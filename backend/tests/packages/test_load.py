"""Carga con escaneo: los paquetes asignados pasan a "En camino" (ADR-014)."""

from apps.drivers.models import DriverProfile
from apps.tenancy.context import tenant_context
from tests.conftest import client_for


def pkg(fx, code, driver_index=0, assign=True):
    with tenant_context(fx.id):
        did = str(DriverProfile.objects.get(membership__user=fx.drivers[driver_index]).id)
    body = {"tracking_code": code, "address": {"raw_text": "Mitre 1"}}
    if assign:
        body["driver_id"] = did
    return client_for(fx.owner, fx.org).post("/api/v1/packages/", body, format="json").json()["package"]


def load(fx, codes, user=None):
    return client_for(user or fx.driver, fx.org).post("/api/v1/packages/load", {"tracking_codes": codes}, format="json")


def test_scanned_codes_get_loaded_once_and_report_each_result(org_a):
    mine = pkg(org_a, "MIO-1")
    pkg(org_a, "DE-OTRO", driver_index=1)
    pkg(org_a, "SIN-ASIGNAR", assign=False)
    r = load(org_a, ["MIO-1", "MIO-1", " DE-OTRO ", "SIN-ASIGNAR", "NO-EXISTE", ""])
    assert r.status_code == 200
    assert r.json()["results"] == [
        {"code": "MIO-1", "result": "loaded", "package_id": mine["id"]},
        {"code": "DE-OTRO", "result": "not_assigned"},
        {"code": "SIN-ASIGNAR", "result": "not_assigned"},
        {"code": "NO-EXISTE", "result": "not_assigned"},
    ]
    assert client_for(org_a.owner, org_a.org).get(f"/api/v1/packages/{mine['id']}").json()["package"]["status"] == "IN_ROUTE"
    # Escanear de nuevo (o reintentar el envío) no cambia nada.
    assert load(org_a, ["MIO-1"]).json()["results"] == [{"code": "MIO-1", "result": "already_loaded", "package_id": mine["id"]}]
    events = client_for(org_a.owner, org_a.org).get(f"/api/v1/packages/{mine['id']}/events").json()["events"]
    assert [e["payload"].get("source") for e in events if e["to_status"] == "IN_ROUTE"] == ["scan"]


def test_a_delivered_package_is_not_loadable(org_a):
    mine = pkg(org_a, "MIO-2")
    client_for(org_a.owner, org_a.org).post(f"/api/v1/packages/{mine['id']}/status", {"status": "CANCELLED", "version": 2}, format="json")
    assert load(org_a, ["MIO-2"]).json()["results"][0]["result"] == "not_loadable"


def test_only_drivers_load(org_a):
    assert load(org_a, ["X"], user=org_a.owner).status_code == 403
