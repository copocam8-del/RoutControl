"""Registro de auditoría (§8 y §11, ADR-010). Solo se agrega: la aplicación no puede modificar ni
borrar registros (se le quitan UPDATE y DELETE sobre la tabla después de cada migrate)."""

import uuid

from django.conf import settings
from django.db import models

from apps.tenancy.models import TenantModel


class AuditLog(TenantModel):
    class Action(models.TextChoices):
        VIEW_TRACK = "view_track", "Ver el recorrido de una jornada"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    at = models.DateTimeField(auto_now_add=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    action = models.CharField(max_length=40, choices=Action.choices)
    object_type = models.CharField(max_length=40)
    object_id = models.UUIDField()
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=200, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta(TenantModel.Meta):
        indexes = [models.Index(fields=["organization", "object_type", "object_id", "at"], name="audit_object_at")]
