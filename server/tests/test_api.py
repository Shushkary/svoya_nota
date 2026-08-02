import base64

import pytest
from fastapi.testclient import TestClient

from nota.adapters.llm_gateway import DisabledGateway
from nota.adapters.sqlite_repository import SqliteRepository
from nota.application.services import Limits, Services
from nota.domain.barcode import BarcodeProduct
from nota.presentation.api import build_app

PNG_1PX = base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082"
    )
).decode()


class FakeGateway:
    enabled = True
    provider = "fake"

    def __init__(self, reply: str):
        self.reply = reply
        self.calls = []

    def complete_text(self, system, user, max_tokens):
        self.calls.append(("text", user))
        return self.reply

    def complete_vision(self, system, user, image_data_url, max_tokens):
        self.calls.append(("vision", image_data_url[:30]))
        return self.reply


class FakeCatalog:
    source = "fake_catalog"

    def __init__(self):
        self.calls = []

    def find(self, code):
        self.calls.append(code)
        if code != "4006381333931":
            return None
        return BarcodeProduct(
            code=code,
            name="Тестовый продукт",
            brand="Тест",
            kcal_100g=120,
            protein_100g=5,
            fat_100g=4,
            carb_100g=15,
            source=self.source,
        )


@pytest.fixture()
def client_and_gateway(tmp_path):
    repo = SqliteRepository(str(tmp_path / "test.db"))
    gateway = FakeGateway(
        '{"description":"Суп","kcal":250,"protein_g":12,"fat_g":8,"carb_g":30,'
        '"confidence":0.7,"comment":"ок"}'
    )
    catalog = FakeCatalog()
    services = Services(repo, gateway, Limits(meal_text_per_day=2, meal_photo_per_day=1), catalog)
    app = build_app(services, "test", gateway.provider)
    return TestClient(app), gateway, catalog


def _register(client):
    token = client.post(
        "/api/register",
        json={"granted": True, "version": "2026-07-28-backup-v1"},
    ).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def _allow_ai(client, headers):
    response = client.put(
        "/api/consents/ai",
        json={"granted": True, "version": "2026-07-22-ai-v1"},
        headers=headers,
    )
    assert response.status_code == 200


def test_health_open(client_and_gateway):
    client, _, _ = client_and_gateway
    body = client.get("/health").json()
    assert body["ok"] is True


def test_health_reports_unavailable_repository():
    class UnhealthyRepository:
        def is_healthy(self):
            return False

    services = Services(UnhealthyRepository(), DisabledGateway())
    client = TestClient(build_app(services, "test", "disabled"))

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"ok": False, "version": "test"}


def test_private_api_responses_are_not_cached(client_and_gateway):
    client, _, _ = client_and_gateway
    response = client.get("/api/snapshot", headers=_register(client))
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_api_rejects_oversized_declared_body(client_and_gateway):
    client, _, _ = client_and_gateway
    response = client.post(
        "/api/meals/analyze",
        content="{}",
        headers={**_register(client), "Content-Length": "1500001"},
    )
    assert response.status_code == 413
    assert response.json()["error"] == "payload_too_large"


def test_auth_required(client_and_gateway):
    client, _, _ = client_and_gateway
    assert client.get("/api/snapshot").status_code == 401
    assert client.post("/api/sync", json={"entries": []}).status_code == 401


def test_registration_and_sync_require_current_data_consent(client_and_gateway):
    client, _, _ = client_and_gateway
    denied = client.post(
        "/api/register",
        json={"granted": False, "version": "2026-07-28-backup-v1"},
    )
    assert denied.status_code == 403
    assert denied.json()["error"] == "consent_required"

    headers = _register(client)
    revoked = client.put(
        "/api/consents/data",
        json={"granted": False, "version": "2026-07-28-backup-v1"},
        headers=headers,
    )
    assert revoked.status_code == 200
    blocked = client.post("/api/sync", json={"entries": []}, headers=headers)
    assert blocked.status_code == 403
    assert blocked.json()["error"] == "consent_required"

    restored = client.put(
        "/api/consents/data",
        json={"granted": True, "version": "2026-07-28-backup-v1"},
        headers=headers,
    )
    assert restored.status_code == 200
    assert client.get("/api/snapshot", headers=headers).status_code == 200


