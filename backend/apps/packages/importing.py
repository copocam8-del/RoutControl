"""Importación genérica de paquetes desde CSV o Excel (§6, ADR-012).

Todavía no hay un archivo de ejemplo de los clientes, así que es flexible:
- **CSV:** separador `,`, `;` o tabulación (se detecta solo); UTF-8 (con o sin BOM) o Latin-1.
- **Excel:** `.xlsx` (la primera hoja).
- La primera fila con datos es el encabezado. Las columnas se **mapean** a los campos de
  RouteControl; se sugiere un mapeo por nombre (en español e inglés) y el usuario lo corrige.
- Cada fila se valida por separado: los errores se informan por fila y campo, y al confirmar se
  crean solo las filas válidas.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from dataclasses import dataclass, field

from apps.drivers.models import DriverProfile

from .models import Package
from .services import normalize_address

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 5000

# Campo de RouteControl → nombres de columna habituales (se comparan normalizados).
FIELDS: dict[str, dict] = {
    "tracking_code": {"label": "Código de seguimiento", "required": True, "aliases": [
        "codigo", "codigo de seguimiento", "seguimiento", "tracking", "tracking code", "tracking number",
        "guia", "nro de guia", "numero de guia", "id envio", "envio", "pedido", "nro pedido", "orden", "remito", "id", "codigo envio",
    ]},
    "recipient_name": {"label": "Destinatario", "aliases": [
        "destinatario", "nombre", "cliente", "nombre cliente", "nombre y apellido", "recipient", "recipient name", "name", "receptor",
    ]},
    "recipient_phone": {"label": "Teléfono", "aliases": [
        "telefono", "tel", "celular", "movil", "whatsapp", "phone", "telefono destinatario", "contacto",
    ]},
    "address": {"label": "Dirección completa", "aliases": [
        "direccion", "domicilio", "direccion completa", "domicilio completo", "address", "direccion de entrega", "destino",
    ]},
    "street": {"label": "Calle", "aliases": ["calle", "street"]},
    "number": {"label": "Altura", "aliases": ["altura", "numero", "nro", "number", "num"]},
    "floor_unit": {"label": "Piso / depto", "aliases": ["piso", "depto", "departamento", "piso depto", "unidad", "dpto"]},
    "locality": {"label": "Localidad", "aliases": ["localidad", "barrio", "ciudad", "partido", "city", "locality"]},
    "province": {"label": "Provincia", "aliases": ["provincia", "province", "state"]},
    "postal_code": {"label": "Código postal", "aliases": ["cp", "codigo postal", "postal", "zip", "postal code"]},
    "notes": {"label": "Observaciones", "aliases": ["observaciones", "notas", "comentarios", "obs", "notes", "indicaciones"]},
    "lat": {"label": "Latitud", "aliases": ["lat", "latitud", "latitude"]},
    "lng": {"label": "Longitud", "aliases": ["lng", "lon", "long", "longitud", "longitude"]},
    "driver_email": {"label": "Repartidor (email)", "aliases": ["repartidor", "email repartidor", "chofer", "driver", "driver email"]},
}


class ImportError_(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code, self.detail = code, detail


def _norm(text: str) -> str:
    plain = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", plain)).strip()


def _decode(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ImportError_("encoding", "No se pudo leer el archivo: guardalo como CSV UTF-8 o Excel.")


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))  # Excel guarda los códigos numéricos como 123.0
    return str(value).strip()


def read_table(filename: str, raw: bytes) -> tuple[list[str], list[list[str]]]:
    """Devuelve (encabezados, filas) como texto. Ignora filas vacías."""
    if len(raw) > MAX_BYTES:
        raise ImportError_("too_large", "El archivo supera los 5 MB.")
    name = filename.lower()
    if name.endswith((".xlsx", ".xlsm")):
        try:
            from openpyxl import load_workbook

            sheet = load_workbook(io.BytesIO(raw), read_only=True, data_only=True).worksheets[0]
            rows = [[_cell(c) for c in row] for row in sheet.iter_rows(values_only=True)]
        except Exception as exc:  # archivo dañado o que no es Excel
            raise ImportError_("unreadable", "No se pudo leer el Excel. Probá guardarlo de nuevo como .xlsx.") from exc
    elif name.endswith(".xls"):
        raise ImportError_("old_excel", "Los .xls viejos no se leen: guardalo como .xlsx o CSV.")
    else:
        text = _decode(raw)
        sample = text[:4096]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
            delimiter = dialect.delimiter
        except csv.Error:
            delimiter = ";" if sample.count(";") > sample.count(",") else ","
        rows = [[c.strip() for c in row] for row in csv.reader(io.StringIO(text), delimiter=delimiter)]
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        raise ImportError_("empty", "El archivo está vacío.")
    headers = [h or f"Columna {i + 1}" for i, h in enumerate(rows[0])]
    body = rows[1:]
    if len(body) > MAX_ROWS:
        raise ImportError_("too_many_rows", f"El archivo tiene más de {MAX_ROWS} filas. Dividilo en partes.")
    width = len(headers)
    return headers, [(r + [""] * width)[:width] for r in body]


def suggest_mapping(headers: list[str]) -> dict[str, str | None]:
    """Campo → encabezado sugerido (o None). Cada columna se usa una sola vez."""
    normalized = {_norm(h): h for h in headers}
    used: set[str] = set()
    mapping: dict[str, str | None] = {}
    for field_name, spec in FIELDS.items():
        match = None
        for alias in [field_name.replace("_", " "), *spec["aliases"]]:
            header = normalized.get(_norm(alias))
            if header and header not in used:
                match = header
                break
        if match:
            used.add(match)
        mapping[field_name] = match
    # Si hay dirección completa, calle y altura sueltas no hacen falta (y al revés).
    return mapping


@dataclass
class RowResult:
    row: int  # número de fila en el archivo (el encabezado es la 1)
    values: dict
    errors: list[dict] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def validate_mapping(mapping: dict, headers: list[str]) -> None:
    unknown_fields = set(mapping) - set(FIELDS)
    if unknown_fields:
        raise ImportError_("unknown_field", f"Campos desconocidos: {', '.join(sorted(unknown_fields))}.")
    bad = {h for h in mapping.values() if h and h not in headers}
    if bad:
        raise ImportError_("unknown_column", f"Columnas que no están en el archivo: {', '.join(sorted(bad))}.")
    if not mapping.get("tracking_code"):
        raise ImportError_("missing_tracking_code", "Elegí la columna del código de seguimiento.")
    if not (mapping.get("address") or mapping.get("street")):
        raise ImportError_("missing_address", "Elegí la columna de la dirección (completa, o al menos la calle).")


def evaluate(headers: list[str], rows: list[list[str]], mapping: dict) -> list[RowResult]:
    """Valida cada fila con el mapeo. Dentro del contexto de la empresa (para ver duplicados)."""
    validate_mapping(mapping, headers)
    index = {h: i for i, h in enumerate(headers)}
    codes_in_file: dict[str, int] = {}
    existing = set(
        Package.objects.filter(
            tracking_code__in=[r[index[mapping["tracking_code"]]].strip() for r in rows]
        ).values_list("tracking_code", flat=True)
    )
    drivers = {}
    if mapping.get("driver_email"):
        emails = {r[index[mapping["driver_email"]]].strip().lower() for r in rows} - {""}
        drivers = {
            d.membership.user.email.lower(): d
            for d in DriverProfile.objects.filter(
                membership__user__email__in=emails, status=DriverProfile.Status.ACTIVE, membership__status="ACTIVE"
            ).select_related("membership__user")
        }

    results = []
    for n, row in enumerate(rows, start=2):
        values = {f: row[index[h]].strip() for f, h in mapping.items() if h}
        result = RowResult(row=n, values=values)
        code = values.get("tracking_code", "")
        if not code:
            result.errors.append({"field": "tracking_code", "message": "Falta el código de seguimiento."})
        elif len(code) > 80:
            result.errors.append({"field": "tracking_code", "message": "El código tiene más de 80 caracteres."})
        elif code in existing:
            result.errors.append({"field": "tracking_code", "message": f"Ya existe un paquete con el código {code}."})
        elif code in codes_in_file:
            result.errors.append({"field": "tracking_code", "message": f"Código repetido (también en la fila {codes_in_file[code]})."})
        else:
            codes_in_file[code] = n
        address = values.get("address") or " ".join(
            v for v in (values.get("street", ""), values.get("number", ""), values.get("locality", "")) if v
        )
        if not normalize_address(address):
            result.errors.append({"field": "address", "message": "Falta la dirección."})
        for coord, low, high in (("lat", -90, 90), ("lng", -180, 180)):
            raw = values.get(coord, "")
            if raw:
                try:
                    number = float(raw.replace(",", "."))
                    if not low <= number <= high:
                        raise ValueError
                    values[coord] = number
                except ValueError:
                    result.errors.append({"field": coord, "message": f"{FIELDS[coord]['label']} inválida: {raw}."})
        if bool(values.get("lat")) != bool(values.get("lng")):
            result.errors.append({"field": "lat", "message": "Hacen falta latitud y longitud juntas."})
        email = values.get("driver_email", "").lower()
        if email:
            driver = drivers.get(email)
            if driver is None:
                result.errors.append({"field": "driver_email", "message": f"No hay un repartidor activo con el email {email}."})
            else:
                values["driver_id"] = str(driver.id)
        results.append(result)
    return results


def package_input(values: dict) -> dict:
    address = {
        "raw_text": values.get("address", ""),
        **{k: values.get(k, "") for k in ("street", "number", "floor_unit", "locality", "province", "postal_code")},
    }
    if isinstance(values.get("lat"), float) and isinstance(values.get("lng"), float):
        address["lat"], address["lng"] = values["lat"], values["lng"]
        address["geocode_provider"] = "import"
    return {
        "tracking_code": values["tracking_code"],
        "recipient_name": values.get("recipient_name", ""),
        "recipient_phone": values.get("recipient_phone", ""),
        "notes": values.get("notes", ""),
        "address": address,
        "driver_id": values.get("driver_id"),
    }
