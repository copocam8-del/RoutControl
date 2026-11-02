"""Mapa en vivo por WebSocket (ADR-017): quién se suscribe, qué se publica y a quién."""

import asyncio
from datetime import timedelta

import pytest
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.conf import settings

from apps.drivers.models import DriverProfile
from apps.tenancy.context import tenant_context
from apps.tenancy.models import Membership
from apps.tracking import live
from config.asgi import application
from tests.conftest import access_token_for, make_point, make_user, now_utc, start_workday, tracking_client

BATCH = "/api/v1/tracking/batch"


# ---------- autorización (con la base, como en la conexión real) ----------


def test_staff_token_is_authorized_for_its_own_org(org_a):
    assert live.authorize_staff(access_token_for(org_a.owner, org_a.org)) == org_a.id


def test_driver_token_is_not_authorized(org_a):
    assert live.authorize_staff(access_token_for(org_a.driver, org_a.org)) is None


def test_token_for_an_org_without_membership_is_not_authorized(org_a, org_b):
    # El dueño de A con un token que dice "empresa B": no tiene membresía en B.
    assert live.authorize_staff(access_token_for(org_a.owner, org_b.org)) is None


def test_inactive_membership_and_garbage_are_not_authorized(org_a):
    supervisor = make_user("super@org-a.test")
    with tenant_context(org_a.id):
        m = Membership.objects.create(user=supervisor, role=Membership.Role.SUPERVISOR)
    assert live.authorize_staff(access_token_for(supervisor, org_a.org)) == org_a.id
    with tenant_context(org_a.id):
        assert Membership.objects.filter(id=m.id).update(status=Membership.Status.DISABLED) == 1
    assert live.authorize_staff(access_token_for(supervisor, org_a.org)) is None
    assert live.authorize_staff("no-es-un-token") is None
    assert live.authorize_staff("") is None


# ---------- consumidor (sin base: la autorización se reemplaza) ----------


@pytest.fixture
def fake_auth(monkeypatch, org_a, org_b):
    tokens = {"token-a": org_a.id, "token-b": org_b.id}
    monkeypatch.setattr(live, "authorize_staff", lambda raw: tokens.get(raw))
    return tokens


async def _connect(access=None, origin=b"http://localhost"):
    ws = WebsocketCommunicator(application, "/ws/live", headers=[(b"origin", origin)])
    connected, _ = await ws.connect()
    assert connected
    if access is not None:
        await ws.send_json_to({"type": "auth", "access": access})
    return ws


def test_websocket_from_another_origin_or_without_origin_is_refused(fake_auth):
    async def scenario():
        for headers in ([(b"origin", b"https://pagina-ajena.example")], []):
            ws = WebsocketCommunicator(application, "/ws/live", headers=headers)
            connected, _ = await ws.connect()
            assert not connected
            await ws.disconnect()

    async_to_sync(scenario)()


def test_consumer_isolates_orgs(fake_auth, org_a, org_b):
    async def scenario():
        ws_a = await _connect("token-a")
        ws_b = await _connect("token-b")
        assert await ws_a.receive_json_from() == {"type": "ready"}
        assert await ws_b.receive_json_from() == {"type": "ready"}
        layer = get_channel_layer()
        event = {"type": "position", "driver_id": "x", "workday_id": "y", "lat": -34.6, "lng": -58.4, "recorded_at": "2026-11-02T10:00:00Z"}
        await layer.group_send(live.group_name(org_a.id), {"type": "live.event", "event": event})
        assert await ws_a.receive_json_from() == event
        assert await ws_b.receive_nothing(timeout=0.2)  # la empresa B no ve a la A
        await ws_a.disconnect()
        await ws_b.disconnect()

    async_to_sync(scenario)()


def test_consumer_rejects_bad_token(fake_auth):
    async def scenario():
        ws = await _connect("token-de-otro")
        assert (await ws.receive_json_from())["type"] == "error"
        assert (await ws.receive_output())["type"] == "websocket.close"
        await ws.disconnect()

    async_to_sync(scenario)()


