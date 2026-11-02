"""Informes por repartidor y por empresa (etapa 2 de la planificación, ADR-024).

Períodos: día, semana (lunes a domingo), quincena (1–15 y 16–fin de mes), mes o un rango. Todo en
la zona horaria de la empresa. Por repartidor:

- jornadas, horas trabajadas (la jornada en curso cuenta hasta ahora) y kilómetros recorridos (por
  los tramos con señal: no se suma una recta por donde no hay datos, igual que en el recorrido);
- tiempo sin señal (huecos);
- visitas, entregados, no entregados (del destinatario y de logística), tasa de entrega, duración
  promedio de la visita y segundos intentos.

Las jornadas de la PWA (seguimiento solo por eventos) tienen menos puntos: sus kilómetros son un
mínimo y el informe lo marca (planificación §4.2).
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db import connections
from django.utils import timezone

from apps.drivers.models import DriverProfile
from apps.tenancy.context import app_db
from apps.tracking.models import LocationPoint, TrackingGap
from apps.workdays.models import Workday

from .models import Visit

PERIODS = ("day", "week", "fortnight", "month", "range")
MAX_RANGE_DAYS = 366
MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


class ReportError(ValueError):
    pass


@dataclass
class Period:
    kind: str
    first: date  # inclusive
    last: date  # inclusive
    label: str

    def bounds(self, tz: ZoneInfo) -> tuple[datetime, datetime]:
        return datetime.combine(self.first, time.min, tzinfo=tz), datetime.combine(self.last + timedelta(days=1), time.min, tzinfo=tz)


def _d(d: date) -> str:
    return f"{d.day}/{d.month}/{d.year}"


def period(kind: str, anchor: date, first: date | None = None, last: date | None = None) -> Period:
    if kind == "day":
        return Period(kind, anchor, anchor, _d(anchor))
    if kind == "week":
        start = anchor - timedelta(days=anchor.weekday())
        end = start + timedelta(days=6)
        return Period(kind, start, end, f"Semana del {_d(start)} al {_d(end)}")
    if kind == "fortnight":
        last_day = calendar.monthrange(anchor.year, anchor.month)[1]
        if anchor.day <= 15:
            start, end, which = anchor.replace(day=1), anchor.replace(day=15), "Primera"
        else:
            start, end, which = anchor.replace(day=16), anchor.replace(day=last_day), "Segunda"
        return Period(kind, start, end, f"{which} quincena de {MONTHS[anchor.month - 1]} de {anchor.year}")
    if kind == "month":
        start = anchor.replace(day=1)
        end = anchor.replace(day=calendar.monthrange(anchor.year, anchor.month)[1])
        return Period(kind, start, end, f"{MONTHS[anchor.month - 1].capitalize()} de {anchor.year}")
    if kind == "range":
        if not first or not last:
            raise ReportError("Para un rango hacen falta las dos fechas.")
        if last < first:
            raise ReportError("La fecha final es anterior a la inicial.")
        if (last - first).days >= MAX_RANGE_DAYS:
            raise ReportError("El rango puede ser de hasta un año.")
        return Period(kind, first, last, f"Del {_d(first)} al {_d(last)}")
    raise ReportError("Período inválido.")


def _distance_and_gaps(workday_ids: list) -> tuple[dict, dict]:
    if not workday_ids:
        return {}, {}
    lp, gap = LocationPoint._meta.db_table, TrackingGap._meta.db_table
    sql = f"""
        WITH p AS (
            SELECT workday_id,
                   ST_Distance(location, lag(location) OVER w) AS step,
                   lag(recorded_at) OVER w AS prev_t
              FROM {lp}
             WHERE workday_id = ANY(%s::uuid[])
            WINDOW w AS (PARTITION BY workday_id ORDER BY recorded_at, id)
        )
        SELECT p.workday_id, COALESCE(SUM(p.step), 0)
          FROM p
         WHERE p.step IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM {gap} g WHERE g.workday_id = p.workday_id AND g.from_at = p.prev_t)
         GROUP BY p.workday_id
    """
    ids = [str(i) for i in workday_ids]
    with connections[app_db()].cursor() as cursor:
        cursor.execute(sql, [ids])
        distance = {str(w): float(m) for w, m in cursor.fetchall()}
    gaps = defaultdict(float)
    for wid, start, end in TrackingGap.objects.filter(workday_id__in=workday_ids).values_list("workday_id", "from_at", "to_at"):
        gaps[str(wid)] += (end - start).total_seconds()
    return distance, gaps


def _empty() -> dict:
    return {
        "workdays": 0, "hours": 0.0, "distance_km": 0.0, "events_only_workdays": 0, "no_signal_minutes": 0.0,
        "visits": 0, "delivered": 0, "failed": 0, "failed_recipient": 0, "failed_logistic": 0,
        "second_attempts": 0, "visit_seconds": 0.0, "timed_visits": 0,
    }


def _finish(row: dict) -> dict:
    out = {k: v for k, v in row.items() if k not in ("visit_seconds", "timed_visits")}
    out["hours"] = round(row["hours"], 2)
    out["distance_km"] = round(row["distance_km"], 1)
    out["no_signal_minutes"] = round(row["no_signal_minutes"])
    closed = row["delivered"] + row["failed"]
    out["delivery_rate"] = round(row["delivered"] / closed, 3) if closed else None
    out["avg_visit_minutes"] = round(row["visit_seconds"] / row["timed_visits"] / 60, 1) if row["timed_visits"] else None
    return out


def build(organization, p: Period, driver_id=None) -> dict:
    tz = ZoneInfo(organization.timezone)
    start, end = p.bounds(tz)
    now = timezone.now()
    drivers = DriverProfile.objects.select_related("membership__user")
    if driver_id:
        drivers = drivers.filter(id=driver_id)
    names = {d.id: d.membership.user.full_name or d.membership.user.email for d in drivers}
    rows: dict = defaultdict(_empty)

    workdays = list(Workday.objects.filter(started_at__gte=start, started_at__lt=end, driver_id__in=names.keys()))
    distance, gaps = _distance_and_gaps([w.id for w in workdays])
    for w in workdays:
        r = rows[w.driver_id]
        r["workdays"] += 1
        r["hours"] += ((w.ended_at or min(now, end)) - w.started_at).total_seconds() / 3600
        r["distance_km"] += distance.get(str(w.id), 0.0) / 1000
        r["no_signal_minutes"] += gaps.get(str(w.id), 0.0) / 60
        if w.tracking_mode == Workday.TrackingMode.EVENTS_ONLY:
            r["events_only_workdays"] += 1

    visits = Visit.objects.filter(started_at__gte=start, started_at__lt=end, voided=False, driver_id__in=names.keys())
    for driver, outcome, attribution, duration, second in visits.values_list("driver_id", "outcome", "outcome_attribution", "duration_s", "is_second_attempt"):
        r = rows[driver]
        r["visits"] += 1
        if outcome == Visit.Outcome.DELIVERED:
            r["delivered"] += 1
        elif outcome:
            r["failed"] += 1
            if attribution == Visit.Attribution.RECIPIENT:
                r["failed_recipient"] += 1
            elif attribution == Visit.Attribution.LOGISTIC:
                r["failed_logistic"] += 1
        if second:
            r["second_attempts"] += 1
        if duration:
            r["visit_seconds"] += duration
            r["timed_visits"] += 1

    total = _empty()
    by_driver = []
    for did, name in sorted(names.items(), key=lambda kv: kv[1].lower()):
        if did not in rows:
            continue  # sin actividad en el período
        for k, v in rows[did].items():
            total[k] += v
        by_driver.append({"driver": {"id": str(did), "name": name}, **_finish(rows[did])})
    return {
        "period": {"kind": p.kind, "from": p.first.isoformat(), "to": p.last.isoformat(), "label": p.label},
        "drivers": by_driver,
        "total": _finish(total),
    }


# --- Exportación --------------------------------------------------------------------------------

COLUMNS = [
    ("driver", "Repartidor"),
    ("workdays", "Jornadas"),
    ("hours", "Horas"),
    ("distance_km", "Km recorridos"),
    ("no_signal_minutes", "Minutos sin señal"),
    ("visits", "Visitas"),
    ("delivered", "Entregados"),
    ("failed", "No entregados"),
    ("failed_recipient", "No entregados (destinatario)"),
    ("failed_logistic", "No entregados (logística)"),
    ("delivery_rate", "Tasa de entrega"),
    ("avg_visit_minutes", "Minutos promedio por visita"),
    ("second_attempts", "Segundos intentos"),
    ("events_only_workdays", "Jornadas solo con eventos (PWA)"),
]


def table(report: dict) -> list[list]:
    rows = [[label for _, label in COLUMNS]]
    for r in [*report["drivers"], {**report["total"], "driver": {"name": "Total de la empresa"}}]:
        rows.append([r["driver"]["name"] if key == "driver" else r.get(key) for key, _ in COLUMNS])
    return rows


def to_csv(report: dict) -> bytes:
    import csv
    import io

    buf = io.StringIO()
    # Punto y coma y coma decimal: así lo abre Excel en español sin pasos extra.
    w = csv.writer(buf, delimiter=";")
    w.writerow([f"Informe: {report['period']['label']}"])
    for row in table(report):
        w.writerow(["" if v is None else (str(v).replace(".", ",") if isinstance(v, float) else v) for v in row])
    return ("﻿" + buf.getvalue()).encode("utf-8")


def to_xlsx(report: dict) -> bytes:
    import io

    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = "Por repartidor"
    ws.append([f"Informe: {report['period']['label']}"])
    ws["A1"].font = Font(bold=True, size=13)
    for i, row in enumerate(table(report)):
        ws.append(row)
        if i == 0 or row[0] == "Total de la empresa":
            for cell in ws[ws.max_row]:
                cell.font = Font(bold=True)
    rate_col = [k for k, _ in COLUMNS].index("delivery_rate") + 1
    for row in ws.iter_rows(min_row=3, min_col=rate_col, max_col=rate_col):
        for cell in row:
            cell.number_format = "0.0%"
    for col in ws.columns:
        ws.column_dimensions[col[1].column_letter].width = max(12, min(40, max(len(str(c.value or "")) for c in col[1:]) + 2))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
