import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, RotateCcw, Sparkles } from 'lucide-react'
import { api, errorMessage } from './api'
import { scheduleLabel, type Activity, type Proposal } from './planner-model'

type Message = { role: 'user' | 'assistant'; text: string }
const examples = ['Завтра в 9:00 позвонить врачу, напомни за час', 'Каждый понедельник в 19:00 спортзал', 'У мамы день рождения 12 марта']

export default function DiaryAssistant({ timezone, busy, online = true, intro, onSave }: {
  timezone: string; busy: boolean; online?: boolean; intro?: ReactNode; onSave(activities: Activity[]): Promise<boolean>
}) {
  const [text, setText] = useState(''), [history, setHistory] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [drafts, setDrafts] = useState<Activity[]>([])
  const [working, setWorking] = useState(false), [error, setError] = useState('')
  const end = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [messages, proposal, working, error])
  async function propose() {
    if (!online) { setError('Помощник работает при подключении к интернету и серверу.'); return }
    const prompt = text.trim()
    if (!prompt || working) return
    setWorking(true); setError(''); setProposal(null); setDrafts([])
    setMessages(current => [...current, { role: 'user', text: prompt }])
    setText('')
    try {
      const context = history ? `${history}\nОтвет пользователя: ${prompt}` : prompt
      const result = await api<Proposal>('/planner/propose', 'POST', { text: context, timezone })
      setProposal(result)
      setDrafts(result.activities.map(a => ({ ...a, id: crypto.randomUUID(), archived: false })))
      setMessages(current => [...current, { role: 'assistant', text: result.message }])
      setHistory(result.clarification ? `${context}\nУточнение: ${result.message}` : '')
    } catch (err) { setError(errorMessage(err)); setMessages(current => current.slice(0, -1)); setText(prompt) }
    finally { setWorking(false) }
  }
  async function confirm() {
    if (!proposal || working) return
    setWorking(true); setError('')
    try {
      if (await onSave(drafts)) {
        setMessages(current => [...current, { role: 'assistant', text: drafts.length === 1 ? `Готово: «${drafts[0].title}» в ежедневнике.` : `Готово: добавил ${drafts.length} записи.` }])
        setProposal(null); setDrafts([]); setHistory('')
      } else setError('Не удалось сохранить. Проверьте статус синхронизации и повторите.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  function dismiss() { setProposal(null); setDrafts([]); setHistory(''); setMessages(current => [...current, { role: 'assistant', text: 'Хорошо, ничего не добавляю.' }]) }
  function reset() { setProposal(null); setDrafts([]); setHistory(''); setMessages([]); setText(''); setError('') }
  return <section className="d-chat-page" aria-label="Чат с помощником">
    <div className="d-chat-scroll" aria-live="polite">
      {!messages.length ? <div className="d-chat-welcome">
        <span className="d-chat-mark"><Sparkles size={24} /></span>
        <h1>Что нужно сделать?</h1>
        <p>Напишите своими словами — я запишу задачу, событие или привычку и напомню вовремя.</p>
        {intro}
        <div className="d-chat-examples">{examples.map(example => <button key={example} type="button" onClick={() => { setText(example); input.current?.focus() }}>{example}</button>)}</div>
      </div> : <div className="d-chat-thread">
        <button type="button" className="d-chat-reset" disabled={working} onClick={reset}><RotateCcw size={14} />Новый чат</button>
        {messages.map((message, i) => <div className={`d-chat-message ${message.role}`} key={`${i}-${message.role}`}><p>{message.text}</p></div>)}
        {working && <div className="d-chat-message assistant d-chat-typing"><p>Думаю…</p></div>}
        {proposal && !proposal.clarification && <div className="d-chat-proposal">
          <h2>Добавить в ежедневник?</h2>
          {drafts.map(a => <article key={a.id}><strong>{a.title}</strong><p>{scheduleLabel(a)}</p>{a.program && <p>{a.program}</p>}</article>)}
          <div className="d-chat-proposal-actions"><button className="d-primary" disabled={busy || working} onClick={() => void confirm()}>Добавить</button><button className="d-secondary" disabled={working} onClick={dismiss}>Не нужно</button></div>
        </div>}
      </div>}
      {error && <p role="alert" className="d-chat-error">{error}</p>}
      <div ref={end} />
    </div>
    <form className="d-chat-composer" onSubmit={e => { e.preventDefault(); void propose() }}>
      {!online && <p className="d-chat-offline" role="status">Помощнику нужен интернет. Ежедневник работает и без него.</p>}
      <div className="d-chat-input">
        <label className="sr-only" htmlFor="diary-assistant-prompt">Сообщение помощнику</label>
        <textarea ref={input} id="diary-assistant-prompt" rows={1} value={text} maxLength={Math.max(0, 6000 - history.length)}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void propose() } }}
          placeholder={history ? 'Ответьте на уточнение…' : 'Что нужно сделать?'} disabled={!online || working} />
        <button className="d-primary" aria-label="Отправить сообщение" disabled={!online || busy || working || !text.trim()}><ArrowUp size={18} /></button>
      </div>
    </form>
  </section>
}