def test_sync_snapshot_roundtrip_and_idempotency(client_and_gateway):
    client, _, _ = client_and_gateway
    headers = _register(client)
    entries = [
        {"kind": "state", "clientId": "s1", "at": "2026-07-20T08:00:00", "payload": '{"calm":3}'},
        {"kind": "practice", "clientId": "p1", "at": "2026-07-20T08:10:00",
         "payload": '{"module":"accord","practiceId":"wave"}'},
        {"kind": "bad_kind", "clientId": "x", "at": "2026-07-20", "payload": "{}"},
    ]
    result = client.post("/api/sync", json={"entries": entries}, headers=headers).json()
    assert result["accepted"] == [
        {"kind": "state", "clientId": "s1"},
        {"kind": "practice", "clientId": "p1"},
    ]
    assert result["rejected"] == ["x"]

    # повторная отправка идемпотентна
    again = client.post("/api/sync", json={"entries": entries[:2]}, headers=headers).json()
    assert again["accepted"] == [
        {"kind": "state", "clientId": "s1"},
        {"kind": "practice", "clientId": "p1"},
    ]
    snapshot = client.get("/api/snapshot", headers=headers).json()["entries"]
    assert len(snapshot) == 2

    # чужой токен не видит данных
    other = _register(client)
    assert client.get("/api/snapshot", headers=other).json()["entries"] == []


def test_sync_keeps_newer_revision_and_returns_canonical_conflict(client_and_gateway):
    client, _, _ = client_and_gateway
    headers = _register(client)
    newer = {
        "kind": "meal", "clientId": "m1", "at": "2026-07-20T12:00:00Z",
        "updatedAt": "2026-07-20T12:02:00Z", "payload": '{"kcal":200}',
    }
    stale = {**newer, "updatedAt": "2026-07-20T12:01:00Z", "payload": '{"kcal":100}'}
    assert client.post("/api/sync", json={"entries": [newer]}, headers=headers).json()["accepted"] == [
        {"kind": "meal", "clientId": "m1"}
    ]

    result = client.post("/api/sync", json={"entries": [stale]}, headers=headers).json()

    assert result["accepted"] == []
    assert result["conflicts"] == [{
        "kind": "meal", "clientId": "m1", "at": "2026-07-20T12:00:00Z",
        "updatedAt": "2026-07-20T12:02:00Z", "payload": '{"kcal":200}',
    }]
    snapshot = client.get("/api/snapshot", headers=headers).json()["entries"]
    assert snapshot == result["conflicts"]


def test_meal_text_estimate_and_quota(client_and_gateway):
    client, gateway, _ = client_and_gateway
    headers = _register(client)
    denied = client.post("/api/meals/estimate", json={"description": "суп"}, headers=headers)
    assert denied.status_code == 403
    assert denied.json()["error"] == "consent_required"
    _allow_ai(client, headers)
    body = client.post(
        "/api/meals/estimate", json={"description": "гречка с курицей 300 г"}, headers=headers
    ).json()
    assert body["kcal"] == 250
    assert body["confidence"] == 0.7
    client.post("/api/meals/estimate", json={"description": "чай"}, headers=headers)
    denied = client.post("/api/meals/estimate", json={"description": "суп"}, headers=headers)
    assert denied.status_code == 429
    assert denied.json()["error"] == "quota_exceeded"


