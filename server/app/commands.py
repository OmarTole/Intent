"""Conservative free parser. Everything outside this grammar goes to Ollama."""
import re
from datetime import datetime, timedelta, date
from .planner import ScheduleProposal


def simple_proposal(text: str, now: datetime) -> ScheduleProposal | None:
    match = re.fullmatch(
        r"\s*(сегодня|завтра|послезавтра|\d{4}-\d{2}-\d{2})\s+в\s+"
        r"([01]?\d|2[0-3]):([0-5]\d)\s+(.{1,160}?)"
        r"(?:,\s*напомни\s+за\s+(час|день|\d{1,3}\s+минут[уы]?))?\s*[.]?\s*",
        text, re.I,
    )
    if not match:
        return None
    when, hour, minute, title, reminder = match.groups()
    # Do not silently turn edit, invite, recurrence or multi-action commands into new events.
    if re.search(r"перенеси|измени|удали|отмени|позови|пригласи|кажд|ежеднев|еженедел|длит|напомни|на\s+(?:час|\d+\s*(?:час|минут))|;|\bи\b", title, re.I):
        return None
    try:
        day = now.date() + timedelta(days={"сегодня": 0, "завтра": 1, "послезавтра": 2}[when.lower()]) if not when[0].isdigit() else date.fromisoformat(when)
    except (ValueError, KeyError):
        return None
    start = datetime.combine(day, datetime.strptime(f"{hour}:{minute}", "%H:%M").time(), now.tzinfo)
    if start < now:
        return ScheduleProposal(message="Это время уже прошло. Уточните будущую дату и время.", clarification=True, activities=[])
    minutes = None if not reminder else 60 if reminder.lower() == "час" else 1440 if reminder.lower() == "день" else int(reminder.split()[0])
    return ScheduleProposal(message=f"Предлагаю: {title.strip()}, {day.isoformat()} в {int(hour):02}:{minute}. Проверьте перед сохранением.",
        clarification=False, activities=[dict(title=title.strip(), kind="event", start=day,
        end=None, time=f"{int(hour):02}:{minute}", duration=30, recurrence="once",
        weekdays=[], reminder=minutes, program="")])
