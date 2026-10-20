import secrets
import asyncio
from contextlib import suppress
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from .ai import Interpreter
from .config import settings
from .db import Base, LoginSession, User, UserMemory, engine, get_db
from .schemas import Login, MemoryData
from .security import RateLimiter, hash_password, token_hash, verify_password
from .accounts import AccountProfile, PhoneIdentity, normalize_identifier, register_accounts

COOKIE = "intent_session"
limiter = RateLimiter()
interpreter = Interpreter(settings)
DUMMY_HASH = hash_password("not-a-real-account")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initial schema only. Future schema changes require explicit migrations.
    Base.metadata.create_all(engine)
    worker = asyncio.create_task(reminder_loop())
    try:
        yield
    finally:
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker


app = FastAPI(title="Intent Agent API", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def protect_requests(request: Request, call_next):
    # Custom header + no CORS support prevents cross-origin browser writes.
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        if request.headers.get("X-Intent-Request") != "1" or request.headers.get("Sec-Fetch-Site") == "cross-site":
            return JSONResponse({"detail": "Запрос отклонён."}, status_code=403)
        try:
            length = int(request.headers.get("content-length", "0"))
        except ValueError:
            return JSONResponse({"detail": "Некорректный запрос."}, status_code=400)
        if length > (4_000_000 if request.url.path == "/api/planner" else 32768):
            return JSONResponse({"detail": "Запрос слишком большой."}, status_code=413)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def current_user(request: Request, response: Response, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE)
    login_session = db.get(LoginSession, token_hash(token)) if token else None
    if not login_session or login_session.expires_at < time.time():
        raise HTTPException(401, "Войдите в свой аккаунт.")
    user = db.get(User, login_session.user_id)
    if not user:
        raise HTTPException(401, "Войдите в свой аккаунт.")
    profile = db.get(AccountProfile, user.id)
    if profile and profile.blocked:
        raise HTTPException(401, "Аккаунт заблокирован. Обратитесь к администратору.")
    expected_user = request.headers.get("X-Intent-User")
    if expected_user and expected_user != user.id:
        raise HTTPException(401, "Аккаунт изменился в другой вкладке. Войдите снова.")
    if not profile:
        db.add(AccountProfile(user_id=user.id))
        db.commit()
    elif profile.last_seen < time.time() - 60:
        profile.last_seen = time.time()
        db.commit()
    if login_session.expires_at < time.time() + settings.session_seconds - 3600:
        login_session.expires_at = time.time() + settings.session_seconds
        db.commit()
        response.set_cookie(COOKIE, token, httponly=True, secure=settings.cookie_secure,
                            samesite="strict", max_age=settings.session_seconds, path="/api")
    return user


def memory_for(user_id: str, db: Session) -> MemoryData:
    # Memory was edited in the retired agent UI; existing rows still give the planner context.
    row = db.get(UserMemory, user_id)
    return MemoryData.model_validate(row.data if row else {})


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    # "ai" shows whether the cloud key was picked up after a deploy; it never exposes the key.
    return {"status": "ok", "application": "intent-agent", "ai": "cloud" if interpreter.cloud else "ollama"}


@app.post("/api/auth/login")
def login(body: Login, request: Request, response: Response, db: Session = Depends(get_db)):
    username = normalize_identifier(body.username)
    limiter.check("login:global", 100)
    limiter.check("login:" + username, 10)
    user = db.scalar(select(User).where(User.username == username))
    if not user and username.startswith("+"):
        identity = db.get(PhoneIdentity, username)
        user = db.get(User, identity.user_id) if identity else None
    valid = verify_password(body.password, user.password_hash if user else DUMMY_HASH)
    if not user or not valid:
        raise HTTPException(401, "Неверный логин или пароль.")
    profile = db.get(AccountProfile, user.id)
    if profile and profile.blocked:
        raise HTTPException(403, "Аккаунт заблокирован. Обратитесь к администратору.")
    old_token = request.cookies.get(COOKIE)
    if old_token:
        db.execute(delete(LoginSession).where(LoginSession.token_hash == token_hash(old_token)))
    db.execute(delete(LoginSession).where(LoginSession.expires_at < time.time()))
    token = secrets.token_urlsafe(32)
    expires = time.time() + settings.session_seconds
    db.add(LoginSession(token_hash=token_hash(token), user_id=user.id, expires_at=expires))
    db.commit()
    phone = db.scalar(select(PhoneIdentity.phone).where(PhoneIdentity.user_id == user.id))
    response.set_cookie(COOKIE, token, httponly=True, secure=settings.cookie_secure,
                        samesite="strict", max_age=settings.session_seconds, path="/api")
    return {"id": user.id, "username": user.username, "phone": phone, "expiresAt": expires, "admin": bool(profile and profile.admin)}


@app.get("/api/auth/me")
def me(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    login_session = db.get(LoginSession, token_hash(request.cookies[COOKIE]))
    profile = db.get(AccountProfile, user.id)
    phone = db.scalar(select(PhoneIdentity.phone).where(PhoneIdentity.user_id == user.id))
    return {"id": user.id, "username": user.username, "phone": phone, "expiresAt": login_session.expires_at, "admin": bool(profile and profile.admin)}


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE)
    if token:
        db.execute(delete(PushSubscription).where(PushSubscription.session_hash == token_hash(token)))
        db.execute(delete(LoginSession).where(LoginSession.token_hash == token_hash(token)))
        db.commit()
    response.delete_cookie(COOKIE, path="/api", secure=settings.cookie_secure, httponly=True, samesite="strict")


from .planner_api import register_planner
register_planner(app, current_user, interpreter, memory_for, limiter)
from .invitations import register_invitations
register_invitations(app, current_user, limiter)
from .push import PushSubscription, register_push, reminder_loop
register_push(app, current_user)
register_accounts(app, current_user, limiter)
