"""Recorrido de una jornada para el mapa: permisos por rol, tramos cortados en los huecos y distancia."""

from datetime import timedelta

import pytest

from apps.tenancy.context import tenant_context
from apps.tenancy.models import Membership
from tests.conftest import client_for, iso, make_point, make_user, now_utc, start_workday, tracking_client


@pytest.fixture
def recorded(org_a):
    """Jornada con dos tramos: 3 puntos, un hueco de 20 min y 2 puntos más; después, finalizada."""
    s = now_utc() - timedelta(hours=1)
    body = start_workday(org_a.driver, org_a.org, started_at=s)
    # ~111 m entre cada punto (0,001° de latitud).
    first = [make_point(s + timedelta(minutes=m), lat=-34.600 - 0.001 * i, lng=-58.40) for i, m in enumerate([1, 2, 3])]
    second = [make_point(s + timedelta(minutes=m), lat=-34.610 - 0.001 * i, lng=-58.40) for i, m in enumerate([23, 24])]
    tracking_client(body["tracking_token"]).post("/api/v1/tracking/batch", first + second, format="json")
    client_for(org_a.driver, org_a.org).post(
        f"/api/v1/workdays/{body['workday']['id']}/end", {"ended_at": iso(s + timedelta(minutes=25))}, format="json"
    )
    return body["workday"]["id"]


def track(user, org, workday_id):
    return client_for(user, org).get(f"/api/v1/workdays/{workday_id}/track")


def test_track_is_split_into_segments_at_gaps(org_a, recorded):
    data = track(org_a.owner, org_a.org, recorded).json()
    segments = data["segments"]["features"]
    assert [len(f["geometry"]["coordinates"]) for f in segments] == [3, 2]
    assert data["stats"]["segment_count"] == 2 and data["stats"]["point_count"] == 5

    # Del inicio al primer punto pasa 1 min (menos que el umbral de 5): el único hueco es el de 20 min.
    [gap] = data["gaps"]
    assert gap["seconds"] == 20 * 60
    assert gap["from"] == [-58.40, pytest.approx(-34.602)]
    assert gap["to"] == [-58.40, pytest.approx(-34.610)]


def test_gap_at_the_start_has_no_origin_point(org_a):
    """Si el primer punto llega 10 min después del inicio, el hueco arranca en el inicio (no es un punto)."""
    s = now_utc() - timedelta(hours=1)
    body = start_workday(org_a.driver, org_a.org, started_at=s)
    tracking_client(body["tracking_token"]).post(
        "/api/v1/tracking/batch", [make_point(s + timedelta(minutes=10))], format="json"
    )
    data = track(org_a.owner, org_a.org, body["workday"]["id"]).json()
    [gap] = data["gaps"]
    assert gap["from"] is None and gap["to"] is not None
    assert data["segments"]["features"][0]["geometry"]["type"] == "Point"  # un solo punto: tramo de un punto


def test_distance_is_geodesic_and_excludes_gap_jumps(org_a, recorded):
    stats = track(org_a.owner, org_a.org, recorded).json()["stats"]
    # 2 pasos de ~110,9 m en el primer tramo + 1 en el segundo; el salto del hueco (~890 m) no suma.
    assert stats["distance_m"] == pytest.approx(3 * 110.9, abs=3)


def test_points_keep_phone_time_accuracy_and_source(org_a, recorded):
    props = [f["properties"] for f in track(org_a.owner, org_a.org, recorded).json()["points"]["features"]]
    assert all(p["recorded_at"].endswith("Z") and p["accuracy_m"] == 12.5 for p in props)
    assert {p["source"] for p in props} == {"FOREGROUND"}


def test_driver_sees_own_track(org_a, recorded):
    assert track(org_a.driver, org_a.org, recorded).status_code == 200


def test_driver_cannot_see_a_coworkers_track(org_a, recorded):
    assert track(org_a.drivers[1], org_a.org, recorded).status_code == 404


def test_supervisor_and_admin_see_every_track_of_their_org(org_a, recorded):
    for role in (Membership.Role.SUPERVISOR, Membership.Role.ADMIN):
        user = make_user(f"{role.lower()}@org-a.test")
        with tenant_context(org_a.id):
            Membership.objects.create(user=user, role=role)
        assert track(user, org_a.org, recorded).status_code == 200


def test_workday_list_for_driver_is_only_own_and_filters_by_date(org_a, recorded):
    start_workday(org_a.drivers[1], org_a.org)
    own = client_for(org_a.driver, org_a.org).get("/api/v1/workdays/").json()["workdays"]
    assert [w["id"] for w in own] == [recorded]
    everyone = client_for(org_a.owner, org_a.org).get("/api/v1/workdays/").json()["workdays"]
    assert len(everyone) == 2 and all("name" in w["driver"] for w in everyone)

    date = everyone[0]["date"]
    assert len(client_for(org_a.owner, org_a.org).get(f"/api/v1/workdays/?date={date}").json()["workdays"]) == 2
    assert client_for(org_a.owner, org_a.org).get("/api/v1/workdays/?date=2001-01-01").json()["workdays"] == []
    assert client_for(org_a.owner, org_a.org).get("/api/v1/workdays/?date=no-es-fecha").status_code == 400


def test_track_of_unknown_workday_is_404(org_a):
    import uuid

    assert track(org_a.owner, org_a.org, uuid.uuid4()).status_code == 404


def test_workday_list_reports_activity_for_the_dashboard(org_a, recorded):
    """Cantidad de puntos y hora del último (para "última señal" en el panel)."""
    [w] = client_for(org_a.owner, org_a.org).get("/api/v1/workdays/").json()["workdays"]
    assert w["point_count"] == 5
    assert w["last_point_at"].endswith("Z")
    empty = start_workday(org_a.drivers[1], org_a.org)
    listed = {x["id"]: x for x in client_for(org_a.owner, org_a.org).get("/api/v1/workdays/").json()["workdays"]}
    assert listed[empty["workday"]["id"]]["point_count"] == 0
    assert listed[empty["workday"]["id"]]["last_point_at"] is None
