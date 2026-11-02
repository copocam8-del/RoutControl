"""Cierre automático de jornadas olvidadas (§5.4, ADR-010).

Si el repartidor no toca "Finalizar jornada", la jornada se cierra sola al cumplir la duración
máxima de su empresa (settings.max_workday_hours, o TRACKING["DEFAULT_MAX_WORKDAY_HOURS"]):

- estado AUTO_CLOSED, motivo "max_duration";
- ended_at = started_at + la duración máxima (no "ahora"): así se aceptan los puntos grabados dentro
  de la jornada que todavía estén en el teléfono sin enviar, durante la gracia del token;
- el token de seguimiento pasa a la gracia, como en un cierre normal, y se recalculan los huecos.
"""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import connections
from django.utils import timezone

from apps.tenancy.context import app_db, tenant_context
from apps.tracking import services as tracking

from .models import Workday

logger = logging.getLogger("routcontrol.workdays")


def stale_workdays() -> list[tuple[uuid.UUID, uuid.UUID]]:
    with connections[app_db()].cursor() as cursor:
        cursor.execute(
            "SELECT organization_id, workday_id FROM rc_stale_workdays(%s)",
            [float(settings.TRACKING["DEFAULT_MAX_WORKDAY_HOURS"])],
        )
        return list(cursor.fetchall())


def close_forgotten_workdays() -> list[uuid.UUID]:
    closed = []
    for org_id, workday_id in stale_workdays():
        with tenant_context(org_id):
            workday = (
                Workday.objects.select_for_update().select_related("organization").filter(id=workday_id).first()
            )
            if workday is None or workday.status != Workday.Status.ACTIVE:
                continue  # el repartidor la cerró mientras tanto
            limit = workday.started_at + timedelta(hours=tracking.max_workday_hours(workday.organization))
            workday.ended_at = min(limit, timezone.now())
            workday.end_received_at = timezone.now()
            workday.status = Workday.Status.AUTO_CLOSED
            workday.close_reason = "max_duration"
            workday.save()
            tracking.close_tracking_tokens(workday)
            tracking.recompute_gaps(workday)
            from apps.alerts import services as alerts

            alerts.workday_ended(workday)
            closed.append(workday.id)
    if closed:
        logger.info("Jornadas cerradas automáticamente: %s", len(closed))
    return closed
