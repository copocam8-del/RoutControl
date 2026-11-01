"""RLS en la tabla de empresas (tenancy_organization): id = rc_current_org().

Igual que las demás pruebas de RLS: SQL directo, sin el ORM, como el rol de la aplicación. El
contexto se fija con ``set_config('app.current_org', …, true)``, que es lo que hace el middleware.
"""

import uuid

import pytest
from django.db import DatabaseError, connections, transaction

from apps.tenancy.context import tenant_context
from apps.tenancy.models import Organization
from apps.tenancy.services import create_organization, get_organization


def raw(sql, params=None, org_id=None):
    with transaction.atomic(using="app"), connections["app"].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_org', %s, true)", [str(org_id) if org_id else ""])
        cursor.execute(sql, params or [])
        return cursor.fetchall() if cursor.description else cursor.rowcount


@pytest.fixture
def orgs(org_a, org_b):
    # Datos sensibles en las dos empresas, para comprobar que no se filtran.
    for fx, cuit in ((org_a, "30-11111111-1"), (org_b, "30-22222222-2")):
        with tenant_context(fx.id):
            Organization.objects.filter(id=fx.id).update(tax_id=cuit, settings={"secreto": fx.org.slug})
    return org_a, org_b


def test_org_table_has_forced_rls_and_policy():
    [(enabled, forced)] = raw("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tenancy_organization'")
    assert enabled and forced
    [(qual, check)] = raw("SELECT qual, with_check FROM pg_policies WHERE tablename = 'tenancy_organization'")
    assert "rc_current_org()" in qual and "rc_current_org()" in check


def test_with_org_a_context_only_org_a_is_visible(orgs):
    org_a, org_b = orgs
    # Control: con el contexto de B, B existe (con sus datos).
    assert raw("SELECT id, tax_id FROM tenancy_organization", org_id=org_b.id) == [(org_b.id, "30-22222222-2")]

    # Con el contexto de A: SELECT sin WHERE → solo A; ni nombre, ni CUIT, ni configuración de B.
    rows = raw("SELECT id, name, tax_id, settings FROM tenancy_organization", org_id=org_a.id)
    assert [r[0] for r in rows] == [org_a.id]
    assert raw("SELECT * FROM tenancy_organization WHERE id = %s", [str(org_b.id)], org_id=org_a.id) == []
    assert raw("SELECT count(*) FROM tenancy_organization WHERE tax_id = '30-22222222-2'", org_id=org_a.id) == [(0,)]


def test_without_context_no_org_is_visible(orgs):
    assert raw("SELECT count(*) FROM tenancy_organization") == [(0,)]


def test_cannot_update_or_delete_another_org(orgs):
    org_a, org_b = orgs
    assert raw("UPDATE tenancy_organization SET name = 'hackeada' WHERE id = %s", [str(org_b.id)], org_id=org_a.id) == 0
    assert raw("DELETE FROM tenancy_organization WHERE id = %s", [str(org_b.id)], org_id=org_a.id) == 0
    assert raw("SELECT name FROM tenancy_organization", org_id=org_b.id) == [("Org org-b",)]


def test_cannot_insert_an_org_outside_its_own_context(orgs):
    org_a, _ = orgs
    with pytest.raises(DatabaseError, match="row-level security"):
        raw(
            "INSERT INTO tenancy_organization (id, name, slug, tax_id, limits, settings, status, timezone, is_demo, "
            "created_at, updated_at) VALUES (%s, 'Intrusa', 'intrusa', '', '{}', '{}', 'ACTIVE', 'UTC', false, now(), now())",
            [str(uuid.uuid4())],
            org_id=org_a.id,
        )


def test_create_and_read_go_through_the_orgs_own_context():
    org = create_organization(name="Nueva", slug="nueva")
    assert get_organization(org.id).name == "Nueva"
    assert not Organization.objects.filter(id=org.id).exists()  # sin contexto: invisible


def test_fk_from_tenant_tables_still_works(orgs):
    """Los chequeos de integridad (FK → tenancy_organization) no dependen del RLS."""
    org_a, _ = orgs
    from apps.tenancy.models import Membership

    with tenant_context(org_a.id):
        membership = Membership.objects.select_related("organization").first()
        assert membership.organization.id == org_a.id
