from datetime import timedelta
from zoneinfo import ZoneInfo

from django.contrib.gis.geos import Point
from django.db import IntegrityError, transaction
from django.db.models import Count, IntegerField, Max, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.drivers.models import Device, DriverProfile
from apps.tenancy.context import app_db
from apps.tenancy.models import Membership
from apps.tenancy.permissions import HasTenantContext, role_required
from apps.tenancy.timefmt import iso_utc
from apps.tracking import services as tracking
from apps.tracking.models import TrackingGap
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
        "started_at": iso_utc(w.started_at),
        "ended_at": iso_utc(w.ended_at),
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
            "tracking_token_expires_at": iso_utc(token.expires_at),
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


class TrackingTokenRecoveryView(APIView):
    """POST /api/v1/workdays/{id}/tracking-token — token nuevo para enviar puntos trabados (ADR-010).

    Cuando el token de seguimiento quedó inválido (venció con el teléfono sin señal, se emitió otro),
    los puntos de esa jornada quedan en el teléfono. Con el JWT del repartidor se pide un token nuevo
    para ESA jornada; el anterior se revoca. Solo si:
      - la jornada es del repartidor que lo pide;
      - está activa o terminó hace menos de la gracia (tracking_token_grace_hours);
      - el dispositivo y el perfil siguen activos (la membresía y el usuario ya los exige el contexto).
    No cambia la ventana de puntos: siguen valiendo solo los grabados entre el inicio y el fin.
    """

    permission_classes = DRIVER_ONLY

    def post(self, request, workday_id):
        driver = current_driver(request)
        workday = (
            Workday.objects.select_related("organization", "device").filter(id=workday_id, driver=driver).first()
            if driver
            else None
        )
        if workday is None:
            return Response({"detail": "Jornada no encontrada."}, status=status.HTTP_404_NOT_FOUND)
        if workday.device.status != Device.Status.ACTIVE:
            return Response(
                {"code": "device_disabled", "detail": "Este dispositivo fue desactivado por la empresa."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if workday.status == Workday.Status.ACTIVE:
            raw, token = tracking.issue_tracking_token(workday)
        else:
            closed_at = workday.end_received_at or workday.ended_at
            grace_until = closed_at + timedelta(hours=tracking.token_grace_hours(workday.organization))
            if grace_until <= timezone.now():
                return _conflict(
                    "grace_expired",
                    "Pasó el plazo para enviar los puntos de esta jornada; no se pueden recuperar.",
                )
            raw, token = tracking.issue_tracking_token(workday)
            token.expires_at = grace_until  # el nuevo vence cuando hubiera vencido la gracia
            token.save(update_fields=["expires_at", "updated_at"])
        return Response(
            {"tracking_token": raw, "tracking_token_expires_at": iso_utc(token.expires_at)},
            status=status.HTTP_201_CREATED,
        )


class CurrentWorkdayView(APIView):
    """GET /api/v1/workdays/current — la jornada activa del repartidor, o null."""

    permission_classes = DRIVER_ONLY

    def get(self, request):
        driver = current_driver(request)
        workday = Workday.objects.filter(driver=driver, status=Workday.Status.ACTIVE).first() if driver else None
        return Response({"workday": workday_payload(workday) if workday else None})


# --- Consulta de jornadas y recorrido (mapa) ------------------------------------------------------

VIEWER_ROLES = (Membership.Role.OWNER, Membership.Role.ADMIN, Membership.Role.SUPERVISOR)


def visible_workdays(request):
    """§8: dueño, admin y supervisor ven todas las jornadas de su empresa; el repartidor, solo las
    propias. Otra empresa no aparece nunca (RLS + TenantManager)."""
    membership = request._request.tenant.membership
    # Los huecos van en una subconsulta: un segundo JOIN multiplicaría el conteo de puntos.
    gaps = (
        TrackingGap.objects.filter(workday=OuterRef("pk"))
        .values("workday")
        .annotate(n=Count("id"))
        .values("n")[:1]
    )
    qs = Workday.objects.select_related("driver__membership__user").annotate(
        point_count=Count("points"),
        last_point_at=Max("points__recorded_at"),
        gap_count=Coalesce(Subquery(gaps, output_field=IntegerField()), Value(0)),
    )
    if membership.role in VIEWER_ROLES:
        return qs
    return qs.filter(driver__membership=membership)


def workday_with_driver(w: Workday) -> dict:
    """Jornada con su repartidor y la actividad registrada (para el panel: "última señal")."""
    user = w.driver.membership.user
    return {
        **workday_payload(w),
        "driver": {"id": str(w.driver_id), "name": user.full_name or user.email},
        "point_count": getattr(w, "point_count", 0),
        "last_point_at": iso_utc(getattr(w, "last_point_at", None)),
        "gap_count": getattr(w, "gap_count", 0),
    }


class DateQuerySerializer(serializers.Serializer):
    date = serializers.DateField(required=False)


class WorkdayListView(APIView):
    """GET /api/v1/workdays?date=AAAA-MM-DD — jornadas visibles para el usuario (las últimas 50)."""

    def get(self, request):
        query = DateQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        qs = visible_workdays(request).order_by("-started_at")
        if query.validated_data.get("date"):
            qs = qs.filter(date=query.validated_data["date"])
        return Response({"workdays": [workday_with_driver(w) for w in qs[:50]]})


class WorkdayTrackView(APIView):
    """GET /api/v1/workdays/{id}/track — recorrido para el mapa, partido en tramos por los huecos."""

    def get(self, request, workday_id):
        from .track import build_track

        workday = visible_workdays(request).filter(id=workday_id).first()
        if workday is None:
            return Response({"detail": "Jornada no encontrada."}, status=status.HTTP_404_NOT_FOUND)
        # Ver un recorrido es ver ubicaciones de una persona: queda registrado (§11, ADR-010).
        audit.record(request, AuditLog.Action.VIEW_TRACK, "workday", workday.id, driver_id=str(workday.driver_id))
        return Response({"workday": workday_with_driver(workday), **build_track(workday)})
