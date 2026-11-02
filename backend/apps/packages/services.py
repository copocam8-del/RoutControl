"""Reglas de los paquetes: alta, edición, asignación y transiciones de estado, siempre con su evento.

Se llaman dentro del contexto de la empresa (la request ya lo tiene): todo queda filtrado por RLS.
"""

from __future__ import annotations

import re
import unicodedata

from django.contrib.gis.geos import Point
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.drivers.models import DriverProfile
from apps.tenancy.context import app_db

from .models import Address, Package, PackageEvent

S = Package.Status

# Estados finales: el paquete ya no se mueve (salvo que se cree una visita nueva en la etapa 2).
FINAL = {S.DELIVERED, S.RETURNED, S.CANCELLED}

# Transiciones permitidas (§7.2). Los cambios hechos por el repartidor en la calle (IN_ROUTE y el
# resultado de la visita) llegan en las partes siguientes, pero ya respetan esta tabla.
TRANSITIONS: dict[str, set[str]] = {
    S.CREATED: {S.ASSIGNED, S.CANCELLED},
    S.ASSIGNED: {S.CREATED, S.IN_ROUTE, S.CANCELLED},
    S.IN_ROUTE: {S.DELIVERED, S.FAILED, S.RESCHEDULED, S.RETURNED, S.ASSIGNED, S.CANCELLED},
    S.FAILED: {S.ASSIGNED, S.IN_ROUTE, S.RESCHEDULED, S.RETURNED, S.CANCELLED},
    S.RESCHEDULED: {S.ASSIGNED, S.IN_ROUTE, S.RETURNED, S.CANCELLED},
    S.DELIVERED: set(),
    S.RETURNED: set(),
    S.CANCELLED: set(),
}


class PackageError(Exception):
    def __init__(self, code: str, detail: str, status: int = 400):
        super().__init__(detail)
        self.code, self.detail, self.status = code, detail, status


def normalize_address(text: str) -> str:
    """Minúsculas, sin acentos, sin signos y con un solo espacio: "Av. Corrientes 1234, CABA" →
    "av corrientes 1234 caba". Sirve para reconocer el mismo domicilio escrito distinto."""
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", plain.lower())).strip()


def get_or_create_address(data: dict) -> Address:
    raw = (data.get("raw_text") or "").strip()
    if not raw:
        parts = [data.get("street", ""), data.get("number", ""), data.get("locality", "")]
        raw = " ".join(p for p in parts if p).strip()
    if not raw:
        raise PackageError("address_required", "Falta la dirección.")
    key = normalize_address(raw)
    address = Address.objects.filter(normalized_key=key).first()
    if address is None:
        address = Address(raw_text=raw, normalized_key=key)
    for field in ("street", "number", "floor_unit", "locality", "province", "postal_code"):
        if data.get(field):
            setattr(address, field, data[field])
    lat, lng = data.get("lat"), data.get("lng")
    if lat is not None and lng is not None:
        address.location = Point(float(lng), float(lat), srid=4326)
        address.geocode_provider = data.get("geocode_provider") or "manual"
    address.save()
    return address


def _event(package: Package, type_: str, actor, from_status="", to_status="", **payload) -> PackageEvent:
    return PackageEvent.objects.create(
        package=package,
        type=type_,
        from_status=from_status,
        to_status=to_status,
        actor=actor,
        payload=payload,
        occurred_at=timezone.now(),
    )


def create_package(data: dict, actor, source: str = Package.Source.MANUAL, import_job_id=None) -> Package:
    with transaction.atomic(using=app_db()):
        address = get_or_create_address(data.get("address") or {})
        package = Package(
            tracking_code=data["tracking_code"].strip(),
            source=source,
            recipient_name=data.get("recipient_name", "").strip(),
            recipient_phone=data.get("recipient_phone", "").strip(),
            address=address,
            notes=data.get("notes", ""),
            import_job_id=import_job_id,
        )
        try:
            with transaction.atomic(using=app_db()):
                package.save(force_insert=True)
        except IntegrityError as exc:
            raise PackageError("duplicate_tracking_code", f"Ya existe un paquete con el código {package.tracking_code}.", 409) from exc
        _event(package, PackageEvent.Type.CREATED, actor, to_status=package.status, source=source)
        if data.get("driver_id"):
            assign(package, data["driver_id"], actor, expected_version=package.version)
        return package


