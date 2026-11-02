"""Indicador de recepción del domicilio (planificación §7.3, ADR-022)."""

from datetime import datetime, timedelta, timezone

import pytest

from apps.packages import reception
from apps.packages.models import Visit
from apps.tenancy.context import tenant_context
from apps.tenancy.models import Organization
from tests.conftest import client_for
from tests.packages.test_delivery import assigned_package, visit

O = Visit.Outcome
A = Visit.Attribution
NOW = datetime(2026, 11, 2, 12, tzinfo=timezone.utc)


def ago(days):
    return NOW - timedelta(days=days)


def test_gray_with_less_than_three_computable_visits():
    stats = reception.compute([(O.DELIVERED, A.NONE, ago(1)), (O.DELIVERED, A.NONE, ago(2))], NOW)
    assert stats["level"] == "gray" and stats["computable"] == 2 and stats["score"] == 1.0


def test_logistic_failures_do_not_count():
    rows = [(O.DELIVERED, A.NONE, ago(1)), (O.DELIVERED, A.NONE, ago(2)), (O.DELIVERED, A.NONE, ago(3))]
    rows += [(O.WRONG_ADDRESS, A.LOGISTIC, ago(1)), (O.NO_ACCESS, A.LOGISTIC, ago(1))]
    stats = reception.compute(rows, NOW)
    assert stats["level"] == "green" and stats["computable"] == 3 and stats["score"] == 1.0


def test_levels_by_threshold():
    absent = (O.RECIPIENT_ABSENT, A.RECIPIENT, ago(0))
    ok = (O.DELIVERED, A.NONE, ago(0))
    assert reception.compute([ok, ok, ok, ok, absent], NOW)["level"] == "green"  # 80 %
    assert reception.compute([ok, ok, absent, absent], NOW)["level"] == "yellow"  # 50 %
    assert reception.compute([ok, absent, absent, absent], NOW)["level"] == "red"  # 25 %


def test_recent_visits_weigh_more_than_old_ones():
    # Hace 60 días fallaba siempre; las últimas tres entregas pesan más: 0,5^(60/30) = 0,25.
    rows = [(O.NO_ANSWER, A.RECIPIENT, ago(60))] * 3 + [(O.DELIVERED, A.NONE, ago(0))] * 3
    stats = reception.compute(rows, NOW)
    assert stats["score"] == pytest.approx(3 / (3 + 0.75), abs=0.001)  # 0,8 → verde
    assert stats["level"] == "green"


def test_reschedule_request_weighs_half():
    rows = [(O.DELIVERED, A.NONE, ago(0))] * 2 + [(O.RESCHEDULE_REQUESTED, A.RECIPIENT, ago(0))] * 2
    assert reception.compute(rows, NOW)["score"] == pytest.approx(2 / 3, abs=0.001)


def test_thresholds_are_configurable_per_company(org_a):
    rows = [(O.DELIVERED, A.NONE, ago(0))] * 3 + [(O.RECIPIENT_ABSENT, A.RECIPIENT, ago(0))]  # 75 %
    with tenant_context(org_a.id):
        org = Organization.objects.get(id=org_a.id)
        assert reception.compute(rows, NOW, reception.config(org))["level"] == "yellow"
        org.settings = {"reception": {"green": 0.7, "min_visits": 5}}
        assert reception.compute(rows, NOW, reception.config(org))["level"] == "gray"  # pide 5
        org.settings = {"reception": {"green": 0.7}}
        assert reception.compute(rows, NOW, reception.config(org))["level"] == "green"


def test_packages_carry_the_indicator_and_the_panel_sees_the_history(org_a):
    first = assigned_package(org_a, "R-1")
    for i, outcome in enumerate(["DELIVERED", "RECIPIENT_ABSENT", "DELIVERED"]):
        p = first if i == 0 else assigned_package(org_a, f"R-{i + 1}")
        visit(org_a, p, outcome)
    # Los tres paquetes van al mismo domicilio ("Mitre 100"): 2 de 3 → amarillo.
    listed = client_for(org_a.driver, org_a.org).get("/api/v1/packages/").json()["packages"]
    assert {p["reception"]["level"] for p in listed} == {"yellow"}
    assert listed[0]["reception"]["computable"] == 3
    detail = client_for(org_a.owner, org_a.org).get(f"/api/v1/packages/{first['id']}").json()["package"]
    assert detail["reception"]["level"] == "yellow"

    address_id = first["address"]["id"]
    history = client_for(org_a.owner, org_a.org).get(f"/api/v1/addresses/{address_id}")
    assert history.status_code == 200
    body = history.json()
    assert body["reception"]["level"] == "yellow" and body["reception"]["delivered"] == 2
    assert sorted(v["outcome"] for v in body["visits"]) == ["DELIVERED", "DELIVERED", "RECIPIENT_ABSENT"]
    assert len(body["packages"]) == 3 and body["thresholds"]["green"] == 0.8
    # El repartidor no ve el historial del domicilio (solo el personal).
    assert client_for(org_a.driver, org_a.org).get(f"/api/v1/addresses/{address_id}").status_code == 403
