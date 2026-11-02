"""GET /api/v1/drivers (panel): solo personal de la empresa; jornada en curso y última jornada."""

from datetime import datetime, timedelta

import pytest

from apps.drivers.models import DriverProfile
from apps.tenancy.context import tenant_context
from apps.tenancy.models import Membership
from tests.conftest import client_for, iso, make_point, make_user, now_utc, start_workday, tracking_client

URL = "/api/v1/drivers/"


def test_drivers_cannot_list_drivers(org_a):
    assert client_for(org_a.driver, org_a.org).get(URL).status_code == 403


@pytest.mark.parametrize("role", [Membership.Role.OWNER, Membership.Role.ADMIN, Membership.Role.SUPERVISOR])
def test_staff_can_list_drivers(org_a, role):
    user = make_user(f"{role.lower()}-x@org-a.test")
    with tenant_context(org_a.id):
        Membership.objects.create(user=user, role=role)
    response = client_for(user, org_a.org).get(URL)
    assert response.status_code == 200
    assert len(response.json()["drivers"]) == 2


def test_active_and_last_workday_and_last_signal(org_a):
    s = now_utc() - timedelta(hours=1)
    # Repartidor 1: una jornada terminada ayer y una en curso con un punto.
    old = start_workday(org_a.drivers[0], org_a.org, started_at=s - timedelta(days=1))
    client_for(org_a.drivers[0], org_a.org).post(
        f"/api/v1/workdays/{old['workday']['id']}/end", {"ended_at": iso(s - timedelta(days=1, hours=-2))}, format="json"
    )
    current = start_workday(org_a.drivers[0], org_a.org, started_at=s)
    point = make_point(s + timedelta(minutes=10))
    tracking_client(current["tracking_token"]).post("/api/v1/tracking/batch", [point], format="json")

    drivers = {d["email"]: d for d in client_for(org_a.owner, org_a.org).get(URL).json()["drivers"]}
    d1, d2 = drivers[org_a.drivers[0].email], drivers[org_a.drivers[1].email]

    assert d1["active_workday"]["id"] == current["workday"]["id"]
    parse = lambda v: datetime.fromisoformat(v.replace("Z", "+00:00"))  # noqa: E731
    assert abs((parse(d1["active_workday"]["last_point_at"]) - parse(point["recorded_at"])).total_seconds()) < 0.001
    assert d1["last_workday"]["id"] == current["workday"]["id"] and d1["last_workday"]["status"] == "ACTIVE"
    assert d2["active_workday"] is None and d2["last_workday"] is None
    assert d1["status"] == "ACTIVE" and d1["membership_status"] == "ACTIVE"


def test_disabled_driver_is_listed_with_its_status(org_a):
    with tenant_context(org_a.id):
        DriverProfile.objects.filter(membership__user=org_a.drivers[1]).update(status=DriverProfile.Status.INACTIVE)
    drivers = {d["email"]: d for d in client_for(org_a.owner, org_a.org).get(URL).json()["drivers"]}
    assert drivers[org_a.drivers[1].email]["status"] == "INACTIVE"


def test_active_workday_includes_last_known_location(org_a, org_b):
    s = now_utc() - timedelta(hours=1)
    current = start_workday(org_a.drivers[0], org_a.org, started_at=s)
    first = make_point(s + timedelta(minutes=5), lat=-34.60, lng=-58.38)
    last = make_point(s + timedelta(minutes=10), lat=-34.61, lng=-58.39)
    tracking_client(current["tracking_token"]).post("/api/v1/tracking/batch", [last, first], format="json")
    start_workday(org_a.drivers[1], org_a.org, started_at=s)  # en curso, sin puntos

    drivers = {d["email"]: d for d in client_for(org_a.owner, org_a.org).get(URL).json()["drivers"]}
    location = drivers[org_a.drivers[0].email]["active_workday"]["last_location"]
    # La más reciente por hora del teléfono, aunque haya llegado antes en el lote.
    assert location == pytest.approx({"lat": -34.61, "lng": -58.39})
    assert drivers[org_a.drivers[1].email]["active_workday"]["last_location"] is None

    # Aislamiento: la empresa B no ve ni la ubicación ni a los repartidores de A.
    other = client_for(org_b.owner, org_b.org).get(URL).json()["drivers"]
    assert all(d["email"] not in drivers for d in other)
    assert all((d["active_workday"] or {}).get("last_location") is None for d in other)
