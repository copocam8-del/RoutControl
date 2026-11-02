"""Paquetes, visitas e incidencias (§7.2). Todas son TenantModel: RLS por empresa y FK compuestas.

Lo que se crea en el teléfono (Visit, Evidence, Communication, Incident) tiene un id UUID generado
en el teléfono (idempotencia: reintentar no duplica) y las dos horas: la del teléfono
(occurred_at / started_at / captured_at) y la del servidor (received_at).
"""

import uuid

from django.conf import settings
from django.contrib.gis.db import models as gis_models
from django.db import models

from apps.drivers.models import DriverProfile
from apps.tenancy.models import TenantModel, TimestampedModel
from apps.workdays.models import Workday


class Address(TenantModel, TimestampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    raw_text = models.CharField(max_length=500)
    street = models.CharField(max_length=200, blank=True)
    number = models.CharField(max_length=20, blank=True)
    floor_unit = models.CharField(max_length=60, blank=True)
    locality = models.CharField(max_length=120, blank=True)
    province = models.CharField(max_length=120, blank=True)
    postal_code = models.CharField(max_length=20, blank=True)
    # Clave para reconocer el mismo domicilio escrito distinto (minúsculas, sin acentos ni signos).
    normalized_key = models.CharField(max_length=500)
    location = gis_models.PointField(geography=True, srid=4326, null=True, blank=True)
    geocode_provider = models.CharField(max_length=40, blank=True)
    geocode_confidence = models.FloatField(null=True, blank=True)
    location_corrected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    reception_stats = models.JSONField(default=dict, blank=True)

    class Meta(TenantModel.Meta):
        indexes = [models.Index(fields=["organization", "normalized_key"], name="address_org_key")]


class Package(TenantModel, TimestampedModel):
    class Status(models.TextChoices):
        CREATED = "CREATED", "Creado"
        ASSIGNED = "ASSIGNED", "Asignado"
        IN_ROUTE = "IN_ROUTE", "En camino"
        DELIVERED = "DELIVERED", "Entregado"
        FAILED = "FAILED", "No entregado"
        RESCHEDULED = "RESCHEDULED", "Reprogramado"
        RETURNED = "RETURNED", "Devuelto"
        CANCELLED = "CANCELLED", "Cancelado"

    class Source(models.TextChoices):
        MANUAL = "MANUAL"
        IMPORT = "IMPORT"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tracking_code = models.CharField(max_length=80)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.MANUAL)
    recipient_name = models.CharField(max_length=200, blank=True)
    recipient_phone = models.CharField(max_length=40, blank=True)
    address = models.ForeignKey(Address, on_delete=models.PROTECT, related_name="packages")
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.CREATED)
    assigned_driver = models.ForeignKey(
        DriverProfile, on_delete=models.PROTECT, null=True, blank=True, related_name="packages"
    )
    assigned_at = models.DateTimeField(null=True, blank=True)
    workday = models.ForeignKey(Workday, on_delete=models.PROTECT, null=True, blank=True, related_name="packages")
    import_job_id = models.UUIDField(null=True, blank=True)
    # Control de concurrencia optimista: cada cambio suma 1; una edición con versión vieja es 409.
    version = models.PositiveIntegerField(default=1)

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["organization", "tracking_code"], name="package_org_tracking_code"),
        ]
        indexes = [
            models.Index(fields=["organization", "status"], name="package_org_status"),
            models.Index(fields=["organization", "assigned_driver", "status"], name="package_org_driver_status"),
        ]


class PackageEvent(TenantModel):
    """Trazabilidad (solo se agrega: la aplicación no puede modificar ni borrar eventos)."""

    class Type(models.TextChoices):
        CREATED = "created", "Alta"
        UPDATED = "updated", "Edición"
        ASSIGNED = "assigned", "Asignación"
        UNASSIGNED = "unassigned", "Desasignación"
        STATUS_CHANGED = "status_changed", "Cambio de estado"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    package = models.ForeignKey(Package, on_delete=models.PROTECT, related_name="events")
    type = models.CharField(max_length=30, choices=Type.choices)
    from_status = models.CharField(max_length=20, blank=True)
    to_status = models.CharField(max_length=20, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="+")
    payload = models.JSONField(default=dict, blank=True)
    occurred_at = models.DateTimeField()
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta(TenantModel.Meta):
        indexes = [models.Index(fields=["organization", "package", "occurred_at"], name="pkgevent_pkg_at")]


