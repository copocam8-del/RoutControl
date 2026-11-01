from .base import *  # noqa: F401,F403
from .base import env_bool

DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = ["*"]
# En desarrollo la PWA llega por el proxy de Vite (mismo origen) y por HTTP.
REFRESH_COOKIE_SECURE = env_bool("REFRESH_COOKIE_SECURE", False)

# Prueba en teléfonos con un túnel HTTPS (Cloudflare Tunnel o ngrok → proxy de Vite → Django):
# el navegador manda `Origin: https://<túnel>`, pero a Django le llega HTTP. El túnel agrega
# `X-Forwarded-Proto: https`. Confiar en ese encabezado SOLO en desarrollo hace que la verificación
# de mismo origen del refresh (ADR-005) funcione con cualquier URL de túnel, sin tocar
# CSRF_TRUSTED_ORIGINS cada vez que la URL cambia. En producción lo define el despliegue.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
