from datetime import date, datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from pydantic import ValidationError
from app.planner import Activity, PlannerData, ScheduleProposal, ScheduleGeneration, TrainingGeneration, training_to_proposal, occurs, due_reminders, enforce_reminder_request
from app.push import deliver_due, PushSubscription, PushDelivery
from app.db import LoginSession
from sqlalchemy import select


def activity(**changes):
    return {"id": str(uuid4()), "title": "Тренировка", "kind": "event", "start": "2026-09-22", "end": None, "time": "19:00", "duration": 120, "recurrence": "weekly", "weekdays": [1, 4], "reminder": 60, "program": "", **changes}


def state(**changes):
    return {"version": 0, "timezone": "Asia/Qyzylorda", "activities": [activity()], "marks": [], **changes}


def test_calendar_ownership_versions_and_marks(clients):
    alice, bob, _ = clients
    payload = state()
    response = alice.put('/api/planner', json=payload)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved['version'] == 1
    assert bob.get('/api/planner').json()['activities'] == []
    assert alice.put('/api/planner', json=payload).status_code == 409
    saved['marks'] = [{"activityId": saved['activities'][0]['id'], "date": "2026-09-22", "status": "partial", "focus": True}]
    updated = alice.put('/api/planner', json=saved).json()
    assert updated['marks'][0]['focus'] is True
    assert updated['marks'][0]['status'] == 'partial'
    updated['activities'][0]['archived'] = True
    archived = alice.put('/api/planner', json=updated).json()
    assert archived['marks'] == updated['marks']
    archived['activities'] = []
    assert alice.put('/api/planner', json=archived).status_code == 422
    archived['marks'] = []
    assert alice.put('/api/planner', json=archived).status_code == 200


def test_calendar_validation(clients):
    alice, _, _ = clients
    for payload in [state(timezone='Bad/Zone'), state(activities=[activity(weekdays=[])]), state(activities=[activity(time='', reminder=15)]), state(activities=[activity(end='2026-01-01')])]:
        assert alice.put('/api/planner', json=payload).status_code == 422
    payload = state()
    payload['activities'] *= 2
    assert alice.put('/api/planner', json=payload).status_code == 422


def test_recurrence_and_annual_leap_day():
    a = Activity(**activity(end='2026-10-01'))
    assert occurs(a, date(2026, 9, 22))
    assert occurs(a, date(2026, 9, 25))
    assert not occurs(a, date(2026, 9, 23))
    assert not occurs(a, date(2026, 10, 2))
    leap = Activity(**activity(start='2024-02-29', recurrence='yearly'))
    assert not occurs(leap, date(2025, 2, 28))
    assert occurs(leap, date(2028, 2, 29))


def test_reminders_timezone_advance_and_independent_focus():
    a = activity(recurrence='once', reminder=1440)
    data = PlannerData(activities=[a], timezone='Asia/Qyzylorda')
    now = datetime(2026, 9, 21, 14, 0, tzinfo=timezone.utc)
    assert len(list(due_reminders(data, now - timedelta(minutes=1), now))) == 1
    assert not list(due_reminders(data, now, now + timedelta(minutes=1)))
    data.marks = []
    for status in ['done', 'rest']:
        marked = PlannerData(activities=[a], marks=[{'activityId': a['id'], 'date': '2026-09-22', 'status': status, 'focus': True}])
        assert not list(due_reminders(marked, now - timedelta(minutes=1), now))


def test_ai_schedule_proposal_never_saves_without_confirmation(clients):
    alice, _, _ = clients
    draft = activity()
    draft.pop('id')
    response = ScheduleProposal(message='Проверьте расписание', clarification=False, activities=[draft])
    with patch('app.main.interpreter._generate', new=AsyncMock(return_value=ScheduleGeneration(response.model_dump()))):
        result = alice.post('/api/planner/propose', json={'text': 'Тренировки вторник и пятница', 'timezone': 'Asia/Qyzylorda'})
    assert result.status_code == 200
    assert result.json()['activities'][0]['weekdays'] == [1, 4]
    assert alice.get('/api/planner').json()['activities'] == []
    with pytest.raises(ValidationError):
        ScheduleProposal(message='В какое время?', clarification=True, activities=[draft])


