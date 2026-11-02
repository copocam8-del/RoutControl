"""La entrega en la calle (§5.3, ADR-013): visitas con resultado, fotos y comunicaciones.

Todo lo manda el teléfono con un id UUID generado ahí (offline primero): reintentar el envío nunca
duplica. Las horas del teléfono se guardan tal cual (started_at, captured_at) junto a la del
servidor (received_at).
"""

from __future__ import annotations

import hashlib
import uuid

from django.contrib.gis.geos import Point
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone

from . import services
from .models import Communication, Evidence, Incident, Package, Visit

S = Package.Status
O = Visit.Outcome

# §7.2: atribución de cada resultado. "Otro inconveniente" la elige el repartidor.
ATTRIBUTION = {
    O.DELIVERED: Visit.Attribution.NONE,
    O.RECIPIENT_ABSENT: Visit.Attribution.RECIPIENT,
    O.NO_ANSWER: Visit.Attribution.RECIPIENT,
    O.RESCHEDULE_REQUESTED: Visit.Attribution.RECIPIENT,
    O.WRONG_ADDRESS: Visit.Attribution.LOGISTIC,
    O.NO_ACCESS: Visit.Attribution.LOGISTIC,
}

# Estado del paquete según el resultado de la visita.
RESULT_STATUS = {O.DELIVERED: S.DELIVERED, O.RESCHEDULE_REQUESTED: S.RESCHEDULED}

VISITABLE = {S.ASSIGNED, S.IN_ROUTE, S.FAILED, S.RESCHEDULED}

MAX_PHOTO_BYTES = 8 * 1024 * 1024
PHOTO_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def _point(loc):
    return Point(loc["lng"], loc["lat"], srid=4326) if loc else None


def record_visit(driver, data: dict, actor) -> tuple[Visit, bool]:
    """Registra la visita y cambia el estado del paquete. Devuelve (visita, creada)."""
    existing = Visit.objects.filter(id=data["id"]).first()
    if existing is not None:
        if existing.driver_id != driver.id:
            raise services.PackageError("id_in_use", "Ese identificador de visita ya se usó.", 409)
        return existing, False  # reintento: la misma visita
    package = Package.objects.select_for_update().filter(id=data["package_id"], assigned_driver=driver).first()
    if package is None:
        raise services.PackageError("package_not_found", "Paquete no encontrado.", 404)
    if package.status not in VISITABLE:
        raise services.PackageError(
            "not_visitable", f"El paquete está {S(package.status).label.lower()}: no admite otra visita.", 409
        )
    outcome = data["outcome"]
    attribution = ATTRIBUTION.get(outcome) or data.get("attribution") or Visit.Attribution.NONE
    ended_at = data.get("ended_at")
    visit = Visit(
        id=data["id"],
        package=package,
        address_id=package.address_id,
        workday_id=data.get("workday_id"),
        driver=driver,
        started_at=data["started_at"],
        ended_at=ended_at,
        duration_s=int((ended_at - data["started_at"]).total_seconds()) if ended_at else None,
        start_location=_point(data.get("start_location")),
        end_location=_point(data.get("end_location")),
        outcome=outcome,
        outcome_attribution=attribution,
        notes=data.get("notes", ""),
        is_second_attempt=package.visits.exists(),
    )
    visit.save(force_insert=True)
    # Si no se cargó con el escaneo, el paquete pasa por "En camino" antes del resultado.
    if package.status in (S.ASSIGNED, S.FAILED, S.RESCHEDULED):
        services.change_status(package, S.IN_ROUTE, actor, visit_id=str(visit.id))
    services.change_status(
        package, RESULT_STATUS.get(outcome, S.FAILED), actor, visit_id=str(visit.id), outcome=outcome, attribution=attribution
    )
    if outcome != O.DELIVERED:
        # Una entrega que no se pudo hacer es una incidencia para el panel (ADR-016). El id deriva
        # del de la visita: reintentar no duplica.
        Incident(
            id=uuid.uuid5(visit.id, "incident"),
            package=package,
            visit=visit,
            driver=driver,
            type=outcome,
            description=visit.notes,
            occurred_at=ended_at or data["started_at"],
        ).save(force_insert=True)
    return visit, True


