"""Fixtures comunes.

Todas las pruebas usan los dos alias de base:
  * "default" (dueño de las tablas) solo crea la base de pruebas y corre las migraciones;
  * "app" (usuario de la aplicación: sin superusuario, sin BYPASSRLS, no es dueño) es por donde
    pasan TODAS las lecturas y escrituras de las pruebas, igual que en producción.
Ver tests/tenancy/test_db_roles.py, que lo verifica en cada corrida.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone as dt_timezone

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User
from apps.drivers.models import DriverProfile
from apps.tenancy.context import tenant_context
from apps.tenancy.models import Membership, Organization

DATABASES = ["default", "app"]


def pytest_collection_modifyitems(items):
    for item in items:
        if not item.get_closest_marker("django_db"):
            item.add_marker(pytest.mark.django_db(databases=DATABASES))


@dataclass
class OrgFixture:
    org: Organization
    owner: User
    drivers: list[User] = field(default_factory=list)

    @property
    def id(self):
        return self.org.id

    @property
    def driver(self) -> User:
        return self.drivers[0]


def make_user(email: str, password: str = "pw-test") -> User:
    return User.objects.create_user(email=email, password=password, full_name=email.split("@")[0])


def make_org(slug: str, n_drivers: int = 1) -> OrgFixture:
    org = Organization.objects.create(name=f"Org {slug}", slug=slug)
    owner = make_user(f"owner@{slug}.test")
    fx = OrgFixture(org=org, owner=owner)
    with tenant_context(org.id):
        Membership.objects.create(user=owner, role=Membership.Role.OWNER)
        for i in range(n_drivers):
            u = make_user(f"driver{i + 1}@{slug}.test")
            m = Membership.objects.create(user=u, role=Membership.Role.DRIVER)
            DriverProfile.objects.create(membership=m)
            fx.drivers.append(u)
    return fx


@pytest.fixture
def org_a() -> OrgFixture:
    return make_org("org-a", n_drivers=2)


@pytest.fixture
def org_b() -> OrgFixture:
    return make_org("org-b", n_drivers=1)


def access_token_for(user: User, org: Organization) -> str:
    refresh = RefreshToken.for_user(user)
    refresh["org"] = str(org.id)
    return str(refresh.access_token)


def client_for(user: User, org: Organization) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token_for(user, org)}")
    return client


def tracking_client(token: str) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Tracking {token}")
    return client


def iso(dt: datetime) -> str:
    return dt.astimezone(dt_timezone.utc).isoformat().replace("+00:00", "Z")


def now_utc() -> datetime:
    return datetime.now(dt_timezone.utc)


def start_workday(user: User, org: Organization, started_at: datetime | None = None, **extra) -> dict:
    """Inicia una jornada por la API, como lo hace la PWA. Devuelve el cuerpo de la respuesta."""
    body = {
        "workday_id": str(uuid.uuid4()),
        "started_at": iso(started_at or now_utc() - timedelta(minutes=30)),
        "device": {"id": str(uuid.uuid4()), "runtime": "PWA", "model": "Prueba"},
        **extra,
    }
    response = client_for(user, org).post("/api/v1/workdays/start", body, format="json")
    assert response.status_code == 201, response.content
    return response.json()


def make_point(recorded_at: datetime, lat: float = -34.6037, lng: float = -58.3816, **extra) -> dict:
    return {
        "point_id": str(uuid.uuid4()),
        "recorded_at": iso(recorded_at),
        "lat": lat,
        "lng": lng,
        "accuracy": 12.5,
        **extra,
    }