EDITABLE = ("recipient_name", "recipient_phone", "notes", "tracking_code")


def update_package(package: Package, data: dict, actor, expected_version: int) -> Package:
    if package.version != expected_version:
        raise PackageError("version_conflict", "Otra persona modificó este paquete. Recargalo y volvé a intentar.", 409)
    if package.status in FINAL:
        raise PackageError("final_status", "El paquete ya está cerrado y no se puede editar.", 409)
    changes = {}
    for field in EDITABLE:
        if field in data and getattr(package, field) != data[field]:
            changes[field] = {"from": getattr(package, field), "to": data[field]}
            setattr(package, field, data[field])
    if "address" in data:
        address = get_or_create_address(data["address"])
        if address.id != package.address_id:
            changes["address"] = {"from": package.address.raw_text, "to": address.raw_text}
            package.address = address
    if not changes:
        return package
    package.version += 1
    try:
        with transaction.atomic(using=app_db()):
            package.save()
    except IntegrityError as exc:
        raise PackageError("duplicate_tracking_code", "Ya existe un paquete con ese código.", 409) from exc
    _event(package, PackageEvent.Type.UPDATED, actor, changes=changes)
    return package


def change_status(package: Package, to_status: str, actor, **payload) -> Package:
    if to_status not in TRANSITIONS.get(package.status, set()):
        raise PackageError(
            "invalid_transition",
            f"No se puede pasar de {S(package.status).label} a {S(to_status).label}.",
            409,
        )
    from_status = package.status
    package.status = to_status
    package.version += 1
    package.save(update_fields=["status", "version", "updated_at"])
    _event(package, PackageEvent.Type.STATUS_CHANGED, actor, from_status=from_status, to_status=to_status, **payload)
    return package


def assign(package: Package, driver_id, actor, expected_version: int) -> Package:
    """Asigna (o desasigna con driver_id=None). Solo a un repartidor activo de la misma empresa."""
    if package.version != expected_version:
        raise PackageError("version_conflict", "Otra persona modificó este paquete. Recargalo y volvé a intentar.", 409)
    if package.status not in (S.CREATED, S.ASSIGNED, S.FAILED, S.RESCHEDULED):
        raise PackageError("not_assignable", f"Un paquete {S(package.status).label.lower()} no se puede reasignar.", 409)
    from_status = package.status
    if driver_id is None:
        if package.assigned_driver_id is None:
            return package
        previous = package.assigned_driver_id
        package.assigned_driver = None
        package.assigned_at = None
        package.status = S.CREATED
        package.version += 1
        package.save()
        _event(package, PackageEvent.Type.UNASSIGNED, actor, from_status=from_status, to_status=package.status, driver_id=str(previous))
        return package
    # Con RLS, un repartidor de otra empresa simplemente no existe para esta consulta.
    driver = DriverProfile.objects.filter(id=driver_id, status=DriverProfile.Status.ACTIVE).select_related("membership").first()
    if driver is None or driver.membership.status != "ACTIVE":
        raise PackageError("driver_not_found", "No hay un repartidor activo con ese identificador.", 400)
    if package.assigned_driver_id == driver.id and package.status == S.ASSIGNED:
        return package
    package.assigned_driver = driver
    package.assigned_at = timezone.now()
    package.status = S.ASSIGNED
    package.version += 1
    package.save()
    _event(package, PackageEvent.Type.ASSIGNED, actor, from_status=from_status, to_status=S.ASSIGNED, driver_id=str(driver.id))
    return package
