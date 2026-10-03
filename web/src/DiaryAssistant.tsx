import { useState } from 'react'
import { api, errorMessage } from './api'
import { scheduleLabel, type Activity, type Proposal } from './planner-model'

export default function DiaryAssistant({ timezone, busy, onSave }: {
  timezone: string; busy: boolean; onSave(activities: Activity[]): Promise<boolean>
}) {
  const [text, setText] = useState(''), [history, setHistory] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [drafts, setDrafts] = useState<Activity[]>([])
  const [working, setWorking] = useState(false), [error, setError] = useState('')
  async function propose() {
    setWorking(true); setError(''); setProposal(null); setDrafts([])
    try {
      const context = history ? `${history}\nОтвет пользователя: ${text}` : text
      const result = await api<Proposal>('/planner/propose', 'POST', { text: context, timezone })
      setProposal(result)
      setDrafts(result.activities.map(a => ({ ...a, id: crypto.randomUUID(), archived: false })))
      setHistory(result.clarification ? `${context}\nУточнение: ${result.message}` : '')
      setText('')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  async function confirm() {
    if (!proposal || working) return
    setWorking(true); setError('')
    try {
      if (await onSave(drafts)) {
        setProposal(null); setDrafts([]); setHistory('')
      } else setError('Предложение не удалось сохранить. Проверьте статус синхронизации.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  return <details className="d-panel d-settings-card"><summary>Помощник — запланировать словами</summary>
    <p>Опишите дело и срок. Помощник предложит черновик; сохранение — после вашего подтверждения. Запрос и часть расписания обрабатывает модель на сервере.</p>
    <form className="d-form" onSubmit={e => { e.preventDefault(); void propose() }}>
      <label>Запрос помощнику<textarea required maxLength={Math.max(1, 5000 - history.length)} value={text} onChange={e => setText(e.target.value)} placeholder="Завтра в 18:00 встреча, напомни за час" /></label>
      <button className="d-primary" disabled={busy || working || !text.trim() || history.length > 5000}>{working ? 'Подождите…' : 'Предложить план'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {proposal && <div><p role="status">{proposal.message}</p>{proposal.activities.map((a, i) => <article key={i}><strong>{a.title}</strong><p>{scheduleLabel({ ...a, id: '', archived: false })}</p>{a.program && <p>{a.program}</p>}</article>)}
      {!proposal.clarification && <button className="d-primary" disabled={busy || working} onClick={() => void confirm()}>Подтвердить и сохранить</button>}
    </div>}
    <button disabled={working} onClick={() => { setProposal(null); setDrafts([]); setHistory(''); setText(''); setError('') }}>Новый запрос</button>
  </details>
}
