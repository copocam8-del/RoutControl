"""Recuperar puntos trabados: token nuevo dentro de la gracia (ADR-010)."""

from datetime import timedelta

from django.utils import timezone

from apps.drivers.models import Device
from apps.tenancy.context import tenant_context
from apps.workdays.models import Workday
from tests.conftest import client_for, iso, make_point, now_utc, start_workday, tracking_client


def recover(user, org, workday_id):
    return client_for(user, org).post(f"/api/v1/workdays/{workday_id}/tracking-token")


def test_active_workday_gets_a_new_token_and_the_old_one_stops_working(org_a):
    body = start_workday(org_a.driver, org_a.org)
    response = recover(org_a.driver, org_a.org, body["workday"]["id"])
    assert response.status_code == 201
    new = response.json()["tracking_token"]
    point = make_point(now_utc() - timedelta(minutes=5))
    assert tracking_client(body["tracking_token"]).post("/api/v1/tracking/batch", [point], format="json").status_code == 401
    assert tracking_client(new).post("/api/v1/tracking/batch", [point], format="json").json()["accepted"] == [point["point_id"]]


def test_finished_workday_within_grace_recovers_the_stuck_points(org_a):
    start = now_utc() - timedelta(hours=2)
    body = start_workday(org_a.driver, org_a.org, started_at=start)
    wid = body["workday"]["id"]
    client_for(org_a.driver, org_a.org).post(f"/api/v1/workdays/{wid}/end", {"ended_at": iso(start + timedelta(hours=1))}, format="json")
    # El token viejo quedó inválido (por ejemplo, se emitió otro desde otro intento).
    with tenant_context(org_a.id):
        from apps.tracking.models import TrackingToken

        TrackingToken.objects.filter(workday_id=wid).update(revoked_at=timezone.now())

    response = recover(org_a.driver, org_a.org, wid)
    assert response.status_code == 201
    stuck = make_point(start + timedelta(minutes=30))
    late = make_point(start + timedelta(minutes=90))  # después del fin: sigue rechazado
    result = tracking_client(response.json()["tracking_token"]).post("/api/v1/tracking/batch", [stuck, late], format="json").json()
    assert result["accepted"] == [stuck["point_id"]]
    assert [r["reason"] for r in result["rejected"]] == ["after_workday_end"]
    # El token nuevo vence cuando vence la gracia (72 h desde el cierre), no 14 h desde ahora.
    expires = response.json()["tracking_token_expires_at"]
    assert expires > iso(now_utc() + timedelta(hours=70))


def test_outside_grace_it_is_refused(org_a):
    body = start_workday(org_a.driver, org_a.org, started_at=now_utc() - timedelta(days=5))
    wid = body["workday"]["id"]
    with tenant_context(org_a.id):
        Workday.objects.filter(id=wid).update(
            status=Workday.Status.FINISHED,
            ended_at=now_utc() - timedelta(days=4),
            end_received_at=now_utc() - timedelta(days=4),
        )
    response = recover(org_a.driver, org_a.org, wid)
    assert response.status_code == 409 and response.json()["code"] == "grace_expired"


def test_disabled_device_cannot_recover(org_a):
    body = start_workday(org_a.driver, org_a.org)
    with tenant_context(org_a.id):
        Device.objects.filter(id=body["workday"]["device_id"]).update(status=Device.Status.DISABLED)
    response = recover(org_a.driver, org_a.org, body["workday"]["id"])
    assert response.status_code == 403 and response.json()["code"] == "device_disabled"
