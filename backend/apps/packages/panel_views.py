"""Lecturas del panel (ADR-016): entregas del día e incidencias. Solo el personal."""

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.tenancy.permissions import HasTenantContext
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


class AddressDetailView(APIView):
    """Historial del domicilio (§7.3, ADR-022): indicador, visitas y paquetes. Solo el personal."""

    permission_classes = STAFF_ONLY

    def get(self, request, address_id):
        from .models import Address, Package
        from . import reception

        address = Address.objects.filter(id=address_id).first()
        if address is None:
            return Response({"detail": "Domicilio no encontrado."}, status=status.HTTP_404_NOT_FOUND)
        org = request._request.tenant.membership.organization
        cfg = reception.config(org)
        visits = list(
            Visit.objects.filter(address=address)
            .select_related("package", "driver__membership__user")
            .prefetch_related("evidence")
            .order_by("-started_at")[:200]
        )
        stats = reception.compute([(v.outcome, v.outcome_attribution, v.started_at) for v in visits if not v.voided], cfg=cfg)
        packages = Package.objects.filter(address=address).order_by("-created_at")[:100]
        return Response(
            {
                "address": address_payload(address),
                "reception": {**stats, "last_visit_at": iso_utc(stats["last_visit_at"])},
                "thresholds": {"green": cfg["green"], "yellow": cfg["yellow"], "min_visits": cfg["min_visits"]},
                "visits": [
                    {
                        "id": str(v.id),
                        "started_at": iso_utc(v.started_at),
                        "duration_s": v.duration_s,
                        "outcome": v.outcome,
                        "outcome_attribution": v.outcome_attribution,
                        "is_second_attempt": v.is_second_attempt,
                        "voided": v.voided,
                        "notes": v.notes,
                        "driver": v.driver.membership.user.full_name or v.driver.membership.user.email,
                        "package": {"id": str(v.package_id), "tracking_code": v.package.tracking_code},
                        "evidence": [{"id": str(e.id)} for e in v.evidence.all()],
                    }
                    for v in visits
                ],
                "packages": [
                    {"id": str(p.id), "tracking_code": p.tracking_code, "status": p.status, "recipient_name": p.recipient_name}
                    for p in packages
                ],
            }
        )


class ReportQuerySerializer(serializers.Serializer):
    period = serializers.ChoiceField(choices=["day", "week", "fortnight", "month", "range"], default="day")
    date = serializers.DateField(required=False)
    to = serializers.DateField(required=False)
    driver = serializers.UUIDField(required=False)
    # "formato" y no "format": DRF reserva ?format= para elegir su propio formato de respuesta.
    formato = serializers.ChoiceField(choices=["csv", "xlsx"], required=False)

    def to_internal_value(self, data):
        # "from" es palabra reservada en Python: se acepta en la URL y se renombra.
        data = data.copy()
        if "from" in data:
            data["date"] = data["from"]
        return super().to_internal_value(data)


def _report(request):
    """(informe, None) o (None, respuesta de error). El repartidor solo ve el suyo (§8: "propios")."""
    from apps.tenancy.models import Membership

    from . import reports
    from .views import STAFF_ROLES, own_driver_id

    q = ReportQuerySerializer(data=request.query_params)
    q.is_valid(raise_exception=True)
    v = q.validated_data
    org = request._request.tenant.membership.organization
    role = request._request.tenant.membership.role
    driver_id = v.get("driver")
    if role not in STAFF_ROLES:
        if role != Membership.Role.DRIVER:
            return None, Response({"detail": "Tu rol no permite ver informes."}, status=status.HTTP_403_FORBIDDEN)
        own = own_driver_id(request)
        if driver_id and str(driver_id) != str(own):
            return None, Response({"detail": "Solo podés ver tu propio informe."}, status=status.HTTP_403_FORBIDDEN)
        driver_id = own
    today = timezone.now().astimezone(ZoneInfo(org.timezone)).date()
    anchor = v.get("date") or today
    try:
        p = reports.period(v["period"], anchor, v.get("date"), v.get("to"))
    except reports.ReportError as exc:
        return None, Response({"code": "bad_period", "detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return reports.build(org, p, driver_id), None


class ReportView(APIView):
    """GET /api/v1/reports?period=day|week|fortnight|month|range&date=&from=&to=&driver= (ADR-024)."""

    # Personal: todos los repartidores; repartidor: solo el suyo (ver _report).
    permission_classes = [IsAuthenticated, HasTenantContext]

    def get(self, request):
        report, err = _report(request)
        return err or Response(report)


class ReportExportView(APIView):
    """GET /api/v1/reports/export?...&formato=csv|xlsx — el mismo informe, para Excel."""

    # Personal: todos los repartidores; repartidor: solo el suyo (ver _report).
    permission_classes = [IsAuthenticated, HasTenantContext]

    def get(self, request):
        from django.http import HttpResponse

        from . import reports

        report, err = _report(request)
        if err:
            return err
        fmt = request.query_params.get("formato", "xlsx")
        name = f"informe-{report['period']['from']}-a-{report['period']['to']}"
        if fmt == "csv":
            resp = HttpResponse(reports.to_csv(report), content_type="text/csv; charset=utf-8")
            resp["Content-Disposition"] = f'attachment; filename="{name}.csv"'
        else:
            resp = HttpResponse(reports.to_xlsx(report), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            resp["Content-Disposition"] = f'attachment; filename="{name}.xlsx"'
        return resp
