"""GET /api/v1/drivers: repartidores de la empresa con su jornada en curso y la última (panel)."""

from django.db.models import OuterRef, Subquery
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.tenancy.models import Membership
from apps.tenancy.permissions import HasTenantContext, role_required
from apps.tenancy.timefmt import iso_utc
from apps.tracking.models import LocationPoint
from apps.workdays.models import Workday

from .models import DriverProfile

STAFF_ONLY = [
    IsAuthenticated,
    HasTenantContext,
    role_required(Membership.Role.OWNER, Membership.Role.ADMIN, Membership.Role.SUPERVISOR),
]


class DriverListView(APIView):
    """Solo dueño, admin y supervisor (§8). Todo dentro del contexto de la empresa (RLS)."""

    permission_classes = STAFF_ONLY

    def get(self, request):
        latest = Workday.objects.filter(driver=OuterRef("pk")).order_by("-started_at")
        active = Workday.objects.filter(driver=OuterRef("pk"), status=Workday.Status.ACTIVE)
        last_point = LocationPoint.objects.filter(
            workday__driver=OuterRef("pk"), workday__status=Workday.Status.ACTIVE
        ).order_by("-recorded_at")
        drivers = (
            DriverProfile.objects.select_related("membership__user")
            .annotate(
                active_id=Subquery(active.values("id")[:1]),
                active_started_at=Subquery(active.values("started_at")[:1]),
                active_last_point_at=Subquery(last_point.values("recorded_at")[:1]),
                last_id=Subquery(latest.values("id")[:1]),
                last_date=Subquery(latest.values("date")[:1]),
                last_started_at=Subquery(latest.values("started_at")[:1]),
                last_ended_at=Subquery(latest.values("ended_at")[:1]),
                last_status=Subquery(latest.values("status")[:1]),
            )
            .order_by("membership__user__full_name", "membership__user__email")
        )
        return Response({"drivers": [self.payload(d) for d in drivers]})

    @staticmethod
    def payload(d: DriverProfile) -> dict:
        user = d.membership.user
        return {
            "id": str(d.id),
            "name": user.full_name or user.email,
            "email": user.email,
            "employee_code": d.employee_code,
            "vehicle_type": d.vehicle_type,
            "status": d.status,
            "membership_status": d.membership.status,
            "active_workday": (
                {
                    "id": str(d.active_id),
                    "started_at": iso_utc(d.active_started_at),
                    "last_point_at": iso_utc(d.active_last_point_at),
                }
                if d.active_id
                else None
            ),
            "last_workday": (
                {
                    "id": str(d.last_id),
                    "date": d.last_date.isoformat(),
                    "started_at": iso_utc(d.last_started_at),
                    "ended_at": iso_utc(d.last_ended_at),
                    "status": d.last_status,
                }
                if d.last_id
                else None
            ),
        }
