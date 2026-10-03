"""Explicit invitations; only an approved event snapshot is shared."""
import time
from datetime import datetime
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException
from pydantic import Field
from sqlalchemy import JSON, Float, ForeignKey, String, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from .db import Base, User, get_db
from .planner import Activity, PlannerData, PlannerState
from .schemas import StrictModel


class Invitation(Base):
    __tablename__ = "invitations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    sender_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    recipient_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    activity_id: Mapped[str] = mapped_column(String(36))
    data: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class InviteRequest(StrictModel):
    activityId: UUID
    recipient: str = Field(min_length=1, max_length=80)


class InviteResponse(StrictModel):
    status: str = Field(pattern="^(accepted|declined|cancelled)$")


def register_invitations(app, current_user, limiter):
    def serialize(row, db):
        return {"id": row.id, "senderId": row.sender_id, "recipientId": row.recipient_id,
                "sender": db.get(User, row.sender_id).username,
                "recipient": db.get(User, row.recipient_id).username,
                "status": row.status, "event": row.data, "createdAt": row.created_at}

    @app.get("/api/invitations")
    def list_invitations(user: User = Depends(current_user), db: Session = Depends(get_db)):
        rows = db.scalars(select(Invitation).where(
            (Invitation.sender_id == user.id) | (Invitation.recipient_id == user.id)
        ).order_by(Invitation.created_at.desc()).limit(200))
        return [serialize(row, db) for row in rows]

    @app.post("/api/invitations", status_code=201)
    def invite(body: InviteRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
        limiter.check("invite:" + user.id, 10)
        planner = db.get(PlannerState, user.id)
        event = next((a for a in planner.data["activities"] if a["id"] == str(body.activityId)), None) if planner else None
        if not event or event.get("archived") or event["kind"] != "event":
            raise HTTPException(404, "Сохранённое событие не найдено.")
        if event["recurrence"] != "once" or not event["time"]:
            raise HTTPException(422, "В бете приглашения доступны для разового события с временем.")
        recipient = db.scalar(select(User).where(User.username == body.recipient.strip().lower()))
        if not recipient or recipient.id == user.id:
            raise HTTPException(422, "Укажите аккаунт другого участника приложения.")
        existing = db.scalar(select(Invitation).where(
            Invitation.sender_id == user.id, Invitation.recipient_id == recipient.id,
            Invitation.activity_id == str(body.activityId), Invitation.status == "pending"))
        if existing:
            return serialize(existing, db)
        # Comments, history, sections, reminder preferences and private notes are never shared.
        snapshot = {k: event[k] for k in ("title", "start", "time", "duration")}
        snapshot["timezone"] = planner.data["timezone"]
        row = Invitation(sender_id=user.id, recipient_id=recipient.id,
                         activity_id=str(body.activityId), data=snapshot)
        db.add(row)
        db.commit()
        return serialize(row, db)

    @app.post("/api/invitations/{invitation_id}/respond")
    def respond(invitation_id: UUID, body: InviteResponse, user: User = Depends(current_user), db: Session = Depends(get_db)):
        row = db.get(Invitation, str(invitation_id))
        if not row or user.id not in (row.sender_id, row.recipient_id):
            raise HTTPException(404, "Приглашение не найдено.")
        allowed = row.sender_id if body.status == "cancelled" else row.recipient_id
        if user.id != allowed:
            raise HTTPException(403, "Это действие недоступно.")
        if row.status == body.status:
            return serialize(row, db)
        if row.status != "pending":
            raise HTTPException(409, "На приглашение уже ответили. Обновите список.")
        result = db.execute(update(Invitation).where(Invitation.id == row.id, Invitation.status == "pending")
                            .values(status=body.status).execution_options(synchronize_session=False))
        if result.rowcount != 1:
            db.rollback()
            raise HTTPException(409, "На приглашение уже ответили.")
        if body.status == "accepted":
            planner = db.get(PlannerState, user.id)
            data = PlannerData.model_validate(planner.data if planner else {}).model_dump(mode="json")
            instant = datetime.fromisoformat(row.data["start"] + "T" + row.data["time"]).replace(
                tzinfo=ZoneInfo(row.data["timezone"])).astimezone(ZoneInfo(data["timezone"]))
            event = Activity(id=uuid4(), title=row.data["title"], kind="event", recurrence="once",
                             start=instant.date(), time=instant.strftime("%H:%M"), duration=row.data["duration"])
            data["activities"].append(event.model_dump(mode="json"))
            PlannerData.model_validate(data)
            if planner:
                saved = db.execute(update(PlannerState).where(PlannerState.user_id == user.id,
                    PlannerState.version == planner.version).values(data=data, version=planner.version + 1))
                if saved.rowcount != 1:
                    db.rollback()
                    raise HTTPException(409, "Ежедневник изменился. Повторите принятие приглашения.")
            else:
                db.add(PlannerState(user_id=user.id, version=1, data=data))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Ежедневник изменился. Повторите принятие приглашения.")
        db.refresh(row)
        return serialize(row, db)
