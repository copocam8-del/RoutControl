"""API de la entrega (ADR-013). El repartidor registra; el personal y el propio repartidor leen."""

from django.core.files.storage import default_storage
from django.http import FileResponse
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.tenancy.models import Membership
from apps.tenancy.permissions import HasTenantContext, role_required
from apps.tenancy.timefmt import iso_utc
from apps.tracking.serializers import AwareDateTimeField

from . import delivery, services
from .models import Communication, Evidence, Visit
from .views import MEMBERS, error, own_driver_id, visible_packages

DRIVER_ONLY = [IsAuthenticated, HasTenantContext, role_required(Membership.Role.DRIVER)]


def current_driver(request):
    profile = getattr(request._request.tenant.membership, "driver_profile", None)
    if profile is None or profile.status != "ACTIVE":
        return None
    return profile


class LocationSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    accuracy = serializers.FloatField(required=False, allow_null=True)


class VisitSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    package_id = serializers.UUIDField()
    workday_id = serializers.UUIDField(required=False, allow_null=True)
    started_at = AwareDateTimeField()
    ended_at = AwareDateTimeField(required=False, allow_null=True)
    outcome = serializers.ChoiceField(choices=Visit.Outcome.choices)
    attribution = serializers.ChoiceField(choices=Visit.Attribution.choices, required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=2000, default="")
    start_location = LocationSerializer(required=False, allow_null=True)
    end_location = LocationSerializer(required=False, allow_null=True)

    def validate(self, attrs):
        if attrs.get("ended_at") and attrs["ended_at"] < attrs["started_at"]:
            raise serializers.ValidationError({"ended_at": "Es anterior al inicio de la visita."})
        if attrs["outcome"] == Visit.Outcome.OTHER and not attrs.get("notes"):
            raise serializers.ValidationError({"notes": "Contá qué pasó."})
        return attrs


class EvidenceSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    package_id = serializers.UUIDField()
    visit_id = serializers.UUIDField(required=False, allow_null=True)
    captured_at = AwareDateTimeField()
    reason = serializers.CharField(required=False, allow_blank=True, max_length=60, default="")
    lat = serializers.FloatField(required=False, allow_null=True, min_value=-90, max_value=90)
    lng = serializers.FloatField(required=False, allow_null=True, min_value=-180, max_value=180)


class CommunicationSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    package_id = serializers.UUIDField()
    channel = serializers.ChoiceField(choices=[Communication.Channel.PHONE, Communication.Channel.WHATSAPP])
    started_at = AwareDateTimeField()


def visit_payload(v: Visit) -> dict:
    return {
        "id": str(v.id),
        "package_id": str(v.package_id),
        "driver": v.driver.membership.user.full_name or v.driver.membership.user.email,
        "started_at": iso_utc(v.started_at),
        "ended_at": iso_utc(v.ended_at),
        "duration_s": v.duration_s,
        "outcome": v.outcome,
        "outcome_attribution": v.outcome_attribution,
        "notes": v.notes,
        "is_second_attempt": v.is_second_attempt,
        "end_location": {"lat": v.end_location.y, "lng": v.end_location.x} if v.end_location else None,
        "evidence": [
            {"id": str(e.id), "captured_at": iso_utc(e.captured_at), "mime": e.mime, "reason": e.reason}
            for e in v.evidence.all()
        ],
    }


class VisitCreateView(APIView):
    """POST /api/v1/visits — idempotente por id (el del teléfono)."""

    permission_classes = DRIVER_ONLY
    parser_classes = [JSONParser]

    def post(self, request):
        driver = current_driver(request)
        if driver is None:
            return Response({"detail": "No tenés un perfil de repartidor activo."}, status=status.HTTP_403_FORBIDDEN)
        data = VisitSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            visit, created = delivery.record_visit(driver, data.validated_data, request.user)
        except services.PackageError as exc:
            return error(exc)
        visit = Visit.objects.select_related("driver__membership__user").prefetch_related("evidence").get(id=visit.id)
        return Response(
            {"visit": visit_payload(visit), "package_status": visit.package.status},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class EvidenceCreateView(APIView):
    """POST /api/v1/evidence (multipart: campos de EvidenceSerializer + `file`) — idempotente por id."""

    permission_classes = DRIVER_ONLY
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        driver = current_driver(request)
        if driver is None:
            return Response({"detail": "No tenés un perfil de repartidor activo."}, status=status.HTTP_403_FORBIDDEN)
        data = EvidenceSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"code": "file_required", "detail": "Falta la foto."}, status=status.HTTP_400_BAD_REQUEST)
        v = dict(data.validated_data)
        if v.get("lat") is not None and v.get("lng") is not None:
            v["location"] = {"lat": v["lat"], "lng": v["lng"]}
        try:
            evidence, created = delivery.save_evidence(driver, v, upload)
        except services.PackageError as exc:
            return error(exc)
        return Response(
            {"evidence": {"id": str(evidence.id), "upload_status": evidence.upload_status, "sha256": evidence.sha256}},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class EvidenceFileView(APIView):
    """GET /api/v1/evidence/{id}/file — la foto, solo para quien puede ver el paquete."""

    permission_classes = MEMBERS

    def get(self, request, evidence_id):
        evidence = Evidence.objects.filter(id=evidence_id, package__in=visible_packages(request)).first()
        if evidence is None or not evidence.storage_key:
            return Response({"detail": "Foto no encontrada."}, status=status.HTTP_404_NOT_FOUND)
        response = FileResponse(default_storage.open(evidence.storage_key, "rb"), content_type=evidence.mime)
        response["Cache-Control"] = "private, max-age=86400"
        return response


class CommunicationCreateView(APIView):
    """POST /api/v1/communications — registra un "Llamar" o "WhatsApp" tocado en la ficha."""

    permission_classes = DRIVER_ONLY
    parser_classes = [JSONParser]

    def post(self, request):
        driver = current_driver(request)
        if driver is None:
            return Response({"detail": "No tenés un perfil de repartidor activo."}, status=status.HTTP_403_FORBIDDEN)
        data = CommunicationSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            item, created = delivery.record_communication(driver, data.validated_data)
        except services.PackageError as exc:
            return error(exc)
        return Response({"communication": {"id": str(item.id)}}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class PackageVisitsView(APIView):
    """GET /api/v1/packages/{id}/visits — visitas con sus fotos (panel y el propio repartidor)."""

    permission_classes = MEMBERS

    def get(self, request, package_id):
        package = visible_packages(request).filter(id=package_id).first()
        if package is None:
            return Response({"detail": "Paquete no encontrado."}, status=status.HTTP_404_NOT_FOUND)
        visits = (
            Visit.objects.filter(package=package, voided=False)
            .select_related("driver__membership__user")
            .prefetch_related("evidence")
            .order_by("started_at")
        )
        return Response({"visits": [visit_payload(v) for v in visits]})


__all__ = ["own_driver_id"]
