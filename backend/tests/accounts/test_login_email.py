"""Login desde teléfonos: email sin mayúsculas ni espacios en los costados; la contraseña, intacta."""

import logging

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.tenancy.context import tenant_context

LOGIN = "/api/v1/auth/login"


def login(email, password="pw-test"):
    return APIClient().post(LOGIN, {"email": email, "password": password}, format="json")


@pytest.mark.parametrize(
    "typed",
    ["driver1@org-a.test", "Driver1@org-a.test", "DRIVER1@ORG-A.TEST", "  driver1@org-a.test  ", "driver1@org-a.test\n"],
)
def test_email_is_case_insensitive_and_trimmed(org_a, typed):
    assert login(typed).status_code == 200


def test_user_saved_with_uppercase_email_can_log_in(org_a):
    with tenant_context(org_a.id):  # RLS de accounts_user (ADR-010)
        assert User.objects.filter(id=org_a.driver.id).update(email="Driver1@Org-A.test") == 1
    assert login("driver1@org-a.test").status_code == 200


@pytest.mark.parametrize("typed", ["Pw-test", "pw-test ", " pw-test", "pw–test"])
def test_password_is_not_altered(org_a, typed):
    """La contraseña se compara tal cual: mayúscula inicial, espacios o un guion largo la cambian."""
    assert login("driver1@org-a.test", typed).status_code == 401


def test_unknown_email_gets_the_same_answer_as_a_wrong_password(org_a):
    unknown, wrong = login("nadie@org-a.test"), login("driver1@org-a.test", "mal")
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


def test_failed_login_is_not_logged_with_password_details(org_a, caplog):
    """Cierre de la etapa 0: se quitó el diagnóstico de contraseñas de las pruebas en teléfonos."""
    with caplog.at_level(logging.DEBUG):
        login(" Driver1@org-a.test", "routcontroll-demo")
    assert "routcontroll" not in caplog.text and "DEMO_PASSWORD" not in caplog.text and "largo" not in caplog.text
