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
    """Un JWT bien firmado pero con una empresa a la que el usuario no pertenece: sin datos.

    Sin contexto, RLS de accounts_user (ADR-010) no deja ver al usuario: el token no autentica (401).
    """
    response = client_for(org_b.driver, org_a.org).get("/api/v1/auth/me")
    assert response.status_code == 401
    assert "organization" not in response.json()


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


@covers("workday-track")
def test_track_of_another_orgs_workday_is_404_for_every_role(org_a, org_b, workday_a):
    """Ni el dueño ni el repartidor de B ven el recorrido de una jornada de A (por id)."""
    workday_id = workday_a["workday"]["id"]
    tracking_client(workday_a["tracking_token"]).post(
        "/api/v1/tracking/batch", [make_point(now_utc() - timedelta(seconds=30))], format="json"
    )
    for user in (org_b.owner, org_b.driver):
        response = client_for(user, org_b.org).get(f"/api/v1/workdays/{workday_id}/track")
        assert response.status_code == 404, response.content
    # Control: dentro de A, el dueño sí lo ve.
    assert client_for(org_a.owner, org_a.org).get(f"/api/v1/workdays/{workday_id}/track").status_code == 200


@covers("workday-list")
def test_workday_list_never_includes_another_org(org_a, org_b, workday_a):
    workday_b = start_workday(org_b.driver, org_b.org)
    listed = client_for(org_b.owner, org_b.org).get("/api/v1/workdays/").json()["workdays"]
    assert [w["id"] for w in listed] == [workday_b["workday"]["id"]]
    listed_a = client_for(org_a.owner, org_a.org).get("/api/v1/workdays/").json()["workdays"]
    assert [w["id"] for w in listed_a] == [workday_a["workday"]["id"]]


@covers("driver-list")
def test_driver_list_never_includes_another_org(org_a, org_b, workday_a):
    names_b = [d["email"] for d in client_for(org_b.owner, org_b.org).get("/api/v1/drivers/").json()["drivers"]]
    assert names_b == [org_b.driver.email]
    names_a = {d["email"] for d in client_for(org_a.owner, org_a.org).get("/api/v1/drivers/").json()["drivers"]}
    assert names_a == {u.email for u in org_a.drivers}


@covers("workday-tracking-token")
def test_tracking_token_recovery_never_reaches_another_org(org_a, org_b, workday_a):
    """Ni un repartidor de otra empresa ni un compañero pueden pedir un token para la jornada de A."""
    wid = workday_a["workday"]["id"]
    assert client_for(org_b.driver, org_b.org).post(f"/api/v1/workdays/{wid}/tracking-token").status_code == 404
    assert client_for(org_a.drivers[1], org_a.org).post(f"/api/v1/workdays/{wid}/tracking-token").status_code == 404
    assert client_for(org_a.owner, org_a.org).post(f"/api/v1/workdays/{wid}/tracking-token").status_code == 403


# --- Paquetes (etapa 1) ------------------------------------------------------------------------


@pytest.fixture
def package_a(org_a):
    response = client_for(org_a.owner, org_a.org).post(
        "/api/v1/packages/", {"tracking_code": "A-1", "address": {"raw_text": "Calle de A 100"}}, format="json"
    )
    assert response.status_code == 201
    return response.json()["package"]


def _driver_of(fx):
    from apps.drivers.models import DriverProfile

    with tenant_context(fx.id):
        return str(DriverProfile.objects.get(membership__user=fx.driver).id)


@covers("package-list")
def test_package_list_never_shows_another_org(org_a, org_b, package_a):
    assert client_for(org_b.owner, org_b.org).get("/api/v1/packages/").json()["packages"] == []
    assert client_for(org_b.owner, org_b.org).get("/api/v1/packages/?q=A-1").json()["packages"] == []


@covers("package-detail")
def test_package_detail_and_edit_of_another_org_is_404(org_a, org_b, package_a):
    client = client_for(org_b.owner, org_b.org)
    assert client.get(f"/api/v1/packages/{package_a['id']}").status_code == 404
    assert client.patch(f"/api/v1/packages/{package_a['id']}", {"version": 1, "notes": "x"}, format="json").status_code == 404


@covers("package-assign")
def test_package_of_another_org_cannot_be_assigned_nor_to_a_driver_of_another_org(org_a, org_b, package_a):
    other = client_for(org_b.owner, org_b.org)
    assert other.post(f"/api/v1/packages/{package_a['id']}/assign", {"driver_id": None, "version": 1}, format="json").status_code == 404
    # El paquete de A no se puede asignar a un repartidor de B: para A, ese repartidor no existe.
    own = client_for(org_a.owner, org_a.org)
    r = own.post(f"/api/v1/packages/{package_a['id']}/assign", {"driver_id": _driver_of(org_b), "version": 1}, format="json")
    assert r.status_code == 400 and r.json()["code"] == "driver_not_found"


