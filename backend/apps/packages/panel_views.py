"""Lecturas del panel (ADR-016): entregas del día e incidencias. Solo el personal."""

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.tenancy.timefmt import iso_utc

from .delivery_views import visit_payload
from .models import Incident, Visit
from .views import STAFF_ONLY, address_payload


class DateSerializer(serializers.Serializer):
    date = serializers.DateField(required=False)


def day_range(request, day):
    """Del inicio al fin del día en la zona horaria de la empresa."""
    tz = ZoneInfo(request._request.tenant.membership.organization.timezone)
    start = datetime.combine(day, time.min, tzinfo=tz)
    return start, start + timedelta(days=1)


class DeliveryListView(APIView):
    """GET /api/v1/deliveries?date=AAAA-MM-DD — las visitas del día (por defecto, hoy)."""

    permission_classes = STAFF_ONLY

    def get(self, request):
        data = DateSerializer(data=request.query_params)
        data.is_valid(raise_exception=True)
        tz = ZoneInfo(request._request.tenant.membership.organization.timezone)
        day = data.validated_data.get("date") or timezone.now().astimezone(tz).date()
        start, end = day_range(request, day)
        visits = (
            Visit.objects.filter(started_at__gte=start, started_at__lt=end, voided=False)
            .select_related("driver__membership__user", "package__address")
            .prefetch_related("evidence")
            .order_by("-started_at")[:1000]
        )
        return Response(
            {
                "date": day.isoformat(),
                "deliveries": [
                    {
                        **visit_payload(v),
                        "package": {
                            "id": str(v.package_id),
                            "tracking_code": v.package.tracking_code,
                            "recipient_name": v.package.recipient_name,
                            "status": v.package.status,
                            "address": address_payload(v.package.address),
                        },
                    }
                    for v in visits
                ],
            }
        )


def incident_payload(i: Incident) -> dict:
    return {
        "id": str(i.id),
        "type": i.type,
        "description": i.description,
        "status": i.status,
        "occurred_at": iso_utc(i.occurred_at),
        "resolved_at": iso_utc(i.resolved_at),
        "resolved_by": (i.resolved_by.full_name or i.resolved_by.email) if i.resolved_by else None,
        "driver": (i.driver.membership.user.full_name or i.driver.membership.user.email) if i.driver else None,
        "visit_id": str(i.visit_id) if i.visit_id else None,
        "evidence": [{"id": str(e.id)} for e in (i.visit.evidence.all() if i.visit else [])],
        "package": {
            "id": str(i.package_id),
            "tracking_code": i.package.tracking_code,
            "recipient_name": i.package.recipient_name,
            "status": i.package.status,
            "address": i.package.address.raw_text,
        },
    }


class IncidentListView(APIView):
    """GET /api/v1/incidents?status=OPEN|RESOLVED — las incidencias, las más nuevas primero."""

    permission_classes = STAFF_ONLY

    def get(self, request):
        qs = Incident.objects.select_related(
            "package__address", "driver__membership__user", "resolved_by", "visit"
        ).prefetch_related("visit__evidence")
        wanted = request.query_params.get("status")
        if wanted in (Incident.Status.OPEN, Incident.Status.RESOLVED):
            qs = qs.filter(status=wanted)
        return Response({"incidents": [incident_payload(i) for i in qs.order_by("-occurred_at")[:500]]})


class IncidentResolveView(APIView):
    """POST /api/v1/incidents/{id}/resolve — la marca resuelta (quién y cuándo). Idempotente."""

    permission_classes = STAFF_ONLY
    parser_classes = [JSONParser]

    def post(self, request, incident_id):
        incident = Incident.objects.select_for_update().filter(id=incident_id).first()
        if incident is None:
            return Response({"detail": "Incidencia no encontrada."}, status=status.HTTP_404_NOT_FOUND)
        if incident.status != Incident.Status.RESOLVED:
            incident.status = Incident.Status.RESOLVED
            incident.resolved_by = request.user
            incident.resolved_at = timezone.now()
            incident.save(update_fields=["status", "resolved_by", "resolved_at", "updated_at"])
        incident = Incident.objects.select_related("package__address", "driver__membership__user", "resolved_by", "visit").get(id=incident.id)
        return Response({"incident": incident_payload(incident)})
