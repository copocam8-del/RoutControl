"""Cierre automático de jornadas olvidadas (Celery, ADR-010)."""

import uuid
from datetime import timedelta

from django.conf import settings
from django.db import connections

from apps.tenancy.context import tenant_context
from apps.tenancy.models import Organization
from apps.workdays.autoclose import close_forgotten_workdays, stale_workdays
from apps.workdays.models import Workday
from apps.workdays.tasks import close_forgotten_workdays_task
from tests.conftest import client_for, make_point, now_utc, start_workday, tracking_client


def status_of(org, workday_id):
    with tenant_context(org.id):
        return Workday.objects.get(id=workday_id)


def test_closes_only_workdays_past_the_max_duration(org_a):
    old_start = now_utc() - timedelta(hours=15)  # máximo por defecto: 14 h
    old = start_workday(org_a.drivers[0], org_a.org, started_at=old_start)
    recent = start_workday(org_a.drivers[1], org_a.org, started_at=now_utc() - timedelta(hours=2))

    closed = close_forgotten_workdays()

    assert closed == [uuid.UUID(old["workday"]["id"])]
    w = status_of(org_a, old["workday"]["id"])
    assert w.status == Workday.Status.AUTO_CLOSED and w.close_reason == "max_duration"
    # El fin es el límite de la jornada (inicio + 14 h), no "ahora".
    assert abs((w.ended_at - (old_start + timedelta(hours=14))).total_seconds()) < 1
    assert status_of(org_a, recent["workday"]["id"]).status == Workday.Status.ACTIVE
    # Idempotente: una segunda pasada no cierra nada más.
    assert close_forgotten_workdays() == []


def test_points_recorded_within_the_workday_are_still_accepted_after_autoclose(org_a):
    """Los puntos que quedaron en el teléfono (dentro de la jornada) se aceptan durante la gracia."""
    start = now_utc() - timedelta(hours=15)
    body = start_workday(org_a.driver, org_a.org, started_at=start)
    close_forgotten_workdays()
    inside, after = make_point(start + timedelta(hours=13)), make_point(start + timedelta(hours=14, minutes=30))
    result = tracking_client(body["tracking_token"]).post("/api/v1/tracking/batch", [inside, after], format="json").json()
    assert result["accepted"] == [inside["point_id"]]
    assert [r["reason"] for r in result["rejected"]] == ["after_workday_end"]


def test_uses_the_max_duration_of_each_company(org_a, org_b):
    with tenant_context(org_b.id):
        Organization.objects.filter(id=org_b.id).update(settings={"max_workday_hours": 1})
    a = start_workday(org_a.driver, org_a.org, started_at=now_utc() - timedelta(hours=2))
    b = start_workday(org_b.driver, org_b.org, started_at=now_utc() - timedelta(hours=2))
    close_forgotten_workdays()
    assert status_of(org_a, a["workday"]["id"]).status == Workday.Status.ACTIVE
    assert status_of(org_b, b["workday"]["id"]).status == Workday.Status.AUTO_CLOSED


def test_stale_lookup_returns_only_identifiers(org_a):
    start_workday(org_a.driver, org_a.org, started_at=now_utc() - timedelta(hours=20))
    with connections["app"].cursor() as cursor:
        cursor.execute("SELECT * FROM rc_stale_workdays(14)")
        assert [d.name for d in cursor.description] == ["organization_id", "workday_id"]
    assert len(stale_workdays()) == 1


def test_driver_sees_it_closed_and_can_start_a_new_one(org_a):
    start_workday(org_a.driver, org_a.org, started_at=now_utc() - timedelta(hours=15))
    close_forgotten_workdays()
    assert client_for(org_a.driver, org_a.org).get("/api/v1/workdays/current").json()["workday"] is None
    start_workday(org_a.driver, org_a.org)


def test_celery_task_and_beat_schedule():
    assert settings.CELERY_BEAT_SCHEDULE["cerrar-jornadas-olvidadas"]["task"] == "workdays.close_forgotten_workdays"
    assert close_forgotten_workdays_task.name == "workdays.close_forgotten_workdays"
    assert close_forgotten_workdays_task.run() == 0
