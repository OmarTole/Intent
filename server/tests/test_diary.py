from datetime import date, datetime, timezone, timedelta
from uuid import uuid4
from sqlalchemy import select
from app.accounts import AccountProfile
from app.db import User
from app.planner import Activity, PlannerData, occurs, due_reminders


def test_registration_and_email_login(clients):
    alice, _, _ = clients
    body = {'email': 'New@Example.com', 'password': 'long-password-123'}
    assert alice.post('/api/auth/register', json=body).status_code == 201
    assert alice.post('/api/auth/register', json=body).status_code == 409
    result = alice.post('/api/auth/login', json={'username': body['email'], 'password': body['password']})
    assert result.status_code == 200
    assert result.json()['username'] == 'new@example.com'
    assert result.json()['admin'] is False
    assert alice.get('/api/planner').json()['sections'] == []


def test_admin_privacy_block_and_reset(clients):
    alice, bob, sessions = clients
    assert alice.get('/api/admin/users').status_code == 403
    with sessions() as db:
        admin = db.scalar(select(User).where(User.username == 'alice'))
        target = db.scalar(select(User).where(User.username == 'bob'))
        target_id = target.id
        profile = db.get(AccountProfile, admin.id)
        if not profile:
            profile = AccountProfile(user_id=admin.id)
            db.add(profile)
        profile.admin = True
        db.commit()
    result = alice.get('/api/admin/users').json()
    assert set(result) == {'users', 'active'}
    assert all('activities' not in u and 'comments' not in u and 'password_hash' not in u for u in result['users'])
    assert alice.post(f'/api/admin/users/{target_id}/block', json={'blocked': True}).status_code == 204
    assert bob.get('/api/planner').status_code == 401
    assert bob.post('/api/auth/login', json={'username': 'bob', 'password': 'test-password-123'}).status_code == 403
    assert alice.post(f'/api/admin/users/{target_id}/block', json={'blocked': False}).status_code == 204
    assert alice.post(f'/api/admin/users/{target_id}/reset-password', json={'password': 'new-password-123'}).status_code == 204
    assert bob.post('/api/auth/login', json={'username': 'bob', 'password': 'test-password-123'}).status_code == 401
    assert bob.post('/api/auth/login', json={'username': 'bob', 'password': 'new-password-123'}).status_code == 200


def test_sections_comments_and_manual_marks_survive_sync(clients):
    alice, bob, _ = clients
    sid, aid = str(uuid4()), str(uuid4())
    data = {'version': 0, 'sections': [{'id': sid, 'title': 'Работа', 'group': 'Обязательное'}],
            'activities': [{'id': aid, 'title': 'Отчет', 'start': '2026-09-29', 'sectionId': sid, 'comments': [{'id': str(uuid4()), 'text': 'Готов черновик', 'at': '2026-09-29T12:00:00Z'}]}],
            'sectionMarks': [{'sectionId': sid, 'date': '2026-09-29', 'status': 'partial'}]}
    saved = alice.put('/api/planner', json=data)
    assert saved.status_code == 200, saved.text
    assert alice.get('/api/planner').json()['activities'][0]['comments'][0]['text'] == 'Готов черновик'
    assert bob.get('/api/planner').json()['sections'] == []
    assert alice.put('/api/planner', json=data).status_code == 409
    invalid = saved.json()
    invalid['sections'] = []
    assert alice.put('/api/planner', json=invalid).status_code == 422


def test_monthly_recurrence_skips_missing_dates():
    a = Activity(id=uuid4(), title='Месячный отчет', start=date(2026, 1, 31), recurrence='monthly')
    assert not occurs(a, date(2026, 2, 28))
    assert occurs(a, date(2026, 3, 31))


def test_multiple_reminders_are_independent_and_deduplicated():
    a = Activity(id=uuid4(), title='День рождения', kind='event', start=date(2026, 10, 10),
                 time='10:00', recurrence='yearly', reminder=1440, reminderOffsets=[0, 1440, 10080])
    data = PlannerData(timezone='UTC', activities=[a])
    for day, minutes in [(3, 10080), (9, 1440), (10, 0)]:
        now = datetime(2027, 10, day, 10, 0, tzinfo=timezone.utc)
        due = list(due_reminders(data, now - timedelta(minutes=1), now))
        assert len(due) == 1
        assert due[0][0].reminder == minutes


def test_custom_groups_order_and_existing_accounts(clients):
    alice, bob, _ = clients
    assert alice.get('/api/planner').json()['groups'] is None
    sid = str(uuid4())
    data = {'version': 0, 'groups': ['Семья', 'Мои планы'],
            'sections': [{'id': sid, 'title': 'Работа', 'group': 'Мои планы', 'position': 4}]}
    saved = alice.put('/api/planner', json=data)
    assert saved.status_code == 200, saved.text
    state = alice.get('/api/planner').json()
    assert state['groups'] == ['Семья', 'Мои планы']
    assert state['sections'][0]['position'] == 4
    assert bob.get('/api/planner').json()['groups'] is None
    state['groups'] = ['Семья']
    assert alice.put('/api/planner', json=state).status_code == 422
    state['groups'] = ['Мои планы', 'Мои планы']
    assert alice.put('/api/planner', json=state).status_code == 422