def test_consumer_closes_when_first_message_is_not_auth(fake_auth):
    async def scenario():
        ws = await _connect()
        await ws.send_json_to({"type": "hola"})
        out = await ws.receive_output()
        assert out == {"type": "websocket.close", "code": 4401}
        await ws.disconnect()

    async_to_sync(scenario)()


def test_consumer_closes_without_auth_after_timeout(fake_auth, monkeypatch):
    monkeypatch.setattr(live, "AUTH_TIMEOUT_S", 0.05)

    async def scenario():
        ws = await _connect()
        out = await ws.receive_output(timeout=1)
        assert out == {"type": "websocket.close", "code": 4401}
        await ws.disconnect()

    async_to_sync(scenario)()


def test_consumer_disconnects_when_access_is_revoked(fake_auth, monkeypatch):
    monkeypatch.setattr(live, "REVALIDATE_S", 0.05)

    async def scenario():
        ws = await _connect("token-a")
        assert await ws.receive_json_from() == {"type": "ready"}
        fake_auth.pop("token-a")  # se le quitó el acceso (o se le venció el token)
        out = await ws.receive_output(timeout=1)
        assert out == {"type": "websocket.close", "code": 4403}
        await ws.disconnect()

    async_to_sync(scenario)()


# ---------- publicar desde el lote de puntos ----------


@pytest.fixture
def published(monkeypatch):
    sent = []
    monkeypatch.setattr(live, "publish", lambda org_id, event: sent.append((org_id, event)))
    return sent


def test_batch_publishes_latest_new_point_to_its_org_after_commit(org_a, published, django_capture_on_commit_callbacks):
    started = now_utc() - timedelta(hours=1)
    wd = start_workday(org_a.driver, org_a.org, started_at=started)
    client = tracking_client(wd["tracking_token"])
    early = make_point(started + timedelta(minutes=1), lat=-34.60, lng=-58.38)
    late = make_point(started + timedelta(minutes=2), lat=-34.61, lng=-58.39)
    with django_capture_on_commit_callbacks(using=settings.APP_DB_ALIAS, execute=True):
        assert client.post(BATCH, [late, early], format="json").status_code == 200
    assert len(published) == 1
    org_id, event = published[0]
    assert org_id == org_a.id
    with tenant_context(org_a.id):
        assert event["driver_id"] == str(DriverProfile.objects.get(membership__user=org_a.driver).id)
    assert (event["lat"], event["lng"]) == (-34.61, -58.39)
    assert event["recorded_at"] == late["recorded_at"]
    # Reenviar el mismo lote no publica nada: no hay puntos nuevos.
    with django_capture_on_commit_callbacks(using=settings.APP_DB_ALIAS, execute=True):
        client.post(BATCH, [late, early], format="json")
    assert len(published) == 1


def test_batch_of_org_b_publishes_only_to_org_b(org_a, org_b, published, django_capture_on_commit_callbacks):
    started = now_utc() - timedelta(hours=1)
    wd = start_workday(org_b.driver, org_b.org, started_at=started)
    with django_capture_on_commit_callbacks(using=settings.APP_DB_ALIAS, execute=True):
        tracking_client(wd["tracking_token"]).post(BATCH, [make_point(started + timedelta(minutes=1))], format="json")
    assert [org for org, _ in published] == [org_b.id]


def test_publish_failure_never_breaks_ingestion(org_a, monkeypatch, django_capture_on_commit_callbacks):
    class Broken:
        async def group_send(self, *a, **k):
            raise ConnectionError("redis caído")

    monkeypatch.setattr(live, "get_channel_layer", lambda: Broken())
    started = now_utc() - timedelta(hours=1)
    wd = start_workday(org_a.driver, org_a.org, started_at=started)
    point = make_point(started + timedelta(minutes=1))
    with django_capture_on_commit_callbacks(using=settings.APP_DB_ALIAS, execute=True):
        response = tracking_client(wd["tracking_token"]).post(BATCH, [point], format="json")
    assert response.status_code == 200
    assert response.json()["accepted"] == [point["point_id"]]
