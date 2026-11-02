"""Producción (docs/despliegue.md, ADR-021). Todo sale de variables de entorno: nada de valores
por defecto inseguros. Detrás de Caddy, que termina el HTTPS."""

from .base import *  # noqa: F401,F403
from .base import env, env_bool, SECRET_KEY

DEBUG = env_bool("DJANGO_DEBUG", False)
if DEBUG:
    raise RuntimeError("DJANGO_DEBUG no puede estar activo en producción.")
if SECRET_KEY.startswith("dev-insecure") or len(SECRET_KEY) < 32:
    raise RuntimeError("Falta DJANGO_SECRET_KEY (al menos 32 caracteres) en producción.")
for _name in ("DB_OWNER_PASSWORD", "DB_APP_PASSWORD"):
    if env(_name, "").endswith("-dev") or not env(_name, ""):
        raise RuntimeError(f"Falta {_name} en producción.")

# Caddy recibe HTTPS y le pasa la request al backend por HTTP con X-Forwarded-Proto.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True
REFRESH_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
# HSTS lo manda Caddy para los tres subdominios (ver infra/prod/Caddyfile).
