import uuid
from datetime import timedelta

import pytest
from django.conf import settings

from apps.drivers.models import Device
from apps.tenancy.context import tenant_context
from apps.tracking.models import LocationPoint, TrackingGap
from tests.conftest import client_for, iso, make_point, now_utc, start_workday, tracking_client

URL = "/api/v1/tracking/batch"


@pytest.fixture
def wd(org_a):
    started = now_utc() - timedelta(hours=1)
    body = start_workday(org_a.driver, org_a.org, started_at=started)
    body["started"] = started
    body["client"] = tracking_client(body["tracking_token"])
    return body


def test_accepts_points_and_keeps_both_timestamps(org_a, wd):
    recorded = wd["started"] + timedelta(minutes=5)
    point = make_point(recorded, speed=4.2, battery=0.8, is_moving=True)
    response = wd["client"].post(URL, [point], format="json")
    assert response.status_code == 200
    assert response.json()["accepted"] == [point["point_id"]]
    assert response.json()["duplicates"] == [] and response.json()["rejected"] == []
    with tenant_context(org_a.id):
        stored = LocationPoint.objects.get(point_id=point["point_id"])
        assert abs((stored.recorded_at - recorded).total_seconds()) < 0.001
        assert stored.received_at > stored.recorded_at  # hora del servidor, distinta de la del teléfono
        assert stored.location.x == pytest.approx(point["lng"]) and stored.location.y == pytest.approx(point["lat"])
        assert stored.battery == 0.8


def test_resending_the_same_batch_never_duplicates(org_a, wd):
    points = [make_point(wd["started"] + timedelta(minutes=i)) for i in range(1, 6)]
    first = wd["client"].post(URL, points, format="json").json()
    second = wd["client"].post(URL, points, format="json").json()
    ids = sorted(p["point_id"] for p in points)
    assert sorted(first["accepted"]) == ids
    assert second["accepted"] == [] and sorted(second["duplicates"]) == ids
    with tenant_context(org_a.id):
        assert LocationPoint.objects.count() == 5


def test_partial_overlap_and_duplicates_inside_the_batch(org_a, wd):
    old = make_point(wd["started"] + timedelta(minutes=1))
    wd["client"].post(URL, [old], format="json")
    new = make_point(wd["started"] + timedelta(minutes=2))
    result = wd["client"].post(URL, [old, new, new], format="json").json()
    assert result["accepted"] == [new["point_id"]]
    assert sorted(result["duplicates"]) == sorted([old["point_id"], new["point_id"]])
    with tenant_context(org_a.id):
        assert LocationPoint.objects.count() == 2


def test_object_body_with_sent_at_measures_clock_offset(org_a, wd):
    phone_clock_ahead = now_utc() + timedelta(seconds=90)
    point = make_point(wd["started"] + timedelta(minutes=1))
    response = wd["client"].post(URL, {"sent_at": iso(phone_clock_ahead), "points": [point]}, format="json")
    assert response.status_code == 200
    with tenant_context(org_a.id):
        device = Device.objects.get(id=wd["workday"]["device_id"])
        assert 85_000 < device.clock_offset_ms < 95_000
        assert device.last_sync_at is not None


@pytest.mark.parametrize(
    "change, reason",
    [
        ({"lat": 91}, "invalid:lat"),
        ({"lng": -181}, "invalid:lng"),
        ({"accuracy": -1}, "invalid:accuracy"),
        ({"battery": 1.5}, "invalid:battery"),
        ({"point_id": "no-es-un-uuid"}, "invalid:point_id"),
        ({"recorded_at": "2026-10-31T10:00:00"}, "invalid:recorded_at"),  # sin zona horaria
    ],
)
def test_invalid_points_are_rejected_individually(org_a, wd, change, reason):
    good = make_point(wd["started"] + timedelta(minutes=1))
    bad = {**make_point(wd["started"] + timedelta(minutes=2)), **change}
    result = wd["client"].post(URL, [good, bad], format="json").json()
    assert result["accepted"] == [good["point_id"]]
    [rejected] = result["rejected"]
    assert (rejected["id"], rejected["reason"]) == (str(bad["point_id"]), reason)
    assert rejected["detail"].startswith("Campo ")


def test_point_without_point_id_is_referenced_by_index(wd):
    bad = make_point(wd["started"] + timedelta(minutes=1))
    del bad["point_id"]
    result = wd["client"].post(URL, [bad], format="json").json()
    assert [(r["id"], r["reason"]) for r in result["rejected"]] == [("#0", "invalid:point_id")]


