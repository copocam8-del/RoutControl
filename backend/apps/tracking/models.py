import uuid

from django.contrib.gis.db import models as gis_models
from django.db import models

from apps.drivers.models import Device, DriverProfile
from apps.tenancy.models import TenantModel, TimestampedModel
from apps.workdays.models import Workday


class TrackingToken(TenantModel, TimestampedModel):
    """Token de alcance limitado: solo POST /tracking/batch, para una jornada y un dispositivo."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workday = models.ForeignKey(Workday, on_delete=models.CASCADE, related_name="tracking_tokens")
    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="tracking_tokens")
    token_hash = models.CharField(max_length=64, unique=True)  # sha256; el token en claro no se guarda
    class RevokedReason(models.TextChoices):
        REISSUED = "reissued"  # se reintentó "Iniciar jornada"
        DEVICE_DISABLED = "device_disabled"
        DRIVER_DISABLED = "driver_disabled"
        MEMBERSHIP_DISABLED = "membership_disabled"

    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=30, choices=RevokedReason.choices, blank=True)


class LocationPoint(TenantModel):
    class Source(models.TextChoices):
        BACKGROUND = "BACKGROUND"
        FOREGROUND = "FOREGROUND"
        EVENT = "EVENT"

    id = models.BigAutoField(primary_key=True)
    point_id = models.UUIDField()  # generado en el teléfono
    workday = models.ForeignKey(Workday, on_delete=models.CASCADE, related_name="points")
    driver = models.ForeignKey(DriverProfile, on_delete=models.PROTECT, related_name="+")
    device = models.ForeignKey(Device, on_delete=models.PROTECT, related_name="+")
    location = gis_models.PointField(geography=True, srid=4326)
    accuracy_m = models.FloatField()
    speed = models.FloatField(null=True, blank=True)
    heading = models.FloatField(null=True, blank=True)
    altitude = models.FloatField(null=True, blank=True)
    battery = models.FloatField(null=True, blank=True)
    is_moving = models.BooleanField(null=True)
    source = models.CharField(max_length=20, choices=Source.choices)
    event = models.CharField(max_length=40, blank=True)  # p. ej. "workday_start" si source=EVENT
    recorded_at = models.DateTimeField()  # hora del teléfono
    received_at = models.DateTimeField()  # hora del servidor

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["organization", "point_id"], name="locationpoint_org_point_uniq"),
        ]
        indexes = [models.Index(fields=["workday", "recorded_at"], name="locpoint_workday_recorded")]


class TrackingGap(TenantModel):
    class Reason(models.TextChoices):
        NO_SIGNAL = "sin_señal"
        APP_CLOSED = "app_cerrada"
        PERMISSION_REVOKED = "permiso_revocado"
        BATTERY_OPTIMIZATION = "optimizacion_bateria"
        UNKNOWN = "desconocido"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workday = models.ForeignKey(Workday, on_delete=models.CASCADE, related_name="gaps")
    from_at = models.DateTimeField()
    to_at = models.DateTimeField()
    reason = models.CharField(max_length=30, choices=Reason.choices, default=Reason.UNKNOWN)
    detected_automatically = models.BooleanField(default=True)

    class Meta(TenantModel.Meta):
        indexes = [models.Index(fields=["workday", "from_at"], name="trackinggap_workday_from")]
