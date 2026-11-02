from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import TrackingTokenAuthentication
from apps.drivers.models import Device
from apps.tenancy.permissions import HasTrackingContext
from apps.tenancy.timefmt import iso_utc
from apps.workdays.models import Workday

from . import services
from .serializers import AwareDateTimeField, PointSerializer


def _point_ref(raw, index: int) -> str:
    if isinstance(raw, dict) and raw.get("point_id") is not None:
        return str(raw["point_id"])
    return f"#{index}"


def _invalid(ref: str, errors: dict) -> dict:
    field, messages = next(iter(errors.items()))
    message = messages[0] if isinstance(messages, list) and messages else str(messages)
    return services.rejection(ref, f"invalid:{field}", f"Campo {field}: {message}")


class TrackingBatchView(APIView):
    """POST /api/v1/tracking/batch

    Autenticación: ``Authorization: Tracking <token>``. La empresa, la jornada y el dispositivo
    salen del token; cualquier ``organization_id``/``workday_id`` del cuerpo se ignora.

    Cuerpo: ``[{point_id, recorded_at, lat, lng, accuracy, ...}]`` o
    ``{"sent_at": "...", "points": [...]}`` (``sent_at`` sirve para medir el desfase del reloj).

    Respuesta: ``{accepted, duplicates, rejected: [{id, reason, detail}], server_time}``. El teléfono
    borra los aceptados y los duplicados; los rechazados no se van a aceptar nunca, tampoco se
    reintentan. Códigos de ``reason``: ``invalid:<campo>``, ``before_workday_start``,
    ``after_workday_end``, ``recorded_in_future`` (ver services.REJECTION_DETAILS).
    """

    authentication_classes = [TrackingTokenAuthentication]
    permission_classes = [HasTrackingContext]

    def post(self, request):
        ctx = request.auth
        body = request.data
        sent_at = None
        if isinstance(body, dict):
            raw_points = body.get("points")
            if body.get("sent_at") is not None:
                try:
                    sent_at = AwareDateTimeField().to_internal_value(body["sent_at"])
                except Exception:  # noqa: BLE001 - un sent_at inválido no invalida el lote
                    sent_at = None
        else:
            raw_points = body
        if not isinstance(raw_points, list):
            return Response({"detail": "Se esperaba una lista de puntos."}, status=status.HTTP_400_BAD_REQUEST)
        max_size = settings.TRACKING["MAX_BATCH_SIZE"]
        if len(raw_points) > max_size:
            return Response(
                {"detail": f"El lote tiene más de {max_size} puntos."}, status=status.HTTP_400_BAD_REQUEST
            )

        now = timezone.now()
        workday = Workday.objects.select_related("organization").get(id=ctx.workday_id)
        result = services.BatchResult()
        valid: list[dict] = []
        seen: set[str] = set()

        for index, raw in enumerate(raw_points):
            ref = _point_ref(raw, index)
            serializer = PointSerializer(data=raw if isinstance(raw, dict) else {})
            if not serializer.is_valid():
                result.rejected.append(_invalid(ref, serializer.errors))
                continue
            point = serializer.validated_data
            pid = str(point["point_id"])
            if pid in seen:
                result.duplicates.append(pid)
                continue
            seen.add(pid)
            reason = services.check_point_window(workday, point["recorded_at"], now)
            if reason:
                result.rejected.append(services.rejection(pid, reason))
                continue
            valid.append(point)

        inserted = services.insert_points(workday, ctx.device_id, valid, received_at=now)
        for point in valid:
            pid = str(point["point_id"])
            (result.accepted if pid in inserted else result.duplicates).append(pid)

        if inserted:
            services.recompute_gaps(workday)

        device_updates = {"last_sync_at": now}
        if sent_at is not None:
            device_updates["clock_offset_ms"] = int((sent_at - now).total_seconds() * 1000)
        Device.objects.filter(id=ctx.device_id).update(**device_updates)

        return Response({**result.as_dict(), "server_time": iso_utc(now)})
