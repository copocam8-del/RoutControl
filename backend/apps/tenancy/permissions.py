from rest_framework.permissions import BasePermission


class HasTenantContext(BasePermission):
    """Exige un contexto de empresa de usuario (JWT con membresía activa)."""

    message = "No hay una empresa activa para esta sesión."

    def has_permission(self, request, view):
        ctx = getattr(request._request, "tenant", None)
        return ctx is not None and ctx.kind == "user"


class HasTrackingContext(BasePermission):
    message = "Token de seguimiento inválido o vencido."

    def has_permission(self, request, view):
        ctx = getattr(request._request, "tenant", None)
        return ctx is not None and ctx.kind == "tracking"


def role_required(*roles: str):
    class _RoleRequired(BasePermission):
        message = "Tu rol no permite esta acción."

        def has_permission(self, request, view):
            ctx = getattr(request._request, "tenant", None)
            return ctx is not None and ctx.kind == "user" and ctx.membership.role in roles

    _RoleRequired.__name__ = f"RoleRequired_{'_'.join(roles)}"
    return _RoleRequired
