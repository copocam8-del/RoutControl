from django.contrib.gis.db import models as gis_models
from django.db import models

from apps.drivers.models import Device, DriverProfile
from apps.tenancy.models import TenantModel, TimestampedModel


class Workday(TenantModel, TimestampedModel):
    class Status(models.TextChoices):
        NOT_STARTED = "NOT_STARTED"
        ACTIVE = "ACTIVE"
        FINISHED = "FINISHED"
        FORCE_CLOSED = "FORCE_CLOSED"
        AUTO_CLOSED = "AUTO_CLOSED"

    class TrackingMode(models.TextChoices):
        CONTINUOUS = "CONTINUOUS"
        EVENTS_ONLY = "EVENTS_ONLY"

    # Generado en el teléfono (UUID): reintentar "Iniciar jornada" no crea otra.
    id = models.UUIDField(primary_key=True, editable=False)
    driver = models.ForeignKey(DriverProfile, on_delete=models.PROTECT, related_name="workdays")
    device = models.ForeignKey(Device, on_delete=models.PROTECT, related_name="workdays")
    date = models.DateField()
    # Hora del teléfono (started_at/ended_at) y del servidor (received_at/end_received_at).
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)
    end_received_at = models.DateTimeField(null=True, blank=True)
    start_location = gis_models.PointField(geography=True, srid=4326, null=True, blank=True)
    end_location = gis_models.PointField(geography=True, srid=4326, null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    close_reason = models.CharField(max_length=60, blank=True)
    tracking_mode = models.CharField(max_length=20, choices=TrackingMode.choices)
    summary = models.JSONField(default=dict, blank=True)

    class Meta(TenantModel.Meta):
        constraints = [
            # Una sola jornada activa por repartidor.
            models.UniqueConstraint(
                fields=["organization", "driver"],
                condition=models.Q(status="ACTIVE"),
                name="workday_one_active_per_driver",
            )
        ]
        indexes = [models.Index(fields=["organization", "driver", "date"])]
