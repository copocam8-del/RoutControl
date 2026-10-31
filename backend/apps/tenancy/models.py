import uuid

from django.db import models

from .context import TenantContextMissing, get_current_org_id, require_current_org_id


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


# --- Plataforma (sin RLS de empresa) ----------------------------------------------------------


class Plan(TimestampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    max_drivers = models.PositiveIntegerField(default=10)
    storage_gb = models.PositiveIntegerField(default=5)
    features = models.JSONField(default=dict, blank=True)


class Organization(TimestampedModel):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE"
        SUSPENDED = "SUSPENDED"
        CLOSED = "CLOSED"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=80, unique=True)
    tax_id = models.CharField(max_length=20, blank=True)
    plan = models.ForeignKey(Plan, null=True, blank=True, on_delete=models.PROTECT)
    limits = models.JSONField(default=dict, blank=True)
    settings = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    timezone = models.CharField(max_length=64, default="America/Argentina/Buenos_Aires")
    # Datos de demostración: siempre marcados como tales (CLAUDE.md).
    is_demo = models.BooleanField(default=False)

    def __str__(self) -> str:
        return self.name


# --- Base de los modelos de empresa -----------------------------------------------------------


class TenantQuerySet(models.QuerySet):
    pass


class TenantManager(models.Manager.from_queryset(TenantQuerySet)):
    """Falla cerrado: sin contexto de empresa no devuelve nada, lanza error."""

    def get_queryset(self):
        org_id = require_current_org_id()
        return super().get_queryset().filter(organization_id=org_id)


class TenantModel(models.Model):
    """Base de toda tabla operativa: ``organization_id NOT NULL`` + RLS + FK compuestas.

    El RLS, los permisos y las FK compuestas no se escriben a mano por tabla: los genera
    ``apps.tenancy.db.apply_tenant_security`` para cada subclase al final de ``migrate``.
    """

    organization = models.ForeignKey(Organization, on_delete=models.PROTECT, related_name="+", editable=False)

    objects = TenantManager()

    class Meta:
        abstract = True
        base_manager_name = "objects"

    def save(self, *args, **kwargs):
        org_id = require_current_org_id()
        if self.organization_id is None:
            self.organization_id = org_id
        elif self.organization_id != org_id:
            raise TenantContextMissing(
                f"{type(self).__name__} pertenece a otra empresa que la del contexto actual."
            )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.organization_id != get_current_org_id():
            raise TenantContextMissing("No se puede borrar un registro de otra empresa.")
        return super().delete(*args, **kwargs)


class Membership(TenantModel, TimestampedModel):
    class Role(models.TextChoices):
        OWNER = "OWNER"
        ADMIN = "ADMIN"
        SUPERVISOR = "SUPERVISOR"
        DRIVER = "DRIVER"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE"
        DISABLED = "DISABLED"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="memberships")
    role = models.CharField(max_length=20, choices=Role.choices)
    permissions = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["organization", "user"], name="membership_org_user_uniq"),
        ]
