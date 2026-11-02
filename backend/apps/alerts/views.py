"""Alertas y configuración de la empresa en el panel (ADR-025)."""

from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.packages import reception, second_attempt
from apps.tenancy.models import Membership
from apps.tenancy.permissions import HasTenantContext, role_required

from . import services
from .models import Notification, NotificationCursor

STAFF = (Membership.Role.OWNER, Membership.Role.ADMIN, Membership.Role.SUPERVISOR)
STAFF_ONLY = [IsAuthenticated, HasTenantContext, role_required(*STAFF)]
EDITORS = (Membership.Role.OWNER, Membership.Role.ADMIN)


def _membership(request):
    return request._request.tenant.membership


def _seen_at(membership):
    cursor = NotificationCursor.objects.filter(membership=membership).first()
    return cursor.seen_at if cursor else None


class NotificationListView(APIView):
    """GET /api/v1/notifications — las últimas 50 y cuántas son nuevas para esta persona."""

    permission_classes = STAFF_ONLY

    def get(self, request):
        seen = _seen_at(_membership(request))
        items = list(Notification.objects.order_by("-created_at")[:50])
        unread = Notification.objects.filter(created_at__gt=seen).count() if seen else Notification.objects.count()
        return Response(
            {
                "notifications": [{**services.payload(n), "unread": seen is None or n.created_at > seen} for n in items],
                "unread": unread,
            }
        )


class NotificationSeenView(APIView):
    """POST /api/v1/notifications/seen — marca todo como visto (para esta persona)."""

    permission_classes = STAFF_ONLY

    def post(self, request):
        membership = _membership(request)
        NotificationCursor.objects.update_or_create(membership=membership, defaults={"seen_at": timezone.now()})
        return Response({"unread": 0})


class AlertsSettingsSerializer(serializers.Serializer):
    workday_started = serializers.BooleanField()
    workday_ended = serializers.BooleanField()
    no_signal = serializers.BooleanField()
    no_signal_minutes = serializers.IntegerField(min_value=5, max_value=240)
    incident = serializers.BooleanField()
    route_finished = serializers.BooleanField()


class ReceptionSettingsSerializer(serializers.Serializer):
    green = serializers.FloatField(min_value=0.05, max_value=1)
    yellow = serializers.FloatField(min_value=0, max_value=0.95)
    min_visits = serializers.IntegerField(min_value=1, max_value=50)

    def validate(self, data):
        if data["yellow"] >= data["green"]:
            raise serializers.ValidationError("El umbral amarillo tiene que ser menor que el verde.")
        return data


class SecondAttemptSettingsSerializer(serializers.Serializer):
    insert_max_min = serializers.IntegerField(min_value=1, max_value=120)
    end_max_min = serializers.IntegerField(min_value=1, max_value=240)

    def validate(self, data):
        if data["end_max_min"] < data["insert_max_min"]:
            raise serializers.ValidationError("\"Al final\" tiene que admitir al menos el desvío de \"insertar\".")
        return data


class SettingsSerializer(serializers.Serializer):
    alerts = AlertsSettingsSerializer()
    reception = ReceptionSettingsSerializer()
    second_attempt = SecondAttemptSettingsSerializer()


def _settings_payload(org, membership) -> dict:
    rc = reception.config(org)
    sa = second_attempt.config(org)
    return {
        "alerts": services.config(org),
        "reception": {"green": rc["green"], "yellow": rc["yellow"], "min_visits": rc["min_visits"]},
        "second_attempt": {"insert_max_min": sa["insert_max_min"], "end_max_min": sa["end_max_min"]},
        "can_edit": membership.role in EDITORS,
    }


class OrganizationSettingsView(APIView):
    """GET/PUT /api/v1/settings — alertas y umbrales de la empresa. Editan dueño y admin."""

    permission_classes = STAFF_ONLY

    def get(self, request):
        m = _membership(request)
        return Response(_settings_payload(m.organization, m))

    def put(self, request):
        m = _membership(request)
        if m.role not in EDITORS:
            return Response({"detail": "Solo el dueño o un administrador pueden cambiar la configuración."}, status=status.HTTP_403_FORBIDDEN)
        data = SettingsSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        org = m.organization
        current = dict(org.settings or {})
        for group in ("alerts", "reception", "second_attempt"):
            current[group] = {**current.get(group, {}), **data.validated_data[group]}
        org.settings = current
        org.save(update_fields=["settings", "updated_at"] if hasattr(org, "updated_at") else ["settings"])
        return Response(_settings_payload(org, m))
