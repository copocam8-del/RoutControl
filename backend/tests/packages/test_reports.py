"""Informes por repartidor y por empresa (ADR-024)."""

import io
from datetime import date, timedelta

import pytest
from openpyxl import load_workbook

from apps.packages import reports
from tests.conftest import client_for, iso, make_point, now_utc, start_workday, tracking_client
from tests.packages.test_second_attempt import fail, pkg

URL = "/api/v1/reports"


def around_now():
    """Un rango que incluye "hoy" en cualquier zona horaria (sin depender de la hora en que corre)."""
    return {"period": "range", "from": (now_utc() - timedelta(days=3)).date().isoformat(), "to": (now_utc() + timedelta(days=1)).date().isoformat()}


@pytest.mark.parametrize(
    "kind,anchor,first,last,label",
    [
        ("day", date(2026, 11, 2), date(2026, 11, 2), date(2026, 11, 2), "2/11/2026"),
        # 2/11/2026 es lunes: la semana va de lunes a domingo.
        ("week", date(2026, 11, 4), date(2026, 11, 2), date(2026, 11, 8), "Semana del 2/11/2026 al 8/11/2026"),
        ("fortnight", date(2026, 11, 15), date(2026, 11, 1), date(2026, 11, 15), "Primera quincena de noviembre de 2026"),
        ("fortnight", date(2027, 2, 16), date(2027, 2, 16), date(2027, 2, 28), "Segunda quincena de febrero de 2027"),
        ("month", date(2026, 11, 20), date(2026, 11, 1), date(2026, 11, 30), "Noviembre de 2026"),
    ],
)
def test_periods(kind, anchor, first, last, label):
    p = reports.period(kind, anchor)
    assert (p.first, p.last, p.label) == (first, last, label)


def test_range_validation():
    assert reports.period("range", date(2026, 1, 1), date(2026, 1, 1), date(2026, 1, 31)).label == "Del 1/1/2026 al 31/1/2026"
    for first, last in [(date(2026, 2, 1), date(2026, 1, 1)), (date(2026, 1, 1), date(2027, 2, 1)), (None, None)]:
        with pytest.raises(reports.ReportError):
            reports.period("range", date(2026, 1, 1), first, last)


def _day_with_activity(fx):
    """Una jornada con ~1 km recorrido, un hueco sin señal (que no suma km) y 3 visitas."""
    started = now_utc() - timedelta(hours=2)
    wd = start_workday(fx.driver, fx.org, started_at=started)
    t = tracking_client(wd["tracking_token"])
    points = [
        make_point(started + timedelta(minutes=1), lat=-34.6083, lng=-58.3712),
        make_point(started + timedelta(minutes=3), lat=-34.6083, lng=-58.3821),  # ~1 km al oeste
        # 40 minutos sin datos: hueco. El salto de ~10 km no se suma.
        make_point(started + timedelta(minutes=43), lat=-34.55, lng=-58.47),
    ]
    assert t.post("/api/v1/tracking/batch", points, format="json").status_code == 200
    delivered = pkg(fx, "D1", (-34.6, -58.38))
    import uuid

    body = {"id": str(uuid.uuid4()), "package_id": delivered["id"], "started_at": iso(started + timedelta(minutes=5)),
            "ended_at": iso(started + timedelta(minutes=9)), "outcome": "DELIVERED"}
    assert client_for(fx.driver, fx.org).post("/api/v1/visits", body, format="json").status_code in (200, 201)
    fail(fx, pkg(fx, "F1", (-34.61, -58.39)))  # nadie responde: del destinatario
    wrong = pkg(fx, "F2", (-34.62, -58.4))
    body = {"id": str(uuid.uuid4()), "package_id": wrong["id"], "started_at": iso(started + timedelta(minutes=20)),
            "ended_at": iso(started + timedelta(minutes=22)), "outcome": "WRONG_ADDRESS"}
    assert client_for(fx.driver, fx.org).post("/api/v1/visits", body, format="json").status_code in (200, 201)
    return wd


def test_daily_report_per_driver_and_company(org_a):
    _day_with_activity(org_a)
    r = client_for(org_a.owner, org_a.org).get(URL, around_now())
    assert r.status_code == 200
    body = r.json()
    assert len(body["drivers"]) == 1  # el otro repartidor no tuvo actividad
    row = body["drivers"][0]
    assert row["workdays"] == 1 and row["visits"] == 3
    assert row["delivered"] == 1 and row["failed"] == 2 and row["failed_recipient"] == 1 and row["failed_logistic"] == 1
    assert row["delivery_rate"] == pytest.approx(1 / 3, abs=0.001)
    assert 0.9 < row["distance_km"] < 1.1  # el salto después del hueco no cuenta
    assert row["no_signal_minutes"] >= 39
    assert row["avg_visit_minutes"] == pytest.approx(2.7, abs=0.1)  # 4, 2 y 2 minutos
    assert body["total"]["visits"] == 3 and body["period"]["kind"] == "range"
    # Otro período sin actividad: vacío.
    last_month = (now_utc() - timedelta(days=40)).date().isoformat()
    assert client_for(org_a.owner, org_a.org).get(URL, {"period": "month", "date": last_month}).json()["drivers"] == []


def test_drivers_only_see_their_own_report(org_a):
    _day_with_activity(org_a)
    own = client_for(org_a.driver, org_a.org).get(URL, around_now()).json()
    assert [d["driver"]["name"] for d in own["drivers"]] == ["driver1"]
    coworker = client_for(org_a.drivers[1], org_a.org).get(URL, around_now()).json()
    assert coworker["drivers"] == [] and coworker["total"]["visits"] == 0
    other_id = own["drivers"][0]["driver"]["id"]
    assert client_for(org_a.drivers[1], org_a.org).get(URL, {"driver": other_id}).status_code == 403


def test_export_csv_and_excel(org_a):
    _day_with_activity(org_a)
    owner = client_for(org_a.owner, org_a.org)
    csv = owner.get(f"{URL}/export", {**around_now(), "formato": "csv"})
    assert csv["Content-Type"].startswith("text/csv") and "attachment" in csv["Content-Disposition"]
    text = csv.content.decode("utf-8-sig")
    lines = text.strip().splitlines()
    assert lines[0].startswith("Informe: ") and lines[1].startswith("Repartidor;Jornadas;Horas")
    assert lines[-1].startswith("Total de la empresa;1;")
    xlsx = owner.get(f"{URL}/export", around_now())
    ws = load_workbook(io.BytesIO(xlsx.content)).active
    assert ws.title == "Por repartidor" and ws["A2"].value == "Repartidor" and ws["A4"].value == "Total de la empresa"
    assert ws["F3"].value == 3  # visitas
    bad = owner.get(URL, {"period": "range", "from": "2026-02-01", "to": "2026-01-01"})
    assert bad.status_code == 400 and bad.json()["code"] == "bad_period"