def test_push_deduplicates_and_unsubscribes_on_logout(clients, monkeypatch):
    alice, _, sessions = clients
    monkeypatch.setenv('VAPID_PRIVATE_KEY', 'test-key')
    subscription = {'endpoint': 'https://fcm.googleapis.com/fcm/send/test', 'keys': {'p256dh': 'a' * 87, 'auth': 'b' * 22}}
    assert alice.post('/api/push/subscribe', json=subscription).status_code == 204
    today = datetime.now(timezone.utc).date().isoformat()
    now = datetime.now(timezone.utc).replace(second=30, microsecond=0)
    assert alice.put('/api/planner', json=state(timezone='UTC', activities=[activity(start=today, recurrence='once', time=now.strftime('%H:%M'), reminder=0)])).status_code == 200
    sent = []
    deliver_due(now=now, sessions=sessions, sender=lambda **kwargs: sent.append(kwargs))
    deliver_due(now=now, sessions=sessions, sender=lambda **kwargs: sent.append(kwargs))
    assert len(sent) == 1
    assert 'Тренировка' not in sent[0]['data']
    assert alice.post('/api/auth/logout').status_code == 204
    with sessions() as db:
        assert list(db.scalars(select(PushSubscription))) == []
        assert len(list(db.scalars(select(PushDelivery)))) == 1


def test_push_rejects_private_endpoints(clients, monkeypatch):
    alice, _, _ = clients
    monkeypatch.setenv('VAPID_PRIVATE_KEY', 'test-key')
    for endpoint in ['https://127.0.0.1/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.attacker.test/x']:
        response = alice.post('/api/push/subscribe', json={'endpoint': endpoint, 'keys': {'p256dh': 'a' * 87, 'auth': 'b' * 22}})
        assert response.status_code == 422


def test_explicit_reminder_cannot_silently_disappear():
    item = activity(reminder=None)
    item.pop('id')
    result = ScheduleProposal(message='Напомню за день', clarification=False, activities=[item])
    assert enforce_reminder_request(result, 'Той у друга. Напомни за день.').activities[0].reminder == 1440
    result.activities[0].time = ''
    assert enforce_reminder_request(result, 'Напомни за день').clarification
    assert not enforce_reminder_request(result, 'Не нужны напоминания.').clarification
    assert result.activities[0].reminder is None


def test_training_blocks_fit_the_requested_duration():
    item = activity(duration=120)
    item.pop('id')
    item['blocks'] = [{'title': 'Разминка', 'minutes': 30, 'details': 'Спокойная разминка'}, {'title': 'Основная часть', 'minutes': 120, 'details': 'Упражнения с паузами'}]
    result = training_to_proposal(TrainingGeneration({'message': 'План', 'clarification': False, 'activities': [item]}))
    assert '0–24 мин' in result.activities[0].program
    assert '24–120 мин' in result.activities[0].program
    assert 'приведены' in result.message


def test_reminder_survives_login_expiry_and_explicit_unsubscribe_stops_it(clients, monkeypatch):
    alice, bob, sessions = clients
    monkeypatch.setenv('VAPID_PRIVATE_KEY', 'test-key')
    subscription = {'endpoint': 'https://fcm.googleapis.com/fcm/send/long-term', 'keys': {'p256dh': 'a' * 87, 'auth': 'b' * 22}}
    alice.post('/api/push/subscribe', json=subscription).raise_for_status()
    now = datetime.now(timezone.utc).replace(second=30, microsecond=0)
    alice.put('/api/planner', json=state(timezone='UTC', activities=[activity(start=now.date().isoformat(), recurrence='once', time=now.strftime('%H:%M'), reminder=0)])).raise_for_status()
    # Another account cannot revoke this endpoint.
    bob.post('/api/push/unsubscribe', json={'endpoint': subscription['endpoint']}).raise_for_status()
    with sessions() as db:
        sub = db.scalar(select(PushSubscription))
        db.get(LoginSession, sub.session_hash).expires_at = now.timestamp() - 1
        db.commit()
    sent = []
    deliver_due(now=now, sessions=sessions, sender=lambda **kwargs: sent.append(kwargs))
    assert len(sent) == 1
    alice.post('/api/auth/login', json={'username': 'alice', 'password': 'test-password-123'}).raise_for_status()
    alice.post('/api/push/unsubscribe', json={'endpoint': subscription['endpoint']}).raise_for_status()
    with sessions() as db:
        assert db.scalar(select(PushSubscription)) is None
