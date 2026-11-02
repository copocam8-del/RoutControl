"""ASGI: HTTP (Django) y WebSocket (Channels, mapa en vivo del panel, ADR-017)."""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
django_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402
from django.urls import path  # noqa: E402

from apps.tracking.live import LiveConsumer  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_app,
        # Solo conexiones cuyo Origin está en ALLOWED_HOSTS: otra página abierta en el navegador
        # no puede abrir el WebSocket (el token igual hace falta, pero esto corta antes).
        "websocket": AllowedHostsOriginValidator(URLRouter([path("ws/live", LiveConsumer.as_asgi())])),
    }
)
