from rest_framework.views import exception_handler as drf_exception_handler

from .context import TenantContextMissing


def exception_handler(exc, context):
    # Un acceso sin contexto es un bug de programación: se deja propagar (500) para que se note,
    # en vez de convertirlo en una respuesta que lo esconda.
    if isinstance(exc, TenantContextMissing):
        return None
    return drf_exception_handler(exc, context)
