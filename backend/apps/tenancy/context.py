"""Contexto de empresa de la request en curso.

El contexto vive en dos lugares que siempre se fijan juntos:
  1. una ContextVar de Python, que usa el ORM (TenantManager) para filtrar y para fallar cerrado;
  2. la variable de sesión de PostgreSQL ``app.current_org``, fijada con ``set_config(..., true)``
     (equivale a ``SET LOCAL``: dura solo la transacción), que usan las políticas de RLS.

``tenant_context`` abre una transacción en la conexión de la aplicación, así que todo lo que pasa
dentro (la vista entera, cuando lo usa el middleware) es atómico y queda filtrado por RLS.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

from django.conf import settings
from django.db import connections, transaction

_current_org: ContextVar[uuid.UUID | None] = ContextVar("rc_current_org", default=None)

PG_SETTING = "app.current_org"


class TenantContextMissing(RuntimeError):
    """Se intentó acceder a datos de empresa sin contexto de empresa."""


def app_db() -> str:
    return settings.APP_DB_ALIAS


def get_current_org_id() -> uuid.UUID | None:
    return _current_org.get()


def require_current_org_id() -> uuid.UUID:
    org_id = _current_org.get()
    if org_id is None:
        raise TenantContextMissing("No hay contexto de empresa: el acceso a datos de empresa falla cerrado.")
    return org_id


def _set_pg_org(value: str) -> None:
    with connections[app_db()].cursor() as cursor:
        cursor.execute("SELECT set_config(%s, %s, true)", [PG_SETTING, value])


@contextmanager
def tenant_context(org_id: uuid.UUID | str) -> Iterator[uuid.UUID]:
    org_uuid = org_id if isinstance(org_id, uuid.UUID) else uuid.UUID(str(org_id))
    previous = _current_org.get()
    token = _current_org.set(org_uuid)
    try:
        with transaction.atomic(using=app_db()):
            _set_pg_org(str(org_uuid))
            yield org_uuid
            # Si el bloque terminó bien, se restaura el valor anterior (importa cuando esto corre
            # anidado, por ejemplo dentro de la transacción de una prueba). Si hubo excepción, o si
            # se marcó para rollback (el middleware lo hace con las respuestas 4xx/5xx), el propio
            # rollback deshace el SET LOCAL; además, en ese estado Django no permite más consultas.
            if not transaction.get_rollback(using=app_db()):
                _set_pg_org(str(previous) if previous else "")
    finally:
        _current_org.reset(token)


USER_PG_SETTING = "app.current_user"


@contextmanager
def user_context(user_id: uuid.UUID | str) -> Iterator[uuid.UUID]:
    """El usuario puede leerse y actualizarse a sí mismo (RLS de accounts_user, ADR-010).

    Se usa donde todavía no hay empresa: el login (después de verificar la contraseña) y el alta de
    usuarios. Igual que tenant_context, dura solo la transacción (SET LOCAL).
    """
    user_uuid = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))
    with transaction.atomic(using=app_db()):
        with connections[app_db()].cursor() as cursor:
            cursor.execute("SELECT set_config(%s, %s, true)", [USER_PG_SETTING, str(user_uuid)])
        yield user_uuid
        if not transaction.get_rollback(using=app_db()):
            with connections[app_db()].cursor() as cursor:
                cursor.execute("SELECT set_config(%s, '', true)", [USER_PG_SETTING])
