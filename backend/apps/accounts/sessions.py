"""Sesiones de refresh: emisión, rotación, revocación y detección de reuso (ADR-005).

Reemplaza a la app ``token_blacklist`` de simplejwt, que guardaba el refresh completo de cada
sesión en una tabla sin RLS. Acá se guarda solo el ``jti`` en ``RefreshSession`` (TenantModel, con
RLS por empresa) y no hace falta ninguna función SECURITY DEFINER:

1. se verifica la FIRMA del refresh (y su vencimiento) con la clave del servidor;
2. la empresa sale del claim ``org`` de ese token firmado;
3. se entra al contexto de esa empresa y la sesión se busca por ``jti`` CON RLS;
4. se rota: la sesión vieja queda revocada ("rotated") y se crea una nueva.

Si llega un refresh que ya fue rotado, alguien más lo tiene (lo robaron, o el ladrón ya lo usó
antes que el dueño): se revocan TODAS las sesiones de ese usuario en esa empresa.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth.models import update_last_login
from django.utils import timezone
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.tenancy.context import tenant_context
from apps.tenancy.middleware import active_membership

from .models import RefreshSession, User

Reason = RefreshSession.RevokedReason


@dataclass(frozen=True)
class IssuedTokens:
    refresh: str
    access: str


@dataclass(frozen=True)
class RotationResult:
    tokens: IssuedTokens | None
    error: str | None = None  # "invalid" | "unknown" | "revoked" | "reuse_detected" | "access_lost"


def _new_session(user: User) -> IssuedTokens:
    """Debe llamarse dentro del contexto de la empresa. Emite el par de tokens y registra el jti."""
    from apps.tenancy.context import require_current_org_id

    org_id = require_current_org_id()
    refresh = RefreshToken.for_user(user)
    refresh["org"] = str(org_id)
    RefreshSession.objects.create(
        jti=refresh["jti"],
        user=user,
        expires_at=datetime.fromtimestamp(refresh["exp"], tz=dt_timezone.utc),
    )
    return IssuedTokens(refresh=str(refresh), access=str(refresh.access_token))


def start_session(user: User, org_id: uuid.UUID | str) -> IssuedTokens:
    """Login: abre una sesión nueva en la empresa elegida (ya validada contra las membresías)."""
    with tenant_context(org_id):
        tokens = _new_session(user)
        # Dentro del contexto: el usuario es miembro de esta empresa y RLS lo deja actualizar.
        update_last_login(None, user)
    return tokens


def _decode(raw: str) -> tuple[uuid.UUID, uuid.UUID, str] | None:
    """Verifica firma, tipo y vencimiento. Devuelve (user_id, org_id, jti) o None."""
    try:
        token = RefreshToken(raw)
        return uuid.UUID(str(token["user_id"])), uuid.UUID(str(token["org"])), str(token["jti"])
    except (TokenError, KeyError, ValueError):
        return None


def revoke_all_for_user(user_id: uuid.UUID, reason: str) -> int:
    """Revoca todas las sesiones abiertas del usuario en la empresa del contexto."""
    return RefreshSession.objects.filter(user_id=user_id, revoked_at__isnull=True).update(
        revoked_at=timezone.now(), revoked_reason=reason
    )


def rotate(raw: str) -> RotationResult:
    decoded = _decode(raw)
    if decoded is None:
        return RotationResult(None, "invalid")
    user_id, org_id, jti = decoded

    # Las revocaciones se tienen que guardar aunque la respuesta sea un 401: por eso el resultado se
    # devuelve (el bloque termina bien y se hace commit) en vez de lanzar una excepción.
    with tenant_context(org_id):
        session = RefreshSession.objects.select_for_update().filter(jti=jti, user_id=user_id).first()
        if session is None:
            return RotationResult(None, "unknown")
        if session.revoked_at is not None:
            if session.revoked_reason == Reason.ROTATED:
                revoke_all_for_user(user_id, Reason.REUSE_DETECTED)
                return RotationResult(None, "reuse_detected")
            return RotationResult(None, "revoked")
        if session.expires_at <= timezone.now():
            return RotationResult(None, "invalid")

        membership = active_membership(user_id)
        if membership is None:
            revoke_all_for_user(user_id, Reason.ACCESS_LOST)
            return RotationResult(None, "access_lost")

        session.revoked_at = timezone.now()
        session.revoked_reason = Reason.ROTATED
        session.save(update_fields=["revoked_at", "revoked_reason"])
        return RotationResult(_new_session(membership.user))


def end_session(raw: str) -> None:
    """Logout: revoca la sesión de ese refresh (si es válido). No toca las demás."""
    decoded = _decode(raw)
    if decoded is None:
        return
    user_id, org_id, jti = decoded
    with tenant_context(org_id):
        RefreshSession.objects.filter(jti=jti, user_id=user_id, revoked_at__isnull=True).update(
            revoked_at=timezone.now(), revoked_reason=Reason.LOGOUT
        )
