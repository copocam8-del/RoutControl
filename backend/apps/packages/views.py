"""API de paquetes (§9). El personal (dueño, admin, supervisor) da de alta, edita y asigna; el
repartidor ve solo los paquetes que tiene asignados. Todo dentro del contexto de la empresa (RLS)."""

from django.db.models import Q
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.tenancy.models import Membership
from apps.tenancy.permissions import HasTenantContext, role_required
from apps.tenancy.timefmt import iso_utc

from . import reception, services
from .models import Package, PackageEvent

STAFF_ROLES = (Membership.Role.OWNER, Membership.Role.ADMIN, Membership.Role.SUPERVISOR)
STAFF_ONLY = [IsAuthenticated, HasTenantContext, role_required(*STAFF_ROLES)]
MEMBERS = [IsAuthenticated, HasTenantContext]


def is_staff(request) -> bool:
    return request._request.tenant.membership.role in STAFF_ROLES


def own_driver_id(request):
    profile = getattr(request._request.tenant.membership, "driver_profile", None)
    return profile.id if profile else None


def visible_packages(request):
    qs = Package.objects.select_related("address", "organization", "assigned_driver__membership__user")
    if is_staff(request):
        return qs
    return qs.filter(assigned_driver_id=own_driver_id(request))


def address_payload(a) -> dict:
    return {
        "id": str(a.id),
        "raw_text": a.raw_text,
        "street": a.street,
        "number": a.number,
        "floor_unit": a.floor_unit,
        "locality": a.locality,
        "province": a.province,
        "postal_code": a.postal_code,
        "location": {"lat": a.location.y, "lng": a.location.x} if a.location else None,
    }


def package_payload(p: Package, receptions: dict | None = None) -> dict:
    """`receptions`: indicadores ya calculados para una lista (una sola consulta); si falta, se
    calcula el de este domicilio."""
    driver = p.assigned_driver
    stats = (receptions or {}).get(p.address_id) or reception.for_addresses([p.address_id], p.organization)[p.address_id]
    return {
        "id": str(p.id),
        "tracking_code": p.tracking_code,
        "source": p.source,
        "status": p.status,
        "recipient_name": p.recipient_name,
        "recipient_phone": p.recipient_phone,
        "notes": p.notes,
        "address": address_payload(p.address),
        # Indicador de recepción del domicilio (§7.3, ADR-022): informativo.
        "reception": reception.summary(stats),
        "assigned_driver": (
            {"id": str(driver.id), "name": driver.membership.user.full_name or driver.membership.user.email}
            if driver
            else None
        ),
        "assigned_at": iso_utc(p.assigned_at),
        "version": p.version,
        "created_at": iso_utc(p.created_at),
        "updated_at": iso_utc(p.updated_at),
    }


def error(exc: services.PackageError) -> Response:
    return Response({"code": exc.code, "detail": exc.detail}, status=exc.status)


class AddressSerializer(serializers.Serializer):
    raw_text = serializers.CharField(max_length=500, required=False, allow_blank=True)
    street = serializers.CharField(max_length=200, required=False, allow_blank=True)
    number = serializers.CharField(max_length=20, required=False, allow_blank=True)
    floor_unit = serializers.CharField(max_length=60, required=False, allow_blank=True)
    locality = serializers.CharField(max_length=120, required=False, allow_blank=True)
    province = serializers.CharField(max_length=120, required=False, allow_blank=True)
    postal_code = serializers.CharField(max_length=20, required=False, allow_blank=True)
    lat = serializers.FloatField(required=False, allow_null=True, min_value=-90, max_value=90)
    lng = serializers.FloatField(required=False, allow_null=True, min_value=-180, max_value=180)


class PackageCreateSerializer(serializers.Serializer):
    tracking_code = serializers.CharField(max_length=80)
    recipient_name = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    recipient_phone = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    address = AddressSerializer()
    driver_id = serializers.UUIDField(required=False, allow_null=True)


class PackageUpdateSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    tracking_code = serializers.CharField(max_length=80, required=False)
    recipient_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    recipient_phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    address = AddressSerializer(required=False)


class AssignSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    driver_id = serializers.UUIDField(allow_null=True)


class BulkAssignSerializer(serializers.Serializer):
    package_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=500)
    driver_id = serializers.UUIDField(allow_null=True)


class StatusSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    # El personal solo cancela o marca devuelto desde el panel; el resto lo cambia la calle.
    status = serializers.ChoiceField(choices=[Package.Status.CANCELLED, Package.Status.RETURNED])
    reason = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class PackageListView(APIView):
    """GET /api/v1/packages/?status=&driver=&q= — POST alta manual (personal)."""

    permission_classes = MEMBERS
    MAX = 500

    def get(self, request):
        qs = visible_packages(request)
        statuses = [s for s in request.query_params.get("status", "").split(",") if s]
        if statuses:
            qs = qs.filter(status__in=statuses)
        driver = request.query_params.get("driver")
        if driver == "none":
            qs = qs.filter(assigned_driver__isnull=True)
        elif driver:
            qs = qs.filter(assigned_driver_id=driver)
        q = request.query_params.get("q", "").strip()
        if q:
            qs = qs.filter(
                Q(tracking_code__icontains=q) | Q(recipient_name__icontains=q) | Q(address__raw_text__icontains=q)
            )
        packages = list(qs.order_by("-created_at")[: self.MAX])
        receptions = reception.for_addresses([p.address_id for p in packages], packages[0].organization) if packages else {}
        return Response({"packages": [package_payload(p, receptions) for p in packages]})

    def post(self, request):
        if not is_staff(request):
            return Response({"detail": "Tu rol no permite esta acción."}, status=status.HTTP_403_FORBIDDEN)
        data = PackageCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            package = services.create_package(data.validated_data, request.user)
        except services.PackageError as exc:
            return error(exc)
        return Response({"package": package_payload(package)}, status=status.HTTP_201_CREATED)


