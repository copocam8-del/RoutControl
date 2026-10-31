import pytest

from apps.drivers.models import DriverProfile
from apps.tenancy.context import TenantContextMissing, get_current_org_id, tenant_context
from apps.tenancy.models import Membership
from apps.workdays.models import Workday


def test_orm_without_context_raises(org_a):
    with pytest.raises(TenantContextMissing):
        list(Membership.objects.all())
    with pytest.raises(TenantContextMissing):
        Workday.objects.count()


def test_orm_with_context_only_sees_own_org(org_a, org_b):
    with tenant_context(org_a.id):
        assert {m.organization_id for m in Membership.objects.all()} == {org_a.id}
        assert Membership.objects.count() == 3  # dueño + 2 repartidores
    with tenant_context(org_b.id):
        assert Membership.objects.count() == 2


def test_cannot_save_row_of_another_org(org_a, org_b):
    with tenant_context(org_b.id):
        profile_b = DriverProfile.objects.first()
    with tenant_context(org_a.id):
        with pytest.raises(TenantContextMissing):
            profile_b.vehicle_type = "moto"
            profile_b.save()


def test_context_is_restored_after_block(org_a, org_b):
    assert get_current_org_id() is None
    with tenant_context(org_a.id):
        with tenant_context(org_b.id):
            assert get_current_org_id() == org_b.id
        assert get_current_org_id() == org_a.id
        assert Membership.objects.count() == 3
    assert get_current_org_id() is None
