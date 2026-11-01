import uuid
from datetime import timedelta

from apps.tenancy.context import tenant_context
from apps.tracking.models import TrackingToken
from apps.workdays.models import Workday
from tests.conftest import client_for, iso, now_utc, start_workday

START = "/api/v1/workdays/start"


def start_body(**extra):
    return {
        "workday_id": str(uuid.uuid4()),
        "started_at": iso(now_utc()),
        "device": {"id": str(uuid.uuid4()), "runtime": "PWA", "model": "Moto G (prueba)"},
        **extra,
    }


def test_start_creates_events_only_workday_and_token(org_a):
    body = start_workday(org_a.driver, org_a.org, location={"lat": -34.6, "lng": -58.4, "accuracy": 10})
    assert body["workday"]["status"] == "ACTIVE"
    assert body["workday"]["tracking_mode"] == "EVENTS_ONLY"  # PWA → solo eventos (§4.2)
    assert len(body["tracking_token"]) > 30
    with tenant_context(org_a.id):
        workday = Workday.objects.get(id=body["workday"]["id"])
        assert workday.start_location is not None
        token = TrackingToken.objects.get(workday=workday)
        assert body["tracking_token"] not in token.token_hash  # se guarda solo el hash
        hours = (token.expires_at - token.created_at).total_seconds() / 3600
        assert 13.9 < hours < 14.1  # duración máxima por defecto


def test_only_drivers_can_start(org_a):
    response = client_for(org_a.owner, org_a.org).post(START, start_body(), format="json")
    assert response.status_code == 403


def test_one_active_workday_per_driver(org_a):
    start_workday(org_a.driver, org_a.org)
    response = client_for(org_a.driver, org_a.org).post(START, start_body(), format="json")
    assert response.status_code == 409
    assert response.json()["code"] == "workday_already_active"


def test_start_is_idempotent_by_workday_id(org_a):
    body = start_body()
    client = client_for(org_a.driver, org_a.org)
    first = client.post(START, body, format="json")
    second = client.post(START, body, format="json")
    assert first.status_code == 201 and second.status_code == 200
    assert first.json()["workday"]["id"] == second.json()["workday"]["id"]
    with tenant_context(org_a.id):
        assert Workday.objects.count() == 1


def test_start_rejects_naive_datetime(org_a):
    response = client_for(org_a.driver, org_a.org).post(
        START, start_body(started_at="2026-10-31T09:00:00"), format="json"
    )
    assert response.status_code == 400


def test_end_workday_and_idempotency(org_a):
    body = start_workday(org_a.driver, org_a.org, started_at=now_utc() - timedelta(hours=2))
    url = f"/api/v1/workdays/{body['workday']['id']}/end"
    client = client_for(org_a.driver, org_a.org)
    first = client.post(url, {"ended_at": iso(now_utc())}, format="json")
    second = client.post(url, {"ended_at": iso(now_utc())}, format="json")
    assert first.status_code == 200 and first.json()["workday"]["status"] == "FINISHED"
    assert second.status_code == 200 and second.json()["workday"]["ended_at"] == first.json()["workday"]["ended_at"]
    assert client.get("/api/v1/workdays/current").json()["workday"] is None


def test_end_before_start_is_400(org_a):
    body = start_workday(org_a.driver, org_a.org)
    response = client_for(org_a.driver, org_a.org).post(
        f"/api/v1/workdays/{body['workday']['id']}/end",
        {"ended_at": iso(now_utc() - timedelta(days=1))},
        format="json",
    )
    assert response.status_code == 400


def test_driver_cannot_end_a_coworkers_workday(org_a):
    body = start_workday(org_a.drivers[0], org_a.org)
    response = client_for(org_a.drivers[1], org_a.org).post(
        f"/api/v1/workdays/{body['workday']['id']}/end", {"ended_at": iso(now_utc())}, format="json"
    )
    assert response.status_code == 404


def test_error_response_rolls_back_what_the_view_wrote(org_a):
    """DRF convierte excepciones en respuestas; el middleware igual tiene que hacer rollback de un 4xx."""
    from django.http import HttpResponse
    from django.test import RequestFactory

    from apps.drivers.models import DriverProfile
    from apps.tenancy.middleware import TenantContextMiddleware
    from tests.conftest import access_token_for

    def view_that_writes_then_fails(request):
        DriverProfile.objects.update(vehicle_type="escrito-por-una-vista-que-falla")
        return HttpResponse(status=400)

    request = RequestFactory().get(
        "/x", HTTP_AUTHORIZATION=f"Bearer {access_token_for(org_a.driver, org_a.org)}"
    )
    assert TenantContextMiddleware(view_that_writes_then_fails)(request).status_code == 400
    with tenant_context(org_a.id):
        assert not DriverProfile.objects.filter(vehicle_type="escrito-por-una-vista-que-falla").exists()


def test_api_datetimes_are_always_utc_with_z(org_a):
    """El mismo instante tiene un solo formato, recién recibido o leído de la base."""
    body = start_workday(org_a.driver, org_a.org, started_at=now_utc() - timedelta(hours=1))
    assert body["workday"]["started_at"].endswith("Z")
    assert body["tracking_token_expires_at"].endswith("Z")
    current = client_for(org_a.driver, org_a.org).get("/api/v1/workdays/current").json()["workday"]
    assert current["started_at"] == body["workday"]["started_at"]