def test_meal_photo_analyze(client_and_gateway):
    client, gateway, _ = client_and_gateway
    headers = {**_register(client), "Idempotency-Key": "photo-test-key-0001"}
    _allow_ai(client, headers)
    ok = client.post(
        "/api/meals/analyze",
        json={"image": f"data:image/png;base64,{PNG_1PX}", "hint": "овсянка"},
        headers=headers,
    )
    assert ok.status_code == 200
    assert ok.json()["description"] == "Суп"
    assert ok.json()["trialLimit"] == 4
    assert ok.json()["trialRemaining"] == 3
    assert ok.json()["idempotentReplay"] is False
    replay = client.post(
        "/api/meals/analyze",
        json={"image": f"data:image/png;base64,{PNG_1PX}", "hint": "овсянка"},
        headers=headers,
    )
    assert replay.status_code == 200
    assert replay.json()["trialRemaining"] == 3
    assert replay.json()["idempotentReplay"] is True
    assert len([call for call in gateway.calls if call[0] == "vision"]) == 1
    status = client.get("/api/meals/photo-trial", headers=headers).json()
    assert status == {"photoLimit": 4, "photoUsed": 1, "photoRemaining": 3}
    bad = client.post(
        "/api/meals/analyze", json={"image": "data:text/html;base64,AAAA"}, headers=headers
    )
    assert bad.status_code == 422


def test_provider_failure_does_not_consume_text_quota(client_and_gateway):
    client, gateway, _ = client_and_gateway
    headers = _register(client)
    _allow_ai(client, headers)
    gateway.reply = "not json"
    failed = client.post("/api/meals/estimate", json={"description": "суп"}, headers=headers)
    assert failed.status_code == 502
    gateway.reply = (
        '{"description":"Суп","kcal":250,"protein_g":12,"fat_g":8,'
        '"carb_g":30,"confidence":0.7,"comment":"ок"}'
    )
    succeeded = client.post("/api/meals/estimate", json={"description": "суп"}, headers=headers)
    assert succeeded.status_code == 200


def test_disabled_gateway_fails_closed(tmp_path):
    repo = SqliteRepository(str(tmp_path / "d.db"))
    services = Services(repo, DisabledGateway())
    client = TestClient(build_app(services, "test", "disabled"))
    headers = _register(client)
    _allow_ai(client, headers)
    response = client.post("/api/meals/estimate", json={"description": "суп"}, headers=headers)
    assert response.status_code == 403
    assert response.json()["error"] == "feature_disabled"


def test_delete_me_wipes_data(client_and_gateway):
    client, _, _ = client_and_gateway
    headers = _register(client)
    client.post("/api/sync", json={"entries": [
        {"kind": "meal", "clientId": "m1", "at": "2026-07-20", "payload": "{}"}
    ]}, headers=headers)
    assert client.delete("/api/me", headers=headers).json()["deleted"] is True
    # Ответ первого DELETE мог потеряться после коммита: повтор не должен
    # оставлять клиент в бесконечном состоянии ожидания удаления.
    assert client.delete("/api/me", headers=headers).json()["deleted"] is True
    assert client.get("/api/snapshot", headers=headers).status_code == 401


def test_barcode_lookup_is_authenticated_cached_and_does_not_need_ai_consent(client_and_gateway):
    client, _, catalog = client_and_gateway
    headers = _register(client)
    denied = client.get("/api/products/barcode/4006381333931")
    assert denied.status_code == 401
    found = client.get("/api/products/barcode/4006381333931", headers=headers)
    assert found.status_code == 200
    assert found.json()["kcal100g"] == 120
    assert found.json()["source"] == "fake_catalog"
    replay = client.get("/api/products/barcode/4006381333931", headers=headers)
    assert replay.status_code == 200
    assert catalog.calls == ["4006381333931"]


def test_barcode_rejects_bad_checksum_before_catalog_call(client_and_gateway):
    client, _, catalog = client_and_gateway
    response = client.get("/api/products/barcode/4006381333932", headers=_register(client))
    assert response.status_code == 422
    assert response.json()["error"] == "bad_request"
    assert catalog.calls == []
