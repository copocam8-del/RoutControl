"""Operaciones de plataforma sobre empresas."""

import uuid

from .context import tenant_context
from .models import Organization


def create_organization(*, id: uuid.UUID | None = None, **fields) -> Organization:
    """Crea una empresa.

    ``tenancy_organization`` tiene RLS (``id = rc_current_org()``), así que el rol de la aplicación
    solo puede insertar la fila estando en el contexto de esa misma empresa: el id se genera antes
    y se entra a su contexto. No hay ninguna excepción al RLS para crear empresas.

    En la etapa 0 solo lo usan los datos de demostración y las pruebas. El alta real (§3.4, la hace
    el equipo de plataforma) se diseña en la etapa 1, con auditoría.
    """
    org_id = id or uuid.uuid4()
    with tenant_context(org_id):
        return Organization.objects.create(id=org_id, **fields)


def get_organization(org_id: uuid.UUID) -> Organization | None:
    """Lee una empresa (solo es visible dentro de su propio contexto)."""
    with tenant_context(org_id):
        return Organization.objects.filter(id=org_id).first()
