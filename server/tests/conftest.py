import os

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["COOKIE_SECURE"] = "false"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, User, get_db
from app.main import app, limiter
from app.security import hash_password


@pytest.fixture
def clients():
    test_engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(test_engine)
    sessions = sessionmaker(test_engine, expire_on_commit=False)
    with sessions() as db:
        for username in ("alice", "bob"):
            db.add(User(username=username, password_hash=hash_password("test-password-123")))
        db.commit()

    def dependency():
        with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    limiter.entries.clear()
    alice = TestClient(app, headers={"X-Intent-Request": "1"})
    bob = TestClient(app, headers={"X-Intent-Request": "1"})
    for client, username in ((alice, "alice"), (bob, "bob")):
        assert client.post("/api/auth/login", json={"username": username, "password": "test-password-123"}).status_code == 200
    yield alice, bob, sessions
    alice.close()
    bob.close()
    app.dependency_overrides.clear()
    test_engine.dispose()
