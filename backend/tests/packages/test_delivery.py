"""La entrega en la calle: visitas con resultado, fotos y comunicaciones (ADR-013)."""

import uuid
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.drivers.models import DriverProfile
from apps.packages.models import Communication, Evidence, Visit
from apps.tenancy.context import tenant_context
from tests.conftest import client_for, iso, now_utc

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture(autouse=True)
def media(tmp_path, settings):
    settings.MEDIA_ROOT = str(tmp_path)


def assigned_package(fx, code="E-1", driver_index=0):
    with tenant_context(fx.id):
        did = str(DriverProfile.objects.get(membership__user=fx.drivers[driver_index]).id)
    r = client_for(fx.owner, fx.org).post(
        "/api/v1/packages/", {"tracking_code": code, "address": {"raw_text": "Mitre 100"}, "driver_id": did}, format="json"
    )
    assert r.status_code == 201
    return r.json()["package"]


def visit(fx, package, outcome="DELIVERED", **extra):
    start = now_utc() - timedelta(minutes=5)
    body = {
        "id": str(uuid.uuid4()),
        "package_id": package["id"],
        "started_at": iso(start),
        "ended_at": iso(start + timedelta(minutes=3)),
        "outcome": outcome,
        "end_location": {"lat": -34.6, "lng": -58.38},
        **extra,
    }
    return client_for(fx.driver, fx.org).post("/api/v1/visits", body, format="json"), body


def test_delivered_visit_closes_the_package_with_its_events(org_a):
    p = assigned_package(org_a)
    r, body = visit(org_a, p)
    assert r.status_code == 201
    assert r.json()["package_status"] == "DELIVERED"
    v = r.json()["visit"]
    assert v["duration_s"] == 180 and v["outcome_attribution"] == "NONE" and not v["is_second_attempt"]
    events = client_for(org_a.owner, org_a.org).get(f"/api/v1/packages/{p['id']}/events").json()["events"]
    assert [(e["from_status"], e["to_status"]) for e in events if e["type"] == "status_changed"] == [
        ("ASSIGNED", "IN_ROUTE"),
        ("IN_ROUTE", "DELIVERED"),
    ]
    # Reintento con el mismo id (respuesta perdida): misma visita, sin duplicar.
    again = client_for(org_a.driver, org_a.org).post("/api/v1/visits", body, format="json")
    assert again.status_code == 200 and again.json()["visit"]["id"] == body["id"]
    with tenant_context(org_a.id):
        assert Visit.objects.count() == 1


@pytest.mark.parametrize(
    "outcome, status, attribution",
    [
        ("RECIPIENT_ABSENT", "FAILED", "RECIPIENT"),
        ("NO_ANSWER", "FAILED", "RECIPIENT"),
        ("RESCHEDULE_REQUESTED", "RESCHEDULED", "RECIPIENT"),
        ("WRONG_ADDRESS", "FAILED", "LOGISTIC"),
        ("NO_ACCESS", "FAILED", "LOGISTIC"),
    ],
)
def test_failed_outcomes_and_attribution(org_a, outcome, status, attribution):
    p = assigned_package(org_a)
    r, _ = visit(org_a, p, outcome)
    assert r.json()["package_status"] == status and r.json()["visit"]["outcome_attribution"] == attribution


def test_other_needs_notes_and_takes_the_drivers_attribution(org_a):
    p = assigned_package(org_a)
    r, _ = visit(org_a, p, "OTHER")
    assert r.status_code == 400 and "notes" in r.json()
    r, _ = visit(org_a, p, "OTHER", notes="Perro suelto en la entrada", attribution="LOGISTIC")
    assert r.json()["visit"]["outcome_attribution"] == "LOGISTIC"


def test_second_attempt_after_a_failure_then_delivered_is_final(org_a):
    p = assigned_package(org_a)
    visit(org_a, p, "NO_ANSWER")
    r, _ = visit(org_a, p, "DELIVERED")
    assert r.json()["visit"]["is_second_attempt"] is True and r.json()["package_status"] == "DELIVERED"
    r, _ = visit(org_a, p, "DELIVERED")
    assert r.status_code == 409 and r.json()["code"] == "not_visitable"


def test_a_driver_cannot_visit_a_coworkers_package(org_a):
    p = assigned_package(org_a, driver_index=1)
    r, _ = visit(org_a, p)
    assert r.status_code == 404


def test_photo_upload_is_stored_hashed_and_served_only_to_who_can_see_it(org_a):
    p = assigned_package(org_a)
    r, body = visit(org_a, p, "NO_ANSWER")
    eid = str(uuid.uuid4())
    upload = client_for(org_a.driver, org_a.org).post(
        "/api/v1/evidence",
        {
            "id": eid,
            "package_id": p["id"],
            "visit_id": body["id"],
            "captured_at": iso(now_utc()),
            "reason": "puerta",
            "file": SimpleUploadedFile("foto.png", PNG, content_type="image/png"),
        },
        format="multipart",
    )
    assert upload.status_code == 201 and upload.json()["evidence"]["upload_status"] == "UPLOADED"
    with tenant_context(org_a.id):
        e = Evidence.objects.get(id=eid)
        assert e.size == len(PNG) and e.storage_key.startswith(f"evidencia/{org_a.id}/")
    # El panel la ve (y la visita la lista), el repartidor también; un compañero no.
    visits = client_for(org_a.owner, org_a.org).get(f"/api/v1/packages/{p['id']}/visits").json()["visits"]
    assert visits[0]["evidence"][0]["id"] == eid
    photo = client_for(org_a.owner, org_a.org).get(f"/api/v1/evidence/{eid}/file")
    assert photo.status_code == 200 and photo["Content-Type"] == "image/png"
    assert b"".join(photo.streaming_content) == PNG
    assert client_for(org_a.drivers[1], org_a.org).get(f"/api/v1/evidence/{eid}/file").status_code == 404


def test_photo_must_be_an_image_and_its_visit_must_exist(org_a):
    p = assigned_package(org_a)
    client = client_for(org_a.driver, org_a.org)
    base = {"package_id": p["id"], "captured_at": iso(now_utc())}
    bad = client.post("/api/v1/evidence", {**base, "id": str(uuid.uuid4()), "file": SimpleUploadedFile("x.txt", b"hola", content_type="text/plain")}, format="multipart")
    assert bad.status_code == 400 and bad.json()["code"] == "bad_type"
    early = client.post(
        "/api/v1/evidence",
        {**base, "id": str(uuid.uuid4()), "visit_id": str(uuid.uuid4()), "file": SimpleUploadedFile("f.png", PNG, content_type="image/png")},
        format="multipart",
    )
    assert early.status_code == 409 and early.json()["code"] == "visit_not_found"


def test_communications_are_logged_once(org_a):
    p = assigned_package(org_a)
    body = {"id": str(uuid.uuid4()), "package_id": p["id"], "channel": "WHATSAPP", "started_at": iso(now_utc())}
    client = client_for(org_a.driver, org_a.org)
    assert client.post("/api/v1/communications", body, format="json").status_code == 201
    assert client.post("/api/v1/communications", body, format="json").status_code == 200
    with tenant_context(org_a.id):
        assert Communication.objects.count() == 1


def test_staff_cannot_register_street_actions(org_a):
    p = assigned_package(org_a)
    assert client_for(org_a.owner, org_a.org).post("/api/v1/visits", {}, format="json").status_code == 403
    body = {"id": str(uuid.uuid4()), "package_id": p["id"], "channel": "PHONE", "started_at": iso(now_utc())}
    assert client_for(org_a.owner, org_a.org).post("/api/v1/communications", body, format="json").status_code == 403
