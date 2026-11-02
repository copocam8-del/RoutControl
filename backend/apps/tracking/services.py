"""Ingesta de lotes GPS, tokens de seguimiento y detección de huecos.

Todo corre dentro del contexto de empresa (RLS activo): las consultas SQL crudas de este módulo
también quedan filtradas por PostgreSQL, no solo por el ORM.
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from django.conf import settings
from django.db import connections
from django.utils import timezone

from apps.tenancy.context import app_db, require_current_org_id
from apps.tenancy.middleware import hash_tracking_token
from apps.workdays.models import Workday

from .models import LocationPoint, TrackingGap, TrackingToken



# --- Tokens ------------------------------------------------------------------------------------


def max_workday_hours(organization) -> float:
    return float(organization.settings.get("max_workday_hours", settings.TRACKING["DEFAULT_MAX_WORKDAY_HOURS"]))


def issue_tracking_token(workday: Workday) -> tuple[str, TrackingToken]:
    """Revoca los tokens anteriores de la jornada y emite uno nuevo. Devuelve el token en claro."""
    now = timezone.now()
    TrackingToken.objects.filter(workday=workday, revoked_at__isnull=True).update(
        revoked_at=now, revoked_reason=TrackingToken.RevokedReason.REISSUED
    )
    raw = secrets.token_urlsafe(32)
    token = TrackingToken.objects.create(
        workday=workday,
        device_id=workday.device_id,
        token_hash=hash_tracking_token(raw),
        expires_at=now + timedelta(hours=max_workday_hours(workday.organization)),
    )
    return raw, token


def token_grace_hours(organization) -> float:
    """Horas de gracia después del fin: por empresa (settings.tracking_token_grace_hours) o global
    (variable de entorno TRACKING_TOKEN_GRACE_AFTER_END_HOURS, por defecto 72)."""
    return float(organization.settings.get("tracking_token_grace_hours", settings.TRACKING["TOKEN_GRACE_AFTER_END_HOURS"]))


def close_tracking_tokens(workday: Workday) -> None:
    """Al finalizar la jornada el token deja de servir para puntos nuevos, pero queda un período de
    gracia para subir los puntos grabados antes del fin que quedaron offline (ADR-003)."""
    # Los puntos grabados después de ended_at se rechazan igual (check_point_window).
    grace_until = timezone.now() + timedelta(hours=token_grace_hours(workday.organization))
    TrackingToken.objects.filter(workday=workday, revoked_at__isnull=True).update(
        expires_at=grace_until, updated_at=timezone.now()
    )


# --- Lotes -------------------------------------------------------------------------------------


@dataclass
class BatchResult:
    accepted: list[str] = field(default_factory=list)
    duplicates: list[str] = field(default_factory=list)
    rejected: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"accepted": self.accepted, "duplicates": self.duplicates, "rejected": self.rejected}


# Motivos de rechazo: un código estable (para la app) y un texto claro (para soporte y el panel).
# Un punto rechazado no se va a aceptar nunca: el teléfono lo puede descartar.
REJECTION_DETAILS = {
    "before_workday_start": "El punto se grabó antes del inicio de la jornada.",
    "after_workday_end": "El punto se grabó después del fin de la jornada.",
    "recorded_in_future": "La hora del punto está en el futuro: revisar el reloj del teléfono.",
    "invalid": "El punto tiene un campo inválido.",
}


def rejection(point_ref: str, reason: str, detail: str | None = None) -> dict:
    return {"id": point_ref, "reason": reason, "detail": detail or REJECTION_DETAILS[reason.split(":")[0]]}


def check_point_window(workday: Workday, recorded_at: datetime, now: datetime) -> str | None:
    """GPS solo durante la jornada: started_at ≤ recorded_at ≤ ended_at (los dos extremos incluidos,
    las dos horas del teléfono). Mientras la jornada está activa, el fin es "ahora" con una
    tolerancia por desfase del reloj. Devuelve el código de rechazo o None."""
    if recorded_at < workday.started_at:
        return "before_workday_start"
    if workday.ended_at is not None:
        if recorded_at > workday.ended_at:
            return "after_workday_end"
    elif recorded_at > now + timedelta(seconds=settings.TRACKING["FUTURE_TOLERANCE_SECONDS"]):
        return "recorded_in_future"
    return None


_INSERT_COLUMNS = (
    "organization_id, point_id, workday_id, driver_id, device_id, location, accuracy_m, speed, heading, "
    "altitude, battery, is_moving, source, event, recorded_at, received_at"
)
_ROW_SQL = (
    "(%s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, "
    "%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
)


def insert_points(workday: Workday, device_id: uuid.UUID, points: list[dict], received_at: datetime) -> set[str]:
    """INSERT … ON CONFLICT (organization_id, point_id) DO NOTHING. Devuelve los point_id insertados."""
    if not points:
        return set()
    org_id = require_current_org_id()
    params: list = []
    for p in points:
        params += [
            str(org_id),
            str(p["point_id"]),
            str(workday.id),
            str(workday.driver_id),
            str(device_id),
            p["lng"],
            p["lat"],
            p["accuracy"],
            p.get("speed"),
            p.get("heading"),
            p.get("altitude"),
            p.get("battery"),
            p.get("is_moving"),
            p.get("source") or LocationPoint.Source.FOREGROUND,
            p.get("event") or "",
            p["recorded_at"],
            received_at,
        ]
    table = LocationPoint._meta.db_table
    sql = (
        f"INSERT INTO {table} ({_INSERT_COLUMNS}) VALUES {', '.join([_ROW_SQL] * len(points))} "
        "ON CONFLICT (organization_id, point_id) DO NOTHING RETURNING point_id"
    )
    with connections[app_db()].cursor() as cursor:
        cursor.execute(sql, params)
        return {str(row[0]) for row in cursor.fetchall()}


# --- Huecos ------------------------------------------------------------------------------------


def gap_threshold_seconds(organization) -> int:
    return int(organization.settings.get("gap_threshold_seconds", settings.TRACKING["DEFAULT_GAP_THRESHOLD_SECONDS"]))


def recompute_gaps(workday: Workday) -> list[TrackingGap]:
    """Recalcula los huecos detectados automáticamente para toda la jornada.

    Se cuentan el inicio, los puntos y (si existe) el fin. Recalcular todo hace que un lote que
    llega tarde y "rellena" un hueco lo elimine. Una jornada tiene a lo sumo miles de puntos, y
    hay un índice (workday_id, recorded_at).
    """
    sql = f"""
        WITH marks AS (
            SELECT started_at AS t FROM {Workday._meta.db_table} WHERE id = %(w)s
            UNION ALL
            SELECT ended_at FROM {Workday._meta.db_table} WHERE id = %(w)s AND ended_at IS NOT NULL
            UNION ALL
            SELECT recorded_at FROM {LocationPoint._meta.db_table} WHERE workday_id = %(w)s
        ), ordered AS (
            SELECT t, lag(t) OVER (ORDER BY t) AS prev FROM marks
        )
        SELECT prev, t FROM ordered
         WHERE prev IS NOT NULL AND t - prev > make_interval(secs => %(s)s)
         ORDER BY prev
    """
    with connections[app_db()].cursor() as cursor:
        cursor.execute(sql, {"w": str(workday.id), "s": gap_threshold_seconds(workday.organization)})
        rows = cursor.fetchall()

    TrackingGap.objects.filter(workday=workday, detected_automatically=True).delete()
    gaps = [TrackingGap(workday=workday, from_at=a, to_at=b) for a, b in rows]
    for gap in gaps:
        gap.save()
    return gaps
