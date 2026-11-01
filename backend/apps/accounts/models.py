import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models

from apps.tenancy.models import TenantModel


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("El email es obligatorio")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("is_platform_staff", True)
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """Usuario de plataforma (sin RLS): una persona puede pertenecer a varias empresas."""

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE"
        DISABLED = "DISABLED"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=200, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    is_platform_staff = models.BooleanField(default=False)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    @property
    def is_active(self) -> bool:  # usado por Django y simplejwt
        return self.status == self.Status.ACTIVE

    def __str__(self) -> str:
        return self.email


class RefreshSession(TenantModel):
    """Una sesión de refresh (una por login, se renueva con cada rotación).

    Guarda SOLO el jti del refresh token, nunca el token: con lo que hay en esta tabla no se puede
    renovar la sesión de nadie. Tiene RLS por empresa como cualquier TenantModel. Ver ADR-005.
    """

    class RevokedReason(models.TextChoices):
        ROTATED = "rotated"  # se usó para renovar; reusarlo es señal de robo
        LOGOUT = "logout"
        REUSE_DETECTED = "reuse_detected"  # se reusó un refresh ya rotado: se revocan todas
        ACCESS_LOST = "access_lost"  # membresía, usuario o empresa desactivados

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    jti = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=20, choices=RevokedReason.choices, blank=True)

    class Meta(TenantModel.Meta):
        indexes = [models.Index(fields=["organization", "user"], name="refreshsession_org_user")]
