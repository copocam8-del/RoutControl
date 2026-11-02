"""Sesiones de refresh propias (RefreshSession) en lugar de token_blacklist de simplejwt (ADR-005).

1. Ninguna tabla guarda el refresh token completo.
2. RLS: con el contexto de A no se ven sesiones de B (SQL directo, como el rol de la aplicación).
3. Reusar un refresh ya rotado revoca todas las sesiones del usuario.
"""

import base64
import json

import pytest
from django.conf import settings
from django.db import connections, transaction
from rest_framework.test import APIClient

from apps.accounts.models import RefreshSession
from apps.tenancy.context import tenant_context
from apps.tenancy.models import Membership

LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"
COOKIE = settings.REFRESH_COOKIE_NAME


def raw(sql, params=None, org_id=None):
    with transaction.atomic(using="app"), connections["app"].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_org', %s, true)", [str(org_id) if org_id else ""])
        cursor.execute(sql, params or [])
        return cursor.fetchall()


def new_device(user, org_id=None) -> APIClient:
    """Un login nuevo (otro teléfono o navegador) → una sesión nueva."""
    client = APIClient()
    body = {"email": user.email, "password": "pw-test"}
    if org_id:
        body["organization_id"] = str(org_id)
    assert client.post(LOGIN, body, format="json").status_code == 200
    return client


def cookie(client: APIClient) -> str:
    return client.cookies[COOKIE].value


def open_sessions(user, org_id) -> int:
    return raw(
        "SELECT count(*) FROM accounts_refreshsession WHERE user_id = %s AND revoked_at IS NULL",
        [str(user.id)],
        org_id=org_id,
    )[0][0]


# --- 1. Nunca el token completo -------------------------------------------------------------


def test_session_table_has_only_jti_user_expiry_and_revocation():
    columns = {r[0] for r in raw("SELECT column_name FROM information_schema.columns WHERE table_name = 'accounts_refreshsession'")}
    assert columns == {"id", "organization_id", "jti", "user_id", "created_at", "expires_at", "revoked_at", "revoked_reason"}


def test_simplejwt_blacklist_app_is_gone():
    assert "rest_framework_simplejwt.token_blacklist" not in settings.INSTALLED_APPS
    assert raw("SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'token_blacklist%%'") == [(0,)]


def test_no_table_stores_a_full_refresh_token(org_a, org_b):
    clients = [new_device(org_a.driver), new_device(org_b.driver)]
    rotated = clients[0]
    old = cookie(rotated)
    assert rotated.post(REFRESH).status_code == 200
    tokens = [old, cookie(rotated), cookie(clients[1])]
    # El token entero y también solo su firma (la parte que no se puede reconstruir).
    needles = tokens + [t.rsplit(".", 1)[1] for t in tokens]

    columns = raw(
        "SELECT table_name, column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'json', 'jsonb')"
    )
    assert columns
    hits = []
    for org_id in (None, org_a.id, org_b.id):  # cada contexto ve sus propias filas (RLS)
        for table, column in columns:
            for needle in needles:
                found = raw(
                    f'SELECT count(*) FROM "{table}" WHERE "{column}"::text LIKE %s', [f"%{needle}%"], org_id=org_id
                )[0][0]
                if found:
                    hits.append((table, column))
    assert hits == [], f"Columnas que contienen un refresh token: {sorted(set(hits))}"


# --- 2. RLS: sesiones de B invisibles desde A -------------------------------------------------


def test_raw_sql_with_org_a_context_sees_no_sessions_of_org_b(org_a, org_b):
    new_device(org_a.driver)
    new_device(org_b.driver)

    # Control: con el contexto de B, la sesión de B existe.
    assert raw("SELECT user_id FROM accounts_refreshsession", org_id=org_b.id) == [(org_b.driver.id,)]

    rows = raw("SELECT organization_id, user_id FROM accounts_refreshsession", org_id=org_a.id)
    assert rows == [(org_a.id, org_a.driver.id)]
    assert raw(
        "SELECT count(*) FROM accounts_refreshsession WHERE user_id = %s", [str(org_b.driver.id)], org_id=org_a.id
    ) == [(0,)]
    # Tampoco se puede revocar (ni "desrevocar") una sesión ajena.
    with transaction.atomic(using="app"), connections["app"].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_org', %s, true)", [str(org_a.id)])
        cursor.execute("UPDATE accounts_refreshsession SET revoked_at = now() WHERE user_id = %s", [str(org_b.driver.id)])
        assert cursor.rowcount == 0
    assert open_sessions(org_b.driver, org_b.id) == 1


def test_raw_sql_without_context_sees_no_sessions(org_a, org_b):
    new_device(org_a.driver)
    new_device(org_b.driver)
    assert raw("SELECT count(*) FROM accounts_refreshsession") == [(0,)]