class Visit(TenantModel, TimestampedModel):
    class Outcome(models.TextChoices):
        DELIVERED = "DELIVERED", "Entregado correctamente"
        RECIPIENT_ABSENT = "RECIPIENT_ABSENT", "Destinatario ausente"
        NO_ANSWER = "NO_ANSWER", "Nadie responde"
        RESCHEDULE_REQUESTED = "RESCHEDULE_REQUESTED", "Cliente solicita reprogramación"
        WRONG_ADDRESS = "WRONG_ADDRESS", "Dirección incorrecta"
        NO_ACCESS = "NO_ACCESS", "Acceso imposible"
        OTHER = "OTHER", "Otro inconveniente"

    class Attribution(models.TextChoices):
        RECIPIENT = "RECIPIENT"
        LOGISTIC = "LOGISTIC"
        NONE = "NONE"

    id = models.UUIDField(primary_key=True, editable=False)  # generado en el teléfono
    package = models.ForeignKey(Package, on_delete=models.PROTECT, related_name="visits")
    address = models.ForeignKey(Address, on_delete=models.PROTECT, related_name="visits")
    workday = models.ForeignKey(Workday, on_delete=models.PROTECT, null=True, blank=True, related_name="visits")
    driver = models.ForeignKey(DriverProfile, on_delete=models.PROTECT, related_name="visits")
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    duration_s = models.PositiveIntegerField(null=True, blank=True)
    start_location = gis_models.PointField(geography=True, srid=4326, null=True, blank=True)
    end_location = gis_models.PointField(geography=True, srid=4326, null=True, blank=True)
    outcome = models.CharField(max_length=30, choices=Outcome.choices, blank=True)
    outcome_attribution = models.CharField(max_length=20, choices=Attribution.choices, blank=True)
    notes = models.TextField(blank=True)
    is_second_attempt = models.BooleanField(default=False)
    voided = models.BooleanField(default=False)
    voided_reason = models.CharField(max_length=200, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta(TenantModel.Meta):
        indexes = [models.Index(fields=["organization", "package", "started_at"], name="visit_pkg_started")]


class Incident(TenantModel, TimestampedModel):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Abierta"
        RESOLVED = "RESOLVED", "Resuelta"

    id = models.UUIDField(primary_key=True, editable=False)  # generado en el teléfono
    package = models.ForeignKey(Package, on_delete=models.PROTECT, related_name="incidents")
    visit = models.ForeignKey(Visit, on_delete=models.PROTECT, null=True, blank=True, related_name="incidents")
    driver = models.ForeignKey(DriverProfile, on_delete=models.PROTECT, null=True, blank=True, related_name="incidents")
    type = models.CharField(max_length=40)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    occurred_at = models.DateTimeField()
    received_at = models.DateTimeField(auto_now_add=True)


class Evidence(TenantModel, TimestampedModel):
    class UploadStatus(models.TextChoices):
        PENDING = "PENDING"
        UPLOADED = "UPLOADED"
        VERIFIED = "VERIFIED"

    id = models.UUIDField(primary_key=True, editable=False)  # generado en el teléfono
    visit = models.ForeignKey(Visit, on_delete=models.PROTECT, null=True, blank=True, related_name="evidence")
    package = models.ForeignKey(Package, on_delete=models.PROTECT, related_name="evidence")
    address = models.ForeignKey(Address, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    driver = models.ForeignKey(DriverProfile, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    reason = models.CharField(max_length=60, blank=True)
    storage_key = models.CharField(max_length=300, blank=True)
    mime = models.CharField(max_length=80, blank=True)
    size = models.PositiveIntegerField(null=True, blank=True)
    sha256 = models.CharField(max_length=64, blank=True)
    location = gis_models.PointField(geography=True, srid=4326, null=True, blank=True)
    captured_at = models.DateTimeField()
    received_at = models.DateTimeField(auto_now_add=True)
    upload_status = models.CharField(max_length=20, choices=UploadStatus.choices, default=UploadStatus.PENDING)


class Communication(TenantModel):
    class Channel(models.TextChoices):
        PHONE = "PHONE"
        WHATSAPP = "WHATSAPP"
        VOIP = "VOIP"

    id = models.UUIDField(primary_key=True, editable=False)  # generado en el teléfono
    package = models.ForeignKey(Package, on_delete=models.PROTECT, related_name="communications")
    visit = models.ForeignKey(Visit, on_delete=models.PROTECT, null=True, blank=True, related_name="communications")
    driver = models.ForeignKey(DriverProfile, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    channel = models.CharField(max_length=20, choices=Channel.choices)
    started_at = models.DateTimeField()
    result = models.CharField(max_length=60, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)