def test_points_outside_the_workday_are_rejected(org_a, wd):
    before = make_point(wd["started"] - timedelta(minutes=10))
    future = make_point(now_utc() + timedelta(hours=1))
    result = wd["client"].post(URL, [before, future], format="json").json()
    reasons = {r["id"]: r["reason"] for r in result["rejected"]}
    assert reasons == {before["point_id"]: "before_workday_start", future["point_id"]: "recorded_in_future"}


def test_after_end_only_points_recorded_before_end_are_accepted(org_a, wd):
    """Los puntos que quedaron offline se pueden subir después de finalizar; los posteriores, no."""
    ended = now_utc() - timedelta(minutes=10)
    pending = make_point(ended - timedelta(minutes=5))
    response = client_for(org_a.driver, org_a.org).post(
        f"/api/v1/workdays/{wd['workday']['id']}/end", {"ended_at": iso(ended)}, format="json"
    )
    assert response.status_code == 200
    late = make_point(ended + timedelta(minutes=1))
    result = wd["client"].post(URL, [pending, late], format="json").json()
    assert result["accepted"] == [pending["point_id"]]
    assert result["rejected"] == [
        {
            "id": late["point_id"],
            "reason": "after_workday_end",
            "detail": "El punto se grabó después del fin de la jornada.",
        }
    ]


def test_batch_too_large_is_400(wd):
    points = [make_point(wd["started"] + timedelta(seconds=i)) for i in range(settings.TRACKING["MAX_BATCH_SIZE"] + 1)]
    assert wd["client"].post(URL, points, format="json").status_code == 400


def test_body_must_be_a_list(wd):
    assert wd["client"].post(URL, {"points": "x"}, format="json").status_code == 400


@pytest.mark.parametrize("header", ["Tracking token-inventado", "Bearer algo", None])
def test_invalid_or_missing_token_is_401(wd, header):
    from rest_framework.test import APIClient

    client = APIClient()
    if header:
        client.credentials(HTTP_AUTHORIZATION=header)
    response = client.post(URL, [make_point(wd["started"])], format="json")
    assert response.status_code in (401, 403)


def test_user_jwt_cannot_post_points(org_a, wd):
    response = client_for(org_a.driver, org_a.org).post(URL, [make_point(wd["started"])], format="json")
    assert response.status_code in (401, 403)


def test_restarting_the_workday_revokes_the_previous_token(org_a, wd):
    body = {
        "workday_id": wd["workday"]["id"],
        "started_at": iso(wd["started"]),
        "device": {"id": wd["workday"]["device_id"], "runtime": "PWA"},
    }
    again = client_for(org_a.driver, org_a.org).post("/api/v1/workdays/start", body, format="json")
    assert again.status_code == 200
    old = wd["client"].post(URL, [make_point(wd["started"] + timedelta(minutes=1))], format="json")
    assert old.status_code in (401, 403)
    new = tracking_client(again.json()["tracking_token"]).post(
        URL, [make_point(wd["started"] + timedelta(minutes=1))], format="json"
    )
    assert new.status_code == 200


def test_gaps_are_detected_and_filled_by_late_points(org_a, wd):
    s = wd["started"]
    # Inicio en s; puntos en s+1m y s+20m → hueco de 19 min (umbral por defecto: 5 min).
    wd["client"].post(URL, [make_point(s + timedelta(minutes=1)), make_point(s + timedelta(minutes=20))], format="json")
    with tenant_context(org_a.id):
        gaps = list(TrackingGap.objects.order_by("from_at"))
        assert len(gaps) == 1
        assert (gaps[0].to_at - gaps[0].from_at) == timedelta(minutes=19)

    # Llegan tarde los puntos del medio (estaban offline): el hueco desaparece.
    late = [make_point(s + timedelta(minutes=m)) for m in (4, 8, 12, 16)]
    wd["client"].post(URL, late, format="json")
    with tenant_context(org_a.id):
        assert TrackingGap.objects.count() == 0


def test_point_ids_are_unique_per_org_not_global_pk(org_a, wd):
    """El point_id del teléfono es la clave de idempotencia; la PK es interna."""
    point = make_point(wd["started"] + timedelta(minutes=1), point_id=str(uuid.uuid4()))
    wd["client"].post(URL, [point], format="json")
    with tenant_context(org_a.id):
        stored = LocationPoint.objects.get(point_id=point["point_id"])
        assert isinstance(stored.pk, int)
