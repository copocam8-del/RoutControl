from rest_framework.authentication import BaseAuthentication
from rest_framework_simplejwt.authentication import JWTAuthentication


class TenantJWTAuthentication(JWTAuthentication):
    """JWT de simplejwt. La empresa ya la fijó TenantContextMiddleware a partir del claim ``org``."""


class TrackingPrincipal:
    is_authenticated = True
    is_anonymous = False

    def __init__(self, ctx):
        self.ctx = ctx


class TrackingTokenAuthentication(BaseAuthentication):
    """``Authorization: Tracking <token>``. El middleware ya resolvió el token y fijó la empresa."""

    keyword = "Tracking"

    def authenticate(self, request):
        ctx = getattr(request._request, "tenant", None)
        if ctx is None or ctx.kind != "tracking":
            return None
        return TrackingPrincipal(ctx), ctx

    def authenticate_header(self, request):
        return self.keyword
