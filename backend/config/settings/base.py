"""Settings comunes. Ver docs/adr/ADR-001-multitenant-rls.md para el esquema de dos usuarios de base."""

import os
from datetime import timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise RuntimeError(f"Falta la variable de entorno {name}")
    return value


def env_bool(name: str, default: bool = False) -> bool:
    return env(name, "1" if default else "0").strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in env(name, default).split(",") if item.strip()]


# Marca provisoria: siempre desde el entorno.
APP_NAME = env("APP_NAME", "RouteControl")
APP_URL = env("APP_URL", "http://localhost:5173")
PANEL_URL = env("PANEL_URL", "http://localhost:5174")
API_URL = env("API_URL", "http://localhost:8000")

# Firma los JWT (HS256): al menos 32 bytes. El default es solo para desarrollo.
SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-insecure-only-for-local-development-change-me")
DEBUG = env_bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.gis",
    "corsheaders",
    "rest_framework",
    "drf_spectacular",
    "apps.tenancy",
    "apps.accounts",
    "apps.drivers",
    "apps.workdays",
    "apps.tracking",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    # Fija el contexto de empresa (y la transacción con SET LOCAL) para toda la request.
    "apps.tenancy.middleware.TenantContextMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = None
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    }
]

# --- Base de datos: dos alias sobre la misma base -------------------------------------------
# "default" = dueño de las tablas: solo migraciones (y creación de la base de pruebas).
# "app"     = usuario de la aplicación: sin superusuario, sin BYPASSRLS, no es dueño.
#             Todas las lecturas y escrituras van acá (ver apps.tenancy.routers).
_db_common = {
    "ENGINE": "django.contrib.gis.db.backends.postgis",
    "NAME": env("DB_NAME", "routcontrol"),
    "HOST": env("DB_HOST", "db"),
    "PORT": env("DB_PORT", "5432"),
    "CONN_MAX_AGE": 0,
}
DATABASES = {
    "default": {
        **_db_common,
        "USER": env("DB_OWNER_USER", "rc_owner"),
        "PASSWORD": env("DB_OWNER_PASSWORD", "rc_owner-dev"),
    },
    "app": {
        **_db_common,
        "USER": env("DB_APP_USER", "rc_app"),
        "PASSWORD": env("DB_APP_PASSWORD", "rc_app-dev"),
    },
}
APP_DB_ALIAS = "app"
DATABASE_ROUTERS = ["apps.tenancy.routers.AppUserRouter"]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "accounts.User"
AUTHENTICATION_BACKENDS = ["apps.accounts.backends.EmailBackend"]
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

LANGUAGE_CODE = "es-ar"
TIME_ZONE = "America/Argentina/Buenos_Aires"
USE_I18N = True
USE_TZ = True

# --- DRF / JWT ---------------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.accounts.authentication.TenantJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
        "apps.tenancy.permissions.HasTenantContext",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.tenancy.exceptions.exception_handler",
    "UNAUTHENTICATED_USER": None,
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    # Sin la app token_blacklist de simplejwt: guardaba el refresh COMPLETO de cada sesión. La
    # rotación, la revocación y la detección de reuso las hace accounts.sessions sobre
    # RefreshSession (solo jti, con RLS por empresa). Ver docs/adr/ADR-005-sesion-web.md.
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "SIGNING_KEY": SECRET_KEY,
}

# Cookie del refresh token (httpOnly). Ver docs/adr/ADR-005-sesion-web.md.
REFRESH_COOKIE_NAME = "rc_refresh"
REFRESH_COOKIE_PATH = "/api/v1/auth/"
REFRESH_COOKIE_SECURE = env_bool("REFRESH_COOKIE_SECURE", True)
REFRESH_COOKIE_SAMESITE = env("REFRESH_COOKIE_SAMESITE", "Lax")
REFRESH_COOKIE_DOMAIN = env("REFRESH_COOKIE_DOMAIN", "") or None

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")

SPECTACULAR_SETTINGS = {
    "TITLE": f"{APP_NAME} API",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# --- Tracking ----------------------------------------------------------------------------------
TRACKING = {
    "MAX_BATCH_SIZE": 500,
    # Duración máxima de una jornada si la empresa no configura otra (§5.4: límite de seguridad).
    "DEFAULT_MAX_WORKDAY_HOURS": 14,
    # Después de "Finalizar jornada", el token sigue sirviendo este tiempo SOLO para enviar
    # puntos grabados entre el inicio y el fin (los que quedaron offline). Ver ADR-003.
    # Se puede pisar por empresa con Organization.settings["tracking_token_grace_hours"].
    "TOKEN_GRACE_AFTER_END_HOURS": float(env("TRACKING_TOKEN_GRACE_AFTER_END_HOURS", "72")),
    # Jornada activa: puntos con recorded_at más adelante que la hora del servidor + esto se rechazan.
    "FUTURE_TOLERANCE_SECONDS": 600,
    # Hueco: más de este tiempo sin puntos (configurable por empresa en settings.gap_threshold_seconds).
    "DEFAULT_GAP_THRESHOLD_SECONDS": 300,
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
