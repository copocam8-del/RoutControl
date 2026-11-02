"""Mapa en vivo del panel por WebSocket (ADR-017).

- **Publicar:** cuando llega un lote de puntos, se publica la última ubicación de ese repartidor al
  grupo de su empresa (`live.<organization_id>`), después del commit. Si el bus (Redis) no está,
  se registra y sigue: la ingesta GPS nunca falla por el mapa en vivo.
- **Suscribirse:** `ws://…/ws/live`. El primer mensaje tiene que ser
  `{"type": "auth", "access": "<JWT>"}` (el token no va en la URL, que queda en los logs). Solo el
  personal (dueño, admin, supervisor) con membresía activa en la empresa del token. Cada conexión
  recibe solo el grupo de esa empresa.
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.layers import get_channel_layer
from django.db import transaction

from apps.tenancy.context import app_db, tenant_context
from apps.tenancy.middleware import _resolve_jwt, active_membership
from apps.tenancy.models import Membership
from apps.tenancy.timefmt import iso_utc

logger = logging.getLogger("routcontrol.live")

STAFF = {Membership.Role.OWNER, Membership.Role.ADMIN, Membership.Role.SUPERVISOR}
AUTH_TIMEOUT_S = 10
# Cada cuánto se vuelve a validar el token y la membresía de una conexión abierta: a quien se le
# quita el acceso (o se le vence el token) se lo desconecta; el panel reconecta con un token nuevo.
REVALIDATE_S = 60


def group_name(org_id) -> str:
    return f"live.{org_id}"


def position_event(workday, point: dict) -> dict:
    return {
        "type": "position",
        "driver_id": str(workday.driver_id),  # DriverProfile, como en /drivers
        "workday_id": str(workday.id),
        "lat": point["lat"],
        "lng": point["lng"],
        "recorded_at": iso_utc(point["recorded_at"]),
    }


def publish(org_id, event: dict) -> None:
    layer = get_channel_layer()
    if layer is None:
        return
    try:
        async_to_sync(layer.group_send)(group_name(org_id), {"type": "live.event", "event": event})
    except Exception:  # noqa: BLE001 - el mapa en vivo nunca hace fallar la ingesta
        logger.warning("No se pudo publicar en el mapa en vivo", exc_info=True)


def publish_latest_position(workday, inserted_points: list[dict]) -> None:
    """Después del commit: la última ubicación (por hora del teléfono) de los puntos nuevos."""
    if not inserted_points:
        return
    latest = max(inserted_points, key=lambda p: p["recorded_at"])
    event = position_event(workday, latest)
    org_id = workday.organization_id
    transaction.on_commit(lambda: publish(org_id, event), using=app_db())


def authorize_staff(raw_access: str) -> uuid.UUID | None:
    """Devuelve la empresa si el token es de personal con membresía activa; si no, None."""
    resolved = _resolve_jwt(raw_access or "")
    if resolved is None:
        return None
    user_id, org_id = resolved
    with tenant_context(org_id):
        membership = active_membership(user_id)
        if membership is None or membership.role not in STAFF:
            return None
    return org_id


class LiveConsumer(AsyncJsonWebsocketConsumer):
    group: str | None = None
    _revalidate: asyncio.Task | None = None

    async def connect(self):
        await self.accept()
        self._auth_deadline = asyncio.get_running_loop().call_later(AUTH_TIMEOUT_S, self._expire)

    def _expire(self):
        if self.group is None:
            asyncio.ensure_future(self.close(code=4401))

    async def receive_json(self, content, **kwargs):
        if self.group is not None:
            return  # después de autenticar, el cliente no manda nada más
        if not isinstance(content, dict) or content.get("type") != "auth":
            await self.close(code=4401)
            return
        org_id = await database_sync_to_async(authorize_staff)(str(content.get("access", "")))
        if org_id is None:
            await self.send_json({"type": "error", "detail": "Sin permiso para el mapa en vivo."})
            await self.close(code=4403)
            return
        self._auth_deadline.cancel()
        self.group = group_name(org_id)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.send_json({"type": "ready"})
        self._revalidate = asyncio.ensure_future(self._keep_validating(str(content.get("access", "")), org_id))

    async def _keep_validating(self, access: str, org_id):
        while True:
            await asyncio.sleep(REVALIDATE_S)
            if await database_sync_to_async(authorize_staff)(access) != org_id:
                await self.close(code=4403)
                return

    async def live_event(self, message):
        await self.send_json(message["event"])

    async def disconnect(self, code):
        if getattr(self, "_auth_deadline", None):
            self._auth_deadline.cancel()
        if self._revalidate:
            self._revalidate.cancel()
        if self.group:
            await self.channel_layer.group_discard(self.group, self.channel_name)