@covers("package-bulk-assign")
def test_bulk_assign_ignores_packages_of_another_org(org_a, org_b, package_a):
    r = client_for(org_b.owner, org_b.org).post(
        "/api/v1/packages/assign", {"package_ids": [package_a["id"]], "driver_id": _driver_of(org_b)}, format="json"
    )
    assert r.json()["assigned"] == [] and r.json()["failed"][0]["code"] == "not_found"


@covers("package-status")
def test_package_status_of_another_org_is_404(org_a, org_b, package_a):
    r = client_for(org_b.owner, org_b.org).post(
        f"/api/v1/packages/{package_a['id']}/status", {"status": "CANCELLED", "version": 1}, format="json"
    )
    assert r.status_code == 404


@covers("package-events")
def test_package_events_of_another_org_is_404(org_a, org_b, package_a):
    assert client_for(org_b.owner, org_b.org).get(f"/api/v1/packages/{package_a['id']}/events").status_code == 404


# --- Importación (etapa 1) ---------------------------------------------------------------------


@pytest.fixture
def import_a(org_a):
    from django.core.files.uploadedfile import SimpleUploadedFile

    response = client_for(org_a.owner, org_a.org).post(
        "/api/v1/imports/", {"file": SimpleUploadedFile("a.csv", b"codigo;direccion\nA-9;Calle de A 1\n")}, format="multipart"
    )
    assert response.status_code == 201
    return response.json()["import"]


@covers("import-create")
def test_import_creates_packages_only_in_the_own_org(org_a, org_b, import_a):
    client_for(org_a.owner, org_a.org).post(
        f"/api/v1/imports/{import_a['id']}/confirm", {"mapping": import_a["suggested_mapping"]}, format="json"
    )
    assert client_for(org_b.owner, org_b.org).get("/api/v1/packages/").json()["packages"] == []


@covers("import-detail")
def test_import_of_another_org_is_404(org_a, org_b, import_a):
    assert client_for(org_b.owner, org_b.org).get(f"/api/v1/imports/{import_a['id']}").status_code == 404


@covers("import-preview")
def test_preview_of_another_org_is_404(org_a, org_b, import_a):
    r = client_for(org_b.owner, org_b.org).post(
        f"/api/v1/imports/{import_a['id']}/preview", {"mapping": import_a["suggested_mapping"]}, format="json"
    )
    assert r.status_code == 404


@covers("import-confirm")
def test_confirm_of_another_org_is_404_and_creates_nothing(org_a, org_b, import_a):
    r = client_for(org_b.owner, org_b.org).post(
        f"/api/v1/imports/{import_a['id']}/confirm", {"mapping": import_a["suggested_mapping"]}, format="json"
    )
    assert r.status_code == 404
    assert client_for(org_a.owner, org_a.org).get("/api/v1/packages/").json()["packages"] == []


# --- Entrega en la calle (etapa 1) -------------------------------------------------------------


@pytest.fixture
def delivered_a(org_a, settings, tmp_path):
    """Un paquete de A asignado a su repartidor, con una visita y una foto."""
    import uuid as _uuid

    from django.core.files.uploadedfile import SimpleUploadedFile

    settings.MEDIA_ROOT = str(tmp_path)
    pkg = client_for(org_a.owner, org_a.org).post(
        "/api/v1/packages/",
        {"tracking_code": "V-1", "address": {"raw_text": "Calle de A 5"}, "driver_id": _driver_of(org_a)},
        format="json",
    ).json()["package"]
    visit_id = str(_uuid.uuid4())
    driver = client_for(org_a.driver, org_a.org)
    driver.post(
        "/api/v1/visits",
        {"id": visit_id, "package_id": pkg["id"], "started_at": iso(now_utc()), "outcome": "NO_ANSWER"},
        format="json",
    )
    evidence_id = str(_uuid.uuid4())
    driver.post(
        "/api/v1/evidence",
        {
            "id": evidence_id,
            "package_id": pkg["id"],
            "visit_id": visit_id,
            "captured_at": iso(now_utc()),
            "file": SimpleUploadedFile("f.png", b"\x89PNG\r\n\x1a\nx", content_type="image/png"),
        },
        format="multipart",
    )
    return {"package": pkg, "visit_id": visit_id, "evidence_id": evidence_id}


