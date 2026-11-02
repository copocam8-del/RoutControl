"""Paquetes: alta manual, edición, asignación, estados y trazabilidad (§7, §9)."""

import uuid

import pytest
from django.db import DatabaseError, connections, transaction

from apps.drivers.models import DriverProfile
from apps.packages.models import Package, PackageEvent
from apps.packages.services import normalize_address
from apps.tenancy.context import tenant_context
from tests.conftest import client_for

URL = "/api/v1/packages/"


def driver_id(fx, i=0) -> str:
    with tenant_context(fx.id):
        return str(DriverProfile.objects.get(membership__user=fx.drivers[i]).id)


def create(fx, code="RC-0001", **extra):
    body = {
        "tracking_code": code,
        "recipient_name": "Destinatario de prueba",
        "recipient_phone": "+54 11 5555-0000",
        "address": {"raw_text": "Av. Corrientes 1234, CABA", "lat": -34.6037, "lng": -58.3816},
        **extra,
    }
    response = client_for(fx.owner, fx.org).post(URL, body, format="json")
    assert response.status_code == 201, response.content
    return response.json()["package"]


def events(fx, package_id, user=None):
    return client_for(user or fx.owner, fx.org).get(f"{URL}{package_id}/events").json()["events"]


# --- Alta, edición y trazabilidad -------------------------------------------------------------


def test_manual_create_with_address_and_created_event(org_a):
    p = create(org_a)
    assert p["status"] == "CREATED" and p["source"] == "MANUAL" and p["version"] == 1
    assert p["address"]["raw_text"] == "Av. Corrientes 1234, CABA"
    assert p["address"]["location"] == pytest.approx({"lat": -34.6037, "lng": -58.3816})
    [e] = events(org_a, p["id"])
    assert e["type"] == "created" and e["to_status"] == "CREATED" and e["actor"]


def test_same_address_written_differently_is_reused(org_a):
    a = create(org_a, "RC-1", address={"raw_text": "Av. Corrientes 1234, CABA"})
    b = create(org_a, "RC-2", address={"raw_text": "av corrientes 1234 caba"})
    assert a["address"]["id"] == b["address"]["id"]
    assert normalize_address("Avenida Córdoba  950 - 3°B") == "avenida cordoba 950 3b"


def test_tracking_code_is_unique_per_company_but_not_across_companies(org_a, org_b):
    create(org_a, "MISMO")
    response = client_for(org_a.owner, org_a.org).post(
        URL, {"tracking_code": "MISMO", "address": {"raw_text": "X 1"}}, format="json"
    )
    assert response.status_code == 409 and response.json()["code"] == "duplicate_tracking_code"
    create(org_b, "MISMO")  # otra empresa: no choca (ni se entera)


def test_address_is_required(org_a):
    response = client_for(org_a.owner, org_a.org).post(URL, {"tracking_code": "X", "address": {}}, format="json")
    assert response.status_code == 400 and response.json()["code"] == "address_required"


def test_edit_with_version_and_updated_event(org_a):
    p = create(org_a)
    client = client_for(org_a.owner, org_a.org)
    response = client.patch(f"{URL}{p['id']}", {"version": 1, "recipient_name": "Otra persona"}, format="json")
    assert response.status_code == 200
    assert response.json()["package"]["recipient_name"] == "Otra persona" and response.json()["package"]["version"] == 2
    stale = client.patch(f"{URL}{p['id']}", {"version": 1, "notes": "pisaría el cambio"}, format="json")
    assert stale.status_code == 409 and stale.json()["code"] == "version_conflict"
    updated = [e for e in events(org_a, p["id"]) if e["type"] == "updated"]
    assert updated[0]["payload"]["changes"]["recipient_name"] == {"from": "Destinatario de prueba", "to": "Otra persona"}


# --- Asignación y estados -------------------------------------------------------------------


def test_assign_unassign_and_events(org_a):
    p = create(org_a)
    client = client_for(org_a.owner, org_a.org)
    did = driver_id(org_a)
    r = client.post(f"{URL}{p['id']}/assign", {"driver_id": did, "version": 1}, format="json")
    assert r.status_code == 200
    assigned = r.json()["package"]
    assert assigned["status"] == "ASSIGNED" and assigned["assigned_driver"]["id"] == did
    r = client.post(f"{URL}{p['id']}/assign", {"driver_id": None, "version": assigned["version"]}, format="json")
    assert r.json()["package"]["status"] == "CREATED" and r.json()["package"]["assigned_driver"] is None
    assert [e["type"] for e in events(org_a, p["id"])] == ["created", "assigned", "unassigned"]


