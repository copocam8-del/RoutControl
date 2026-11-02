"""Alertas del panel (planificación: Notification, etapa 2; ADR-025)."""

import uuid

from django.db import models

from apps.tenancy.models import Membership, TenantModel


class Notification(TenantModel):
    class Type(models.TextChoices):
        WORKDAY_STARTED = "WORKDAY_STARTED", "Inicio de jornada"
        WORKDAY_ENDED = "WORKDAY_ENDED", "Fin de jornada"
        NO_SIGNAL = "NO_SIGNAL", "Sin señal"
        INCIDENT = "INCIDENT", "Incidencia"
        ROUTE_FINISHED = "ROUTE_FINISHED", "Recorrido finalizado"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    type = models.CharField(max_length=30, choices=Type.choices)
    title = models.CharField(max_length=200)
    body = models.CharField(max_length=500, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    # Evita avisar dos veces lo mismo (por ejemplo, un aviso por cada silencio de una jornada).
    dedupe_key = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta(TenantModel.Meta):
        indexes = [models.Index(fields=["organization", "created_at"], name="notification_org_created")]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "dedupe_key"], condition=~models.Q(dedupe_key=""), name="notification_dedupe"
            )
        ]


class NotificationCursor(TenantModel):
    """Hasta cuándo vio las alertas cada persona del panel (las posteriores son "nuevas")."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    membership = models.OneToOneField(Membership, on_delete=models.CASCADE, related_name="notification_cursor")
    seen_at = models.DateTimeField()
