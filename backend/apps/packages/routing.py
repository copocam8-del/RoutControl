"""Armar mi ruta (§5.5, ADR-008 y ADR-015): VROOM ordena las paradas y OSRM da los tiempos.

Los dos se autoalojan (infra/routing). Acá solo se habla con VROOM por HTTP: VROOM le pide a OSRM
la matriz de tiempos. Si el servicio no responde, la app sigue con el orden manual.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.tenancy.context import app_db

from . import polyline
from .models import Package, RouteStop

PENDING = [Package.Status.ASSIGNED, Package.Status.IN_ROUTE, Package.Status.FAILED, Package.Status.RESCHEDULED]
# Cuánto tarda en promedio una entrega en la puerta (lo usa VROOM para estimar). Configurable por empresa.
DEFAULT_SERVICE_S = 180


class RoutingUnavailable(Exception):
    """VROOM (o OSRM detrás) no respondió o no pudo armar la ruta."""


def call_vroom(problem: dict) -> dict:
    """POST del problema a VROOM. Separado para poder reemplazarlo en las pruebas."""
    request = urllib.request.Request(
        settings.ROUTING["VROOM_URL"],
        data=json.dumps(problem).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.ROUTING["TIMEOUT_S"]) as response:
            body = json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        raise RoutingUnavailable(str(exc)) from exc
    if body.get("code", 0) != 0:
        raise RoutingUnavailable(body.get("error", "VROOM no pudo armar la ruta"))
    return body


def pending_packages(driver) -> list[Package]:
    return list(Package.objects.filter(assigned_driver=driver, status__in=PENDING).select_related("address").order_by("created_at"))


def optimize(driver, workday, start: dict) -> list[RouteStop]:
    """Ordena los pendientes del repartidor desde su ubicación actual. Los que no tienen
    coordenadas no se pueden ordenar: van al final, en el orden en que se cargaron."""
    packages = pending_packages(driver)
    located = [p for p in packages if p.address.location]
    unlocated = [p for p in packages if not p.address.location]
    service_s = int(workday.organization.settings.get("service_seconds", DEFAULT_SERVICE_S))
    order: list[tuple[Package, int | None, int | None]] = []
    if located:
        problem = {
            # Sin "end": la ruta termina en la última parada (el repartidor no vuelve al depósito).
            "vehicles": [{"id": 1, "profile": "car", "start": [start["lng"], start["lat"]]}],
            "jobs": [
                {"id": i, "location": [p.address.location.x, p.address.location.y], "service": service_s}
                for i, p in enumerate(located, start=1)
            ],
            # g: true: VROOM devuelve la distancia de cada tramo y la geometría por calles, que se
            # corta en un tramo por parada para el mapa de la app.
            "options": {"g": True},
        }
        result = call_vroom(problem)
        first = result["routes"][0] if result.get("routes") else {}
        steps = [s for s in first.get("steps", []) if s["type"] == "job"]
        paths = _leg_paths(first.get("geometry") or "", [located[s["job"] - 1] for s in steps])
        previous_arrival = 0
        previous_distance = 0
        for step, path in zip(steps, paths):
            arrival, distance = step.get("arrival", 0), step.get("distance", 0)
            order.append((located[step["job"] - 1], arrival - previous_arrival, distance - previous_distance, path))
            previous_arrival = arrival + service_s
            previous_distance = distance
        # Los que VROOM no pudo ubicar (sin ruta en OSRM) van al final.
        placed = {p.id for p, *_ in order}
        order += [(p, None, None, "") for p in located if p.id not in placed]
    order += [(p, None, None, "") for p in unlocated]
    return save(workday, order, RouteStop.Source.OPTIMIZED)


def _leg_paths(geometry: str, packages: list[Package]) -> list[str]:
    """Un tramo codificado por parada. Si no hay geometría (o no se puede leer), tramos vacíos."""
    if not geometry:
        return [""] * len(packages)
    try:
        coords = polyline.decode(geometry)
    except (IndexError, ValueError):
        return [""] * len(packages)
    legs = polyline.split_at(coords, [(p.address.location.y, p.address.location.x) for p in packages])
    return [polyline.encode(leg) if len(leg) > 1 else "" for leg in legs]


def save(workday, ordered: list[tuple], source: str) -> list[RouteStop]:
    """ordered: (paquete, eta_s, distance_m[, path])."""
    with transaction.atomic(using=app_db()):
        RouteStop.objects.filter(workday=workday).delete()
        stops = [
            RouteStop(
                workday=workday, package=row[0], sequence=i, source=source, eta_s=row[1], distance_m=row[2], path=row[3] if len(row) > 3 else ""
            )
            for i, row in enumerate(ordered, start=1)
        ]
        for stop in stops:
            stop.save(force_insert=True)
    return stops


def current(workday) -> list[RouteStop]:
    return list(RouteStop.objects.filter(workday=workday).select_related("package").order_by("sequence"))


def now():
    return timezone.now()