def test_create_already_assigned(org_a):
    p = create(org_a, driver_id=driver_id(org_a))
    assert p["status"] == "ASSIGNED"


def test_cannot_assign_to_a_disabled_driver(org_a):
    p = create(org_a)
    did = driver_id(org_a)
    with tenant_context(org_a.id):
        DriverProfile.objects.filter(id=did).update(status=DriverProfile.Status.INACTIVE)
    r = client_for(org_a.owner, org_a.org).post(f"{URL}{p['id']}/assign", {"driver_id": did, "version": 1}, format="json")
    assert r.status_code == 400 and r.json()["code"] == "driver_not_found"


def test_bulk_assign_reports_each_package(org_a):
    a, b = create(org_a, "A"), create(org_a, "B")
    client = client_for(org_a.owner, org_a.org)
    client.post(f"{URL}{b['id']}/status", {"status": "CANCELLED", "version": 1}, format="json")
    missing = str(uuid.uuid4())
    r = client.post(f"{URL}assign", {"package_ids": [a["id"], b["id"], missing], "driver_id": driver_id(org_a)}, format="json")
    assert r.status_code == 200
    assert r.json()["assigned"] == [a["id"]]
    assert {f["id"]: f["code"] for f in r.json()["failed"]} == {b["id"]: "not_assignable", missing: "not_found"}


def test_staff_can_cancel_and_final_status_is_final(org_a):
    p = create(org_a)
    client = client_for(org_a.owner, org_a.org)
    r = client.post(f"{URL}{p['id']}/status", {"status": "CANCELLED", "version": 1, "reason": "Pedido anulado"}, format="json")
    assert r.status_code == 200 and r.json()["package"]["status"] == "CANCELLED"
    again = client.post(f"{URL}{p['id']}/status", {"status": "RETURNED", "version": 2}, format="json")
    assert again.status_code == 409 and again.json()["code"] == "invalid_transition"
    edit = client.patch(f"{URL}{p['id']}", {"version": 2, "notes": "x"}, format="json")
    assert edit.status_code == 409 and edit.json()["code"] == "final_status"
    last = events(org_a, p["id"])[-1]
    assert (last["from_status"], last["to_status"], last["payload"]["reason"]) == ("CREATED", "CANCELLED", "Pedido anulado")


def test_list_filters(org_a):
    a, b = create(org_a, "RC-A", recipient_name="Ana"), create(org_a, "RC-B", recipient_name="Beto")
    client = client_for(org_a.owner, org_a.org)
    client.post(f"{URL}{a['id']}/assign", {"driver_id": driver_id(org_a), "version": 1}, format="json")
    ids = lambda r: {p["id"] for p in r.json()["packages"]}  # noqa: E731
    assert ids(client.get(f"{URL}?status=ASSIGNED")) == {a["id"]}
    assert ids(client.get(f"{URL}?driver=none")) == {b["id"]}
    assert ids(client.get(f"{URL}?q=beto")) == {b["id"]}


# --- Roles ------------------------------------------------------------------------------------


def test_driver_sees_only_own_packages_and_cannot_write(org_a):
    mine = create(org_a, "MIO", driver_id=driver_id(org_a, 0))
    other = create(org_a, "DEL-OTRO", driver_id=driver_id(org_a, 1))
    client = client_for(org_a.drivers[0], org_a.org)
    assert [p["id"] for p in client.get(URL).json()["packages"]] == [mine["id"]]
    assert client.get(f"{URL}{other['id']}").status_code == 404
    assert client.get(f"{URL}{mine['id']}/events").status_code == 200
    assert client.post(URL, {"tracking_code": "X", "address": {"raw_text": "Y"}}, format="json").status_code == 403
    assert client.patch(f"{URL}{mine['id']}", {"version": 2, "notes": "x"}, format="json").status_code == 403
    assert client.post(f"{URL}{mine['id']}/assign", {"driver_id": None, "version": 2}, format="json").status_code == 403


# --- Solo se agrega -------------------------------------------------------------------------


def test_package_events_cannot_be_altered_or_deleted(org_a):
    p = create(org_a)
    for sql in ("UPDATE packages_packageevent SET type = 'x'", "DELETE FROM packages_packageevent"):
        with pytest.raises(DatabaseError), transaction.atomic(using="app"):
            with connections["app"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_org', %s, true)", [str(org_a.id)])
                cursor.execute(sql)
    with tenant_context(org_a.id):
        assert PackageEvent.objects.filter(package_id=p["id"]).count() == 1
        assert Package.objects.filter(id=p["id"]).exists()
