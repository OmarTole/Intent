"""Personal calendar: local dates, explicit recurrence and independent daily focus."""
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal, Annotated
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import re

from pydantic import Field, RootModel, model_validator
from sqlalchemy import JSON, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base
from .schemas import StrictModel


class PlannerState(Base):
    __tablename__ = "planner_states"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    data: Mapped[dict] = mapped_column(JSON)


class TaskEntry(StrictModel):
    id: UUID
    text: str = Field(min_length=1, max_length=3000)
    at: str = Field(max_length=40)


class Activity(StrictModel):
    id: UUID
    title: str = Field(min_length=1, max_length=160)
    kind: Literal["habit", "task", "event"] = "habit"
    start: date
    end: date | None = None
    time: str = Field(default="", pattern=r"^(|([01]\d|2[0-3]):[0-5]\d)$")
    duration: int = Field(default=30, ge=5, le=1440)
    recurrence: Literal["once", "daily", "weekly", "monthly", "yearly"] = "daily"
    weekdays: list[Annotated[int, Field(ge=0, le=6)]] = Field(default_factory=list, max_length=7)
    reminder: int | None = Field(default=None, ge=0, le=10080)
    reminderOffsets: list[Annotated[int, Field(ge=0, le=10080)]] = Field(default_factory=list, max_length=5)
    program: str = Field(default="", max_length=6000)
    archived: bool = False
    sectionId: UUID | None = None
    parentEventId: UUID | None = None
    comments: list["TaskEntry"] = Field(default_factory=list, max_length=500)
    history: list["TaskEntry"] = Field(default_factory=list, max_length=1000)


    @model_validator(mode="after")
    def valid_schedule(self):
        if self.end and self.end < self.start:
            raise ValueError("Конец периода раньше начала")
        if any(day < 0 or day > 6 for day in self.weekdays) or len(set(self.weekdays)) != len(self.weekdays):
            raise ValueError("Некорректные дни недели")
        if self.recurrence == "weekly" and not self.weekdays:
            raise ValueError("Выберите дни недели")
        if (self.reminder is not None or self.reminderOffsets) and not self.time:
            raise ValueError("Для напоминания укажите время")
        return self


class Section(StrictModel):
    id: UUID
    title: str = Field(min_length=1, max_length=160)
    group: str = Field(default="Обязательное", max_length=80)
    position: int = Field(default=0, ge=0, le=10000)


class SectionMark(StrictModel):
    sectionId: UUID
    date: date
    status: Literal["pending", "partial", "done", "empty", "skipped", "missed"]


class DayMark(StrictModel):
    activityId: UUID
    date: date
    status: Literal["missed", "partial", "done", "rest"] = "missed"
    focus: bool = False
    # Override one occurrence without changing the recurring series.
    time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class PlannerData(StrictModel):
    timezone: str = "Asia/Qyzylorda"
    activities: list[Activity] = Field(default_factory=list, max_length=2000)
    marks: list[DayMark] = Field(default_factory=list, max_length=20000)
    sections: list[Section] = Field(default_factory=list, max_length=200)
    sectionMarks: list[SectionMark] = Field(default_factory=list, max_length=20000)
    groups: list[Annotated[str, Field(min_length=1, max_length=80)]] | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def valid_data(self):
        try:
            ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Неизвестный часовой пояс")
        ids = {item.id for item in self.activities}
        if len(ids) != len(self.activities):
            raise ValueError("Повторяющиеся действия")
        event_ids = {a.id for a in self.activities if a.kind == 'event'}
        if any(a.parentEventId and (a.parentEventId not in event_ids or a.parentEventId == a.id) for a in self.activities):
            raise ValueError("Связанное событие не найдено")
        keys = {(mark.activityId, mark.date) for mark in self.marks}
        if len(keys) != len(self.marks) or any(mark.activityId not in ids for mark in self.marks):
            raise ValueError("Некорректные отметки")
        section_ids = {s.id for s in self.sections}
        if self.groups is not None and (len(set(self.groups)) != len(self.groups) or any(s.group not in self.groups for s in self.sections)):
            raise ValueError("Группы должны быть уникальными; каждое направление должно принадлежать существующей группе")
        if len(section_ids) != len(self.sections) or any(a.sectionId and a.sectionId not in section_ids for a in self.activities):
            raise ValueError("Некорректные разделы")
        if any(m.sectionId not in section_ids for m in self.sectionMarks) or len({(m.sectionId, m.date) for m in self.sectionMarks}) != len(self.sectionMarks):
            raise ValueError("Некорректные отметки разделов")
        return self


class PlannerUpdate(PlannerData):
    version: int = Field(ge=0)


class ProposalItem(StrictModel):
    title: str = Field(min_length=1, max_length=160)
    kind: Literal["habit", "task", "event"]
    start: date
    end: date | None
    time: str = Field(pattern=r"^(|([01]\d|2[0-3]):[0-5]\d)$")
    duration: int = Field(ge=5, le=1440)
    recurrence: Literal["once", "daily", "weekly", "yearly"]
    weekdays: list[Annotated[int, Field(ge=0, le=6)]] = Field(max_length=7)
    reminder: int | None = Field(ge=0, le=10080)
    program: str = Field(max_length=6000)


class ScheduleProposal(StrictModel):
    message: str = Field(min_length=1, max_length=1500)
    clarification: bool
    activities: list[ProposalItem] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def valid_proposal(self):
        from uuid import uuid4
        if self.clarification == bool(self.activities):
            raise ValueError("Уточнение не содержит расписание; готовый план содержит действия")
        for item in self.activities:
            Activity(id=uuid4(), **item.model_dump())
        return self


