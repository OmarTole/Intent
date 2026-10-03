from datetime import datetime
from zoneinfo import ZoneInfo
from app.commands import simple_proposal


def test_simple_commands_use_local_date_and_do_not_need_model():
    now = datetime(2026, 12, 31, 23, 30, tzinfo=ZoneInfo('Asia/Qyzylorda'))
    proposal = simple_proposal('Завтра в 18:00 встреча, напомни за час', now)
    assert proposal.activities[0].start.isoformat() == '2027-01-01'
    assert proposal.activities[0].reminder == 60
    assert proposal.activities[0].title == 'встреча'
    assert simple_proposal('Сегодня в 18:00 встреча', now).clarification
    for text in ['Завтра в 18:00 пригласи Армана', 'Завтра в 18:00 удали встречу', '2026-02-30 в 18:00 встреча']:
        assert simple_proposal(text, now) is None
