"""Aislamiento por endpoint (§3.6): un usuario de otra empresa nunca ve ni toca datos ajenos.

Regla del proyecto: **cada endpoint nuevo tiene que figurar en ISOLATION_CASES o en EXEMPT**
(con el motivo). ``test_every_api_endpoint_is_covered`` falla si alguien agrega uno sin cubrirlo.
"""

import uuid
from datetime import timedelta

import pytest
from django.urls import URLPattern, URLResolver, get_resolver

from apps.tenancy.context import tenant_context
from apps.tracking.models import LocationPoint
from apps.workdays.models import Workday
from tests.conftest import client_for, iso, make_point, now_utc, start_workday, tracking_client

# Endpoints sin datos de empresa, y por qué.
EXEMPT = {
    "auth-login": "Previo a tener empresa; la elección de empresa se valida contra las membresías.",
    "auth-refresh": "Usa la cookie; la empresa sale del refresh firmado y se revalida la membresía.",
    "auth-logout": "Solo invalida la cookie del propio navegador.",
    "schema": "Documento OpenAPI, sin datos.",
}

ISOLATION_CASES: dict[str, str] = {}


def covers(url_name: str):
    def decorator(fn):
        ISOLATION_CASES[url_name] = fn.__name__
        return fn

    return decorator


def _api_url_names(resolver=None, prefix=""):
    resolver = resolver or get_resolver()
    for p in resolver.url_patterns:
        path = prefix + str(p.pattern)
        if isinstance(p, URLResolver):
            yield from _api_url_names(p, path)
        elif isinstance(p, URLPattern) and path.startswith("api/"):
            yield p.name or path


def test_every_api_endpoint_is_covered():
    names = set(_api_url_names())
    missing = names - set(ISOLATION_CASES) - set(EXEMPT)
    assert not missing, f"Endpoints sin prueba de aislamiento (agregarla o justificar en EXEMPT): {missing}"


@pytest.fixture
def workday_a(org_a):
    return start_workday(org_a.driver, org_a.org)


@covers("auth-me")
def test_me_returns_only_the_org_of_the_token(org_a, org_b):
    response = client_for(org_b.driver, org_b.org).get("/api/v1/auth/me")
    assert response.status_code == 200
    assert response.json()["organization"]["id"] == str(org_b.id)


def test_token_with_org_where_user_has_no_membership_gets_no_context(org_a, org_b):
    """Un JWT bien firmado pero con una empresa a la que el usuario no pertenece: 403, sin datos."""
    response = client_for(org_b.driver, org_a.org).get("/api/v1/auth/me")
    assert response.status_code == 403


@covers("workday-end")
def test_end_workday_of_another_org_is_404(org_a, org_b, workday_a):
    workday_id = workday_a["workday"]["id"]
    for user in (org_b.driver, org_b.owner):
        response = client_for(user, org_b.org).post(
            f"/api/v1/workdays/{workday_id}/end", {"ended_at": iso(now_utc())}, format="json"
        )
        assert response.status_code in (403, 404), response.content
    with tenant_context(org_a.id):
        assert Workday.objects.get(id=workday_id).status == Workday.Status.ACTIVE


@covers("workday-current")
def test_current_workday_never_returns_another_org(org_a, org_b, workday_a):
    response = client_for(org_b.driver, org_b.org).get("/api/v1/workdays/current")
    assert response.status_code == 200
    assert response.json()["workday"] is None


@covers("workday-start")
def test_start_with_workday_id_of_another_org_does_not_touch_it(org_a, org_b, workday_a):
    """Reusar el UUID de una jornada de A desde B: conflicto, y la jornada de A queda igual."""
    body = {
        "workday_id": workday_a["workday"]["id"],
        "started_at": iso(now_utc()),
        "device": {"id": str(uuid.uuid4()), "runtime": "PWA"},
    }
    response = client_for(org_b.driver, org_b.org).post("/api/v1/workdays/start", body, format="json")
    assert response.status_code == 409
    with tenant_context(org_a.id):
        assert Workday.objects.get(id=workday_a["workday"]["id"]).driver.membership.user == org_a.driver
    with tenant_context(org_b.id):
        assert not Workday.objects.exists()


@covers("tracking-batch")
def test_batch_org_comes_from_token_not_from_body(org_a, org_b, workday_a):
    """Con el token de B, aunque el cuerpo diga empresa/jornada de A, los puntos van a B."""
    workday_b = start_workday(org_b.driver, org_b.org)
    point = make_point(now_utc() - timedelta(minutes=1))
    point["organization_id"] = str(org_a.id)
    point["workday_id"] = workday_a["workday"]["id"]
    response = tracking_client(workday_b["tracking_token"]).post(
        "/api/v1/tracking/batch",
        {"organization_id": str(org_a.id), "workday_id": workday_a["workday"]["id"], "points": [point]},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["accepted"] == [point["point_id"]]
    with tenant_context(org_a.id):
        assert not LocationPoint.objects.exists()
    with tenant_context(org_b.id):
        stored = LocationPoint.objects.get(point_id=point["point_id"])
        assert str(stored.workday_id) == workday_b["workday"]["id"]


def test_same_point_id_in_two_orgs_does_not_collide(org_a, org_b, workday_a):
    workday_b = start_workday(org_b.driver, org_b.org)
    point = make_point(now_utc() - timedelta(minutes=1))
    ra = tracking_client(workday_a["tracking_token"]).post("/api/v1/tracking/batch", [point], format="json")
    rb = tracking_client(workday_b["tracking_token"]).post("/api/v1/tracking/batch", [point], format="json")
    assert ra.json()["accepted"] == [point["point_id"]]
    assert rb.json()["accepted"] == [point["point_id"]]  # no es "duplicado": es de otra empresa
