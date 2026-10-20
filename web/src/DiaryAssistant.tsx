import { useState } from 'react'
import { ArrowUp, Sparkles } from 'lucide-react'
import { api, errorMessage } from './api'
import { scheduleLabel, type Activity, type Proposal } from './planner-model'

type Message = { role: 'user' | 'assistant'; text: string }

export default function DiaryAssistant({ timezone, busy, online = true, onSave }: {
  timezone: string; busy: boolean; online?: boolean; onSave(activities: Activity[]): Promise<boolean>
}) {
  const [text, setText] = useState(''), [history, setHistory] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [drafts, setDrafts] = useState<Activity[]>([])
  const [working, setWorking] = useState(false), [error, setError] = useState('')
  async function propose() {
    if (!online) { setError('Помощник работает при подключении к интернету и серверу.'); return }
    const prompt = text.trim()
    if (!prompt || working) return
    setWorking(true); setError(''); setProposal(null); setDrafts([])
    setMessages(current => [...current, { role: 'user', text: prompt }])
    try {
      const context = history ? `${history}\nОтвет пользователя: ${prompt}` : prompt
      const result = await api<Proposal>('/planner/propose', 'POST', { text: context, timezone })
      setProposal(result)
      setDrafts(result.activities.map(a => ({ ...a, id: crypto.randomUUID(), archived: false })))
      setMessages(current => [...current, { role: 'assistant', text: result.message }])
      setHistory(result.clarification ? `${context}\nУточнение: ${result.message}` : '')
      setText('')
    } catch (err) { setError(errorMessage(err)); setMessages(current => current.slice(0, -1)) }
    finally { setWorking(false) }
  }
  async function confirm() {
    if (!proposal || working) return
    setWorking(true); setError('')
    try {
      if (await onSave(drafts)) {
        setMessages(current => [...current, { role: 'assistant', text: 'Готово, добавил в ваш ежедневник.' }])
        setProposal(null); setDrafts([]); setHistory('')
      } else setError('Предложение не удалось сохранить. Проверьте статус синхронизации.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  function reset() { setProposal(null); setDrafts([]); setHistory(''); setMessages([]); setText(''); setError('') }
  return <section className="d-assistant-page">
    <header className="d-assistant-heading"><span className="d-assistant-mark"><Sparkles size={22} /></span><div><h1>Помощник</h1><p>Планы и задачи простыми словами</p></div><button className="d-secondary" disabled={working} onClick={reset}>Новый чат</button></header>
    {!online && <p className="d-assistant-status" role="status">Чтобы отвечать, помощнику нужен интернет и доступный сервер. Ваш ежедневник можно использовать офлайн.</p>}
    <div className="d-assistant-chat" aria-live="polite">
      {!messages.length && <div className="d-assistant-empty"><Sparkles size={26} /><h2>Чем помочь?</h2><p>Например: «В четверг встреча в 15:00 на полтора часа, напомни за 30 минут».</p></div>}
      {messages.map((message, i) => <div className={`d-chat-message ${message.role}`} key={`${i}-${message.role}`}><span>{message.role === 'user' ? 'Вы' : 'Intent'}</span><p>{message.text}</p></div>)}
      {working && <div className="d-chat-message assistant"><span>Intent</span><p>Думаю над вашим запросом…</p></div>}
      {proposal && !proposal.clarification && <div className="d-assistant-proposal"><h2>Черновик события</h2><p>Проверьте детали перед добавлением.</p>{drafts.map(a => <article key={a.id}><strong>{a.title}</strong><p>{scheduleLabel(a)}</p>{a.program && <p>{a.program}</p>}</article>)}<button className="d-primary" disabled={busy || working} onClick={() => void confirm()}>Подтвердить и сохранить</button></div>}
      {error && <p role="alert" className="d-assistant-error">{error}</p>}
    </div>
    <form className="d-assistant-composer" onSubmit={e => { e.preventDefault(); void propose() }}>
      <label className="sr-only" htmlFor="diary-assistant-prompt">Сообщение помощнику</label>
      <textarea id="diary-assistant-prompt" value={text} maxLength={Math.max(0, 6000 - history.length)} onChange={e => setText(e.target.value)} placeholder={history ? 'Ответьте на уточнение…' : 'Напишите, что нужно запланировать'} disabled={!online || working} />
      <button className="d-primary" aria-label="Отправить сообщение" disabled={!online || busy || working || !text.trim()}>{working ? '…' : <ArrowUp size={18} />}</button>
      <small>Помощник предложит черновик. Запись появится только после вашего подтверждения.</small>
    </form>
  </section>
}
