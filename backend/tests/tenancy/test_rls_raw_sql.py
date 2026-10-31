"""El RLS bloquea por sí solo, sin ayuda del ORM.

Estas pruebas no usan managers ni querysets: mandan SQL directo por la conexión del rol de la
aplicación (sin superusuario, sin BYPASSRLS, no es dueño; ver test_db_roles.py) con
``set_config('app.current_org', <A>, true)``, que es exactamente lo que hace el middleware.

Si alguien borra el filtro del TenantManager, o escribe una consulta cruda sin WHERE, PostgreSQL
igual tiene que devolver solo filas de la empresa A.
"""

import uuid
from datetime import timedelta

import pytest
from django.db import DatabaseError, connections, transaction

from tests.conftest import make_point, now_utc, start_workday, tracking_client

# Tablas de empresa con datos en las dos empresas después del fixture `two_orgs_with_data`.
TABLES = [
    "tenancy_membership",
    "drivers_driverprofile",
    "drivers_device",
    "workdays_workday",
    "tracking_trackingtoken",
    "tracking_locationpoint",
]


@pytest.fixture
def two_orgs_with_data(org_a, org_b):
    """Cada empresa con una jornada y puntos GPS cargados por la API real."""
    for fx in (org_a, org_b):
        started = now_utc() - timedelta(minutes=20)
        body = start_workday(fx.driver, fx.org, started_at=started)
        points = [make_point(started + timedelta(minutes=i)) for i in range(1, 4)]
        response = tracking_client(body["tracking_token"]).post("/api/v1/tracking/batch", points, format="json")
        assert len(response.json()["accepted"]) == 3
    return org_a, org_b


def raw(sql: str, params=None, org_id=None):
    """Ejecuta SQL directo como el rol de la aplicación, con (o sin) contexto de empresa."""
    with transaction.atomic(using="app"):
        with connections["app"].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_org', %s, true)", [str(org_id) if org_id else ""])
            cursor.execute(sql, params or [])
            return cursor.fetchall()


@pytest.mark.parametrize("table", TABLES)
def test_raw_sql_with_org_a_context_returns_no_rows_of_org_b(two_orgs_with_data, table):
    org_a, org_b = two_orgs_with_data

    # Control: con el contexto de B, las filas de B existen. Sin esto, la prueba pasaría también
    # si simplemente no hubiera datos de B.
    rows_b = raw(f"SELECT organization_id FROM {table}", org_id=org_b.id)
    assert rows_b and {r[0] for r in rows_b} == {org_b.id}

    # Con el contexto de A: SELECT sin ningún WHERE → solo filas de A.
    rows = raw(f"SELECT organization_id FROM {table}", org_id=org_a.id)
    assert rows, f"{table}: deberían verse las filas de A"
    assert {r[0] for r in rows} == {org_a.id}

    # Pedir explícitamente las filas de B tampoco las devuelve.
    explicit = raw(f"SELECT count(*) FROM {table} WHERE organization_id = %s", [str(org_b.id)], org_id=org_a.id)
    assert explicit[0][0] == 0


def test_raw_sql_without_context_returns_nothing(two_orgs_with_data):
    for table in TABLES:
        assert raw(f"SELECT count(*) FROM {table}")[0][0] == 0, table


def test_raw_sql_by_id_of_org_b_point_is_invisible_from_org_a(two_orgs_with_data):
    org_a, org_b = two_orgs_with_data
    point_id_b = raw("SELECT point_id FROM tracking_locationpoint LIMIT 1", org_id=org_b.id)[0][0]
    assert raw("SELECT * FROM tracking_locationpoint WHERE point_id = %s", [str(point_id_b)], org_id=org_a.id) == []


def test_raw_update_and_delete_cannot_touch_org_b(two_orgs_with_data):
    org_a, org_b = two_orgs_with_data
    with transaction.atomic(using="app"):
        with connections["app"].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_org', %s, true)", [str(org_a.id)])
            cursor.execute("UPDATE tracking_locationpoint SET accuracy_m = 999 WHERE organization_id = %s", [str(org_b.id)])
            assert cursor.rowcount == 0
            cursor.execute("DELETE FROM workdays_workday WHERE organization_id = %s", [str(org_b.id)])
            assert cursor.rowcount == 0

    # Y siguen intactas vistas desde B.
    assert raw("SELECT count(*) FROM tracking_locationpoint WHERE accuracy_m = 999", org_id=org_b.id)[0][0] == 0
    assert raw("SELECT count(*) FROM workdays_workday", org_id=org_b.id)[0][0] == 1


def test_raw_insert_into_org_b_from_org_a_context_is_rejected(two_orgs_with_data):
    """WITH CHECK: no se puede escribir una fila de otra empresa, ni siquiera a mano."""
    org_a, org_b = two_orgs_with_data
    workday_b, driver_b, device_b = raw(
        "SELECT id, driver_id, device_id FROM workdays_workday LIMIT 1", org_id=org_b.id
    )[0]
    with pytest.raises(DatabaseError, match="row-level security"):
        with transaction.atomic(using="app"):
            with connections["app"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_org', %s, true)", [str(org_a.id)])
                cursor.execute(
                    "INSERT INTO tracking_locationpoint (organization_id, point_id, workday_id, driver_id, "
                    "device_id, location, accuracy_m, source, event, recorded_at, received_at) VALUES "
                    "(%s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(-58.4, -34.6), 4326)::geography, 5, "
                    "'FOREGROUND', '', now(), now())",
                    [str(org_b.id), str(uuid.uuid4()), str(workday_b), str(driver_b), str(device_b)],
                )


def test_composite_fk_blocks_linking_rows_across_orgs(two_orgs_with_data):
    """Aunque se escriba con organization_id = A, no se puede apuntar a una jornada de B."""
    org_a, org_b = two_orgs_with_data
    workday_b = raw("SELECT id FROM workdays_workday LIMIT 1", org_id=org_b.id)[0][0]
    driver_a, device_a = raw("SELECT driver_id, device_id FROM workdays_workday LIMIT 1", org_id=org_a.id)[0]
    with pytest.raises(DatabaseError):
        with transaction.atomic(using="app"):
            with connections["app"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_org', %s, true)", [str(org_a.id)])
                cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
                cursor.execute(
                    "INSERT INTO tracking_locationpoint (organization_id, point_id, workday_id, driver_id, "
                    "device_id, location, accuracy_m, source, event, recorded_at, received_at) VALUES "
                    "(%s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(-58.4, -34.6), 4326)::geography, 5, "
                    "'FOREGROUND', '', now(), now())",
                    [str(org_a.id), str(uuid.uuid4()), str(workday_b), str(driver_a), str(device_a)],
                )
