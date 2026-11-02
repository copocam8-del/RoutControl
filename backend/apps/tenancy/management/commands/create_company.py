"""Alta de una empresa con su dueño (despliegue, ADR-021).

    python manage.py create_company --name "Mi Empresa" --slug mi-empresa --owner-email yo@mail.com

Si el email no existe, crea el usuario con una contraseña aleatoria y la muestra UNA vez. Si ya
existe, solo le agrega la membresía de dueño. Idempotente por slug: no duplica la empresa.
"""

import secrets
import uuid

from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from apps.accounts.models import User
from apps.tenancy.context import app_db, tenant_context, user_context
from apps.tenancy.models import Membership
from apps.tenancy.services import create_organization, get_organization

# Id determinista por slug: con RLS no se puede buscar una empresa por slug sin estar en su
# contexto, así que una segunda corrida la encuentra por id.
COMPANY_NAMESPACE = uuid.UUID("6b1e7c52-3c1f-4a55-9a43-2f6f2e7c9d10")


class Command(BaseCommand):
    help = "Crea una empresa y su dueño (o le agrega el dueño si ya existe)."

    def add_arguments(self, parser):
        parser.add_argument("--name", required=True)
        parser.add_argument("--slug", required=True)
        parser.add_argument("--owner-email", required=True)
        parser.add_argument("--owner-name", default="")
        parser.add_argument("--timezone", default="America/Argentina/Buenos_Aires")

    def handle(self, *args, name, slug, owner_email, owner_name, timezone, **options):
        email = owner_email.strip().lower()
        if "@" not in email:
            raise CommandError("Email inválido.")
        org_id = uuid.uuid5(COMPANY_NAMESPACE, slug)
        org = get_organization(org_id)
        if org is None:
            org = create_organization(id=org_id, slug=slug, name=name, timezone=timezone)
            self.stdout.write(f"Empresa creada: {org.name} ({org.slug})")
        else:
            self.stdout.write(f"La empresa ya existía: {org.name} ({org.slug})")

        # accounts_user tiene RLS (ADR-010): se busca por email con la función de login.
        with connections[app_db()].cursor() as cursor:
            cursor.execute("SELECT id FROM rc_auth_lookup(%s)", [email])
            row = cursor.fetchone()
        password = None
        if row:
            with user_context(row[0]):
                user = User.objects.get(id=row[0])
        else:
            password = secrets.token_urlsafe(12)
            user = User.objects.create_user(email=email, password=password, full_name=owner_name or email.split("@")[0])

        with tenant_context(org.id):
            membership, created = Membership.objects.get_or_create(user=user, defaults={"role": Membership.Role.OWNER})
        if created:
            self.stdout.write(f"Dueño: {email}")
        else:
            self.stdout.write(f"{email} ya tenía acceso ({membership.role}).")
        if password:
            self.stdout.write(self.style.WARNING(f"Contraseña inicial (anotala, no se vuelve a mostrar): {password}"))
