import uuid

from django.db import models

from apps.tenancy.models import Membership, TenantModel, TimestampedModel


class DriverProfile(TenantModel, TimestampedModel):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE"
        INACTIVE = "INACTIVE"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    membership = models.OneToOneField(Membership, on_delete=models.PROTECT, related_name="driver_profile")
    employee_code = models.CharField(max_length=50, blank=True)
    # document_number (cifrado) queda para la etapa 1: no hace falta para validar la PWA.
    hire_date = models.DateField(null=True, blank=True)
    vehicle_type = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)


class Device(TenantModel, TimestampedModel):
    """Un dispositivo (o una instalación de la PWA). El id lo genera el teléfono."""

    class Runtime(models.TextChoices):
        NATIVE_ANDROID = "NATIVE_ANDROID"
        NATIVE_IOS = "NATIVE_IOS"
        PWA = "PWA"

    class LocationPermission(models.TextChoices):
        ALWAYS = "always"
        WHILE_IN_USE = "while_in_use"
        DENIED = "denied"
        PROMPT = "prompt"
        UNKNOWN = "unknown"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE"
        DISABLED = "DISABLED"  # p. ej. teléfono perdido: revoca sus tokens de seguimiento

    id = models.UUIDField(primary_key=True, editable=False)
    driver = models.ForeignKey(DriverProfile, on_delete=models.PROTECT, related_name="devices")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    runtime = models.CharField(max_length=20, choices=Runtime.choices)
    model = models.CharField(max_length=120, blank=True)
    os_version = models.CharField(max_length=60, blank=True)
    app_version = models.CharField(max_length=40, blank=True)
    user_agent = models.CharField(max_length=400, blank=True)
    location_permission = models.CharField(
        max_length=20, choices=LocationPermission.choices, default=LocationPermission.UNKNOWN
    )
    battery_optimization_disabled = models.BooleanField(null=True)
    push_token = models.CharField(max_length=500, blank=True)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    # Hora del teléfono menos hora del servidor, medida en el último lote recibido.
    clock_offset_ms = models.BigIntegerField(null=True, blank=True)
