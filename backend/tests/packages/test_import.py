"""Importación genérica CSV/Excel con mapeo, vista previa y errores por fila (ADR-012)."""

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.drivers.models import DriverProfile
from apps.packages.importing import read_table, suggest_mapping
from apps.packages.models import ImportJob, Package
from apps.tenancy.context import tenant_context
from tests.conftest import client_for

URL = "/api/v1/imports/"

CSV = (
    "Nro de guía;Destinatario;Teléfono;Dirección;Localidad;Observaciones\n"
    "G-1;Ana Pérez;11 5555-0001;Av. Corrientes 1234;CABA;Timbre 3B\n"
    "G-2;Beto Gómez;;Calle Falsa 123;Lanús;\n"
    ";Sin código;;Mitre 500;Avellaneda;\n"
    "G-1;Repetido;;Belgrano 10;CABA;\n"
    "G-5;Sin dirección;;;;\n"
)


def upload(fx, content: bytes | str, name="envios.csv"):
    data = content.encode("utf-8") if isinstance(content, str) else content
    response = client_for(fx.owner, fx.org).post(URL, {"file": SimpleUploadedFile(name, data)}, format="multipart")
    return response


def xlsx(rows) -> bytes:
    from openpyxl import Workbook

    book = Workbook()
    for row in rows:
        book.active.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def test_upload_reads_headers_and_suggests_mapping(org_a):
    r = upload(org_a, CSV)
    assert r.status_code == 201
    job = r.json()["import"]
    assert job["headers"] == ["Nro de guía", "Destinatario", "Teléfono", "Dirección", "Localidad", "Observaciones"]
    assert job["total_rows"] == 5
    assert job["suggested_mapping"]["tracking_code"] == "Nro de guía"
    assert job["suggested_mapping"]["recipient_name"] == "Destinatario"
    assert job["suggested_mapping"]["recipient_phone"] == "Teléfono"
    assert job["suggested_mapping"]["address"] == "Dirección"
    assert job["suggested_mapping"]["locality"] == "Localidad"
    assert job["suggested_mapping"]["notes"] == "Observaciones"
    assert {f["key"] for f in job["fields"] if f["required"]} == {"tracking_code"}


def test_preview_reports_errors_per_row_and_creates_nothing(org_a):
    job = upload(org_a, CSV).json()["import"]
    r = client_for(org_a.owner, org_a.org).post(f"{URL}{job['id']}/preview", {"mapping": job["suggested_mapping"]}, format="json")
    assert r.status_code == 200
    assert r.json()["summary"] == {"total_rows": 5, "ok_rows": 2, "error_rows": 3}
    errors = {(e["row"], e["field"]) for e in r.json()["errors"]}
    assert errors == {(4, "tracking_code"), (5, "tracking_code"), (6, "address")}
    repeated = next(e for e in r.json()["errors"] if e["row"] == 5)
    assert "fila 2" in repeated["message"]
    with tenant_context(org_a.id):
        assert Package.objects.count() == 0


def test_confirm_creates_only_valid_rows_once_and_drops_the_raw_rows(org_a):
    job = upload(org_a, CSV).json()["import"]
    client = client_for(org_a.owner, org_a.org)
    r = client.post(f"{URL}{job['id']}/confirm", {"mapping": job["suggested_mapping"]}, format="json")
    result = r.json()["import"]
    assert result["status"] == "DONE" and result["ok_rows"] == 2 and result["error_rows"] == 3
    assert len(result["errors"]) == 3 and result["sample"] == []
    with tenant_context(org_a.id):
        created = {p.tracking_code: p for p in Package.objects.select_related("address")}
        assert set(created) == {"G-1", "G-2"}
        assert created["G-1"].source == "IMPORT" and str(created["G-1"].import_job_id) == job["id"]
        assert created["G-1"].address.raw_text == "Av. Corrientes 1234" and created["G-1"].address.locality == "CABA"
        assert ImportJob.objects.get(id=job["id"]).rows == []
    again = client.post(f"{URL}{job['id']}/confirm", {"mapping": job["suggested_mapping"]}, format="json")
    assert again.json()["import"]["ok_rows"] == 2
    with tenant_context(org_a.id):
        assert Package.objects.count() == 2  # no se importó dos veces