# --- 3. Rotación y detección de reuso ---------------------------------------------------------


def test_rotation_revokes_the_old_session_and_creates_a_new_one(org_a):
    client = new_device(org_a.driver)
    old = cookie(client)
    assert client.post(REFRESH).status_code == 200
    with tenant_context(org_a.id):
        sessions = list(RefreshSession.objects.filter(user=org_a.driver).order_by("created_at"))
    assert [s.revoked_reason for s in sessions] == [RefreshSession.RevokedReason.ROTATED, ""]
    assert cookie(client) != old


def test_reusing_a_rotated_refresh_revokes_all_sessions_of_the_user(org_a):
    phone = new_device(org_a.driver)
    laptop = new_device(org_a.driver)
    coworker = new_device(org_a.drivers[1])
    stolen = cookie(phone)

    assert phone.post(REFRESH).status_code == 200  # el dueño rota; `stolen` queda rotado
    assert open_sessions(org_a.driver, org_a.id) == 2

    thief = APIClient()
    thief.cookies[COOKIE] = stolen
    response = thief.post(REFRESH)
    assert response.status_code == 401
    assert response.json()["code"] == "refresh_reuse_detected"

    # Todas las sesiones del usuario quedan revocadas: la del ladrón, la rotada y la otra.
    assert open_sessions(org_a.driver, org_a.id) == 0
    with tenant_context(org_a.id):
        reasons = set(RefreshSession.objects.filter(user=org_a.driver).values_list("revoked_reason", flat=True))
    assert RefreshSession.RevokedReason.REUSE_DETECTED in reasons
    assert phone.post(REFRESH).status_code == 401
    assert laptop.post(REFRESH).status_code == 401
    # Las de otros usuarios no se tocan.
    assert coworker.post(REFRESH).status_code == 200
    # Y el usuario puede volver a ingresar.
    assert new_device(org_a.driver).post(REFRESH).status_code == 200


def test_reuse_revocation_persists_even_if_the_request_carries_a_valid_access_token(org_a):
    """El 401 no puede deshacer la revocación (el middleware no envuelve los endpoints de sesión)."""
    from tests.conftest import access_token_for

    phone = new_device(org_a.driver)
    stolen = cookie(phone)
    phone.post(REFRESH)
    thief = APIClient()
    thief.cookies[COOKIE] = stolen
    thief.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token_for(org_a.driver, org_a.org)}")
    assert thief.post(REFRESH).status_code == 401
    assert open_sessions(org_a.driver, org_a.id) == 0


def test_reuse_revocation_is_scoped_to_the_org_of_the_token(org_a, org_b):
    """Las sesiones del mismo usuario en otra empresa no se ven (RLS) y no se tocan."""
    user = org_a.owner
    with tenant_context(org_b.id):
        Membership.objects.create(user=user, role=Membership.Role.SUPERVISOR)
    in_a = new_device(user, org_a.id)
    in_b = new_device(user, org_b.id)
    stolen = cookie(in_a)
    in_a.post(REFRESH)
    thief = APIClient()
    thief.cookies[COOKIE] = stolen
    assert thief.post(REFRESH).status_code == 401
    assert open_sessions(user, org_a.id) == 0
    assert open_sessions(user, org_b.id) == 1
    assert in_b.post(REFRESH).status_code == 200


def test_a_tampered_token_cannot_trigger_mass_revocation(org_a):
    """La firma se verifica ANTES de leer la base: un token adulterado no revoca nada."""
    client = new_device(org_a.driver)
    header, payload, signature = cookie(client).split(".")
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    claims["exp"] += 3600
    forged_payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    forger = APIClient()
    forger.cookies[COOKIE] = f"{header}.{forged_payload}.{signature}"

    assert forger.post(REFRESH).status_code == 401
    assert open_sessions(org_a.driver, org_a.id) == 1
    assert client.post(REFRESH).status_code == 200


def test_logout_revokes_only_that_session(org_a):
    phone = new_device(org_a.driver)
    laptop = new_device(org_a.driver)
    old = cookie(phone)
    assert phone.post(LOGOUT).status_code == 204
    assert open_sessions(org_a.driver, org_a.id) == 1
    # Reusar un refresh cerrado con logout NO es señal de robo: no revoca las demás.
    replay = APIClient()
    replay.cookies[COOKIE] = old
    assert replay.post(REFRESH).status_code == 401
    assert laptop.post(REFRESH).status_code == 200


def test_refresh_with_an_unknown_jti_is_rejected(org_a):
    """Un refresh bien firmado pero sin sesión (por ejemplo, emitido antes de este cambio)."""
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(org_a.driver)
    token["org"] = str(org_a.id)
    client = APIClient()
    client.cookies[COOKIE] = str(token)
    assert client.post(REFRESH).status_code == 401
