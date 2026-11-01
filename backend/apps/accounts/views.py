"""Sesión web (panel y PWA): access token en memoria + refresh rotativo en cookie httpOnly.

Ver docs/adr/ADR-005-sesion-web.md: la misma configuración sirve con el proxy de Vite (mismo
origen) y en producción con la API en ``api.<dominio>`` (mismo sitio, CORS con credenciales).
"""

from __future__ import annotations

import uuid
from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth import authenticate
from django.db import connections
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.tenancy.context import app_db, tenant_context
from apps.tenancy.models import Membership

from . import sessions


def active_membership_ids(user_id) -> list[tuple[uuid.UUID, uuid.UUID]]:
    """Única lectura previa al contexto en el login: [(organization_id, membership_id)].
    El refresh no la necesita: la empresa sale del claim org del refresh firmado."""
    with connections[app_db()].cursor() as cursor:
        cursor.execute("SELECT organization_id, membership_id FROM rc_user_memberships(%s)", [str(user_id)])
        return cursor.fetchall()


def user_memberships(user_id) -> list[dict]:
    """Empresas activas del usuario, con nombre y rol.

    La función solo da los ids; el nombre sale de Organization (tabla de plataforma) y el rol se
    lee dentro del contexto de cada empresa, con RLS.
    """
    result = []
    for org_id, membership_id in active_membership_ids(user_id):
        with tenant_context(org_id):
            membership = Membership.objects.select_related("organization").filter(id=membership_id).first()
            if membership is not None:
                result.append(
                    {"id": str(org_id), "name": membership.organization.name, "role": membership.role}
                )
    return sorted(result, key=lambda o: o["name"])


def _set_refresh_cookie(response: Response, refresh: str) -> None:
    response.set_cookie(
        settings.REFRESH_COOKIE_NAME,
        refresh,
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        path=settings.REFRESH_COOKIE_PATH,
        domain=settings.REFRESH_COOKIE_DOMAIN,
        secure=settings.REFRESH_COOKIE_SECURE,
        httponly=True,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        settings.REFRESH_COOKIE_NAME,
        path=settings.REFRESH_COOKIE_PATH,
        domain=settings.REFRESH_COOKIE_DOMAIN,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
    )


def _origin_allowed(request) -> bool:
    """Defensa CSRF de los endpoints que usan la cookie (además de SameSite).

    Un navegador siempre manda Origin en un POST con fetch. Se acepta el mismo origen (proxy de
    Vite) o uno de CSRF_TRUSTED_ORIGINS (app./panel. en producción). Sin Origin no hay navegador
    de por medio, y entonces tampoco una cookie ajena que robar.
    """
    origin = request.headers.get("Origin")
    if not origin:
        return True
    if origin in settings.CSRF_TRUSTED_ORIGINS:
        return True
    parsed = urlsplit(origin)
    return parsed.netloc == request.get_host() and parsed.scheme == request.scheme


def _session_payload(user, org: dict, access: str) -> dict:
    return {
        "access": access,
        "user": {"id": str(user.id), "email": user.email, "full_name": user.full_name},
        "organization": {"id": org["id"], "name": org["name"]},
        "role": org["role"],
    }


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False)
    organization_id = serializers.UUIDField(required=False)


class LoginView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]

    def post(self, request):
        data = LoginSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user = authenticate(
            request, username=data.validated_data["email"].lower(), password=data.validated_data["password"]
        )
        if user is None:
            return Response({"detail": "Email o contraseña incorrectos."}, status=status.HTTP_401_UNAUTHORIZED)

        orgs = user_memberships(user.id)
        wanted = data.validated_data.get("organization_id")
        if wanted is not None:
            orgs = [o for o in orgs if o["id"] == str(wanted)]
        if not orgs:
            return Response(
                {"detail": "No tenés acceso activo a ninguna empresa."}, status=status.HTTP_403_FORBIDDEN
            )
        if len(orgs) > 1:
            return Response(
                {"code": "choose_organization", "organizations": orgs}, status=status.HTTP_409_CONFLICT
            )

        org = orgs[0]
        tokens = sessions.start_session(user, org["id"])
        response = Response(_session_payload(user, org, tokens.access))
        _set_refresh_cookie(response, tokens.refresh)
        return response


# Respuestas de /auth/refresh según el resultado de la rotación (accounts.sessions.rotate).
_REFRESH_ERRORS = {
    "invalid": "Sesión vencida.",
    "unknown": "Sesión vencida.",
    "revoked": "Sesión cerrada.",
    "reuse_detected": "Por seguridad se cerraron todas tus sesiones. Volvé a ingresar.",
    "access_lost": "Tu acceso a esta empresa fue dado de baja.",
}


class RefreshView(APIView):
    """Rota el refresh: firma → empresa del claim org → contexto → sesión por jti con RLS."""

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def post(self, request):
        if not _origin_allowed(request):
            return Response({"detail": "Origen no permitido."}, status=status.HTTP_403_FORBIDDEN)
        raw = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if not raw:
            return Response({"detail": "Sin sesión."}, status=status.HTTP_401_UNAUTHORIZED)

        result = sessions.rotate(raw)
        if result.tokens is None:
            body = {"detail": _REFRESH_ERRORS[result.error or "invalid"]}
            if result.error == "reuse_detected":
                body["code"] = "refresh_reuse_detected"
            response = Response(body, status=status.HTTP_401_UNAUTHORIZED)
            _clear_refresh_cookie(response)
            return response

        response = Response({"access": result.tokens.access})
        _set_refresh_cookie(response, result.tokens.refresh)
        return response


class LogoutView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]

    def post(self, request):
        if not _origin_allowed(request):
            return Response({"detail": "Origen no permitido."}, status=status.HTTP_403_FORBIDDEN)
        raw = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if raw:
            sessions.end_session(raw)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        _clear_refresh_cookie(response)
        return response


class MeView(APIView):
    def get(self, request):
        membership = request._request.tenant.membership
        return Response(
            {
                "user": {
                    "id": str(request.user.id),
                    "email": request.user.email,
                    "full_name": request.user.full_name,
                },
                "organization": {"id": str(membership.organization_id), "name": membership.organization.name},
                "role": membership.role,
            }
        )
