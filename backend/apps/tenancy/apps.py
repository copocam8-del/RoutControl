from django.apps import AppConfig
from django.db.models.signals import post_migrate


def _apply_security(sender, using, **kwargs):
    from .db import apply_tenant_security

    apply_tenant_security(using=using)


class TenancyConfig(AppConfig):
    name = "apps.tenancy"
    label = "tenancy"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        # post_migrate se emite una vez por app al terminar TODO el migrate; con sender=self
        # corre una sola vez y con todas las tablas ya creadas.
        post_migrate.connect(_apply_security, sender=self, dispatch_uid="rc_apply_tenant_security")
