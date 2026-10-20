import { useEffect, useState, type ChangeEvent } from 'react'
import { api, errorMessage } from './api'
import type { Diary } from './diary-model'

type Invitation = { id: string; senderId: string; recipientId: string; sender: string; recipient: string; status: string;
  event: { title: string; start: string; time: string; timezone: string; duration: number } }
type PickedContact = { name?: string[]; tel?: string[] }
type ContactNavigator = Navigator & { contacts?: { select(properties: string[], options?: { multiple?: boolean }): Promise<PickedContact[]> } }
type FoundContact = { name: string; phone: string }
const labels: Record<string, string> = { pending: 'Ожидает ответа', accepted: 'Принято', declined: 'Отклонено', cancelled: 'Отменено' }

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (value.trim().startsWith('+')) return `+${digits}`
  if (digits.startsWith('00')) return `+${digits.slice(2)}`
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`
  if (digits.length === 11 && digits.startsWith('7')) return `+${digits}`
  if (digits.length === 10) return `+7${digits}`
  return value.trim()
}

export function parseVCardContacts(content: string): FoundContact[] {
  const unfolded = content.replace(/\r?\n[ \t]/g, '')
  const cards = unfolded.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) || []
  const unescape = (value: string) => value.replace(/\\[nN]/g, ' ').replace(/\\([,;\\])/g, '$1').trim()
  return cards.flatMap(card => {
    const lines = card.split(/\r?\n/)
    const nameLine = lines.find(line => /^FN(?:;[^:]*)?:/i.test(line)) || lines.find(line => /^N(?:;[^:]*)?:/i.test(line))
    const name = nameLine ? unescape(nameLine.slice(nameLine.indexOf(':') + 1)) : ''
    return lines.filter(line => /^TEL(?:;[^:]*)?:/i.test(line)).map(line => {
      const phone = normalizePhone(unescape(line.slice(line.indexOf(':') + 1)))
      return { name: name || phone, phone }
    }).filter(contact => /^\+[1-9]\d{7,14}$/.test(contact.phone))
  })
}
export default function People({ data, accountId, busy, dirty, onAccepted }: {
  data: Diary; accountId: string; busy: boolean; dirty: boolean; onAccepted(): Promise<boolean>
}) {
  const [items, setItems] = useState<Invitation[]>([]), [recipient, setRecipient] = useState('')
  const [activityId, setActivityId] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [working, setWorking] = useState(false), [found, setFound] = useState<FoundContact[]>([])
  const contactPickerAvailable = !!(navigator as ContactNavigator).contacts && window.isSecureContext
  const events = data.activities.filter(a => a.kind === 'event' && !a.archived && a.recurrence === 'once' && a.time)
  async function refresh() { setItems(await api<Invitation[]>('/invitations')) }
  useEffect(() => { void refresh().catch(err => setError(errorMessage(err))) }, [accountId])
  async function action(run: () => Promise<unknown>) {
    setWorking(true); setError(''); setNotice('')
    try { await run(); await refresh() } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  async function chooseContacts() {
    const picker = (navigator as ContactNavigator).contacts
    if (!picker || !window.isSecureContext) return
    setWorking(true); setError(''); setFound([])
    try {
      const selected = await picker.select(['name', 'tel'], { multiple: true })
      const contacts = selected.flatMap(contact => (contact.tel || []).map(raw => ({ name: contact.name?.[0] || raw, phone: normalizePhone(raw) })))
        .filter(contact => /^\+[1-9]\d{7,14}$/.test(contact.phone))
      const unique = [...new Map(contacts.map(contact => [contact.phone, contact])).values()]
      if (!unique.length) { setNotice('В выбранных контактах не нашлось номеров в международном формате.'); return }
      const result = await api<{ registered: string[] }>('/contacts/lookup', 'POST', { phones: unique.slice(0, 100).map(c => c.phone) })
      const registered = new Set(result.registered)
      setFound(unique.filter(c => registered.has(c.phone)))
      if (!unique.some(c => registered.has(c.phone))) setNotice('Среди выбранных контактов пока нет пользователей Intent.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  async function importVcard(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setWorking(true); setError(''); setNotice(''); setFound([])
    try {
      const unique = [...new Map(parseVCardContacts(await file.text()).map(contact => [contact.phone, contact])).values()].slice(0, 100)
      if (!unique.length) { setNotice('В файле не найдены телефонные номера в международном формате.'); return }
      const result = await api<{ registered: string[] }>('/contacts/lookup', 'POST', { phones: unique.map(contact => contact.phone) })
      const registered = new Set(result.registered)
      setFound(unique.filter(contact => registered.has(contact.phone)))
      if (!unique.some(contact => registered.has(contact.phone))) setNotice('Среди выбранных контактов пока нет пользователей Intent.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  return <section className="d-panel d-settings-card"><h2>Взаимодействие с людьми</h2>
    <p>Найдите пользователя по номеру телефона и пригласите его на разовое событие. После принятия у него появится личная копия события.</p>
    <form className="d-form" onSubmit={e => { e.preventDefault(); void action(async () => {
      await api('/invitations', 'POST', { activityId, recipient: recipient.includes('@') ? recipient : normalizePhone(recipient) })
      setRecipient(''); setNotice('Приглашение отправлено внутри приложения.')
    }) }}>
      <label>Событие<select required value={activityId} onChange={e => setActivityId(e.target.value)}><option value="">Выберите сохранённое событие</option>{events.map(a => <option key={a.id} value={a.id}>{a.title} · {a.start} {a.time}</option>)}</select></label>
      <label>Номер участника или почта<input required type="text" inputMode="tel" maxLength={80} value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="+7 701 123 45 67" /></label>
      {dirty && <p>Сначала синхронизируйте изменения ежедневника.</p>}
      <button className="d-primary" disabled={busy || working || dirty || !activityId}>Отправить приглашение</button>
    </form>
    {contactPickerAvailable && <button disabled={working} onClick={() => void chooseContacts()}>{working ? 'Проверяем…' : 'Найти среди контактов телефона'}</button>}
    <label className="d-hint">Импортировать контакты из файла vCard (.vcf)<input type="file" accept=".vcf,text/vcard" disabled={working} onChange={event => void importVcard(event)} /></label>
    <p className="d-hint">Можно выбрать контакты в браузере или импортировать .vcf. На сервер отправляются только номера телефонов для поиска; имена остаются на устройстве.</p>
    {found.map(contact => <article key={contact.phone}><h3>{contact.name}</h3><p>{contact.phone} · использует Intent</p><button disabled={working || busy || dirty || !activityId} onClick={() => void action(async () => { await api('/invitations', 'POST', { activityId, recipient: contact.phone }); setNotice(`Приглашение отправлено: ${contact.name}.`) })}>Пригласить</button></article>)}
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
