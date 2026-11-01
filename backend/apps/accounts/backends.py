"""Login por email: sin distinguir mayúsculas y sin los espacios de los costados.

Los teclados de los teléfonos ponen mayúscula inicial, agregan un espacio al final al autocompletar,
etc. El email se normaliza siempre igual (``normalize_email``), y la búsqueda es ``iexact`` por si
algún usuario quedó guardado con mayúsculas. La contraseña NO se toca: puede tener espacios válidos.
"""

from django.contrib.auth.backends import ModelBackend

from .models import User


def normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


class EmailBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        email = normalize_email(username or kwargs.get("email"))
        if not email or password is None:
            return None
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            # Mismo costo que una contraseña incorrecta: no revela si el email existe.
            User().set_password(password)
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
