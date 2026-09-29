import time
import uuid
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import LoginSession
from app.main import app
from app.schemas import AgentResponse, CoachResponse


def goal():
    return {"id": str(uuid.uuid4()), "title": "Начать бегать", "summary": "Короткие пробежки", "rawText": "Хочу бегать",
            "kind": "activity", "status": "active",
            "steps": [{"id": str(uuid.uuid4()), "title": "Выбрать маршрут", "isCompleted": False}]}


def editable(data):
    return {key: value for key, value in data.items() if key not in {"id", "createdAt", "updatedAt"}}


def test_auth_cookie_logout_and_expiry(clients):
    alice, _, sessions = clients
    assert alice.get("/api/auth/me").json()["username"] == "alice"
    result = alice.post("/api/auth/login", json={"username": "alice", "password": "test-password-123"})
    assert "HttpOnly" in result.headers["set-cookie"]
    assert "SameSite=strict" in result.headers["set-cookie"]
    assert alice.post("/api/auth/logout").status_code == 204
    assert alice.get("/api/intents").status_code == 401
    alice.post("/api/auth/login", json={"username": "alice", "password": "test-password-123"})
    with sessions() as db:
        for session in db.scalars(select(LoginSession)):
            session.expires_at = time.time() - 1
        db.commit()
    assert alice.get("/api/auth/me").status_code == 401


def test_ownership_isolation_including_journal_and_id_collision(clients):
    alice, bob, _ = clients
    payload = goal()
    created = alice.post("/api/intents", json=payload)
    assert created.status_code == 201
    assert len(alice.get("/api/intents").json()) == 1
    assert bob.get("/api/intents").json() == []
    assert bob.get("/api/events").json() == []
    assert bob.put(f"/api/intents/{payload['id']}", json=editable(created.json())).status_code == 404
    assert bob.post("/api/intents", json=payload).status_code == 409


def test_idempotent_create_and_optimistic_update(clients):
    alice, _, _ = clients
    payload = goal()
    first = alice.post("/api/intents", json=payload).json()
    retry = alice.post("/api/intents", json=payload).json()
    assert first == retry
    assert len(alice.get("/api/events").json()) == 1
    changed = editable(first)
    changed["steps"][0]["isCompleted"] = True
    updated = alice.put(f"/api/intents/{first['id']}", json=changed)
    assert updated.status_code == 200
    assert updated.json()["version"] == 2
    assert updated.json()["steps"][0]["isCompleted"] is True
    assert alice.put(f"/api/intents/{first['id']}", json=changed).status_code == 409
    assert len(alice.get("/api/events").json()) == 2


def test_cross_origin_writes_and_missing_header_rejected(clients):
    alice, _, _ = clients
    response = alice.post("/api/intents", json=goal(), headers={"Sec-Fetch-Site": "cross-site"})
    assert response.status_code == 403
    with TestClient(app) as anonymous:
        assert anonymous.post("/api/auth/login", json={"username": "alice", "password": "x"}).status_code == 403


def test_validation_and_no_private_cache(clients):
    alice, _, _ = clients
    invalid = goal()
    invalid["title"] = "  "
    assert alice.post("/api/intents", json=invalid).status_code == 422
    invalid = goal()
    invalid["steps"].append(invalid["steps"][0])
    assert alice.post("/api/intents", json=invalid).status_code == 422
    assert alice.post("/api/interpret", json={"text": "x" * 2001}).status_code == 422
    assert alice.get("/api/intents").headers["cache-control"] == "no-store"


def test_login_rate_limit(clients):
    alice, _, _ = clients
    for _ in range(9):
        assert alice.post("/api/auth/login", json={"username": "alice", "password": "wrong"}).status_code == 401
    assert alice.post("/api/auth/login", json={"username": "alice", "password": "wrong"}).status_code == 429


def test_stale_tab_cannot_write_as_a_different_account(clients):
    alice, bob, _ = clients
    alice_id = alice.get("/api/auth/me").json()["id"]
    assert bob.post("/api/intents", json=goal(), headers={"X-Intent-User": alice_id}).status_code == 401
    assert bob.get("/api/intents").json() == []


def test_agent_memory_is_private_and_editable(clients):
    alice, bob, _ = clients
    memory = {
        "displayName": "Алексей",
        "about": "Учусь бегать",
        "preferences": "Короткие шаги",
        "availability": "Вечером",
    }
    assert alice.put("/api/memory", json=memory).json() == memory
    assert alice.get("/api/memory").json() == memory
    assert bob.get("/api/memory").json() == {
        "displayName": "", "about": "", "preferences": "", "availability": ""
    }


def test_agent_conversation_is_persisted_per_account_and_can_be_cleared(clients):
    alice, bob, _ = clients
    answer = AgentResponse(
        mode="clarification",
        message="Сколько времени вы готовы уделять?",
    )
    with patch("app.main.interpreter.converse", new=AsyncMock(return_value=answer)) as converse:
        response = alice.post("/api/agent/respond", json={"text": "Хочу бегать"})
    assert response.status_code == 200
    assert response.json()["response"]["mode"] == "clarification"
    assert [item["role"] for item in alice.get("/api/agent/messages").json()] == ["user", "assistant"]
    assert bob.get("/api/agent/messages").json() == []
    assert converse.await_args.args[0][-1] == {"role": "user", "content": "Хочу бегать"}
    assert alice.delete("/api/agent/messages").status_code == 204
    assert alice.get("/api/agent/messages").json() == []


def test_coach_uses_owned_goal_and_writes_journal_event(clients):
    alice, bob, _ = clients
    created = alice.post("/api/intents", json=goal()).json()
    answer = CoachResponse(message="Начните с малого.", nextStep="Пройти 10 минут", encouragement="Этого достаточно.")
    with patch("app.main.interpreter.coach", new=AsyncMock(return_value=answer)) as coach:
        response = alice.post(f"/api/intents/{created['id']}/coach", json={"note": ""})
    assert response.status_code == 200
    assert response.json()["nextStep"] == "Пройти 10 минут"
    assert coach.await_args.args[0]["id"] == created["id"]
    assert len(alice.get("/api/events").json()) == 2
    assert bob.post(f"/api/intents/{created['id']}/coach", json={"note": ""}).status_code == 404
