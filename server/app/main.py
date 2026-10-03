import secrets
import asyncio
from contextlib import suppress
import time
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .ai import Interpreter
from .config import settings
from .db import AgentMessage, Base, Event, Intent, LoginSession, User, UserMemory, engine, get_db
from .schemas import AgentTurnRequest, CoachRequest, CreateIntent, Interpretation, Login, MemoryData, UpdateIntent
from .security import RateLimiter, hash_password, token_hash, verify_password
from .accounts import AccountProfile, register_accounts

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


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
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
    return user


def serialize_intent(intent: Intent):
    return {**intent.data, "id": intent.id, "version": intent.version,
            "createdAt": intent.created_at, "updatedAt": intent.updated_at}


def memory_for(user_id: str, db: Session) -> MemoryData:
    row = db.get(UserMemory, user_id)
    return MemoryData.model_validate(row.data if row else {})


def serialize_message(message: AgentMessage):
    return {"id": message.id, "role": message.role, "text": message.text, "createdAt": message.created_at}


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "application": "intent-agent"}


@app.post("/api/auth/login")
def login(body: Login, request: Request, response: Response, db: Session = Depends(get_db)):
    username = body.username.lower()
    limiter.check("login:global", 100)
    limiter.check("login:" + username, 10)
    user = db.scalar(select(User).where(User.username == username))
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
    response.set_cookie(COOKIE, token, httponly=True, secure=settings.cookie_secure,
                        samesite="strict", max_age=settings.session_seconds, path="/api")
    return {"id": user.id, "username": user.username, "expiresAt": expires, "admin": bool(profile and profile.admin)}


@app.get("/api/auth/me")
def me(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    login_session = db.get(LoginSession, token_hash(request.cookies[COOKIE]))
    profile = db.get(AccountProfile, user.id)
    return {"id": user.id, "username": user.username, "expiresAt": login_session.expires_at, "admin": bool(profile and profile.admin)}


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE)
    if token:
        db.execute(delete(PushSubscription).where(PushSubscription.session_hash == token_hash(token)))
        db.execute(delete(LoginSession).where(LoginSession.token_hash == token_hash(token)))
        db.commit()
    response.delete_cookie(COOKIE, path="/api", secure=settings.cookie_secure, httponly=True, samesite="strict")


@app.get("/api/intents")
def list_intents(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Intent).where(Intent.user_id == user.id).order_by(Intent.created_at.desc()))
    return [serialize_intent(row) for row in rows]


@app.post("/api/intents", status_code=201)
def create_intent(body: CreateIntent, user: User = Depends(current_user), db: Session = Depends(get_db)):
    data = body.model_dump(mode="json", exclude={"id"})
    existing = db.get(Intent, str(body.id))
    if existing:
        if existing.user_id == user.id and existing.data == data:
            return serialize_intent(existing)
        raise HTTPException(409, "Эта цель уже сохранена. Обновите список.")
    row = Intent(id=str(body.id), user_id=user.id, data=data)
    db.add(row)
    db.add(Event(user_id=user.id, intent_id=row.id, message=f"Создана цель «{body.title}»"))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Эта цель уже сохранена. Обновите список.")
    return serialize_intent(row)


@app.put("/api/intents/{intent_id}")
def update_intent(intent_id: UUID, body: UpdateIntent, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(Intent).where(Intent.id == str(intent_id), Intent.user_id == user.id))
    if not row:
        raise HTTPException(404, "Цель не найдена.")
    data = body.model_dump(mode="json", exclude={"version"})
    now = time.time()
    result = db.execute(update(Intent).where(Intent.id == str(intent_id), Intent.user_id == user.id,
                                            Intent.version == body.version)
                        .values(data=data, version=body.version + 1, updated_at=now)
                        .execution_options(synchronize_session=False))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Цель изменена на другом устройстве. Обновите список и повторите действие.")
    labels = {"active": "Возобновлена", "paused": "Отложена", "completed": "Завершена", "cancelled": "Отменена"}
    action = labels[body.status] if row.data["status"] != body.status else "Обновлена"
    db.add(Event(user_id=user.id, intent_id=str(intent_id), message=f"{action} цель «{body.title}»"))
    db.commit()
    db.refresh(row)
    return serialize_intent(row)


@app.get("/api/events")
def events(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Event).where(Event.user_id == user.id).order_by(Event.created_at.desc()).limit(100))
    return [{"id": row.id, "intentId": row.intent_id, "message": row.message, "createdAt": row.created_at} for row in rows]


@app.get("/api/memory")
def get_memory(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return memory_for(user.id, db)


@app.put("/api/memory")
def update_memory(body: MemoryData, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.get(UserMemory, user.id)
    if row:
        row.data = body.model_dump()
        row.updated_at = time.time()
    else:
        db.add(UserMemory(user_id=user.id, data=body.model_dump()))
    db.add(Event(user_id=user.id, intent_id="memory", message="Обновлена память персонального агента"))
    db.commit()
    return body


@app.get("/api/agent/messages")
def agent_messages(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(AgentMessage).where(AgentMessage.user_id == user.id)
                           .order_by(AgentMessage.created_at.desc()).limit(50)))
    return [serialize_message(row) for row in reversed(rows)]


@app.delete("/api/agent/messages", status_code=204)
def clear_agent_messages(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(delete(AgentMessage).where(AgentMessage.user_id == user.id))
    db.commit()


@app.post("/api/agent/respond")
async def agent_respond(body: AgentTurnRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    limiter.check("ai:" + user.id, 6)
    prior = list(db.scalars(select(AgentMessage).where(AgentMessage.user_id == user.id)
                            .order_by(AgentMessage.created_at.desc()).limit(8)))
    context = [{"role": row.role, "content": row.text} for row in reversed(prior)]
    context.append({"role": "user", "content": body.text})
    result = await interpreter.converse(context, memory_for(user.id, db))
    created_at = time.time()
    user_message = AgentMessage(user_id=user.id, role="user", text=body.text, created_at=created_at)
    assistant_message = AgentMessage(user_id=user.id, role="assistant", text=result.message, created_at=created_at + 0.000001)
    db.add_all([user_message, assistant_message])
    db.commit()
    return {"userMessage": serialize_message(user_message), "assistantMessage": serialize_message(assistant_message),
            "response": result}


@app.post("/api/intents/{intent_id}/coach")
async def coach_intent(intent_id: UUID, body: CoachRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    limiter.check("ai:" + user.id, 6)
    row = db.scalar(select(Intent).where(Intent.id == str(intent_id), Intent.user_id == user.id))
    if not row:
        raise HTTPException(404, "Цель не найдена.")
    result = await interpreter.coach(serialize_intent(row), memory_for(user.id, db), body.note)
    db.add(Event(user_id=user.id, intent_id=row.id, message=f"Агент предложил следующий шаг для цели «{row.data['title']}»"))
    db.commit()
    return result


@app.post("/api/interpret")
async def interpret(body: Interpretation, user: User = Depends(current_user)):
    limiter.check("ai:" + user.id, 6)
    return await interpreter.interpret(body.text)


from .planner_api import register_planner
register_planner(app, current_user, interpreter, memory_for, limiter)
from .invitations import register_invitations
register_invitations(app, current_user, limiter)
from .push import PushSubscription, register_push, reminder_loop
register_push(app, current_user)
register_accounts(app, current_user, limiter)
