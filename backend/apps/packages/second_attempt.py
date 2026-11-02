"""Segundo intento con sugerencia de desvío (planificación §7.2 `SecondAttemptRequest`, ADR-023).

Cuando un paquete no se entregó, el panel puede pedir un segundo intento. Se calcula, para el
repartidor asignado y su jornada en curso, cuánto le cuesta sumarlo:

- **Inserción más barata:** entre cada par de puntos consecutivos de lo que le queda (su última
  ubicación y las paradas pendientes en el orden de la ruta), el lugar donde sumar el domicilio
  agrega menos camino. También se mide ponerlo al final.
- **Estimación en línea recta** × 1,3 (las calles no son rectas) a 20 km/h (ciudad, con paradas).
  Es deliberadamente simple: no depende de que OSRM esté prendido y alcanza para decidir "ahora,
  al final o mañana". Los valores se configuran por empresa (settings["second_attempt"]).
- **Sugerencia:** desvío ≤ 10 min → insertarlo ahí; ≤ 25 min → al final de la ruta; más, o sin
  jornada en curso → al día siguiente. La decide una persona del panel.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from apps.tenancy.context import app_db
from apps.tracking.models import LocationPoint
from apps.workdays.models import Workday

from . import routing, services
from .models import Package, PackageEvent, RouteStop, SecondAttemptRequest

S = Package.Status
SA = SecondAttemptRequest
DEFAULTS = {"insert_max_min": 10, "end_max_min": 25, "speed_kmh": 20, "road_factor": 1.3}
REQUESTABLE = {S.FAILED, S.RESCHEDULED}


def config(organization) -> dict:
    custom = (organization.settings or {}).get("second_attempt", {}) if organization is not None else {}
    return {**DEFAULTS, **{k: v for k, v in custom.items() if k in DEFAULTS}}


@dataclass
class Point:
    lat: float
    lng: float
    package: Package | None = None


def meters(a: Point, b: Point) -> float:
    from math import asin, cos, radians, sin, sqrt

    dlat, dlng = radians(b.lat - a.lat), radians(b.lng - a.lng)
    h = sin(dlat / 2) ** 2 + cos(radians(a.lat)) * cos(radians(b.lat)) * sin(dlng / 2) ** 2
    return 2 * 6_371_000 * asin(sqrt(h))


def cheapest_insertion(route: list[Point], x: Point) -> tuple[int, float, float]:
    """(posición, metros extra insertando ahí, metros extra al final). `route[0]` es dónde está el
    repartidor; la posición i significa "después de route[i]"."""
    end_extra = meters(route[-1], x)
    best_i, best = len(route) - 1, end_extra
    for i in range(len(route) - 1):
        a, b = route[i], route[i + 1]
        extra = meters(a, x) + meters(x, b) - meters(a, b)
        if extra < best:
            best_i, best = i, extra
    return best_i, best, end_extra


def _current_position(workday) -> Point | None:
    last = LocationPoint.objects.filter(workday=workday).order_by("-recorded_at").values_list("location", flat=True).first()
    if last is not None:
        return Point(last.y, last.x)
    if workday.start_location is not None:
        return Point(workday.start_location.y, workday.start_location.x)
    return None


def _pending_route(workday, driver, exclude_id) -> list[Package]:
    """Lo que le queda al repartidor, en el orden de la ruta (si hay) y después el resto."""
    pending = {p.id: p for p in routing.pending_packages(driver) if p.id != exclude_id and p.status in (S.ASSIGNED, S.IN_ROUTE)}
    ordered = [s.package_id for s in RouteStop.objects.filter(workday=workday).order_by("sequence")]
    out = [pending.pop(pid) for pid in ordered if pid in pending]
    return out + list(pending.values())


def suggest(package: Package) -> dict:
    """La sugerencia para el paquete, sin guardar nada."""
    cfg = config(package.organization)
    speed = float(cfg["speed_kmh"]) * 1000 / 3600
    factor = float(cfg["road_factor"])
    base = {"workday": None, "distance_m": None, "detour_s": None, "pending_count": 0, "insert_after": None, "insert_position": None}
    driver = package.assigned_driver
    workday = Workday.objects.filter(driver=driver, status=Workday.Status.ACTIVE).first() if driver else None
    loc = package.address.location
    if driver is None:
        return {**base, "suggestion": SA.Suggestion.NEXT_DAY, "suggestion_reason": "El paquete no tiene repartidor asignado."}
    if loc is None:
        return {**base, "suggestion": SA.Suggestion.END, "suggestion_reason": "El domicilio no tiene ubicación: no se puede medir el desvío; queda al final de la ruta."}
    if workday is None:
        return {**base, "suggestion": SA.Suggestion.NEXT_DAY, "suggestion_reason": "El repartidor no está en jornada."}
    here = _current_position(workday)
    pending = _pending_route(workday, driver, package.id)
    stops = [Point(p.address.location.y, p.address.location.x, p) for p in pending if p.address.location]
    x = Point(loc.y, loc.x, package)
    if here is None and not stops:
        return {**base, "workday": workday, "suggestion": SA.Suggestion.INSERT, "suggestion_reason": "No le quedan paradas: puede ir directamente."}
    route = ([here] if here else []) + stops
    i, extra_m, end_m = cheapest_insertion(route, x)
    detour_s = round(extra_m * factor / speed)
    end_s = round(end_m * factor / speed)
    after = route[i].package  # None si conviene ir primero (después de su ubicación actual)
    position = sum(1 for p in route[: i + 1] if p.package is not None)  # paradas antes del paquete
    result = {
        **base,
        "workday": workday,
        "distance_m": round(meters(here, x)) if here else None,
        "pending_count": len(pending),
        "detour_s": detour_s,
        "insert_after": after,
        "insert_position": position,
    }
    minutes = lambda s: max(1, round(s / 60))  # noqa: E731
    if detour_s <= float(cfg["insert_max_min"]) * 60:
        where = f"después de la parada {position}" if position else "como próxima parada"
        return {**result, "suggestion": SA.Suggestion.INSERT, "suggestion_reason": f"Insertarlo {where}: suma unos {minutes(detour_s)} min de recorrido."}
    if end_s <= float(cfg["end_max_min"]) * 60:
        return {**result, "detour_s": end_s, "insert_after": None, "insert_position": len(pending), "suggestion": SA.Suggestion.END,
                "suggestion_reason": f"Al final de la ruta: suma unos {minutes(end_s)} min (insertarlo antes desviaría {minutes(detour_s)} min)."}
    return {**result, "suggestion": SA.Suggestion.NEXT_DAY, "suggestion_reason": f"Queda lejos de la ruta de hoy (unos {minutes(min(detour_s, end_s))} min de desvío): mejor mañana."}


def request(package: Package, user, window_start=None, window_end=None, note: str = "") -> SecondAttemptRequest:
    if package.status not in REQUESTABLE:
        raise services.PackageError("not_failed", "Solo se pide un segundo intento de un paquete no entregado.", 409)
    if SA.objects.filter(package=package, decision=SA.Decision.PENDING).exists():
        raise services.PackageError("already_requested", "Ya hay un pedido de segundo intento pendiente para este paquete.", 409)
    if window_start and window_end and window_end <= window_start:
        raise services.PackageError("bad_window", "La franja termina antes de empezar.")
    s = suggest(package)
    req = SA(package=package, requested_by=user, window_start=window_start, window_end=window_end, note=note, **s)
    req.save(force_insert=True)
    services._event(package, PackageEvent.Type.UPDATED, user, changes={"second_attempt": "requested"}, suggestion=req.suggestion)
    return req


def decide(req: SecondAttemptRequest, user, accept: bool, placement: str | None = None) -> SecondAttemptRequest:
    if req.decision != SA.Decision.PENDING:
        raise services.PackageError("already_decided", "Este pedido ya se decidió.", 409)
    with transaction.atomic(using=app_db()):
        req.decided_by, req.decided_at = user, timezone.now()
        if not accept:
            req.decision = SA.Decision.REJECTED
            req.save()
            return req
        placement = placement or req.suggestion
        if placement not in SA.Suggestion.values:
            raise services.PackageError("bad_placement", "Ubicación inválida.")
        package = Package.objects.select_for_update().get(id=req.package_id)
        if package.status not in REQUESTABLE:
            raise services.PackageError("not_failed", "El paquete ya no está como no entregado.", 409)
        req.decision, req.placement = SA.Decision.ACCEPTED, placement
        req.save()
        if placement == SA.Suggestion.NEXT_DAY:
            # Mañana: queda reprogramado (sigue asignado y visible como segundo intento).
            if package.status != S.RESCHEDULED:
                services.change_status(package, S.RESCHEDULED, user, reason="Segundo intento al día siguiente")
            return req
        services.change_status(package, S.ASSIGNED, user, reason="Segundo intento")
        workday = Workday.objects.filter(driver=package.assigned_driver, status=Workday.Status.ACTIVE).first() if package.assigned_driver else None
        if workday is not None:
            _place_in_route(workday, package, req.insert_after if placement == SA.Suggestion.INSERT else None, at_end=placement == SA.Suggestion.END)
    return req


def _place_in_route(workday, package, after: Package | None, at_end: bool) -> None:
    """Reescribe el orden de la ruta con el paquete en su lugar (los demás, igual)."""
    current = [s.package for s in RouteStop.objects.filter(workday=workday).select_related("package").order_by("sequence") if s.package_id != package.id]
    stops = {s.package_id: s for s in RouteStop.objects.filter(workday=workday)}
    if at_end or not current and after is None:
        order = current + [package]
    elif after is None:
        order = [package] + current
    else:
        idx = next((i for i, p in enumerate(current) if p.id == after.id), len(current) - 1)
        order = current[: idx + 1] + [package] + current[idx + 1 :]
    source = RouteStop.Source.MANUAL if not stops else next(iter(stops.values())).source
    rows = [(p, getattr(stops.get(p.id), "eta_s", None), getattr(stops.get(p.id), "distance_m", None), getattr(stops.get(p.id), "path", "")) for p in order]
    routing.save(workday, rows, source)


def payload(req: SecondAttemptRequest) -> dict:
    from apps.tenancy.timefmt import iso_utc

    p = req.package
    return {
        "id": str(req.id),
        "package": {"id": str(p.id), "tracking_code": p.tracking_code, "recipient_name": p.recipient_name, "address": p.address.raw_text, "status": p.status},
        "requested_at": iso_utc(req.requested_at),
        "window_start": iso_utc(req.window_start),
        "window_end": iso_utc(req.window_end),
        "note": req.note,
        "distance_m": req.distance_m,
        "detour_s": req.detour_s,
        "pending_count": req.pending_count,
        "insert_position": req.insert_position,
        "suggestion": req.suggestion,
        "suggestion_reason": req.suggestion_reason,
        "decision": req.decision,
        "placement": req.placement or None,
        "decided_at": iso_utc(req.decided_at),
    }
