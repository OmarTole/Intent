import { useEffect, useState } from 'react'
import { api, errorMessage } from './api'
import type { Diary } from './diary-model'

type Invitation = { id: string; senderId: string; recipientId: string; sender: string; recipient: string; status: string;
  event: { title: string; start: string; time: string; timezone: string; duration: number } }
const labels: Record<string, string> = { pending: 'Ожидает ответа', accepted: 'Принято', declined: 'Отклонено', cancelled: 'Отменено' }
export default function People({ data, accountId, busy, dirty, onAccepted }: {
  data: Diary; accountId: string; busy: boolean; dirty: boolean; onAccepted(): Promise<boolean>
}) {
  const [items, setItems] = useState<Invitation[]>([]), [recipient, setRecipient] = useState('')
  const [activityId, setActivityId] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [working, setWorking] = useState(false)
  const events = data.activities.filter(a => a.kind === 'event' && !a.archived && a.recurrence === 'once' && a.time)
  async function refresh() { setItems(await api<Invitation[]>('/invitations')) }
  useEffect(() => { void refresh().catch(err => setError(errorMessage(err))) }, [accountId])
  async function action(run: () => Promise<unknown>) {
    setWorking(true); setError(''); setNotice('')
    try { await run(); await refresh() } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  return <section className="d-panel d-settings-card"><h2>Взаимодействие с людьми</h2>
    <p>Пригласите участника приложения на разовое событие. Передаются название, дата, время и длительность. После принятия у него появится личная копия; последующие изменения и отмена события автоматически не переносятся.</p>
    <form className="d-form" onSubmit={e => { e.preventDefault(); void action(async () => {
      await api('/invitations', 'POST', { activityId, recipient }); setRecipient(''); setNotice('Приглашение отправлено внутри приложения.')
    }) }}>
      <label>Событие<select required value={activityId} onChange={e => setActivityId(e.target.value)}><option value="">Выберите сохранённое событие</option>{events.map(a => <option key={a.id} value={a.id}>{a.title} · {a.start} {a.time}</option>)}</select></label>
      <label>Почта участника<input required type="email" maxLength={80} value={recipient} onChange={e => setRecipient(e.target.value)} /></label>
      {dirty && <p>Сначала синхронизируйте изменения ежедневника.</p>}
      <button className="d-primary" disabled={busy || working || dirty || !activityId}>Отправить приглашение</button>
    </form>
    <button disabled={working} onClick={() => void action(refresh)}>Обновить приглашения</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!items.length && <p>Приглашений пока нет.</p>}
    {items.map(item => <article key={item.id}><h3>{item.event.title}</h3><p>{item.event.start} · {item.event.time} · {item.event.timezone} · {item.event.duration} мин</p><p>{item.senderId === accountId ? `Кому: ${item.recipient}` : `От: ${item.sender}`} · {labels[item.status]}</p>
      {item.status === 'pending' && (item.recipientId === accountId ? <>
        <button disabled={busy || working || dirty} onClick={() => void action(async () => { await api(`/invitations/${item.id}/respond`, 'POST', { status: 'accepted' }); await onAccepted() })}>Принять и добавить в календарь</button>
        <button disabled={working} onClick={() => void action(() => api(`/invitations/${item.id}/respond`, 'POST', { status: 'declined' }))}>Отклонить</button>
      </> : <button disabled={working} onClick={() => void action(() => api(`/invitations/${item.id}/respond`, 'POST', { status: 'cancelled' }))}>Отменить приглашение</button>)}
    </article>)}
  </section>
}
