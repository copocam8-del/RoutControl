"""Alta de empresa para el despliegue (ADR-021): crea la empresa y su dueño, sin duplicar."""

from io import StringIO

from django.contrib.auth.hashers import check_password
from django.core.management import call_command

from apps.accounts.models import User
from apps.tenancy.context import tenant_context, user_context
from apps.tenancy.models import Membership
from tests.conftest import client_for


def run(*args) -> str:
    out = StringIO()
    call_command("create_company", *args, stdout=out)
    return out.getvalue()


def test_creates_company_and_owner_who_can_log_in():
    out = run("--name", "Mi Empresa", "--slug", "mi-empresa", "--owner-email", "Duenio@Mi.Test")
    assert "Empresa creada: Mi Empresa" in out
    password = out.split("no se vuelve a mostrar): ")[1].strip()
    from django.test import Client

    r = Client().post("/api/v1/auth/login", {"email": "duenio@mi.test", "password": password}, content_type="application/json")
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["role"] == "OWNER" and body["organization"]["name"] == "Mi Empresa"


def test_second_run_does_not_duplicate_and_reuses_existing_user(org_a):
    run("--name", "Mi Empresa", "--slug", "mi-empresa", "--owner-email", "duenio@mi.test")
    out = run("--name", "Otro nombre", "--slug", "mi-empresa", "--owner-email", "duenio@mi.test")
    assert "La empresa ya existía: Mi Empresa" in out
    assert "Contraseña inicial" not in out
    # Un usuario que ya existe (el dueño de otra empresa) queda como dueño también de esta, con
    # su contraseña de siempre.
    out = run("--name", "Mi Empresa", "--slug", "mi-empresa", "--owner-email", org_a.owner.email)
    assert "Contraseña inicial" not in out
    with user_context(org_a.owner.id):
        assert check_password("pw-test", User.objects.get(id=org_a.owner.id).password)
    from apps.tenancy.management.commands.create_company import COMPANY_NAMESPACE
    import uuid

    with tenant_context(uuid.uuid5(COMPANY_NAMESPACE, "mi-empresa")):
        assert Membership.objects.filter(role=Membership.Role.OWNER).count() == 2
    assert client_for(org_a.owner, org_a.org).get("/api/v1/drivers/").status_code == 200