def test_existing_codes_are_reported_not_duplicated(org_a):
    client_for(org_a.owner, org_a.org).post(
        "/api/v1/packages/", {"tracking_code": "G-2", "address": {"raw_text": "X 1"}}, format="json"
    )
    job = upload(org_a, CSV).json()["import"]
    r = client_for(org_a.owner, org_a.org).post(f"{URL}{job['id']}/preview", {"mapping": job["suggested_mapping"]}, format="json")
    assert any(e["row"] == 3 and "Ya existe" in e["message"] for e in r.json()["errors"])


def test_comma_separated_latin1_and_street_number_columns(org_a):
    content = "codigo,calle,altura,cp,lat,lng\nX-1,Rivadavia,5000,1424,-34.6,-58.43\nX-2,Córdoba,950,,abc,-58\n"
    job = upload(org_a, content.encode("cp1252")).json()["import"]
    mapping = job["suggested_mapping"]
    assert (mapping["tracking_code"], mapping["street"], mapping["number"], mapping["postal_code"]) == ("codigo", "calle", "altura", "cp")
    r = client_for(org_a.owner, org_a.org).post(f"{URL}{job['id']}/preview", {"mapping": mapping}, format="json")
    assert r.json()["summary"]["ok_rows"] == 1
    assert {e["field"] for e in r.json()["errors"]} == {"lat"}
    assert r.json()["rows"][0]["values"]["lat"] == pytest.approx(-34.6)


def test_excel_with_numeric_codes_and_driver_by_email(org_a):
    content = xlsx([["Guía", "Dirección", "Repartidor"], [1001, "Mitre 100", org_a.driver.email], [1002, "Mitre 200", "nadie@x.test"]])
    job = upload(org_a, content, name="envios.xlsx").json()["import"]
    assert job["sample"][0][0] == "1001"  # no "1001.0"
    mapping = job["suggested_mapping"]
    assert mapping["driver_email"] == "Repartidor"
    client = client_for(org_a.owner, org_a.org)
    result = client.post(f"{URL}{job['id']}/confirm", {"mapping": mapping}, format="json").json()["import"]
    assert result["ok_rows"] == 1 and result["errors"][0]["field"] == "driver_email"
    with tenant_context(org_a.id):
        p = Package.objects.get(tracking_code="1001")
        assert p.status == "ASSIGNED" and p.assigned_driver == DriverProfile.objects.get(membership__user=org_a.driver)


def test_mapping_must_name_code_and_address(org_a):
    job = upload(org_a, CSV).json()["import"]
    client = client_for(org_a.owner, org_a.org)
    r = client.post(f"{URL}{job['id']}/preview", {"mapping": {"tracking_code": "Nro de guía"}}, format="json")
    assert r.status_code == 400 and r.json()["code"] == "missing_address"
    r = client.post(f"{URL}{job['id']}/preview", {"mapping": {"tracking_code": "No existe", "address": "Dirección"}}, format="json")
    assert r.json()["code"] == "unknown_column"


@pytest.mark.parametrize(
    "name, content, code",
    [("vacio.csv", "", "empty"), ("viejo.xls", "x", "old_excel"), ("roto.xlsx", "no soy excel", "unreadable")],
)
def test_unreadable_files_get_a_clear_message(org_a, name, content, code):
    r = upload(org_a, content, name=name)
    assert r.status_code == 400 and r.json()["code"] == code


def test_only_staff_can_import(org_a):
    response = client_for(org_a.driver, org_a.org).post(URL, {"file": SimpleUploadedFile("a.csv", b"a\n1")}, format="multipart")
    assert response.status_code == 403


def test_reader_and_suggestions_directly():
    headers, rows = read_table("x.csv", "Tracking Number\tAddress\tName\nT1\tStreet 1\tAnn\n".encode())
    assert headers == ["Tracking Number", "Address", "Name"] and rows == [["T1", "Street 1", "Ann"]]
    assert suggest_mapping(headers)["recipient_name"] == "Name"