class PackageDetailView(APIView):
    """GET /api/v1/packages/{id} — PATCH edición con control de versión (personal)."""

    permission_classes = MEMBERS

    def get(self, request, package_id):
        package = visible_packages(request).filter(id=package_id).first()
        if package is None:
            return Response({"detail": "Paquete no encontrado."}, status=status.HTTP_404_NOT_FOUND)
        return Response({"package": package_payload(package)})

    def patch(self, request, package_id):
        if not is_staff(request):
            return Response({"detail": "Tu rol no permite esta acción."}, status=status.HTTP_403_FORBIDDEN)
        package = Package.objects.select_for_update().filter(id=package_id).first()
        if package is None:
            return Response({"detail": "Paquete no encontrado."}, status=status.HTTP_404_NOT_FOUND)
        data = PackageUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = dict(data.validated_data)
        try:
            package = services.update_package(package, v, request.user, v.pop("version"))
        except services.PackageError as exc:
            return error(exc)
        return Response({"package": package_payload(package)})


class PackageAssignView(APIView):
    """POST /api/v1/packages/{id}/assign {driver_id | null, version}."""

    permission_classes = STAFF_ONLY

    def post(self, request, package_id):
        data = AssignSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        package = Package.objects.select_for_update().filter(id=package_id).first()
        if package is None:
            return Response({"detail": "Paquete no encontrado."}, status=status.HTTP_404_NOT_FOUND)
        try:
            services.assign(package, data.validated_data["driver_id"], request.user, data.validated_data["version"])
        except services.PackageError as exc:
            return error(exc)
        return Response({"package": package_payload(visible_packages(request).get(id=package.id))})


class PackageBulkAssignView(APIView):
    """POST /api/v1/packages/assign {package_ids, driver_id | null}: asignación masiva desde el panel.
    Devuelve los asignados y, por paquete, los que no se pudieron (con el motivo)."""

    permission_classes = STAFF_ONLY

    def post(self, request):
        data = BulkAssignSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        ids = data.validated_data["package_ids"]
        found = {p.id: p for p in Package.objects.select_for_update().filter(id__in=ids)}
        assigned, failed = [], []
        for package_id in ids:
            package = found.get(package_id)
            if package is None:
                failed.append({"id": str(package_id), "code": "not_found", "detail": "Paquete no encontrado."})
                continue
            try:
                services.assign(package, data.validated_data["driver_id"], request.user, package.version)
                assigned.append(str(package.id))
            except services.PackageError as exc:
                if exc.code == "driver_not_found":
                    return error(exc)
                failed.append({"id": str(package.id), "code": exc.code, "detail": exc.detail})
        return Response({"assigned": assigned, "failed": failed})


class PackageStatusView(APIView):
    """POST /api/v1/packages/{id}/status {status: CANCELLED | RETURNED, version, reason}."""

    permission_classes = STAFF_ONLY

    def post(self, request, package_id):
        data = StatusSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        package = Package.objects.select_for_update().filter(id=package_id).first()
        if package is None:
            return Response({"detail": "Paquete no encontrado."}, status=status.HTTP_404_NOT_FOUND)
        if package.version != v["version"]:
            return error(services.PackageError("version_conflict", "Otra persona modificó este paquete.", 409))
        try:
            services.change_status(package, v["status"], request.user, reason=v["reason"])
        except services.PackageError as exc:
            return error(exc)
        return Response({"package": package_payload(visible_packages(request).get(id=package.id))})


class PackageEventsView(APIView):
    """GET /api/v1/packages/{id}/events — trazabilidad, del más viejo al más nuevo."""

    permission_classes = MEMBERS

    def get(self, request, package_id):
        package = visible_packages(request).filter(id=package_id).first()
        if package is None:
            return Response({"detail": "Paquete no encontrado."}, status=status.HTTP_404_NOT_FOUND)
        events = PackageEvent.objects.filter(package=package).select_related("actor").order_by("occurred_at")
        return Response(
            {
                "events": [
                    {
                        "id": str(e.id),
                        "type": e.type,
                        "from_status": e.from_status,
                        "to_status": e.to_status,
                        "actor": (e.actor.full_name or e.actor.email) if e.actor else None,
                        "payload": e.payload,
                        "occurred_at": iso_utc(e.occurred_at),
                    }
                    for e in events
                ]
            }
        )
