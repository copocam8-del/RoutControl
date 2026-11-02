"""Recorrido de una jornada para el mapa (etapa 0, §14 punto 4).

Devuelve el recorrido partido en TRAMOS: un tramo se corta en cada hueco (TrackingGap), así el
mapa no dibuja una línea recta engañosa por donde no hay datos. La distancia se calcula en PostGIS
(geodésica, sobre `geography`) y suma solo dentro de los tramos.

Todo corre dentro del contexto de empresa: el ORM y las consultas SQL quedan filtrados por RLS.
"""

from __future__ import annotations

from django.db import connections

from apps.tenancy.context import app_db
from apps.tenancy.timefmt import iso_utc
from apps.tracking.models import LocationPoint, TrackingGap

from .models import Workday


def _points(workday: Workday) -> list[dict]:
    sql = f"""
        SELECT recorded_at, ST_X(location::geometry), ST_Y(location::geometry), accuracy_m, source, event,
               ST_Distance(location, lag(location) OVER w) AS step_m
          FROM {LocationPoint._meta.db_table}
         WHERE workday_id = %s
        WINDOW w AS (ORDER BY recorded_at, id)
         ORDER BY recorded_at, id
    """
    with connections[app_db()].cursor() as cursor:
        cursor.execute(sql, [str(workday.id)])
        rows = cursor.fetchall()
    return [
        {"t": t, "lng": lng, "lat": lat, "accuracy": acc, "source": source, "event": event, "step_m": step}
        for t, lng, lat, acc, source, event, step in rows
    ]


def build_track(workday: Workday) -> dict:
    points = _points(workday)
    gaps = list(TrackingGap.objects.filter(workday=workday).order_by("from_at"))
    # Los huecos se calculan sobre las mismas marcas (inicio, puntos, fin): un hueco entre dos
    # puntos empieza exactamente en el recorded_at del primero.
    breaks_after = {g.from_at for g in gaps}

    segments: list[list[list[float]]] = []
    distance_m = 0.0
    previous = None
    for p in points:
        starts_new = previous is None or previous["t"] in breaks_after
        if starts_new:
            segments.append([])
        elif p["step_m"] is not None:
            distance_m += p["step_m"]
        segments[-1].append([p["lng"], p["lat"]])
        previous = p

    def where(at):
        """Coordenada del punto más cercano en el tiempo a un extremo del hueco (o None)."""
        match = next((p for p in points if p["t"] == at), None)
        return [match["lng"], match["lat"]] if match else None

    return {
        "segments": {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": coords}
                    if len(coords) > 1
                    else {"type": "Point", "coordinates": coords[0]},
                    "properties": {"segment": i},
                }
                for i, coords in enumerate(segments)
            ],
        },
        "points": {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [p["lng"], p["lat"]]},
                    "properties": {
                        "recorded_at": iso_utc(p["t"]),
                        "accuracy_m": p["accuracy"],
                        "source": p["source"],
                        "event": p["event"],
                    },
                }
                for p in points
            ],
        },
        "gaps": [
            {
                "from_at": iso_utc(g.from_at),
                "to_at": iso_utc(g.to_at),
                "seconds": int((g.to_at - g.from_at).total_seconds()),
                "reason": g.reason,
                "from": where(g.from_at),
                "to": where(g.to_at),
            }
            for g in gaps
        ],
        "stats": {
            "point_count": len(points),
            "segment_count": len(segments),
            "distance_m": round(distance_m, 1),
            "gap_count": len(gaps),
            "gap_seconds": int(sum((g.to_at - g.from_at).total_seconds() for g in gaps)),
        },
    }
