from uuid import uuid4


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
