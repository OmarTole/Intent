import time

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import LoginSession
from app.main import app

EMPTY_PLANNER = {"version": 0}


def test_phone_registration_and_long_session(clients):
    alice, _, _ = clients
    created = alice.post('/api/auth/register', json={"email": "+7 (701) 123-45-67", "password": "phone-login-password"})
    assert created.status_code == 201
    login = alice.post('/api/auth/login', json={"username": "+7 701 123 45 67", "password": "phone-login-password"})
    assert login.status_code == 200
    assert login.json()['username'] == '+77011234567'
    assert login.json()['expiresAt'] - time.time() > 9 * 365 * 24 * 3600


def test_existing_account_can_add_phone_and_login_with_it(clients):
    alice, _, _ = clients
    linked = alice.put('/api/auth/phone', json={"phone": "+77011234567", "password": "test-password-123"})
    assert linked.status_code == 200
    assert alice.get('/api/auth/me').json()['phone'] == '+77011234567'
    assert alice.post('/api/auth/login', json={"username": "+7 701 123 45 67", "password": "test-password-123"}).status_code == 200


def test_active_legacy_session_is_extended_on_use(clients):
    alice, _, sessions = clients
    with sessions() as db:
        session = db.scalar(select(LoginSession))
        session.expires_at = time.time() + 5 * 86400
        db.commit()
    response = alice.get('/api/auth/me')
    assert response.status_code == 200
    assert response.json()['expiresAt'] - time.time() > 9 * 365 * 24 * 3600
    assert 'Max-Age=315360000' in response.headers['set-cookie']


def test_auth_cookie_logout_and_expiry(clients):
    alice, _, sessions = clients
    assert alice.get("/api/auth/me").json()["username"] == "alice"
    result = alice.post("/api/auth/login", json={"username": "alice", "password": "test-password-123"})
    assert "HttpOnly" in result.headers["set-cookie"]
    assert "SameSite=strict" in result.headers["set-cookie"]
    assert alice.post("/api/auth/logout").status_code == 204
    assert alice.get("/api/planner").status_code == 401
    alice.post("/api/auth/login", json={"username": "alice", "password": "test-password-123"})
    with sessions() as db:
        for session in db.scalars(select(LoginSession)):
            session.expires_at = time.time() - 1
        db.commit()
    assert alice.get("/api/auth/me").status_code == 401


def test_cross_origin_writes_and_missing_header_rejected(clients):
    alice, _, _ = clients
    response = alice.put("/api/planner", json=EMPTY_PLANNER, headers={"Sec-Fetch-Site": "cross-site"})
    assert response.status_code == 403
    with TestClient(app) as anonymous:
        assert anonymous.post("/api/auth/login", json={"username": "alice", "password": "x"}).status_code == 403


def test_no_private_cache(clients):
    alice, _, _ = clients
    assert alice.get("/api/planner").headers["cache-control"] == "no-store"


def test_login_rate_limit(clients):
    alice, _, _ = clients
    for _ in range(9):
        assert alice.post("/api/auth/login", json={"username": "alice", "password": "wrong"}).status_code == 401
    assert alice.post("/api/auth/login", json={"username": "alice", "password": "wrong"}).status_code == 429


def test_stale_tab_cannot_write_as_a_different_account(clients):
    alice, bob, _ = clients
    alice_id = alice.get("/api/auth/me").json()["id"]
    assert bob.put("/api/planner", json=EMPTY_PLANNER, headers={"X-Intent-User": alice_id}).status_code == 401
    assert bob.get("/api/planner").json()["version"] == 0
