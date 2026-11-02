"""Alertas configurables del panel (ADR-025)."""

import uuid
from datetime import timedelta

from django.conf import settings

from apps.alerts import services
from apps.alerts.models import Notification
from apps.tenancy.context import tenant_context
from apps.tracking import live
from tests.conftest import client_for, iso, make_point, now_utc, start_workday, tracking_client
from tests.packages.test_second_attempt import fail, pkg

URL = "/api/v1/notifications"


def types(fx):
    with tenant_context(fx.id):
        return list(Notification.objects.order_by("created_at").values_list("type", flat=True))


def test_workday_start_and_end_alert_the_staff_and_unread_is_per_person(org_a):
    wd = start_workday(org_a.driver, org_a.org)
    owner = client_for(org_a.owner, org_a.org)
    body = owner.get(URL).json()
    assert body["unread"] == 1
    n = body["notifications"][0]
    assert n["type"] == "WORKDAY_STARTED" and n["title"] == "driver1 inició la jornada" and n["unread"] is True
    assert n["payload"]["workday_id"] == wd["workday"]["id"]
    assert owner.post(f"{URL}/seen").json()["unread"] == 0
    assert owner.get(URL).json()["notifications"][0]["unread"] is False
    client_for(org_a.driver, org_a.org).post(f"/api/v1/workdays/{wd['workday']['id']}/end", {"ended_at": iso(now_utc())}, format="json")
    body = owner.get(URL).json()
    assert body["unread"] == 1 and body["notifications"][0]["title"] == "driver1 finalizó la jornada"
    # Los repartidores no ven las alertas del panel.
    assert client_for(org_a.driver, org_a.org).get(URL).status_code == 403


def test_incident_and_route_finished(org_a):
    start_workday(org_a.driver, org_a.org)
    a, b = pkg(org_a, "A", (-34.6, -58.38)), pkg(org_a, "B", (-34.61, -58.39))
    fail(org_a, a)  # incidencia; todavía queda B
    assert types(org_a) == ["WORKDAY_STARTED", "INCIDENT"]
    start = now_utc() - timedelta(minutes=3)
    body = {"id": str(uuid.uuid4()), "package_id": b["id"], "started_at": iso(start), "ended_at": iso(start + timedelta(minutes=2)), "outcome": "DELIVERED"}
    client_for(org_a.driver, org_a.org).post("/api/v1/visits", body, format="json")
    assert types(org_a) == ["WORKDAY_STARTED", "INCIDENT", "ROUTE_FINISHED"]
    finished = client_for(org_a.owner, org_a.org).get(URL).json()["notifications"][0]
    assert finished["title"] == "driver1 terminó su recorrido" and finished["body"] == "1 entregados y 1 no entregados."
    incident = client_for(org_a.owner, org_a.org).get(URL).json()["notifications"][1]
    assert incident["title"] == "Incidencia: Nadie responde" and incident["body"].startswith("A · Calle A")


def test_alerts_can_be_turned_off_per_company(org_a):
    owner = client_for(org_a.owner, org_a.org)
    current = owner.get("/api/v1/settings").json()
    assert current["alerts"]["workday_started"] is True and current["can_edit"] is True
    current["alerts"]["workday_started"] = False
    r = owner.put("/api/v1/settings", {k: current[k] for k in ("alerts", "reception", "second_attempt")}, format="json")
    assert r.status_code == 200 and r.json()["alerts"]["workday_started"] is False
    start_workday(org_a.driver, org_a.org)
    assert types(org_a) == []


def test_settings_validation_and_who_can_edit(org_a):
    owner = client_for(org_a.owner, org_a.org)
    body = {k: owner.get("/api/v1/settings").json()[k] for k in ("alerts", "reception", "second_attempt")}
    bad = {**body, "reception": {"green": 0.5, "yellow": 0.6, "min_visits": 3}}
    assert owner.put("/api/v1/settings", bad, format="json").status_code == 400
    ok = {**body, "reception": {"green": 0.7, "yellow": 0.3, "min_visits": 4}, "second_attempt": {"insert_max_min": 5, "end_max_min": 20}}
    assert owner.put("/api/v1/settings", ok, format="json").status_code == 200
    from apps.packages import reception, second_attempt
    from apps.tenancy.models import Organization

    with tenant_context(org_a.id):
        org = Organization.objects.get(id=org_a.id)
        assert reception.config(org)["green"] == 0.7 and reception.config(org)["min_visits"] == 4
        assert second_attempt.config(org)["insert_max_min"] == 5
    assert client_for(org_a.driver, org_a.org).put("/api/v1/settings", ok, format="json").status_code == 403


def test_no_signal_is_alerted_once_per_silence(org_a):
    wd = start_workday(org_a.driver, org_a.org, started_at=now_utc() - timedelta(minutes=40))
    t = tracking_client(wd["tracking_token"])
    t.post("/api/v1/tracking/batch", [make_point(now_utc() - timedelta(minutes=30))], format="json")
    assert services.check_no_signal() == 1
    assert services.check_no_signal() == 0  # el mismo silencio no se avisa dos veces
    n = client_for(org_a.owner, org_a.org).get(URL).json()["notifications"][0]
    assert n["type"] == "NO_SIGNAL" and n["title"] == "driver1 está sin señal" and n["body"] == "Última ubicación hace 30 min."
    # Vuelve la señal: no hay aviso. Con un punto reciente, nada.
    t.post("/api/v1/tracking/batch", [make_point(now_utc() - timedelta(minutes=1))], format="json")
    assert services.check_no_signal() == 0


def test_no_signal_threshold_comes_from_the_company(org_a):
    start_workday(org_a.driver, org_a.org, started_at=now_utc() - timedelta(minutes=10))
    assert services.check_no_signal() == 0  # 10 min < 15 (por defecto)
    from apps.tenancy.models import Organization

    with tenant_context(org_a.id):
        org = Organization.objects.get(id=org_a.id)
        org.settings = {**org.settings, "alerts": {"no_signal_minutes": 5}}
        org.save(update_fields=["settings"])
    assert services.check_no_signal() == 1


def test_alerts_go_live_to_the_panel_after_commit(org_a, monkeypatch, django_capture_on_commit_callbacks):
    sent = []
    monkeypatch.setattr(live, "publish", lambda org_id, event: sent.append((org_id, event)))
    with django_capture_on_commit_callbacks(using=settings.APP_DB_ALIAS, execute=True):
        start_workday(org_a.driver, org_a.org)
    notifications = [e["notification"] for org, e in sent if e["type"] == "notification"]
    assert len(notifications) == 1 and notifications[0]["title"] == "driver1 inició la jornada"
    assert notifications[0]["type"] == "WORKDAY_STARTED"
    assert sent[0][0] == org_a.id


def test_auto_closed_workdays_are_alerted(org_a):
    from apps.workdays.autoclose import close_forgotten_workdays

    start_workday(org_a.driver, org_a.org, started_at=now_utc() - timedelta(hours=30))
    assert len(close_forgotten_workdays()) == 1
    assert client_for(org_a.owner, org_a.org).get(URL).json()["notifications"][0]["title"] == "La jornada de driver1 se cerró sola (duración máxima)"
