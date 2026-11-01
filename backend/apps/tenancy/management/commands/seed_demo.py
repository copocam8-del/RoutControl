"""Crea dos empresas de DEMOSTRACIÓN con usuarios de prueba. Idempotente. Solo con DEBUG."""

import os
import uuid

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User
from apps.drivers.models import DriverProfile
from apps.tenancy.context import tenant_context
from apps.tenancy.models import Membership
from apps.tenancy.services import create_organization, get_organization

DEMO_NAMESPACE = uuid.UUID("6f1c2b0e-5d0a-4c55-9a51-2f3c8d0e7a10")

DEMO = [
    {
        "slug": "demo-norte",
        "name": "Demo Norte (DATOS DE DEMOSTRACIÓN)",
        "users": [
            ("duenio@norte.demo", "Dueña Norte (demo)", Membership.Role.OWNER),
            ("repartidor1@norte.demo", "Repartidor 1 Norte (demo)", Membership.Role.DRIVER),
            ("repartidor2@norte.demo", "Repartidor 2 Norte (demo)", Membership.Role.DRIVER),
        ],
    },
    {
        "slug": "demo-sur",
        "name": "Demo Sur (DATOS DE DEMOSTRACIÓN)",
        "users": [
            ("duenio@sur.demo", "Dueño Sur (demo)", Membership.Role.OWNER),
            ("repartidor1@sur.demo", "Repartidor 1 Sur (demo)", Membership.Role.DRIVER),
        ],
    },
]
# Usuario con membresía en las dos empresas, para probar la elección de empresa en el login.
MULTI = ("supervisor@ambas.demo", "Supervisora de ambas (demo)", Membership.Role.SUPERVISOR)


class Command(BaseCommand):
    help = "Crea las empresas y usuarios de demostración (solo en desarrollo)."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_demo solo corre con DJANGO_DEBUG=1.")
        password = os.environ.get("DEMO_PASSWORD", "routcontrol-demo")

        def user(email, name):
            u, created = User.objects.get_or_create(email=email, defaults={"full_name": name})
            if created:
                u.set_password(password)
                u.save()
            return u

        multi = user(*MULTI[:2])
        for spec in DEMO:
            # Id determinista: con RLS no se puede buscar una empresa por slug sin estar en su
            # contexto, así que un segundo seed la encuentra por id.
            org_id = uuid.uuid5(DEMO_NAMESPACE, spec["slug"])
            org = get_organization(org_id) or create_organization(
                id=org_id, slug=spec["slug"], name=spec["name"], is_demo=True
            )
            with tenant_context(org.id):
                for email, name, role in [*spec["users"], MULTI]:
                    u = multi if email == MULTI[0] else user(email, name)
                    m, _ = Membership.objects.get_or_create(user=u, defaults={"role": role})
                    if role == Membership.Role.DRIVER:
                        DriverProfile.objects.get_or_create(membership=m)
            self.stdout.write(f"  {org.name}: {', '.join(e for e, *_ in spec['users'])}")

        self.stdout.write(f"  En las dos empresas: {MULTI[0]}")
        self.stdout.write(self.style.SUCCESS(f"Listo. Contraseña de todos: la de DEMO_PASSWORD ({password!r})."))
