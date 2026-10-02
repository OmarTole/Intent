"""Single-process reminder worker with persisted delivery receipts."""
import asyncio
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi import Depends, HTTPException, Request
from pydantic import Field, field_validator
from sqlalchemy import JSON, Float, ForeignKey, String, delete, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .db import Base, SessionLocal, User, get_db
from .planner import PlannerData, PlannerState, due_reminders
from .schemas import StrictModel
from .security import token_hash
from .security import RateLimiter

log = logging.getLogger(__name__)
push_limiter = RateLimiter()


def configuration_error():
    if not os.getenv('VAPID_PRIVATE_KEY') or not os.getenv('VAPID_PUBLIC_KEY'):
        return 'На сервере не настроены оба ключа VAPID.'
    subject = os.getenv('VAPID_SUBJECT', '')
    if not subject or 'localhost' in subject.lower() or not subject.startswith(('mailto:', 'https://')):
        return 'В Render задайте VAPID_SUBJECT: mailto:ваша_настоящая_почта вместо owner@localhost.'
    return None


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_hash: Mapped[str] = mapped_column(String(64))
    data: Mapped[dict] = mapped_column(JSON)


class PushDelivery(Base):
    __tablename__ = "push_deliveries"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sent_at: Mapped[float] = mapped_column(Float, default=time.time)


class SubscriptionKeys(StrictModel):
    p256dh: str = Field(min_length=80, max_length=100, pattern=r"^[A-Za-z0-9_-]+=*$")
    auth: str = Field(min_length=20, max_length=30, pattern=r"^[A-Za-z0-9_-]+=*$")


class SubscriptionData(StrictModel):
    endpoint: str = Field(max_length=2000)
    expirationTime: float | None = None
    keys: SubscriptionKeys

    @field_validator("endpoint")
    @classmethod
    def safe_push_service(cls, value):
        url = urlparse(value)
        host = url.hostname or ""
        allowed = host in {"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"} or host.endswith(".notify.windows.com") or host.endswith(".push.apple.com")
        if url.scheme != "https" or not allowed or url.port not in (None, 443) or url.username or url.password or url.fragment:
            raise ValueError("Неподдерживаемый сервис push-уведомлений")
        return value


class UnsubscribeData(StrictModel):
    endpoint: str = Field(min_length=1, max_length=2000)


def register_push(app, current_user):
    @app.get("/api/push/config")
    def config(user: User = Depends(current_user)):
        return {"publicKey": os.getenv("VAPID_PUBLIC_KEY", "") if os.getenv("VAPID_PRIVATE_KEY") else "", "error": configuration_error()}

    @app.post('/api/push/test')
    def test_push(body: UnsubscribeData, user: User = Depends(current_user), db: Session = Depends(get_db)):
        push_limiter.check('push-test:' + user.id, 3)
        if error := configuration_error():
            raise HTTPException(503, error)
        key = hashlib.sha256(body.endpoint.encode()).hexdigest()
        sub = db.get(PushSubscription, key)
        if not sub or sub.user_id != user.id:
            raise HTTPException(404, 'Сначала включите уведомления на этом устройстве.')
        from pywebpush import webpush
        try:
            webpush(subscription_info=sub.data,
                    data=json.dumps({'title': 'Уведомления работают', 'body': 'Проверка доставки', 'tag': 'intent-test', 'url': '/'}),
                    vapid_private_key=os.environ['VAPID_PRIVATE_KEY'],
                    vapid_claims={'sub': os.environ['VAPID_SUBJECT']}, timeout=10, ttl=300)
        except Exception as error:
            response = getattr(error, 'response', None)
            status = response.status_code if response is not None else None
            if status in (404, 410):
                db.delete(sub)
                db.commit()
                raise HTTPException(410, 'Подписка устарела. Отключите уведомления и включите снова.') from None
            if status in (401, 403):
                raise HTTPException(502, 'Сервис телефона отклонил ключи VAPID. Проверьте пару ключей и VAPID_SUBJECT в Render, затем переподключите уведомления.') from None
            raise HTTPException(502, 'Не удалось отправить уведомление. Попробуйте снова и проверьте настройки VAPID на сервере.') from None
        return {'accepted': True}

    @app.post("/api/push/subscribe", status_code=204)
    def subscribe(body: SubscriptionData, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
        if not os.getenv("VAPID_PRIVATE_KEY"):
            raise HTTPException(503, "Уведомления на сервере пока не настроены.")
        key = hashlib.sha256(body.endpoint.encode()).hexdigest()
        row = db.get(PushSubscription, key)
        if row and row.user_id != user.id:
            # A new authenticated account takes ownership of this browser subscription.
            db.delete(row)
            db.flush()
            row = None
        session = token_hash(request.cookies.get("intent_session", ""))
        if row:
            row.data = body.model_dump()
            row.session_hash = session
        else:
            db.add(PushSubscription(id=key, user_id=user.id, session_hash=session, data=body.model_dump()))
        db.commit()

    @app.post("/api/push/unsubscribe", status_code=204)
    def unsubscribe(body: UnsubscribeData, user: User = Depends(current_user), db: Session = Depends(get_db)):
        key = hashlib.sha256(body.endpoint.encode()).hexdigest()
        db.execute(delete(PushSubscription).where(PushSubscription.id == key, PushSubscription.user_id == user.id))
        db.commit()


def deliver_due(now=None, sessions=SessionLocal, sender=None):
    if not os.getenv("VAPID_PRIVATE_KEY"):
        return
    if sender is None:
        from pywebpush import webpush
        sender = webpush
    now = now or datetime.now(timezone.utc)
    with sessions() as db:
        for sub in list(db.scalars(select(PushSubscription))):
            # Permission is device/account scoped, not limited to the login cookie's lifetime.
            # Explicit logout/unsubscribe revokes it; expiration alone must not lose future reminders.
            if not db.get(User, sub.user_id):
                db.delete(sub)
                db.commit()
                continue
            row = db.get(PlannerState, sub.user_id)
            if not row:
                continue
            for item, day, at in due_reminders(PlannerData.model_validate(row.data), now - timedelta(hours=24), now):
                key = hashlib.sha256(f"{sub.id}:{item.id}:{day}:{at}:{item.reminder}".encode()).hexdigest()
                if db.get(PushDelivery, key):
                    continue
                try:
                    sender(subscription_info=sub.data, data=json.dumps({"title": item.title, "body": f"{day:%d.%m.%Y} · {at}", "tag": key, "url": f"/?view=today&date={day}"}),
                           vapid_private_key=os.environ["VAPID_PRIVATE_KEY"], vapid_claims={"sub": os.getenv("VAPID_SUBJECT", "mailto:owner@localhost")}, timeout=10, ttl=3600)
                    db.add(PushDelivery(id=key))
                    db.commit()
                except Exception as error:
                    response = getattr(error, "response", None)
                    if response is not None and response.status_code in (404, 410):
                        db.delete(sub)
                        db.commit()
                        break
                    log.warning("Push delivery failed; will retry (%s, HTTP %s)", type(error).__name__, response.status_code if response is not None else 'unknown')
        db.execute(delete(PushDelivery).where(PushDelivery.sent_at < now.timestamp() - 30 * 86400))
        db.commit()


async def reminder_loop():
    while True:
        try:
            await asyncio.to_thread(deliver_due)
        except Exception:
            log.exception("Reminder worker failed")
        await asyncio.sleep(30)
