"""Armar mi ruta (ADR-015). VROOM se reemplaza por una respuesta armada a mano (no hace falta el
servicio para probar la lógica); infra/routing tiene la prueba contra el servicio real."""

import pytest

from apps.drivers.models import DriverProfile
from apps.packages import polyline, routing
from apps.tenancy.context import tenant_context
from tests.conftest import client_for, start_workday


def pkg(fx, code, lat=None, lng=None, driver_index=0):
    with tenant_context(fx.id):
        did = str(DriverProfile.objects.get(membership__user=fx.drivers[driver_index]).id)
    address = {"raw_text": f"Calle {code}"}
    if lat is not None:
        address.update(lat=lat, lng=lng)
    r = client_for(fx.owner, fx.org).post("/api/v1/packages/", {"tracking_code": code, "address": address, "driver_id": did}, format="json")
    return r.json()["package"]


@pytest.fixture
def vroom(monkeypatch):
    """VROOM falso: devuelve los trabajos en el orden inverso, con tiempos y distancias acumulados."""
    calls = []

    def fake(problem):
        calls.append(problem)
        jobs = list(reversed(problem["jobs"]))
        steps = [{"type": "start"}]
        start = problem["vehicles"][0]["start"]
        line = [(start[1], start[0])]
        for i, job in enumerate(jobs, start=1):
            steps.append({"type": "job", "job": job["id"], "arrival": i * 600 + (i - 1) * job["service"], "distance": i * 2000})
            lng, lat = job["location"]
            # Un punto intermedio (como una esquina) y la parada.
            line += [((line[-1][0] + lat) / 2 + 0.001, (line[-1][1] + lng) / 2), (lat, lng)]
        return {"code": 0, "routes": [{"steps": steps, "geometry": polyline.encode(line)}]}

    monkeypatch.setattr(routing, "call_vroom", fake)
    return calls


def test_optimize_orders_located_stops_and_leaves_unlocated_at_the_end(org_a, vroom):
    a = pkg(org_a, "A", -34.60, -58.38)
    b = pkg(org_a, "B", -34.61, -58.39)
    c = pkg(org_a, "C")  # sin coordenadas: no se puede ordenar
    start_workday(org_a.driver, org_a.org)
    r = client_for(org_a.driver, org_a.org).post("/api/v1/route/optimize", {"lat": -34.59, "lng": -58.37}, format="json")
    assert r.status_code == 200
    body = r.json()
    assert [s["package_id"] for s in body["stops"]] == [b["id"], a["id"], c["id"]]
    assert body["source"] == "OPTIMIZED"
    assert [s["eta_s"] for s in body["stops"]] == [600, 600, None]  # cada tramo, sin la espera en la puerta
    assert [s["distance_m"] for s in body["stops"]] == [2000, 2000, None]
    # La línea por calles queda cortada en un tramo por parada: cada uno termina en su parada.
    legs = [polyline.decode(s["path"]) if s["path"] else [] for s in body["stops"]]
    assert legs[0][0] == pytest.approx((-34.59, -58.37)) and legs[0][-1] == pytest.approx((-34.61, -58.39))
    assert legs[1][0] == pytest.approx((-34.61, -58.39)) and legs[1][-1] == pytest.approx((-34.60, -58.38))
    assert body["stops"][2]["path"] == ""  # sin coordenadas, sin tramo
    problem = vroom[0]
    assert problem["vehicles"][0]["start"] == [-58.37, -34.59]  # [lng, lat], como espera VROOM
    assert len(problem["jobs"]) == 2 and problem["jobs"][0]["service"] == 180
    # La ruta queda guardada.
    assert [s["package_id"] for s in client_for(org_a.driver, org_a.org).get("/api/v1/route").json()["stops"]] == [b["id"], a["id"], c["id"]]


def test_manual_order_replaces_the_route_and_keeps_new_pending_at_the_end(org_a, vroom):
    a, b, c = pkg(org_a, "A", -34.6, -58.38), pkg(org_a, "B", -34.6, -58.39), pkg(org_a, "C", -34.6, -58.4)
    start_workday(org_a.driver, org_a.org)
    client = client_for(org_a.driver, org_a.org)
    r = client.put("/api/v1/route", {"package_ids": [c["id"], a["id"]]}, format="json")
    assert [s["package_id"] for s in r.json()["stops"]] == [c["id"], a["id"], b["id"]]
    assert r.json()["source"] == "MANUAL"
    assert all(s["path"] == "" for s in r.json()["stops"])  # a mano no hay tramos por calles


