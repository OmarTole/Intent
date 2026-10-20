from datetime import datetime
from zoneinfo import ZoneInfo
from app.commands import enforce_explicit_details, simple_proposal
from app.planner import ScheduleProposal


def test_simple_commands_use_local_date_and_do_not_need_model():
    now = datetime(2026, 12, 31, 23, 30, tzinfo=ZoneInfo('Asia/Qyzylorda'))
    proposal = simple_proposal('Завтра в 18:00 встреча, напомни за час', now)
    assert proposal.activities[0].start.isoformat() == '2027-01-01'
    assert proposal.activities[0].reminder == 60
    assert proposal.activities[0].title == 'встреча'
    assert simple_proposal('Сегодня в 18:00 встреча', now).clarification
    for text in ['Завтра в 18:00 пригласи Армана', 'Завтра в 18:00 удали встречу', '2026-02-30 в 18:00 встреча']:
        assert simple_proposal(text, now) is None


def test_ai_proposal_respects_explicit_weekday_and_duration():
    now = datetime(2026, 10, 20, 11, 0, tzinfo=ZoneInfo('Asia/Qyzylorda'))
    generated = ScheduleProposal.model_validate({
        'message': 'Среда в 15:00, 300 минут', 'clarification': False,
        'activities': [{
            'title': 'Встреча', 'kind': 'event', 'start': '2026-10-28', 'end': '2026-10-28',
            'time': '15:00', 'duration': 300, 'recurrence': 'once', 'weekdays': [3],
            'reminder': 30, 'program': '',
        }],
    })
    result = enforce_explicit_details(generated, 'В четверг встреча в 15:00 на полтора часа', now)
    assert result.activities[0].start.isoformat() == '2026-10-22'
    assert result.activities[0].duration == 90
    assert '2026-10-22' in result.message
    assert '90 мин' in result.message
