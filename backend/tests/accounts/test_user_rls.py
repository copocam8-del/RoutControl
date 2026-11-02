"""RLS en accounts_user (ADR-010), con SQL directo como rc_app (sin ORM, sin superusuario).

La aplicación ve solo al usuario del contexto (app.current_user) y a los miembros de la empresa
del contexto (app.current_org). El login busca por email con rc_auth_lookup (SECURITY DEFINER),
que devuelve una sola fila con id, hash y estado.
"""

import pytest
from django.db import DatabaseError, connections, transaction
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.tenancy.context import tenant_context, user_context


def raw(sql: str, params=None, org_id=None, user_id=None, fetch=True):
    with transaction.atomic(using="app"):
        with connections["app"].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_org', %s, true)", [str(org_id) if org_id else ""])
            cursor.execute("SELECT set_config('app.current_user', %s, true)", [str(user_id) if user_id else ""])
            cursor.execute(sql, params or [])
            return cursor.fetchall() if fetch else cursor.rowcount


def emails(org_id=None, user_id=None) -> set[str]:
    return {r[0] for r in raw("SELECT email FROM accounts_user", org_id=org_id, user_id=user_id)}


def test_without_context_no_user_is_visible(org_a, org_b):
    assert emails() == set()


def test_org_context_sees_only_its_members(org_a, org_b):
    a, b = emails(org_id=org_a.id), emails(org_id=org_b.id)
    # Control: cada empresa ve a sus propios miembros.
    assert org_a.driver.email in a and org_a.owner.email in a
    assert org_b.driver.email in b
    # Ningún miembro de B se ve desde A (ni al revés).
    assert not ({org_b.driver.email, org_b.owner.email} & a)
    assert not ({org_a.driver.email, org_a.owner.email} & b)


def test_user_context_sees_only_itself(org_a, org_b):
    assert emails(user_id=org_a.driver.id) == {org_a.driver.email}


def test_cannot_update_users_of_another_org(org_a, org_b):
    updated = raw(
        "UPDATE accounts_user SET full_name = 'hackeado' WHERE id = %s",
        [str(org_b.driver.id)],
        org_id=org_a.id,
        fetch=False,
    )
    assert updated == 0
    with tenant_context(org_b.id):
        assert User.objects.get(id=org_b.driver.id).full_name != "hackeado"


def test_cannot_delete_users(org_a):
    deleted = raw("DELETE FROM accounts_user WHERE id = %s", [str(org_a.driver.id)], org_id=org_a.id, fetch=False)
    assert deleted == 0


def test_auth_lookup_returns_one_row_with_only_id_hash_and_status(org_a, org_b):
    rows = raw("SELECT * FROM rc_auth_lookup(%s)", ["  DRIVER1@ORG-A.TEST "])
    assert len(rows) == 1
    user_id, password_hash, status = rows[0]
    assert user_id == org_a.driver.id and "$" in password_hash and status == "ACTIVE"  # hash, nunca la contraseña
    assert raw("SELECT * FROM rc_auth_lookup(%s)", ["nadie@x.test"]) == []
    # No sirve para listar: un patrón no es un email.
    assert raw("SELECT * FROM rc_auth_lookup(%s)", ["%"]) == []


def test_app_role_cannot_bypass_rls_on_users(org_a):
    """rc_app no es dueño de accounts_user: no puede desactivar el RLS."""
    with pytest.raises(DatabaseError):
        raw("ALTER TABLE accounts_user DISABLE ROW LEVEL SECURITY", fetch=False)


def test_login_still_works_and_new_users_can_be_created(org_a):
    response = APIClient().post("/api/v1/auth/login", {"email": org_a.driver.email, "password": "pw-test"}, format="json")
    assert response.status_code == 200
    created = User.objects.create_user(email="nuevo@org-a.test", password="x")
    with user_context(created.id):
        assert User.objects.filter(id=created.id).exists()
    assert not User.objects.filter(id=created.id).exists()  # fuera de su contexto, invisible
