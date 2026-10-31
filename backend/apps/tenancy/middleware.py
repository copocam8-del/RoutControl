"""Middleware de empresa: fija el contexto (ContextVar + SET LOCAL) para toda la request.

La empresa se toma de credenciales emitidas y verificadas por el servidor, nunca de un parámetro
del cliente:

* ``Authorization: Bearer <access>`` → el claim ``org`` del JWT (firmado por el servidor en el
  login, después de verificar la membresía con ``rc_user_memberships``). Acá NO hace falta
  ninguna función privilegiada: con la empresa del token se fija el contexto y la membresía se
  vuelve a leer con RLS, para comprobar que siga activa.
* ``Authorization: Tracking <token>`` → ``rc_resolve_tracking_token`` (SECURITY DEFINER) devuelve
  solo (organization_id, workday_id); el resto del token se lee ya dentro del contexto, con RLS.

La API nunca se conecta con el rol dueño de las tablas (tests/tenancy/test_pre_context_lookups.py).

Si no hay credenciales válidas, la request sigue SIN contexto: DRF responde 401/403 y cualquier
acceso a datos de empresa falla cerrado.

La vista corre dentro de la transacción de ``tenant_context``; si la respuesta es un error
(>= 400) se hace rollback, porque DRF convierte las excepciones en respuestas y el atomic no se
enteraría.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass

from django.db import connections, transaction

from .context import app_db, tenant_context


@dataclass(frozen=True)
class TenantRequestContext:
    kind: str  # "user" | "tracking"
    organization_id: uuid.UUID
    user_id: uuid.UUID | None = None
    membership: object | None = None
    tracking_token_id: uuid.UUID | None = None
    workday_id: uuid.UUID | None = None
    device_id: uuid.UUID | None = None


def hash_tracking_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _split_auth_header(request) -> tuple[str, str] | None:
    header = request.META.get("HTTP_AUTHORIZATION", "")
    parts = header.split()
    if len(parts) != 2:
        return None
    return parts[0], parts[1]


def _resolve_jwt(raw: str):
    from rest_framework_simplejwt.exceptions import TokenError
    from rest_framework_simplejwt.tokens import AccessToken

    try:
        token = AccessToken(raw)
        return uuid.UUID(str(token["user_id"])), uuid.UUID(str(token["org"]))
    except (TokenError, KeyError, ValueError):
        return None


def _resolve_tracking_org(token_hash: str) -> tuple[uuid.UUID, uuid.UUID] | None:
    """Única lectura previa al contexto en tracking/batch: (organization_id, workday_id) o None."""
    with connections[app_db()].cursor() as cursor:
        cursor.execute("SELECT organization_id, workday_id FROM rc_resolve_tracking_token(%s)", [token_hash])
        return cursor.fetchone()


def _load_tracking_context(token_hash: str, org_id: uuid.UUID, workday_id: uuid.UUID):
    """Dentro de tenant_context: el resto de los datos del token se lee con RLS."""
    from apps.tracking.models import TrackingToken

    token = TrackingToken.objects.filter(token_hash=token_hash, workday_id=workday_id).first()
    if token is None:
        return None
    return TenantRequestContext(
        kind="tracking",
        organization_id=org_id,
        tracking_token_id=token.id,
        workday_id=token.workday_id,
        device_id=token.device_id,
    )


def _active_membership(user_id: uuid.UUID):
    """Debe llamarse dentro de tenant_context: el ORM y el RLS limitan a la empresa del token."""
    from .models import Membership, Organization

    return (
        Membership.objects.filter(
            user_id=user_id,
            status=Membership.Status.ACTIVE,
            organization__status=Organization.Status.ACTIVE,
        )
        .select_related("organization", "user")
        .first()
    )


class TenantContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.tenant = None
        auth = _split_auth_header(request)
        if auth is None:
            return self.get_response(request)

        scheme, raw = auth
        if scheme == "Bearer":
            resolved = _resolve_jwt(raw)
            if resolved is None:
                return self.get_response(request)
            user_id, org_id = resolved
            with tenant_context(org_id):
                membership = _active_membership(user_id)
                if membership is not None:
                    request.tenant = TenantRequestContext(
                        kind="user", organization_id=org_id, user_id=user_id, membership=membership
                    )
                    return self._run(request)
            # JWT válido pero sin membresía activa en esa empresa: la vista corre sin contexto.
            return self.get_response(request)

        if scheme == "Tracking":
            token_hash = hash_tracking_token(raw)
            resolved = _resolve_tracking_org(token_hash)
            if resolved is None:
                return self.get_response(request)
            org_id, workday_id = resolved
            with tenant_context(org_id):
                ctx = _load_tracking_context(token_hash, org_id, workday_id)
                if ctx is not None:
                    request.tenant = ctx
                    return self._run(request)
            return self.get_response(request)

        return self.get_response(request)

    def _run(self, request):
        response = self.get_response(request)
        if response.status_code >= 400:
            transaction.set_rollback(True, using=app_db())
        return response
