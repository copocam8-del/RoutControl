"""Alertas configurables del panel (ADR-025).

- **Qué se avisa:** inicio y fin de jornada, sin señal, incidencias y recorrido finalizado. Cada una
  se prende o apaga por empresa (settings["alerts"]); "sin señal" tiene su umbral en minutos.
- **Cómo:** una fila `Notification` por evento, visible para todo el personal de la empresa, y el
  aviso en vivo por el WebSocket del mapa (ADR-017), después del commit. Cada persona tiene su
  "visto hasta" (`NotificationCursor`): lo posterior cuenta como nuevo.
- **Sin duplicados:** `dedupe_key` (por ejemplo, un aviso por cada silencio de una jornada).
- Una alerta nunca hace fallar lo que la disparó: si algo sale mal, se registra y sigue.
"""

from __future__ import annotations

import logging

from django.db import IntegrityError, transaction

from apps.tenancy.context import app_db
from apps.tenancy.timefmt import iso_utc

from .models import Notification

logger = logging.getLogger("routcontrol.alerts")
T = Notification.Type

DEFAULTS = {
    "workday_started": True,
    "workday_ended": True,
    "no_signal": True,
    "no_signal_minutes": 15,
    "incident": True,
    "route_finished": True,
}
TOGGLE = {
    T.WORKDAY_STARTED: "workday_started",
    T.WORKDAY_ENDED: "workday_ended",
    T.NO_SIGNAL: "no_signal",
    T.INCIDENT: "incident",
    T.ROUTE_FINISHED: "route_finished",
}


def config(organization) -> dict:
    custom = (organization.settings or {}).get("alerts", {}) if organization is not None else {}
    return {**DEFAULTS, **{k: v for k, v in custom.items() if k in DEFAULTS}}


def payload(n: Notification) -> dict:
    return {"id": str(n.id), "type": n.type, "title": n.title, "body": n.body, "payload": n.payload, "created_at": iso_utc(n.created_at)}


def emit(organization, type_: str, title: str, body: str = "", data: dict | None = None, dedupe_key: str = "") -> Notification | None:
    """Crea la alerta si está prendida para la empresa (y no existía) y la avisa en vivo."""
    try:
        if not config(organization).get(TOGGLE[type_], True):
            return None
        if dedupe_key and Notification.objects.filter(dedupe_key=dedupe_key).exists():
            return None
        n = Notification(type=type_, title=title, body=body, payload=data or {}, dedupe_key=dedupe_key)
        try:
            with transaction.atomic(using=app_db()):
                n.save(force_insert=True)
        except IntegrityError:
            return None  # la misma alerta, emitida a la vez por otro proceso
        from apps.tracking import live

        # La alerta va adentro: su propio "type" (INCIDENT, …) no pisa el del evento.
        event = {"type": "notification", "notification": payload(n)}
        org_id = organization.id
        transaction.on_commit(lambda: live.publish(org_id, event), using=app_db())
        return n
    except Exception:  # noqa: BLE001 - una alerta nunca rompe la operación que la disparó
        logger.warning("No se pudo emitir la alerta %s", type_, exc_info=True)
        return None


def driver_name(driver) -> str:
    user = driver.membership.user
    return user.full_name or user.email


# --- Disparadores ------------------------------------------------------------------------------


def workday_started(workday) -> None:
    name = driver_name(workday.driver)
    emit(workday.organization, T.WORKDAY_STARTED, f"{name} inició la jornada", "",
         {"workday_id": str(workday.id), "driver_id": str(workday.driver_id)}, f"workday_started:{workday.id}")


def workday_ended(workday) -> None:
    name = driver_name(workday.driver)
    auto = workday.status == "AUTO_CLOSED"
    title = f"La jornada de {name} se cerró sola (duración máxima)" if auto else f"{name} finalizó la jornada"
    emit(workday.organization, T.WORKDAY_ENDED, title, "",
         {"workday_id": str(workday.id), "driver_id": str(workday.driver_id), "auto": auto}, f"workday_ended:{workday.id}")


def incident_created(incident, organization) -> None:
    from apps.packages.models import Visit

    label = dict(Visit.Outcome.choices).get(incident.type, incident.type)
    p = incident.package
    emit(organization, T.INCIDENT, f"Incidencia: {label}", f"{p.tracking_code} · {p.address.raw_text}",
         {"incident_id": str(incident.id), "package_id": str(p.id), "driver_id": str(incident.driver_id)}, f"incident:{incident.id}")


def maybe_route_finished(workday) -> None:
    """Cuando al repartidor no le quedan paradas pendientes en su jornada en curso."""
    from apps.packages.models import Package, Visit

    if workday is None or workday.status != "ACTIVE":
        return
    pending = Package.objects.filter(assigned_driver_id=workday.driver_id, status__in=[Package.Status.ASSIGNED, Package.Status.IN_ROUTE]).exists()
    if pending:
        return
    # Las visitas de esta jornada: por la jornada o, si la app no la mandó (versiones viejas), por
    # el repartidor desde que empezó.
    visits = Visit.objects.filter(driver_id=workday.driver_id, started_at__gte=workday.started_at, voided=False)
    delivered = visits.filter(outcome=Visit.Outcome.DELIVERED).count()
    total = visits.exclude(outcome="").count()
    if not total:
        return
    name = driver_name(workday.driver)
    emit(workday.organization, T.ROUTE_FINISHED, f"{name} terminó su recorrido",
         f"{delivered} entregados y {total - delivered} no entregados.",
         {"workday_id": str(workday.id), "driver_id": str(workday.driver_id)}, f"route_finished:{workday.id}")


def check_no_signal() -> int:
    """Tarea periódica (Celery): jornadas en curso sin ubicaciones hace más del umbral de su empresa.
    Un aviso por cada silencio (se vuelve a avisar si, después de volver la señal, se corta de nuevo)."""
    from datetime import timedelta

    from django.db import connections
    from django.utils import timezone

    from apps.tenancy.context import tenant_context
    from apps.tracking.models import LocationPoint
    from apps.workdays.models import Workday

    with connections[app_db()].cursor() as cursor:
        cursor.execute("SELECT organization_id, workday_id FROM rc_active_workdays()")
        rows = cursor.fetchall()
    emitted = 0
    now = timezone.now()
    for org_id, workday_id in rows:
        with tenant_context(org_id):
            w = Workday.objects.select_related("organization", "driver__membership__user").filter(id=workday_id, status="ACTIVE").first()
            if w is None:
                continue
            cfg = config(w.organization)
            if not cfg["no_signal"]:
                continue
            last = LocationPoint.objects.filter(workday=w).order_by("-recorded_at").values_list("recorded_at", flat=True).first() or w.started_at
            silence = now - last
            if silence < timedelta(minutes=float(cfg["no_signal_minutes"])):
                continue
            minutes = int(silence.total_seconds() // 60)
            n = emit(w.organization, T.NO_SIGNAL, f"{driver_name(w.driver)} está sin señal",
                     f"Última ubicación hace {minutes} min.",
                     {"workday_id": str(w.id), "driver_id": str(w.driver_id), "last_at": iso_utc(last)},
                     f"no_signal:{w.id}:{last.isoformat()}")
            emitted += 1 if n else 0
    return emitted
