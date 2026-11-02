"""Condiciones de aprobación del ADR-003.

1. Solo se aceptan puntos con started_at ≤ recorded_at ≤ ended_at.
2. Las horas de gracia después del fin son configurables (global y por empresa).
3. El token se revoca si se desactiva el dispositivo o el repartidor.
4. Los puntos fuera de rango se rechazan con un motivo claro.
"""

from datetime import timedelta

import uuid

import pytest
from django.conf import settings
from django.test import override_settings

from apps.accounts.models import User
from apps.drivers.models import Device, DriverProfile
from apps.tenancy.context import tenant_context
from apps.tenancy.models import Membership
from apps.tracking.models import TrackingToken
from apps.tracking.services import REJECTION_DETAILS
from tests.conftest import client_for, iso, make_point, now_utc, start_workday, tracking_client

URL = "/api/v1/tracking/batch"


@pytest.fixture
def ended_workday(org_a):
    started = now_utc() - timedelta(hours=3)
    ended = now_utc() - timedelta(hours=1)
    body = start_workday(org_a.driver, org_a.org, started_at=started)
    response = client_for(org_a.driver, org_a.org).post(
        f"/api/v1/workdays/{body['workday']['id']}/end", {"ended_at": iso(ended)}, format="json"
    )
    assert response.status_code == 200
    return {**body, "started": started, "ended": ended, "client": tracking_client(body["tracking_token"])}


# --- 1 y 4: ventana de la jornada y motivos -------------------------------------------------


def test_window_is_inclusive_at_both_ends_and_strict_outside(ended_workday):
    s, e = ended_workday["started"], ended_workday["ended"]
    at_start, at_end, middle = make_point(s), make_point(e), make_point(s + timedelta(minutes=30))
    just_before, just_after = make_point(s - timedelta(seconds=1)), make_point(e + timedelta(seconds=1))

    result = ended_workday["client"].post(
        URL, [at_start, at_end, middle, just_before, just_after], format="json"
    ).json()

    assert sorted(result["accepted"]) == sorted([at_start["point_id"], at_end["point_id"], middle["point_id"]])
    by_id = {r["id"]: r for r in result["rejected"]}
    assert by_id[just_before["point_id"]]["reason"] == "before_workday_start"
    assert by_id[just_after["point_id"]]["reason"] == "after_workday_end"
    for r in result["rejected"]:
        assert r["detail"] == REJECTION_DETAILS[r["reason"]]  # texto claro, no solo un código


def test_active_workday_rejects_points_from_the_future_with_reason(org_a):
    body = start_workday(org_a.driver, org_a.org)
    future = make_point(now_utc() + timedelta(hours=2))
    [rejected] = tracking_client(body["tracking_token"]).post(URL, [future], format="json").json()["rejected"]
    assert rejected["reason"] == "recorded_in_future"
    assert "reloj" in rejected["detail"]


# --- 2: horas de gracia configurables -------------------------------------------------------


def _token_hours_left(org_id) -> float:
    with tenant_context(org_id):
        token = TrackingToken.objects.get()
        return (token.expires_at - now_utc()).total_seconds() / 3600


def test_default_grace_is_72_hours(org_a, ended_workday):
    assert 71.9 < _token_hours_left(org_a.id) <= 72


@override_settings(TRACKING={**settings.TRACKING, "TOKEN_GRACE_AFTER_END_HOURS": 6})
def test_global_grace_is_configurable(org_a):
    """El valor global sale de TRACKING_TOKEN_GRACE_AFTER_END_HOURS (acá, pisado a 6 h)."""
    body = start_workday(org_a.driver, org_a.org)
    client_for(org_a.driver, org_a.org).post(
        f"/api/v1/workdays/{body['workday']['id']}/end", {"ended_at": iso(now_utc())}, format="json"
    )
    assert 5.9 < _token_hours_left(org_a.id) <= 6


def test_grace_can_be_overridden_per_org(org_a):
    with tenant_context(org_a.id):  # la tabla de empresas tiene RLS
        org_a.org.settings = {"tracking_token_grace_hours": 2}
        org_a.org.save()
    body = start_workday(org_a.driver, org_a.org)
    client_for(org_a.driver, org_a.org).post(
        f"/api/v1/workdays/{body['workday']['id']}/end", {"ended_at": iso(now_utc())}, format="json"
    )
    assert 1.9 < _token_hours_left(org_a.id) <= 2


# --- 3: revocación al desactivar el dispositivo o el repartidor -----------------------------


@pytest.fixture
def active(org_a):
    body = start_workday(org_a.driver, org_a.org)
    client = tracking_client(body["tracking_token"])
    assert client.post(URL, [make_point(now_utc() - timedelta(minutes=1))], format="json").status_code == 200
    return {**body, "client": client}


def _assert_token_dead(active, org_id, reason: str | None):
    response = active["client"].post(URL, [make_point(now_utc() - timedelta(seconds=30))], format="json")
    assert response.status_code == 401
    if reason:
        with tenant_context(org_id):
            token = TrackingToken.objects.get()
            assert token.revoked_at is not None and token.revoked_reason == reason


def test_disabling_the_device_revokes_the_token(org_a, active):
    with tenant_context(org_a.id):
        device = Device.objects.get(id=active["workday"]["device_id"])
        device.status = Device.Status.DISABLED
        device.save()
    _assert_token_dead(active, org_a.id, TrackingToken.RevokedReason.DEVICE_DISABLED)


def test_disabling_the_driver_profile_revokes_the_token(org_a, active):
    with tenant_context(org_a.id):
        profile = DriverProfile.objects.get(membership__user=org_a.driver)
        profile.status = DriverProfile.Status.INACTIVE
        profile.save()
    _assert_token_dead(active, org_a.id, TrackingToken.RevokedReason.DRIVER_DISABLED)


def test_disabling_the_membership_revokes_the_token(org_a, active):
    with tenant_context(org_a.id):
        membership = Membership.objects.get(user=org_a.driver)
        membership.status = Membership.Status.DISABLED
        membership.save()
    _assert_token_dead(active, org_a.id, TrackingToken.RevokedReason.MEMBERSHIP_DISABLED)


def test_bulk_update_without_signals_still_blocks_the_token(org_a, active):
    """QuerySet.update() no dispara señales: igual corta, porque lo exige la función SQL."""
    with tenant_context(org_a.id):
        Device.objects.filter(id=active["workday"]["device_id"]).update(status=Device.Status.DISABLED)
    _assert_token_dead(active, org_a.id, reason=None)


def test_disabling_the_user_blocks_the_token(org_a, active):
    with tenant_context(org_a.id):  # RLS de accounts_user: se modifica desde la empresa
        assert User.objects.filter(id=org_a.driver.id).update(status=User.Status.DISABLED) == 1
    _assert_token_dead(active, org_a.id, reason=None)


def test_disabled_device_cannot_start_a_new_workday(org_a, active):
    client = client_for(org_a.driver, org_a.org)
    client.post(f"/api/v1/workdays/{active['workday']['id']}/end", {"ended_at": iso(now_utc())}, format="json")
    with tenant_context(org_a.id):
        Device.objects.filter(id=active["workday"]["device_id"]).update(status=Device.Status.DISABLED)
    response = client.post(
        "/api/v1/workdays/start",
        {
            "workday_id": str(uuid.uuid4()),
            "started_at": iso(now_utc()),
            "device": {"id": active["workday"]["device_id"], "runtime": "PWA"},
        },
        format="json",
    )
    assert response.status_code == 403 and response.json()["code"] == "device_disabled"