@covers("visit-create")
def test_visit_cannot_target_a_package_of_another_org(org_a, org_b, delivered_a):
    body = {"id": str(uuid.uuid4()), "package_id": delivered_a["package"]["id"], "started_at": iso(now_utc()), "outcome": "DELIVERED"}
    assert client_for(org_b.driver, org_b.org).post("/api/v1/visits", body, format="json").status_code == 404
    # Reusar el id de una visita de A desde B no la expone ni la pisa.
    body["id"] = delivered_a["visit_id"]
    assert client_for(org_b.driver, org_b.org).post("/api/v1/visits", body, format="json").status_code in (404, 409)


@covers("evidence-create")
def test_evidence_cannot_target_a_package_of_another_org(org_a, org_b, delivered_a):
    from django.core.files.uploadedfile import SimpleUploadedFile

    r = client_for(org_b.driver, org_b.org).post(
        "/api/v1/evidence",
        {
            "id": str(uuid.uuid4()),
            "package_id": delivered_a["package"]["id"],
            "captured_at": iso(now_utc()),
            "file": SimpleUploadedFile("f.png", b"\x89PNG\r\n\x1a\nx", content_type="image/png"),
        },
        format="multipart",
    )
    assert r.status_code == 404


@covers("evidence-file")
def test_photo_of_another_org_is_404(org_a, org_b, delivered_a):
    assert client_for(org_b.owner, org_b.org).get(f"/api/v1/evidence/{delivered_a['evidence_id']}/file").status_code == 404


@covers("communication-create")
def test_communication_cannot_target_a_package_of_another_org(org_a, org_b, delivered_a):
    body = {"id": str(uuid.uuid4()), "package_id": delivered_a["package"]["id"], "channel": "PHONE", "started_at": iso(now_utc())}
    assert client_for(org_b.driver, org_b.org).post("/api/v1/communications", body, format="json").status_code == 404


@covers("package-visits")
def test_visits_of_another_org_are_404(org_a, org_b, delivered_a):
    assert client_for(org_b.owner, org_b.org).get(f"/api/v1/packages/{delivered_a['package']['id']}/visits").status_code == 404


@covers("package-load")
def test_loading_never_touches_or_reveals_packages_of_another_org(org_a, org_b):
    client_for(org_a.owner, org_a.org).post(
        "/api/v1/packages/", {"tracking_code": "COMPARTIDO", "address": {"raw_text": "A 1"}, "driver_id": _driver_of(org_a)}, format="json"
    )
    r = client_for(org_b.driver, org_b.org).post("/api/v1/packages/load", {"tracking_codes": ["COMPARTIDO"]}, format="json")
    assert r.json()["results"] == [{"code": "COMPARTIDO", "result": "not_assigned"}]
    pkg = client_for(org_a.owner, org_a.org).get("/api/v1/packages/?q=COMPARTIDO").json()["packages"][0]
    assert pkg["status"] == "ASSIGNED"


# --- Armar mi ruta (etapa 1) -------------------------------------------------------------------


@pytest.fixture
def route_b(org_a, org_b, monkeypatch):
    """B con jornada y un paquete propio; A con un paquete. VROOM falso que devuelve todo."""
    from apps.packages import routing

    monkeypatch.setattr(
        routing,
        "call_vroom",
        lambda problem: {"code": 0, "routes": [{"steps": [{"type": "job", "job": j["id"], "arrival": 0, "distance": 0} for j in problem["jobs"]]}]},
    )
    a = client_for(org_a.owner, org_a.org).post(
        "/api/v1/packages/", {"tracking_code": "RA", "address": {"raw_text": "A 1", "lat": -34.6, "lng": -58.4}, "driver_id": _driver_of(org_a)}, format="json"
    ).json()["package"]
    client_for(org_b.owner, org_b.org).post(
        "/api/v1/packages/", {"tracking_code": "RB", "address": {"raw_text": "B 1", "lat": -34.6, "lng": -58.4}, "driver_id": _driver_of(org_b)}, format="json"
    )
    start_workday(org_b.driver, org_b.org)
    return a


@covers("route-optimize")
def test_optimize_only_uses_packages_of_the_own_org(org_a, org_b, route_b):
    r = client_for(org_b.driver, org_b.org).post("/api/v1/route/optimize", {"lat": -34.6, "lng": -58.4}, format="json")
    assert route_b["id"] not in [s["package_id"] for s in r.json()["stops"]]
    assert len(r.json()["stops"]) == 1


@covers("route")
def test_manual_route_ignores_packages_of_another_org(org_a, org_b, route_b):
    r = client_for(org_b.driver, org_b.org).put("/api/v1/route", {"package_ids": [route_b["id"]]}, format="json")
    assert route_b["id"] not in [s["package_id"] for s in r.json()["stops"]]
    assert route_b["id"] not in [s["package_id"] for s in client_for(org_b.driver, org_b.org).get("/api/v1/route").json()["stops"]]
