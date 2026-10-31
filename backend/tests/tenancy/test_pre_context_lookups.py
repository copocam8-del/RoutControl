"""Las dos búsquedas previas al contexto (membresías y TrackingToken) y nada más.

* Solo existen como funciones SECURITY DEFINER acotadas, que devuelven exactamente
  (organization_id, membership_id) y (organization_id, workday_id).
* Por fuera de esas funciones, el rol de la aplicación (rc_app) no puede leer membresías ni
  tokens de otra empresa: ni sin contexto, ni con el contexto de la propia, ni buscando por hash.
* La API nunca se conecta como el rol dueño de las tablas (rc_owner).
"""

import hashlib
from datetime import timedelta

import pytest
from django.db import connections, transaction
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.tenancy.context import tenant_context
from apps.tenancy.models import Membership
from apps.tracking.models import TrackingToken
from tests.conftest import iso, make_point, now_utc, start_workday, tracking_client

FUNCTIONS = {
    "rc_user_memberships": ["organization_id", "membership_id"],
    "rc_resolve_tracking_token": ["organization_id", "workday_id"],
}


def raw(sql, params=None, org_id=None):
    with transaction.atomic(using="app"), connections["app"].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_org', %s, true)", [str(org_id) if org_id else ""])
        cursor.execute(sql, params or [])
        return cursor.fetchall()


@pytest.fixture
def tokens(org_a, org_b):
    """Una jornada activa (con su token en claro) en cada empresa."""
    return {
        "a": start_workday(org_a.driver, org_a.org)["tracking_token"],
        "b": start_workday(org_b.driver, org_b.org)["tracking_token"],
    }


def sha(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


# --- Las funciones: acotadas y con lo mínimo -----------------------------------------------------


@pytest.mark.parametrize("name, columns", FUNCTIONS.items())
def test_functions_are_narrow_security_definer(name, columns):
    [(secdef, config, args, out_names, public_can_execute, app_can_execute)] = raw(
        """
        SELECT p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid),
               (SELECT array_agg(n ORDER BY i) FROM unnest(p.proargnames, p.proargmodes)
                        WITH ORDINALITY AS a(n, m, i) WHERE m = 't'),
               has_function_privilege('public', p.oid, 'EXECUTE'),
               has_function_privilege(current_user, p.oid, 'EXECUTE')
          FROM pg_proc p WHERE p.proname = %s
        """,
        [name],
    )
    assert secdef is True
    assert any(c.startswith("search_path=") for c in config)  # search_path fijo
    assert len(args.split(",")) == 1  # una sola clave de entrada
    assert out_names == columns  # devuelve solo identificadores
    assert public_can_execute is False
    assert app_can_execute is True


def test_function_owner_is_not_the_app_role():
    owners = raw(
        "SELECT DISTINCT pg_get_userbyid(proowner) FROM pg_proc WHERE proname = ANY(%s)", [list(FUNCTIONS)]
    )
    assert owners and current_app_user() not in {o for (o,) in owners}


def current_app_user():
    return raw("SELECT current_user")[0][0]


# --- Por fuera de las funciones: nada de otra empresa ----------------------------------------


def test_app_role_cannot_read_memberships_without_context(org_a, org_b):
    assert raw("SELECT count(*) FROM tenancy_membership")[0][0] == 0
    # Ni buscando la membresía de un usuario concreto.
    assert raw("SELECT * FROM tenancy_membership WHERE user_id = %s", [str(org_b.driver.id)]) == []


def test_app_role_cannot_read_memberships_of_another_org(org_a, org_b):
    rows = raw("SELECT organization_id, user_id FROM tenancy_membership", org_id=org_a.id)
    assert rows and {org for org, _ in rows} == {org_a.id}
    assert raw(
        "SELECT * FROM tenancy_membership WHERE user_id = %s", [str(org_b.driver.id)], org_id=org_a.id
    ) == []


def test_app_role_cannot_read_tokens_without_context(tokens):
    assert raw("SELECT count(*) FROM tracking_trackingtoken")[0][0] == 0
    assert raw("SELECT * FROM tracking_trackingtoken WHERE token_hash = %s", [sha(tokens["b"])]) == []


def test_app_role_cannot_find_another_orgs_token_by_hash(org_a, org_b, tokens):
    # Control: con el contexto de B, el token de B existe.
    own = raw("SELECT id FROM tracking_trackingtoken WHERE token_hash = %s", [sha(tokens["b"])], org_id=org_b.id)
    assert len(own) == 1
    # Con el contexto de A, no.
    assert raw(
        "SELECT * FROM tracking_trackingtoken WHERE token_hash = %s", [sha(tokens["b"])], org_id=org_a.id
    ) == []
    rows = raw("SELECT organization_id FROM tracking_trackingtoken", org_id=org_a.id)
    assert {org for (org,) in rows} == {org_a.id}


def test_orm_cannot_read_them_either(org_a, org_b, tokens):
    with tenant_context(org_a.id):
        assert not Membership.objects.filter(user=org_b.driver).exists()
        assert not TrackingToken.objects.filter(token_hash=sha(tokens["b"])).exists()


# --- Las funciones devuelven solo lo que corresponde a la clave ------------------------------


def test_resolve_function_returns_only_org_and_workday(org_b, tokens):
    rows = raw("SELECT * FROM rc_resolve_tracking_token(%s)", [sha(tokens["b"])])
    assert len(rows) == 1 and len(rows[0]) == 2 and rows[0][0] == org_b.id
    assert raw("SELECT * FROM rc_resolve_tracking_token(%s)", [sha("token-inventado")]) == []


def test_memberships_function_returns_only_ids_of_that_user(org_a, org_b):
    rows = raw("SELECT * FROM rc_user_memberships(%s)", [str(org_b.driver.id)])
    assert len(rows) == 1 and len(rows[0]) == 2 and rows[0][0] == org_b.id


# --- La API no usa nunca el rol dueño ---------------------------------------------------------


def test_api_never_queries_with_the_owner_role(org_a):
    """Flujo completo (login, refresh, me, jornada, lote, fin): cero consultas por "default"."""
    with CaptureQueriesContext(connections["default"]) as owner_queries:
        client = APIClient()
        login = client.post(
            "/api/v1/auth/login", {"email": org_a.driver.email, "password": "pw-test"}, format="json"
        )
        assert login.status_code == 200
        access = client.post("/api/v1/auth/refresh").json()["access"]
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        assert client.get("/api/v1/auth/me").status_code == 200

        started = now_utc() - timedelta(minutes=10)
        body = start_workday(org_a.driver, org_a.org, started_at=started)
        batch = tracking_client(body["tracking_token"]).post(
            "/api/v1/tracking/batch", [make_point(started + timedelta(minutes=1))], format="json"
        )
        assert batch.status_code == 200
        end = client.post(f"/api/v1/workdays/{body['workday']['id']}/end", {"ended_at": iso(now_utc())}, format="json")
        assert end.status_code == 200

    assert len(owner_queries.captured_queries) == 0, owner_queries.captured_queries
