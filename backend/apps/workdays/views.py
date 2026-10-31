from zoneinfo import ZoneInfo

from django.contrib.gis.geos import Point
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.drivers.models import Device, DriverProfile
from apps.tenancy.context import app_db
from apps.tenancy.models import Membership
from apps.tenancy.permissions import HasTenantContext, role_required
from apps.tracking import services as tracking
from apps.tracking.serializers import AwareDateTimeField

from .models import Workday


class LocationSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    accuracy = serializers.FloatField(min_value=0, required=False, allow_null=True)


class DeviceSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    runtime = serializers.ChoiceField(choices=Device.Runtime.choices)
    model = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    os_version = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    app_version = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    location_permission = serializers.ChoiceField(
        choices=Device.LocationPermission.choices, required=False, default=Device.LocationPermission.UNKNOWN
    )


class StartSerializer(serializers.Serializer):
    workday_id = serializers.UUIDField()
    started_at = AwareDateTimeField()
    device = DeviceSerializer()
    location = LocationSerializer(required=False, allow_null=True)


class EndSerializer(serializers.Serializer):
    ended_at = AwareDateTimeField()
    location = LocationSerializer(required=False, allow_null=True)


def _point(loc):
    return Point(loc["lng"], loc["lat"], srid=4326) if loc else None


def workday_payload(w: Workday) -> dict:
    return {
        "id": str(w.id),
        "status": w.status,
        "tracking_mode": w.tracking_mode,
        "date": w.date.isoformat(),
        "started_at": w.started_at.isoformat(),
        "ended_at": w.ended_at.isoformat() if w.ended_at else None,
        "device_id": str(w.device_id),
    }


def _conflict(code: str, detail: str, **extra) -> Response:
    return Response({"code": code, "detail": detail, **extra}, status=status.HTTP_409_CONFLICT)


def current_driver(request) -> DriverProfile | None:
    return DriverProfile.objects.filter(
        membership=request._request.tenant.membership, status=DriverProfile.Status.ACTIVE
    ).first()


DRIVER_ONLY = [IsAuthenticated, HasTenantContext, role_required(Membership.Role.DRIVER)]


class StartWorkdayView(APIView):
    """POST /api/v1/workdays/start — idempotente por ``workday_id`` (UUID del teléfono)."""

    permission_classes = DRIVER_ONLY

    def post(self, request):
        data = StartSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        driver = current_driver(request)
        if driver is None:
            return Response({"detail": "No tenés un perfil de repartidor activo."}, status=status.HTTP_403_FORBIDDEN)

        existing = Workday.objects.filter(id=v["workday_id"]).first()
        if existing is not None:
            if existing.driver_id != driver.id or existing.status != Workday.Status.ACTIVE:
                return _conflict("workday_id_in_use", "Ese identificador de jornada ya se usó.")
            raw, token = tracking.issue_tracking_token(existing)  # reintento: token nuevo, el viejo se revoca
            return Response(self._payload(existing, raw, token), status=status.HTTP_200_OK)

        active = Workday.objects.filter(driver=driver, status=Workday.Status.ACTIVE).first()
        if active is not None:
            return _conflict(
                "workday_already_active", "Ya tenés una jornada iniciada.", workday=workday_payload(active)
            )

        dev = v["device"]
        if Device.objects.filter(id=dev["id"]).exclude(status=Device.Status.ACTIVE).exists():
            return Response(
                {"code": "device_disabled", "detail": "Este dispositivo fue desactivado por la empresa."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            with transaction.atomic(using=app_db()):
                device = Device.objects.filter(id=dev["id"]).first() or Device(id=dev["id"])
                device.driver = driver
                for attr in ("runtime", "model", "os_version", "app_version", "location_permission"):
                    setattr(device, attr, dev[attr])
                device.user_agent = request.headers.get("User-Agent", "")[:400]
                device.save()

                workday = Workday(
                    id=v["workday_id"],
                    driver=driver,
                    device=device,
                    # Fecha de la jornada en la zona horaria de la empresa.
                    date=v["started_at"].astimezone(ZoneInfo(driver.organization.timezone)).date(),
                    started_at=v["started_at"],
                    start_location=_point(v.get("location")),
                    status=Workday.Status.ACTIVE,
                    tracking_mode=(
                        Workday.TrackingMode.EVENTS_ONLY
                        if device.runtime == Device.Runtime.PWA
                        else Workday.TrackingMode.CONTINUOUS
                    ),
                )
                workday.save(force_insert=True)
        except IntegrityError:
            # El UUID del dispositivo o de la jornada ya existe (posiblemente en otra empresa, que
            # por RLS no se ve) o hubo una carrera con otro "Iniciar jornada".
            return _conflict("id_conflict", "El dispositivo o la jornada ya existen. Generá un identificador nuevo.")

        raw, token = tracking.issue_tracking_token(workday)
        return Response(self._payload(workday, raw, token), status=status.HTTP_201_CREATED)

    @staticmethod
    def _payload(workday, raw, token):
        return {
            "workday": workday_payload(workday),
            "tracking_token": raw,
            "tracking_token_expires_at": token.expires_at.isoformat(),
        }


class EndWorkdayView(APIView):
    """POST /api/v1/workdays/{id}/end — idempotente."""

    permission_classes = DRIVER_ONLY

    def post(self, request, workday_id):
        data = EndSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        driver = current_driver(request)
        workday = (
            Workday.objects.select_related("organization").filter(id=workday_id, driver=driver).first()
            if driver
            else None
        )
        if workday is None:
            return Response({"detail": "Jornada no encontrada."}, status=status.HTTP_404_NOT_FOUND)
        if workday.status != Workday.Status.ACTIVE:
            return Response({"workday": workday_payload(workday)})
        if v["ended_at"] < workday.started_at:
            return Response(
                {"ended_at": ["Es anterior al inicio de la jornada."]}, status=status.HTTP_400_BAD_REQUEST
            )

        workday.ended_at = v["ended_at"]
        workday.end_received_at = timezone.now()
        workday.end_location = _point(v.get("location"))
        workday.status = Workday.Status.FINISHED
        workday.close_reason = "driver"
        workday.save()
        tracking.close_tracking_tokens(workday)
        tracking.recompute_gaps(workday)
        return Response({"workday": workday_payload(workday)})


class CurrentWorkdayView(APIView):
    """GET /api/v1/workdays/current — la jornada activa del repartidor, o null."""

    permission_classes = DRIVER_ONLY

    def get(self, request):
        driver = current_driver(request)
        workday = Workday.objects.filter(driver=driver, status=Workday.Status.ACTIVE).first() if driver else None
        return Response({"workday": workday_payload(workday) if workday else None})
