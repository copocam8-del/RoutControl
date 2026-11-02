"""Segundo intento con sugerencia de desvío (ADR-023)."""

from datetime import timedelta

from apps.drivers.models import DriverProfile
from apps.packages.second_attempt import Point, cheapest_insertion
from apps.tenancy.context import tenant_context
from tests.conftest import client_for, iso, make_point, now_utc, start_workday, tracking_client

# Puntos sobre una misma avenida (Rivadavia, CABA, de este a oeste): sirven para medir distancias.
START = (-34.6083, -58.3712)
A = (-34.6090, -58.3850)  # ~1,3 km
B = (-34.6100, -58.4050)  # ~3,1 km
NEAR_A = (-34.6095, -58.3950)  # entre A y B
FAR = (-34.5500, -58.4700)  # ~11 km al noroeste


def pkg(fx, code, latlng, status=None):
    with tenant_context(fx.id):
        did = str(DriverProfile.objects.get(membership__user=fx.driver).id)
    address = {"raw_text": f"Calle {code}", "lat": latlng[0], "lng": latlng[1]}
    r = client_for(fx.owner, fx.org).post("/api/v1/packages/", {"tracking_code": code, "address": address, "driver_id": did}, format="json")
    assert r.status_code == 201, r.content
    return r.json()["package"]


def fail(fx, p):
    """Una visita "nadie responde": el paquete queda no entregado."""
    import uuid

    start = now_utc() - timedelta(minutes=5)
    body = {"id": str(uuid.uuid4()), "package_id": p["id"], "started_at": iso(start), "ended_at": iso(start + timedelta(minutes=2)), "outcome": "NO_ANSWER"}
    r = client_for(fx.driver, fx.org).post("/api/v1/visits", body, format="json")
    assert r.status_code in (200, 201), r.content


def on_shift_at(fx, latlng):
    wd = start_workday(fx.driver, fx.org)
    point = make_point(now_utc() - timedelta(minutes=1), lat=latlng[0], lng=latlng[1])
    assert tracking_client(wd["tracking_token"]).post("/api/v1/tracking/batch", [point], format="json").status_code == 200
    return wd


def ask(fx, p, **body):
    return client_for(fx.owner, fx.org).post(f"/api/v1/packages/{p['id']}/second-attempt", body, format="json")


def test_cheapest_insertion_picks_the_gap_with_least_extra_way():
    route = [Point(*START), Point(*A), Point(*B)]
    i, extra, end = cheapest_insertion(route, Point(*NEAR_A))
    assert i == 1  # entre A y B
    assert extra < 200 and end > extra  # casi en el camino; al final costaría más


def test_without_workday_the_suggestion_is_next_day_and_only_failed_packages_qualify(org_a):
    p = pkg(org_a, "X", NEAR_A)
    assert ask(org_a, p).json()["code"] == "not_failed"
    on_shift = start_workday(org_a.driver, org_a.org)  # para poder registrar la visita
    fail(org_a, p)
    client_for(org_a.driver, org_a.org).post(f"/api/v1/workdays/{on_shift['workday']['id']}/end", {"ended_at": iso(now_utc())}, format="json")
    r = ask(org_a, p)
    assert r.status_code == 201
    body = r.json()["second_attempt"]
    assert body["suggestion"] == "NEXT_DAY" and body["suggestion_reason"] == "El repartidor no está en jornada."
    assert ask(org_a, p).json()["code"] == "already_requested"


def test_near_the_route_suggests_inserting_it_and_accepting_puts_it_back_in_the_route(org_a):
    a, b = pkg(org_a, "A", A), pkg(org_a, "B", B)
    x = pkg(org_a, "X", NEAR_A)
    on_shift_at(org_a, START)
    driver = client_for(org_a.driver, org_a.org)
    fail(org_a, x)
    assert driver.put("/api/v1/route", {"package_ids": [a["id"], b["id"]]}, format="json").status_code == 200
    window = {"window_start": iso(now_utc() + timedelta(hours=1)), "window_end": iso(now_utc() + timedelta(hours=3)), "note": "Llamó, está de tarde"}
    r = ask(org_a, x, **window)
    s = r.json()["second_attempt"]
    assert s["suggestion"] == "INSERT" and s["insert_position"] == 1
    assert s["suggestion_reason"].startswith("Insertarlo después de la parada 1: suma unos")
    assert s["detour_s"] < 10 * 60 and s["pending_count"] == 2 and s["distance_m"] > 1000

    d = client_for(org_a.owner, org_a.org).post(f"/api/v1/second-attempts/{s['id']}/decide", {"accept": True}, format="json")
    assert d.status_code == 200 and d.json()["second_attempt"]["placement"] == "INSERT"
    assert [stop["package_id"] for stop in driver.get("/api/v1/route").json()["stops"]] == [a["id"], x["id"], b["id"]]
    mine = {p["id"]: p for p in driver.get("/api/v1/packages/").json()["packages"]}
    assert mine[x["id"]]["status"] == "ASSIGNED"
    assert mine[x["id"]]["second_attempt"]["note"] == "Llamó, está de tarde"
    assert mine[x["id"]]["second_attempt"]["window_start"] == window["window_start"]
    assert mine[a["id"]]["second_attempt"] is None
    # Ya decidido: no se decide dos veces.
    assert client_for(org_a.owner, org_a.org).post(f"/api/v1/second-attempts/{s['id']}/decide", {"accept": False}, format="json").status_code == 409


def test_far_from_the_route_suggests_next_day_and_accepting_reschedules(org_a):
    pkg(org_a, "A", A)
    x = pkg(org_a, "X", FAR)
    on_shift_at(org_a, START)
    fail(org_a, x)
    s = ask(org_a, x).json()["second_attempt"]
    assert s["suggestion"] == "NEXT_DAY" and "mejor mañana" in s["suggestion_reason"]
    owner = client_for(org_a.owner, org_a.org)
    assert owner.post(f"/api/v1/second-attempts/{s['id']}/decide", {"accept": True}, format="json").status_code == 200
    assert owner.get(f"/api/v1/packages/{x['id']}").json()["package"]["status"] == "RESCHEDULED"
    # El panel puede elegir otra cosa que la sugerida (al final de la ruta).
    y = pkg(org_a, "Y", FAR)
    fail(org_a, y)
    s = ask(org_a, y).json()["second_attempt"]
    owner.post(f"/api/v1/second-attempts/{s['id']}/decide", {"accept": True, "placement": "END"}, format="json")
    assert client_for(org_a.driver, org_a.org).get("/api/v1/route").json()["stops"][-1]["package_id"] == y["id"]


def test_rejecting_changes_nothing_and_drivers_cannot_use_it(org_a):
    x = pkg(org_a, "X", NEAR_A)
    on_shift_at(org_a, START)
    fail(org_a, x)
    assert client_for(org_a.driver, org_a.org).post(f"/api/v1/packages/{x['id']}/second-attempt", {}, format="json").status_code == 403
    s = ask(org_a, x).json()["second_attempt"]
    owner = client_for(org_a.owner, org_a.org)
    assert owner.post(f"/api/v1/second-attempts/{s['id']}/decide", {"accept": False}, format="json").json()["second_attempt"]["decision"] == "REJECTED"
    assert owner.get(f"/api/v1/packages/{x['id']}").json()["package"]["status"] == "FAILED"
    listed = owner.get(f"/api/v1/second-attempts?package={x['id']}").json()["second_attempts"]
    assert [r["decision"] for r in listed] == ["REJECTED"]
    assert client_for(org_a.driver, org_a.org).get("/api/v1/second-attempts").status_code == 403
