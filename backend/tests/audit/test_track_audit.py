"""Auditoría de accesos a recorridos (§11, ADR-010)."""

import pytest
from django.db import DatabaseError, connections, transaction

from apps.audit.models import AuditLog
from apps.tenancy.context import tenant_context
from tests.conftest import client_for, start_workday


def raw(sql, params=None, org_id=None, fetch=True):
    with transaction.atomic(using="app"):
        with connections["app"].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_org', %s, true)", [str(org_id) if org_id else ""])
            cursor.execute(sql, params or [])
            return cursor.fetchall() if fetch else cursor.rowcount


def test_viewing_a_track_is_recorded_with_who_what_and_when(org_a):
    body = start_workday(org_a.driver, org_a.org)
    wid = body["workday"]["id"]
    client = client_for(org_a.owner, org_a.org)
    assert client.get(f"/api/v1/workdays/{wid}/track", HTTP_USER_AGENT="Panel de prueba").status_code == 200
    with tenant_context(org_a.id):
        [log] = AuditLog.objects.all()
    assert log.actor_id == org_a.owner.id and log.action == "view_track"
    assert (log.object_type, str(log.object_id)) == ("workday", wid)
    assert log.user_agent == "Panel de prueba" and log.metadata["driver_id"]


def test_the_driver_viewing_their_own_track_is_recorded_too(org_a):
    wid = start_workday(org_a.driver, org_a.org)["workday"]["id"]
    client_for(org_a.driver, org_a.org).get(f"/api/v1/workdays/{wid}/track")
    with tenant_context(org_a.id):
        assert AuditLog.objects.filter(actor=org_a.driver, object_id=wid).count() == 1


def test_denied_access_is_not_recorded_as_a_view(org_a, org_b):
    wid = start_workday(org_a.driver, org_a.org)["workday"]["id"]
    assert client_for(org_b.owner, org_b.org).get(f"/api/v1/workdays/{wid}/track").status_code == 404
    with tenant_context(org_b.id):
        assert AuditLog.objects.count() == 0


def test_audit_rows_are_isolated_by_company(org_a, org_b):
    for fx in (org_a, org_b):
        wid = start_workday(fx.driver, fx.org)["workday"]["id"]
        client_for(fx.owner, fx.org).get(f"/api/v1/workdays/{wid}/track")
    # Control: B tiene su registro.
    assert {r[0] for r in raw("SELECT organization_id FROM audit_auditlog", org_id=org_b.id)} == {org_b.id}
    assert {r[0] for r in raw("SELECT organization_id FROM audit_auditlog", org_id=org_a.id)} == {org_a.id}
    assert raw("SELECT count(*) FROM audit_auditlog")[0][0] == 0  # sin contexto, nada


def test_the_app_cannot_alter_or_delete_audit_rows(org_a):
    wid = start_workday(org_a.driver, org_a.org)["workday"]["id"]
    client_for(org_a.owner, org_a.org).get(f"/api/v1/workdays/{wid}/track")
    with pytest.raises(DatabaseError):
        raw("UPDATE audit_auditlog SET action = 'x'", org_id=org_a.id, fetch=False)
    with pytest.raises(DatabaseError):
        raw("DELETE FROM audit_auditlog", org_id=org_a.id, fetch=False)
