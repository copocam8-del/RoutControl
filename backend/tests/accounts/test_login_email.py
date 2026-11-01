"""Login desde teléfonos: email sin mayúsculas ni espacios en los costados; la contraseña, intacta."""

import logging

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User

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
    User.objects.filter(id=org_a.driver.id).update(email="Driver1@Org-A.test")
    assert login("driver1@org-a.test").status_code == 200


@pytest.mark.parametrize("typed", ["Pw-test", "pw-test ", " pw-test", "pw–test"])
def test_password_is_not_altered(org_a, typed):
    """La contraseña se compara tal cual: mayúscula inicial, espacios o un guion largo la cambian."""
    assert login("driver1@org-a.test", typed).status_code == 401


def test_unknown_email_gets_the_same_answer_as_a_wrong_password(org_a):
    unknown, wrong = login("nadie@org-a.test"), login("driver1@org-a.test", "mal")
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


@override_settings(LOG_FAILED_LOGIN_SHAPE=True)
@pytest.mark.parametrize(
    "typed, expected",
    [
        ("Pw-test", "'primera_es_mayuscula': True"),
        ("pw-test ", "'espacio_al_final': True"),
        ("pw–test", "U+2013 EN DASH"),
    ],
)
def test_failed_login_logs_the_shape_never_the_password(org_a, caplog, typed, expected):
    with caplog.at_level(logging.WARNING, logger="routcontrol.auth"):
        assert login(" Driver1@org-a.test", typed).status_code == 401
    text = caplog.text
    assert expected in text
    assert "existe=True" in text and "normalizado='driver1@org-a.test'" in text
    assert typed.strip() not in text and "pw-test" not in text  # nunca la contraseña


@override_settings(LOG_FAILED_LOGIN_SHAPE=False)
def test_shape_log_is_off_outside_development(org_a, caplog):
    with caplog.at_level(logging.WARNING, logger="routcontrol.auth"):
        login("driver1@org-a.test", "mal")
    assert "login fallido" not in caplog.text


@override_settings(LOG_FAILED_LOGIN_SHAPE=True)
@pytest.mark.parametrize(
    "typed, expected",
    [
        ("routcontroll-demo", "sobra en posición 11: esperado '', llegó 'l'"),
        ("routcontrol -demo", "sobra en posición 11: esperado '', llegó ' '"),
        ("routcontrl-demo", "falta en posición 9: esperado 'o', llegó ''"),
    ],
)
def test_demo_accounts_log_where_the_password_differs(org_a, caplog, typed, expected):
    """Solo emails .demo: se compara con DEMO_PASSWORD (pública) y se registra la diferencia."""
    User.objects.create_user(email="probador@x.demo", password="routcontrol-demo")
    with caplog.at_level(logging.WARNING, logger="routcontrol.auth"):
        assert login("probador@x.demo", typed).status_code == 401
    assert expected in caplog.text


@override_settings(LOG_FAILED_LOGIN_SHAPE=True)
def test_real_accounts_are_never_compared(org_a, caplog):
    with caplog.at_level(logging.WARNING, logger="routcontrol.auth"):
        login("driver1@org-a.test", "routcontroll-demo")
    assert "DEMO_PASSWORD" not in caplog.text and "llegó" not in caplog.text
