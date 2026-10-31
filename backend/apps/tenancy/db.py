"""Seguridad de base de datos derivada de los modelos.

Se ejecuta al final de cada ``migrate`` (señal post_migrate, ver apps.py), como el dueño de las
tablas, y es idempotente. Genera para cada subclase concreta de TenantModel:

  * ``ENABLE`` + ``FORCE ROW LEVEL SECURITY`` y la política ``tenant_isolation``
    (``organization_id = rc_current_org()`` para leer y para escribir);
  * ``UNIQUE (organization_id, id)``, para poder ser destino de FK compuestas;
  * una FK compuesta ``(organization_id, <fk>) → destino(organization_id, id)`` por cada FK a otra
    tabla de empresa, para que sea imposible relacionar registros de empresas distintas.

Y para todo el esquema: permisos DML al rol de la aplicación (nunca DDL ni propiedad).

Generarlo desde los modelos evita olvidarse una tabla; las pruebas de tests/tenancy verifican
el resultado directamente en el catálogo de PostgreSQL.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.db import connections, transaction

FUNCTIONS_SQL = Path(settings.BASE_DIR) / "sql" / "rls" / "functions.sql"
POLICY_NAME = "tenant_isolation"


def tenant_models():
    from .models import TenantModel

    return [m for m in apps.get_models() if issubclass(m, TenantModel) and not m._meta.abstract]


def _short_name(prefix: str, *parts: str) -> str:
    digest = hashlib.sha1("_".join(parts).encode()).hexdigest()[:10]
    return f"{prefix}_{parts[0][:30]}_{digest}"


def tenant_foreign_keys(model):
    """FK de un modelo de empresa hacia otro modelo de empresa."""
    from .models import TenantModel

    for field in model._meta.concrete_fields:
        if not field.is_relation or field.name == "organization":
            continue
        target = field.related_model
        if issubclass(target, TenantModel):
            yield field, target


def _if_missing_constraint(name: str, ddl: str) -> str:
    return (
        "DO $rc$ BEGIN "
        f"IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{name}') THEN {ddl}; END IF; "
        "END $rc$;"
    )


def apply_tenant_security(using: str = "default") -> None:
    connection = connections[using]
    qn = connection.ops.quote_name
    app_user = qn(settings.DATABASES[settings.APP_DB_ALIAS]["USER"])
    models = tenant_models()

    statements: list[str] = [
        # Por si se migra una sola app y alguna tabla que nombran las funciones todavía no existe.
        "SET LOCAL check_function_bodies = off",
        FUNCTIONS_SQL.read_text(encoding="utf-8").replace("{app_user}", app_user),
    ]

    for model in models:
        table = model._meta.db_table
        statements += [
            f"ALTER TABLE {qn(table)} ENABLE ROW LEVEL SECURITY",
            f"ALTER TABLE {qn(table)} FORCE ROW LEVEL SECURITY",
            f"DROP POLICY IF EXISTS {POLICY_NAME} ON {qn(table)}",
            f"CREATE POLICY {POLICY_NAME} ON {qn(table)} "
            "USING (organization_id = rc_current_org()) "
            "WITH CHECK (organization_id = rc_current_org())",
            _if_missing_constraint(
                _short_name("rc_orguniq", table),
                f"ALTER TABLE {qn(table)} ADD CONSTRAINT {_short_name('rc_orguniq', table)} "
                f"UNIQUE (organization_id, {qn(model._meta.pk.column)})",
            ),
        ]

    # Las FK compuestas van después de crear todos los UNIQUE de destino.
    for model in models:
        table = model._meta.db_table
        for field, target in tenant_foreign_keys(model):
            name = _short_name("rc_orgfk", table, field.column)
            statements.append(
                _if_missing_constraint(
                    name,
                    f"ALTER TABLE {qn(table)} ADD CONSTRAINT {name} "
                    f"FOREIGN KEY (organization_id, {qn(field.column)}) "
                    f"REFERENCES {qn(target._meta.db_table)} (organization_id, {qn(target._meta.pk.column)}) "
                    "DEFERRABLE INITIALLY DEFERRED",
                )
            )

    statements += [
        f"GRANT USAGE ON SCHEMA public TO {app_user}",
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {app_user}",
        f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {app_user}",
        f"REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON django_migrations FROM {app_user}",
    ]

    with transaction.atomic(using=using), connection.cursor() as cursor:
        for sql in statements:
            cursor.execute(sql)
