"""Login por email: sin distinguir mayúsculas y sin los espacios de los costados.

Los teclados de los teléfonos ponen mayúscula inicial, agregan un espacio al final al autocompletar,
etc. El email se normaliza siempre igual (``normalize_email``), y la búsqueda no distingue
mayúsculas por si algún usuario quedó guardado con ellas. La contraseña NO se toca: puede tener espacios válidos.
"""

from django.contrib.auth.backends import ModelBackend
from django.db import connections

from apps.tenancy.context import app_db, user_context

from .models import User


def normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


class EmailBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        email = normalize_email(username or kwargs.get("email"))
        if not email or password is None:
            return None
        # accounts_user tiene RLS (ADR-010): el email se busca con rc_auth_lookup (SECURITY DEFINER),
        # que devuelve solo id, hash y estado; el resto del usuario se lee como él mismo.
        with connections[app_db()].cursor() as cursor:
            cursor.execute("SELECT id, password, status FROM rc_auth_lookup(%s)", [email])
            row = cursor.fetchone()
        user = None
        if row is not None:
            with user_context(row[0]):
                user = User.objects.filter(id=row[0]).first()
        if user is None:
            # Mismo costo que una contraseña incorrecta: no revela si el email existe.
            User().set_password(password)
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