def test_delivered_packages_leave_the_route(org_a, vroom):
    a, b = pkg(org_a, "A", -34.6, -58.38), pkg(org_a, "B", -34.6, -58.39)
    client = client_for(org_a.owner, org_a.org)
    client.post(f"/api/v1/packages/{a['id']}/status", {"status": "CANCELLED", "version": 2}, format="json")
    start_workday(org_a.driver, org_a.org)
    r = client_for(org_a.driver, org_a.org).post("/api/v1/route/optimize", {"lat": -34.6, "lng": -58.37}, format="json")
    assert [s["package_id"] for s in r.json()["stops"]] == [b["id"]]


def test_polyline_round_trip_and_split():
    coords = [(-34.6037, -58.3816), (-34.6045, -58.3820), (-34.61, -58.39), (-34.612, -58.392)]
    assert polyline.decode(polyline.encode(coords)) == pytest.approx(coords)
    # Ejemplo de la documentación del formato (Google): "_p~iF~ps|U_ulLnnqC_mqNvxq`@".
    assert polyline.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@") == pytest.approx([(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)])
    legs = polyline.split_at(coords, [(-34.61, -58.39), (-34.612, -58.392)])
    assert legs == [coords[:3], coords[2:]]


def test_when_the_routing_service_is_down_the_driver_gets_a_clear_message(org_a, monkeypatch):
    def down(problem):
        raise routing.RoutingUnavailable("connection refused")

    monkeypatch.setattr(routing, "call_vroom", down)
    pkg(org_a, "A", -34.6, -58.38)
    start_workday(org_a.driver, org_a.org)
    r = client_for(org_a.driver, org_a.org).post("/api/v1/route/optimize", {"lat": -34.6, "lng": -58.37}, format="json")
    assert r.status_code == 503 and r.json()["code"] == "routing_unavailable"


def test_needs_an_active_workday(org_a, vroom):
    r = client_for(org_a.driver, org_a.org).post("/api/v1/route/optimize", {"lat": -34.6, "lng": -58.37}, format="json")
    assert r.status_code == 409 and r.json()["code"] == "no_active_workday"
    assert client_for(org_a.owner, org_a.org).get("/api/v1/route").status_code == 403


@pytest.mark.skipif(not __import__("os").environ.get("ROUTING_REAL"), reason="Necesita OSRM y VROOM levantados (infra/routing)")
def test_against_the_real_vroom_and_osrm():
    """ROUTING_REAL=1 con `--profile routing up osrm vroom`: tres paradas reales en CABA."""
    problem = {
        "vehicles": [{"id": 1, "profile": "car", "start": [-58.3816, -34.6037]}],
        "jobs": [
            {"id": 1, "location": [-58.4370, -34.6118], "service": 180},
            {"id": 2, "location": [-58.3960, -34.5875], "service": 180},
            {"id": 3, "location": [-58.4600, -34.5600], "service": 180},
        ],
        "options": {"g": True},
    }
    result = routing.call_vroom(problem)
    steps = [s for s in result["routes"][0]["steps"] if s["type"] == "job"]
    assert sorted(s["job"] for s in steps) == [1, 2, 3]
    assert all(s["distance"] > 0 for s in steps)
    # La geometría por calles se lee y se corta en un tramo por parada, cada uno con varios puntos.
    coords = polyline.decode(result["routes"][0]["geometry"])
    by_job = {j["id"]: j["location"] for j in problem["jobs"]}
    legs = polyline.split_at(coords, [(by_job[s["job"]][1], by_job[s["job"]][0]) for s in steps])
    assert all(len(leg) > 2 for leg in legs)
    for leg, s in zip(legs, steps):
        lng, lat = by_job[s["job"]]
        assert abs(leg[-1][0] - lat) < 0.002 and abs(leg[-1][1] - lng) < 0.002  # termina en la parada (~200 m)
