"""Account administration exposes usage counts, never personal planner content."""
import time
import re
from fastapi import Depends, HTTPException, Request
from pydantic import Field, field_validator
from sqlalchemy import Boolean, Float, ForeignKey, String, delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column
from .db import Base, LoginSession, User, get_db
from .planner import PlannerState
from .schemas import StrictModel
from .security import hash_password, verify_password


class AccountProfile(Base):
    __tablename__ = "account_profiles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    admin: Mapped[bool] = mapped_column(Boolean, default=False)
    blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    last_seen: Mapped[float] = mapped_column(Float, default=time.time)


class PhoneIdentity(Base):
    __tablename__ = "phone_identities"
    phone: Mapped[str] = mapped_column(String(16), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True, index=True)


class Registration(StrictModel):
    email: str = Field(min_length=5, max_length=80)
    password: str = Field(min_length=12, max_length=256)

    @field_validator("email")
    @classmethod
    def normalize_account_name(cls, value: str) -> str:
        value = value.strip()
        if "@" in value:
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
                raise ValueError("Введите корректный телефон в международном формате или почту.")
            return value.lower()
        digits = re.sub(r"[\s()\-]", "", value)
        if not re.fullmatch(r"\+[1-9]\d{7,14}", digits):
            raise ValueError("Введите телефон в международном формате, например +77011234567.")
        return digits


def normalize_identifier(value: str) -> str:
    value = value.strip()
    if "@" in value:
        return value.lower()
    return re.sub(r"[\s()\-]", "", value)


class BlockAccount(StrictModel):
    blocked: bool


class ResetPassword(StrictModel):
    password: str = Field(min_length=12, max_length=256)


class PhoneUpdate(StrictModel):
    phone: str = Field(min_length=8, max_length=24)
    password: str = Field(min_length=1, max_length=256)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        value = re.sub(r"[\s()\-]", "", value)
        if not re.fullmatch(r"\+[1-9]\d{7,14}", value):
            raise ValueError("Введите телефон в международном формате, например +77011234567.")
        return value


def register_accounts(app, current_user, limiter):
    def administrator(user: User = Depends(current_user), db: Session = Depends(get_db)):
        profile = db.get(AccountProfile, user.id)
        if not profile or not profile.admin:
            raise HTTPException(403, "Нужны права администратора.")
        return user

    @app.post('/api/auth/register', status_code=201)
    def register(body: Registration, request: Request, db: Session = Depends(get_db)):
        limiter.check('register:' + (request.client.host if request.client else 'unknown'), 5, 3600)
        user = User(username=body.email, password_hash=hash_password(body.password))
        db.add(user)
        try:
            db.flush()
            db.add(AccountProfile(user_id=user.id))
            if body.email.startswith("+"):
                db.add(PhoneIdentity(phone=body.email, user_id=user.id))
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Такой аккаунт или номер телефона уже зарегистрирован.")
        return {"id": user.id}

    @app.put('/api/auth/phone')
    def set_phone(body: PhoneUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
        if not verify_password(body.password, user.password_hash):
            raise HTTPException(401, "Пароль не подошёл.")
        owner = db.get(PhoneIdentity, body.phone)
        if owner and owner.user_id != user.id:
            raise HTTPException(409, "Этот номер уже связан с другим аккаунтом.")
        current = db.scalar(select(PhoneIdentity).where(PhoneIdentity.user_id == user.id))
        if current:
            current.phone = body.phone
        else:
            db.add(PhoneIdentity(phone=body.phone, user_id=user.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Этот номер уже связан с другим аккаунтом.")
        return {"phone": body.phone}

    @app.get('/api/admin/users')
    def users(admin: User = Depends(administrator), db: Session = Depends(get_db)):
        profiles = {p.user_id: p for p in db.scalars(select(AccountProfile))}
        planners = {p.user_id: p.data for p in db.scalars(select(PlannerState))}
        result = []
        for user in db.scalars(select(User)):
            p = profiles.get(user.id)
            data = planners.get(user.id, {})
            activities = data.get('activities', [])
            result.append(dict(id=user.id, email=user.username, admin=bool(p and p.admin), blocked=bool(p and p.blocked),
                               createdAt=p.created_at if p else None, lastSeen=p.last_seen if p else None,
                               tasks=sum(a.get('kind') == 'task' for a in activities),
                               habits=sum(a.get('kind') == 'habit' for a in activities),
                               events=sum(a.get('kind') == 'event' for a in activities),
                               completed=sum(m.get('status') == 'done' for m in data.get('marks', []))))
        return {"users": result, "active": {str(days): sum(bool(u['lastSeen'] and u['lastSeen'] >= time.time() - days * 86400) for u in result) for days in (1, 7, 30)}}

    @app.post('/api/admin/users/{user_id}/block', status_code=204)
    def block(user_id: str, body: BlockAccount, admin: User = Depends(administrator), db: Session = Depends(get_db)):
        if user_id == admin.id:
            raise HTTPException(400, "Нельзя заблокировать свой аккаунт.")
        if not db.get(User, user_id):
            raise HTTPException(404, "Пользователь не найден.")
        profile = db.get(AccountProfile, user_id)
        if not profile:
            profile = AccountProfile(user_id=user_id)
            db.add(profile)
        profile.blocked = body.blocked
        if body.blocked:
            revoke(db, user_id)
        db.commit()

    @app.post('/api/admin/users/{user_id}/reset-password', status_code=204)
    def reset(user_id: str, body: ResetPassword, admin: User = Depends(administrator), db: Session = Depends(get_db)):
        user = db.get(User, user_id)
        if not user:
            raise HTTPException(404, "Пользователь не найден.")
        user.password_hash = hash_password(body.password)
        revoke(db, user_id)
        db.commit()


def revoke(db, user_id):
    from .push import PushSubscription
    db.execute(delete(LoginSession).where(LoginSession.user_id == user_id))
    db.execute(delete(PushSubscription).where(PushSubscription.user_id == user_id))
