import pytest
from django.conf import settings
from rest_framework.test import APIClient

from apps.tenancy.context import tenant_context
from apps.tenancy.models import Membership

LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"
COOKIE = settings.REFRESH_COOKIE_NAME


def login(client, email, password="pw-test", **extra):
    return client.post(LOGIN, {"email": email, "password": password, **extra}, format="json")


def test_login_returns_access_in_body_and_refresh_in_httponly_cookie(org_a):
    client = APIClient()
    response = login(client, org_a.driver.email)
    assert response.status_code == 200
    data = response.json()
    assert data["access"] and data["organization"]["id"] == str(org_a.id) and data["role"] == "DRIVER"
    assert "refresh" not in data  # el refresh nunca va al JavaScript
    cookie = response.cookies[COOKIE]
    assert cookie["httponly"] is True
    assert cookie["secure"] is True
    assert cookie["samesite"] == settings.REFRESH_COOKIE_SAMESITE
    assert cookie["path"] == settings.REFRESH_COOKIE_PATH


def test_login_wrong_password_is_401(org_a):
    assert login(APIClient(), org_a.driver.email, password="mal").status_code == 401


def test_access_token_works_for_me(org_a):
    client = APIClient()
    access = login(client, org_a.driver.email).json()["access"]
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    assert client.get("/api/v1/auth/me").json()["organization"]["id"] == str(org_a.id)


@pytest.fixture
def multi_user(org_a, org_b):
    user = org_a.owner
    with tenant_context(org_b.id):
        Membership.objects.create(user=user, role=Membership.Role.SUPERVISOR)
    return user


def test_user_in_two_orgs_must_choose(org_a, org_b, multi_user):
    response = login(APIClient(), multi_user.email)
    assert response.status_code == 409
    assert {o["id"] for o in response.json()["organizations"]} == {str(org_a.id), str(org_b.id)}
    chosen = login(APIClient(), multi_user.email, organization_id=str(org_b.id))
    assert chosen.status_code == 200 and chosen.json()["role"] == "SUPERVISOR"


def test_cannot_choose_an_org_without_membership(org_a, org_b):
    response = login(APIClient(), org_a.driver.email, organization_id=str(org_b.id))
    assert response.status_code == 403


def test_refresh_rotates_and_old_refresh_stops_working(org_a):
    client = APIClient()
    login(client, org_a.driver.email)
    old_refresh = client.cookies[COOKIE].value
    response = client.post(REFRESH)
    assert response.status_code == 200 and response.json()["access"]
    assert client.cookies[COOKIE].value != old_refresh

    replay = APIClient()
    replay.cookies[COOKIE] = old_refresh
    assert replay.post(REFRESH).status_code == 401


def test_refreshed_access_keeps_the_org(org_a):
    client = APIClient()
    login(client, org_a.driver.email)
    access = client.post(REFRESH).json()["access"]
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    assert api.get("/api/v1/auth/me").json()["organization"]["id"] == str(org_a.id)


def test_refresh_without_cookie_is_401():
    assert APIClient().post(REFRESH).status_code == 401


def test_refresh_from_foreign_origin_is_rejected(org_a):
    client = APIClient()
    login(client, org_a.driver.email)
    assert client.post(REFRESH, HTTP_ORIGIN="https://evil.example").status_code == 403
    assert client.post(REFRESH, HTTP_ORIGIN="https://app.example.test").status_code == 200  # CSRF_TRUSTED_ORIGINS
    assert client.post(REFRESH, HTTP_ORIGIN="http://testserver").status_code == 200  # mismo origen (proxy)


def test_refresh_fails_after_membership_is_disabled(org_a):
    client = APIClient()
    login(client, org_a.driver.email)
    with tenant_context(org_a.id):
        Membership.objects.filter(user=org_a.driver).update(status=Membership.Status.DISABLED)
    assert client.post(REFRESH).status_code == 401


def test_access_token_stops_working_when_membership_is_disabled(org_a):
    client = APIClient()
    access = login(client, org_a.driver.email).json()["access"]
    with tenant_context(org_a.id):
        Membership.objects.filter(user=org_a.driver).update(status=Membership.Status.DISABLED)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    # Sin membresía activa no hay contexto, y con RLS en accounts_user (ADR-010) el usuario ni
    # siquiera es visible: el token deja de autenticar (401) y la app vuelve al login.
    assert client.get("/api/v1/auth/me").status_code == 401


def test_disabled_user_with_unexpired_access_token_gets_no_context(org_a):
    """Desactivar al usuario corta el acceso en la request siguiente, sin esperar a que venza el token."""
    from django.http import HttpResponse
    from django.test import RequestFactory

    from apps.accounts.models import User
    from apps.tenancy.middleware import TenantContextMiddleware

    client = APIClient()
    access = login(client, org_a.driver.email).json()["access"]
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    assert client.get("/api/v1/auth/me").status_code == 200

    with tenant_context(org_a.id):  # RLS de accounts_user: se modifica desde la empresa
        assert User.objects.filter(id=org_a.driver.id).update(status=User.Status.DISABLED) == 1

    # 1) El middleware no fija contexto de empresa (la membresía sigue activa: el que falla es el usuario).
    seen = {}

    def view(request):
        seen["tenant"] = request.tenant
        return HttpResponse()

    TenantContextMiddleware(view)(RequestFactory().get("/x", HTTP_AUTHORIZATION=f"Bearer {access}"))
    assert seen["tenant"] is None
    # 2) Y la API lo rechaza.
    assert client.get("/api/v1/auth/me").status_code in (401, 403)
    assert client.get("/api/v1/workdays/current").status_code in (401, 403)
    # 3) Tampoco puede renovar la sesión con la cookie.
    assert client.post(REFRESH).status_code == 401


def test_logout_revokes_refresh_and_clears_cookie(org_a):
    client = APIClient()
    login(client, org_a.driver.email)
    refresh = client.cookies[COOKIE].value
    response = client.post(LOGOUT)
    assert response.status_code == 204
    assert response.cookies[COOKIE].value == ""
    again = APIClient()
    again.cookies[COOKIE] = refresh
    assert again.post(REFRESH).status_code == 401


def test_session_says_whether_the_org_is_demo(org_a):
    """Los datos de demostración se marcan como tales en la interfaz (CLAUDE.md)."""
    from apps.tenancy.models import Organization

    client = APIClient()
    assert login(client, org_a.driver.email).json()["organization"]["is_demo"] is False
    with tenant_context(org_a.id):
        Organization.objects.filter(id=org_a.id).update(is_demo=True)
    data = login(APIClient(), org_a.driver.email).json()
    assert data["organization"]["is_demo"] is True
    me = APIClient()
    me.credentials(HTTP_AUTHORIZATION=f"Bearer {data['access']}")
    assert me.get("/api/v1/auth/me").json()["organization"]["is_demo"] is True
