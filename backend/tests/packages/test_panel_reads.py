"""Panel: entregas del día e incidencias (ADR-016)."""

import uuid
from datetime import timedelta

import pytest

from apps.drivers.models import DriverProfile
from apps.tenancy.context import tenant_context
from tests.conftest import client_for, iso, now_utc


@pytest.fixture(autouse=True)
def media(tmp_path, settings):
    settings.MEDIA_ROOT = str(tmp_path)


def assigned(fx, code):
    with tenant_context(fx.id):
        did = str(DriverProfile.objects.get(membership__user=fx.driver).id)
    return client_for(fx.owner, fx.org).post(
        "/api/v1/packages/", {"tracking_code": code, "address": {"raw_text": f"Calle {code}"}, "driver_id": did}, format="json"
    ).json()["package"]


def visit(fx, package, outcome, notes=""):
    body = {
        "id": str(uuid.uuid4()),
        "package_id": package["id"],
        "started_at": iso(now_utc() - timedelta(minutes=2)),
        "ended_at": iso(now_utc() - timedelta(minutes=1)),
        "outcome": outcome,
        "notes": notes,
    }
    assert client_for(fx.driver, fx.org).post("/api/v1/visits", body, format="json").status_code == 201
    return body


def test_failed_visit_opens_an_incident_that_staff_can_resolve(org_a):
    p = assigned(org_a, "I-1")
    v = visit(org_a, p, "WRONG_ADDRESS", "No existe la altura")
    client = client_for(org_a.owner, org_a.org)
    [incident] = client.get("/api/v1/incidents?status=OPEN").json()["incidents"]
    assert incident["type"] == "WRONG_ADDRESS" and incident["description"] == "No existe la altura"
    assert incident["visit_id"] == v["id"] and incident["package"]["tracking_code"] == "I-1"
    r = client.post(f"/api/v1/incidents/{incident['id']}/resolve", {}, format="json")
    assert r.status_code == 200 and r.json()["incident"]["status"] == "RESOLVED" and r.json()["incident"]["resolved_by"]
    assert client.get("/api/v1/incidents?status=OPEN").json()["incidents"] == []
    assert client.post(f"/api/v1/incidents/{incident['id']}/resolve", {}, format="json").status_code == 200  # idempotente


def test_a_delivered_visit_opens_no_incident(org_a):
    visit(org_a, assigned(org_a, "OK-1"), "DELIVERED")
    assert client_for(org_a.owner, org_a.org).get("/api/v1/incidents").json()["incidents"] == []


def test_deliveries_of_the_day_with_package_and_outcome(org_a):
    a = assigned(org_a, "D-1")
    b = assigned(org_a, "D-2")
    visit(org_a, a, "DELIVERED")
    visit(org_a, b, "NO_ANSWER")
    r = client_for(org_a.owner, org_a.org).get("/api/v1/deliveries")
    assert r.status_code == 200
    by_code = {d["package"]["tracking_code"]: d for d in r.json()["deliveries"]}
    assert by_code["D-1"]["outcome"] == "DELIVERED" and by_code["D-1"]["package"]["status"] == "DELIVERED"
    assert by_code["D-2"]["outcome"] == "NO_ANSWER" and by_code["D-2"]["package"]["status"] == "FAILED"
    assert client_for(org_a.owner, org_a.org).get("/api/v1/deliveries?date=2001-01-01").json()["deliveries"] == []


def test_drivers_cannot_read_the_panel_lists(org_a):
    client = client_for(org_a.driver, org_a.org)
    assert client.get("/api/v1/deliveries").status_code == 403
    assert client.get("/api/v1/incidents").status_code == 403
