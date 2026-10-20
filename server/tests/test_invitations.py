from uuid import uuid4

from app.accounts import PhoneIdentity
from app.db import User
from app.security import hash_password


def event():
    return {"id": str(uuid4()), "title": "Встреча", "kind": "event", "start": "2026-10-04",
            "time": "01:00", "duration": 45, "recurrence": "once", "program": "Секретные заметки"}


def test_invitation_is_private_and_acceptance_is_idempotent(clients):
    alice, bob, _ = clients
    activity = event()
    assert alice.put('/api/planner', json={"version": 0, "timezone": "Asia/Qyzylorda", "activities": [activity]}).status_code == 200
    assert bob.put('/api/planner', json={"version": 0, "timezone": "America/New_York"}).status_code == 200
    created = alice.post('/api/invitations', json={"activityId": activity['id'], "recipient": "bob"})
    assert created.status_code == 201
    invite = created.json()
    assert 'program' not in invite['event'] and 'comments' not in invite['event']
    assert alice.post('/api/invitations', json={"activityId": activity['id'], "recipient": "bob"}).json()['id'] == invite['id']
    assert len(bob.get('/api/invitations').json()) == 1
    assert alice.post(f"/api/invitations/{invite['id']}/respond", json={"status": "accepted"}).status_code == 403
    for _ in range(2):
        assert bob.post(f"/api/invitations/{invite['id']}/respond", json={"status": "accepted"}).status_code == 200
    planner = bob.get('/api/planner').json()
    assert len(planner['activities']) == 1
    assert planner['activities'][0]['start'] == '2026-10-03'
    assert planner['activities'][0]['time'] == '16:00'
    assert planner['activities'][0]['program'] == ''
    assert planner['activities'][0]['reminder'] is None


def test_cancellation_and_foreign_events(clients):
    alice, bob, _ = clients
    activity = event()
    alice.put('/api/planner', json={"version": 0, "activities": [activity]})
    assert bob.post('/api/invitations', json={"activityId": activity['id'], "recipient": "alice"}).status_code == 404
    invite = alice.post('/api/invitations', json={"activityId": activity['id'], "recipient": "bob"}).json()
    assert bob.post(f"/api/invitations/{invite['id']}/respond", json={"status": "cancelled"}).status_code == 403
    assert alice.post(f"/api/invitations/{invite['id']}/respond", json={"status": "cancelled"}).status_code == 200
    assert bob.post(f"/api/invitations/{invite['id']}/respond", json={"status": "accepted"}).status_code == 409
    assert not bob.get('/api/planner').json()['activities']
    assert bob.post(f"/api/invitations/{uuid4()}/respond", json={"status": "accepted"}).status_code == 404


def test_contacts_lookup_and_invite_by_phone(clients):
    alice, _, sessions = clients
    phone = '+77011234567'
    with sessions() as db:
        user = User(username='phone-user', password_hash=hash_password('phone-login-password'))
        db.add(user)
        db.flush()
        user_id = user.id
        db.add(PhoneIdentity(phone=phone, user_id=user.id))
        db.commit()
    lookup = alice.post('/api/contacts/lookup', json={'phones': [phone, '+77019999999']})
    assert lookup.status_code == 200
    assert lookup.json()['registered'] == [phone]
    activity = event()
    alice.put('/api/planner', json={'version': 0, 'activities': [activity]})
    invitation = alice.post('/api/invitations', json={'activityId': activity['id'], 'recipient': '+7 701 123 45 67'})
    assert invitation.status_code == 201
    assert invitation.json()['recipientId'] == user_id
