"""Conservative free parser. Everything outside this grammar goes to Ollama."""
import re
from datetime import datetime, timedelta, date
from .planner import ScheduleProposal

WEEKDAYS = {
    'понедельник': 0, 'понедельника': 0, 'вторник': 1, 'вторника': 1,
    'среда': 2, 'среду': 2, 'среды': 2, 'четверг': 3, 'четверга': 3,
    'пятница': 4, 'пятницу': 4, 'пятницы': 4, 'суббота': 5,
    'субботу': 5, 'субботы': 5, 'воскресенье': 6, 'воскресенья': 6,
}


def enforce_explicit_details(proposal: ScheduleProposal, text: str, now: datetime) -> ScheduleProposal:
    """Keep explicit user dates, weekdays and durations from being overwritten by model guesses."""
    if proposal.clarification:
        return proposal
    weekday_match = re.search(r"\b(?:в\s+)?(" + "|".join(WEEKDAYS) + r")\b", text, re.I)
    date_match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    duration = None
    duration_match = re.search(r"\bна\s+(полтора|полторы|\d+(?:[.,]\d+)?)\s*(час(?:а|ов)?|ч\.?|минут(?:у|ы)?|мин\.?)\b", text, re.I)
    if duration_match:
        amount, unit = duration_match.groups()
        amount = 1.5 if amount.lower() in ('полтора', 'полторы') else float(amount.replace(',', '.'))
        duration = round(amount * (60 if unit.lower().startswith(('час', 'ч')) else 1))

    changed = False
    for item in proposal.activities:
        updates = {}
        if date_match:
            explicit_date = date.fromisoformat(date_match.group(1))
            if item.start != explicit_date:
                updates['start'] = explicit_date
                if item.end is not None and item.end == item.start:
                    updates['end'] = explicit_date
        elif weekday_match:
            weekday = WEEKDAYS[weekday_match.group(1).lower()]
            delta = (weekday - now.date().weekday()) % 7
            if delta == 0 and item.time and item.time <= now.strftime('%H:%M'):
                delta = 7
            explicit_date = now.date() + timedelta(days=delta)
            if item.start != explicit_date:
                updates['start'] = explicit_date
                if item.end is not None and item.end == item.start:
                    updates['end'] = explicit_date
        if duration is not None and item.duration != duration:
            updates['duration'] = max(5, min(duration, 1440))
        if updates:
            proposal.activities[proposal.activities.index(item)] = item.model_copy(update=updates)
            changed = True
    if changed:
        first = proposal.activities[0]
        proposal.message = f"Проверьте черновик: {first.title}, {first.start.isoformat()} в {first.time}, {first.duration} мин."
    return proposal


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
