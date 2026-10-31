"""El aislamiento solo se puede probar si las pruebas usan el mismo rol que la aplicación.

Si estas pruebas corrieran como superusuario, o como dueño de las tablas, o con BYPASSRLS,
PostgreSQL ignoraría el RLS y todas las pruebas de aislamiento pasarían aunque no funcionara.
Por eso esto se verifica en cada corrida, en el catálogo de PostgreSQL.
"""

from django.conf import settings
from django.db import connections

from apps.tenancy.db import POLICY_NAME, tenant_foreign_keys, tenant_models
from apps.tracking.models import LocationPoint


def fetchone(alias: str, sql: str, params=None):
    with connections[alias].cursor() as cursor:
        cursor.execute(sql, params or [])
        return cursor.fetchone()


def test_orm_uses_the_app_role():
    """Todo el ORM (y por lo tanto las pruebas) pasa por el alias "app"."""
    assert LocationPoint.objects.db == settings.APP_DB_ALIAS
    assert settings.DATABASES["app"]["USER"] != settings.DATABASES["default"]["USER"]


def test_app_role_is_not_superuser_and_has_no_bypassrls():
    current_user, is_super, bypass, createdb, createrole = fetchone(
        "app",
        "SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole "
        "FROM pg_roles r WHERE r.rolname = current_user",
    )
    assert current_user == settings.DATABASES["app"]["USER"]
    assert is_super is False
    assert bypass is False
    assert createdb is False
    assert createrole is False


def test_app_role_does_not_inherit_privileged_roles():
    """Tampoco puede ser miembro de un rol con superusuario, BYPASSRLS o dueño de las tablas."""
    row = fetchone(
        "app",
        """
        WITH RECURSIVE granted(oid) AS (
            SELECT oid FROM pg_roles WHERE rolname = current_user
            UNION SELECT m.roleid FROM pg_auth_members m JOIN granted g ON m.member = g.oid
        )
        SELECT count(*) FROM granted g JOIN pg_roles r ON r.oid = g.oid
         WHERE r.rolsuper OR r.rolbypassrls OR r.rolname = %s
        """,
        [settings.DATABASES["default"]["USER"]],
    )
    assert row[0] == 0


def test_app_role_owns_no_tables_and_migrations_ran_as_owner():
    owned = fetchone(
        "app",
        "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = current_user",
    )
    assert owned[0] == 0
    owner = fetchone("app", "SELECT tableowner FROM pg_tables WHERE tablename = 'tracking_locationpoint'")
    assert owner[0] == settings.DATABASES["default"]["USER"]


def test_app_role_cannot_alter_tables_or_disable_rls():
    from django.db import DatabaseError, transaction

    attempts = [
        ["ALTER TABLE tracking_locationpoint DISABLE ROW LEVEL SECURITY"],
        ["ALTER TABLE tracking_locationpoint NO FORCE ROW LEVEL SECURITY"],
        ["DROP POLICY tenant_isolation ON tracking_locationpoint"],
        # SET row_security = off no falla por sí mismo; para un rol sin BYPASSRLS, la consulta
        # siguiente sobre una tabla con RLS sí tiene que fallar.
        ["SET LOCAL row_security = off", "SELECT 1 FROM tracking_locationpoint"],
    ]
    with connections["app"].cursor() as cursor:
        for statements in attempts:
            failed = False
            try:
                with transaction.atomic(using="app"):
                    for sql in statements:
                        cursor.execute(sql)
            except DatabaseError:
                failed = True
            assert failed, f"El rol de la aplicación pudo ejecutar: {statements}"


def test_every_tenant_table_has_forced_rls_and_policy():
    tables = [m._meta.db_table for m in tenant_models()]
    assert {"tenancy_membership", "workdays_workday", "tracking_locationpoint"} <= set(tables)
    for table in tables:
        enabled, forced = fetchone(
            "app", "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = %s", [table]
        )
        assert enabled and forced, f"{table} sin RLS forzado"
        policy = fetchone(
            "app",
            "SELECT qual, with_check FROM pg_policies WHERE tablename = %s AND policyname = %s",
            [table, POLICY_NAME],
        )
        assert policy is not None, f"{table} sin política {POLICY_NAME}"
        assert "rc_current_org()" in policy[0] and "rc_current_org()" in policy[1]


def test_every_tenant_fk_has_a_composite_fk_with_organization():
    for model in tenant_models():
        for fk, target in tenant_foreign_keys(model):
            row = fetchone(
                "app",
                """
                SELECT count(*) FROM pg_constraint c
                 WHERE c.contype = 'f'
                   AND c.conrelid = %s::regclass AND c.confrelid = %s::regclass
                   AND array_length(c.conkey, 1) = 2
                """,
                [model._meta.db_table, target._meta.db_table],
            )
            assert row[0] >= 1, f"{model._meta.db_table}.{fk.column} sin FK compuesta con organization_id"