def save_evidence(driver, data: dict, upload) -> tuple[Evidence, bool]:
    existing = Evidence.objects.filter(id=data["id"]).first()
    if existing is not None:
        if existing.driver_id != driver.id:
            raise services.PackageError("id_in_use", "Ese identificador de foto ya se usó.", 409)
        return existing, False
    package = Package.objects.filter(id=data["package_id"], assigned_driver=driver).first()
    if package is None:
        raise services.PackageError("package_not_found", "Paquete no encontrado.", 404)
    visit_id = data.get("visit_id")
    if visit_id and not Visit.objects.filter(id=visit_id, package=package).exists():
        raise services.PackageError("visit_not_found", "La visita de la foto no existe (todavía no llegó).", 409)
    mime = (upload.content_type or "").split(";")[0].lower()
    if mime not in PHOTO_TYPES:
        raise services.PackageError("bad_type", "La foto tiene que ser JPG, PNG o WEBP.", 400)
    content = upload.read(MAX_PHOTO_BYTES + 1)
    if len(content) > MAX_PHOTO_BYTES:
        raise services.PackageError("too_large", "La foto supera los 8 MB.", 400)
    # Ruta por empresa: evidencia/<empresa>/<paquete>/<id>.<ext>. Nunca se sirve directo: solo por la API.
    key = f"evidencia/{package.organization_id}/{package.id}/{data['id']}.{PHOTO_TYPES[mime]}"
    stored = default_storage.save(key, ContentFile(content))
    evidence = Evidence(
        id=data["id"],
        visit_id=visit_id,
        package=package,
        address_id=package.address_id,
        driver=driver,
        reason=data.get("reason", ""),
        storage_key=stored,
        mime=mime,
        size=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        location=_point(data.get("location")),
        captured_at=data["captured_at"],
        upload_status=Evidence.UploadStatus.UPLOADED,
    )
    evidence.save(force_insert=True)
    return evidence, True


def record_communication(driver, data: dict) -> tuple[Communication, bool]:
    existing = Communication.objects.filter(id=data["id"]).first()
    if existing is not None:
        return existing, False
    package = Package.objects.filter(id=data["package_id"], assigned_driver=driver).first()
    if package is None:
        raise services.PackageError("package_not_found", "Paquete no encontrado.", 404)
    item = Communication(
        id=data["id"],
        package=package,
        driver=driver,
        channel=data["channel"],
        started_at=data["started_at"],
        result=data.get("result", ""),
    )
    item.save(force_insert=True)
    return item, True


def now():
    return timezone.now()


def load_packages(driver, codes: list[str], actor) -> list[dict]:
    """Carga con escaneo (ADR-014): cada código asignado a este repartidor pasa a "En camino".

    Respuesta por código (sin revelar nada de paquetes ajenos):
    - loaded: estaba asignado y pasó a En camino;
    - already_loaded: ya estaba En camino (escaneo repetido, reintento);
    - not_assigned: no existe, o no está asignado a este repartidor (la misma respuesta);
    - not_loadable: es suyo pero ya está entregado, cancelado o devuelto.
    """
    results = []
    seen = set()
    for raw in codes:
        code = raw.strip()
        if not code or code in seen:
            continue
        seen.add(code)
        package = Package.objects.select_for_update().filter(tracking_code=code, assigned_driver=driver).first()
        if package is None:
            results.append({"code": code, "result": "not_assigned"})
        elif package.status == S.IN_ROUTE:
            results.append({"code": code, "result": "already_loaded", "package_id": str(package.id)})
        elif package.status in (S.ASSIGNED, S.FAILED, S.RESCHEDULED):
            services.change_status(package, S.IN_ROUTE, actor, source="scan")
            results.append({"code": code, "result": "loaded", "package_id": str(package.id)})
        else:
            results.append({"code": code, "result": "not_loadable", "package_id": str(package.id), "status": package.status})
    return results
