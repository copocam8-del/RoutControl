"""Revocación de tokens de seguimiento cuando se desactiva el dispositivo o el repartidor.

Hay dos barreras:
  1. Estas señales marcan ``revoked_at`` en cuanto se guarda el cambio de estado con ``.save()``.
  2. ``rc_resolve_tracking_token`` exige que el dispositivo, el perfil, la membresía y el usuario
     estén activos. Cubre los cambios hechos con ``QuerySet.update()`` (que no dispara señales)
     y la desactivación del usuario, que es de plataforma y abarca varias empresas.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from apps.drivers.models import Device, DriverProfile
from apps.tenancy.models import Membership

from .models import TrackingToken


def _revoke(queryset, reason: str) -> int:
    return queryset.filter(revoked_at__isnull=True).update(revoked_at=timezone.now(), revoked_reason=reason)


@receiver(post_save, sender=Device, dispatch_uid="rc_revoke_on_device_disabled")
def revoke_on_device_disabled(sender, instance: Device, **kwargs):
    if instance.status != Device.Status.ACTIVE:
        _revoke(TrackingToken.objects.filter(device=instance), TrackingToken.RevokedReason.DEVICE_DISABLED)


@receiver(post_save, sender=DriverProfile, dispatch_uid="rc_revoke_on_driver_disabled")
def revoke_on_driver_disabled(sender, instance: DriverProfile, **kwargs):
    if instance.status != DriverProfile.Status.ACTIVE:
        _revoke(
            TrackingToken.objects.filter(workday__driver=instance), TrackingToken.RevokedReason.DRIVER_DISABLED
        )


@receiver(post_save, sender=Membership, dispatch_uid="rc_revoke_on_membership_disabled")
def revoke_on_membership_disabled(sender, instance: Membership, **kwargs):
    if instance.status != Membership.Status.ACTIVE:
        _revoke(
            TrackingToken.objects.filter(workday__driver__membership=instance),
            TrackingToken.RevokedReason.MEMBERSHIP_DISABLED,
        )