class ScheduleRequest(StrictModel):
    text: str = Field(min_length=1, max_length=6000)
    timezone: str = "Asia/Qyzylorda"


class ReadySchedule(StrictModel):
    message: str = Field(min_length=1, max_length=1500)
    clarification: Literal[False]
    activities: list[ProposalItem] = Field(min_length=1, max_length=12)


class ScheduleQuestion(StrictModel):
    message: str = Field(min_length=1, max_length=1500)
    clarification: Literal[True]
    activities: list[ProposalItem] = Field(max_length=0)


class ScheduleGeneration(RootModel[ReadySchedule | ScheduleQuestion]):
    pass


class TrainingBlock(StrictModel):
    title: str = Field(min_length=1, max_length=100)
    minutes: int = Field(ge=1, le=240)
    details: str = Field(min_length=10, max_length=800)


class TrainingItem(ProposalItem):
    duration: int = Field(ge=20, le=240)
    time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    blocks: list[TrainingBlock] = Field(min_length=2, max_length=8, description="Блоки занятия по времени: подготовка, разминка, силовые, плавание, восстановление")


class ReadyTraining(ReadySchedule):
    activities: list[TrainingItem] = Field(min_length=1, max_length=4)


class TrainingGeneration(RootModel[ReadyTraining | ScheduleQuestion]):
    pass


def training_to_proposal(generation: TrainingGeneration) -> ScheduleProposal:
    payload = generation.root.model_dump()
    adjusted = False
    for item in payload['activities']:
        blocks = item.pop('blocks')
        total = sum(b['minutes'] for b in blocks)
        if total != item['duration']:
            # Allocate the requested session budget, never display impossible totals.
            adjusted = True
            available = max(item['duration'], len(blocks))
            remainder = available - len(blocks)
            sizes = [1 + int(remainder * b['minutes'] / total) for b in blocks]
            sizes[-1] += available - sum(sizes)
            for block, size in zip(blocks, sizes):
                block['minutes'] = size
        elapsed = 0
        lines = []
        for block in blocks:
            lines.append(f"{elapsed}–{elapsed + block['minutes']} мин · {block['title']}\n{block['details']}")
            elapsed += block['minutes']
        item['program'] = '\n\n'.join(lines)
    if adjusted:
        payload['message'] = 'Длительности блоков приведены к общей длительности занятия. Проверьте объём упражнений и паузы перед утверждением.'
    return ScheduleProposal.model_validate(payload)


def enforce_reminder_request(result: ScheduleProposal, request: str) -> ScheduleProposal:
    """A model must not acknowledge a reminder while returning a disabled reminder."""
    if result.clarification or not re.search(r"напом|напомин", request, re.I):
        return result
    text = request.lower()
    if re.search(r"(?:не\s+(?:нужны|нужно|надо)|без)\s+напомин|не\s+напомин|напоминания\s+не\s+нужны", text):
        for item in result.activities:
            item.reminder = None
        return result
    advance = None
    for phrase, minutes in [(r"за\s+(?:один\s+)?день|за\s+сутки", 1440), (r"за\s+неделю", 10080), (r"за\s+(?:один\s+)?час\b", 60), (r"в\s+момент\s+начала", 0)]:
        if re.search(phrase, text):
            advance = minutes
    numeric = re.search(r"за\s+(\d+)\s*(мин|час|дн|день|недел)", text)
    if numeric:
        advance = int(numeric[1]) * (1 if numeric[2] == 'мин' else 60 if numeric[2] == 'час' else 10080 if numeric[2] == 'недел' else 1440)
    if advance is None:
        return ScheduleProposal(message="За сколько времени до события напомнить? Например, за час или за день.", clarification=True, activities=[])
    if len(result.activities) == 1 and advance is not None and advance <= 10080 and result.activities[0].time:
        result.activities[0].reminder = advance
    if any(a.reminder is None or not a.time for a in result.activities):
        return ScheduleProposal(message="В какое время начинается событие и за сколько времени напомнить?", clarification=True, activities=[])
    return result


def occurs(item: Activity, day: date) -> bool:
    if day < item.start or (item.end and day > item.end):
        return False
    if item.recurrence == "once":
        return day == item.start
    if item.recurrence == "weekly":
        return day.weekday() in item.weekdays
    if item.recurrence == "yearly":
        return (day.month, day.day) == (item.start.month, item.start.day)
    if item.recurrence == "monthly":
        return day.day == item.start.day
    return True


def due_reminders(data: PlannerData, since: datetime, now: datetime):
    zone = ZoneInfo(data.timezone)
    local_now = now.astimezone(zone)
    marks = {(m.activityId, m.date): m for m in data.marks}
    reminders = (item.model_copy(update={'reminder': advance}) for item in data.activities
                 for advance in dict.fromkeys(([item.reminder] if item.reminder is not None else []) + item.reminderOffsets))
    for item in reminders:
        if item.archived or item.reminder is None or not item.time:
            continue
        # Includes upcoming occurrences with advance reminders up to seven days.
        for offset in range(-1, 9):
            day = local_now.date() + timedelta(days=offset)
            mark = marks.get((item.id, day))
            if not occurs(item, day) or (mark and mark.status in {"done", "rest"}):
                continue
            at = mark.time if mark and mark.time else item.time
            scheduled = datetime.combine(day, time.fromisoformat(at), zone)
            due = scheduled.astimezone(timezone.utc) - timedelta(minutes=item.reminder)
            if since < due <= now:
                yield item, day, at
