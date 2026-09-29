import { useEffect, useRef, useState } from 'react'
import { Plus, RefreshCw, Star, X, ArrowRight, Bell } from 'lucide-react'
import { api, errorMessage } from './api'
import { existingPush, disablePush } from './push'
import { blankActivity, canSaveReminderDirectly, emptyPlanner, localDate, markLabels, occurs, overlaps, plusDays, scheduleLabel, weekdays, type Activity, type Mark, type PlannerData, type Proposal } from './planner-model'

export default function Planner({ view, readOnly, onError, onPending, initialRequest = '', onInitialHandled }: { view: 'today' | 'calendar'; readOnly: boolean; onError(error: unknown): Promise<void>; onPending(value: boolean): void; initialRequest?: string; onInitialHandled?(value: string): void }) {
  const [data, setData] = useState<PlannerData>(emptyPlanner)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [day, setDay] = useState('')
  const [mode, setMode] = useState<'day' | 'week' | 'month'>('week')
  const [editing, setEditing] = useState<Activity | null>(null)
  const [marking, setMarking] = useState<{ activity: Activity; date: string } | null>(null)
  const [archive, setArchive] = useState(false)
  const [prompt, setPrompt] = useState(initialRequest)
  const [assistantOpen, setAssistantOpen] = useState(!!initialRequest)
  const initialSent = useRef(false)
  const [history, setHistory] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [drafts, setDrafts] = useState<Activity[]>([])
  const [autoAdded, setAutoAdded] = useState<Activity | null>(null)
  const [draftIndex, setDraftIndex] = useState<number | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [tick, setTick] = useState(Date.now())
  const today = localDate(data.timezone, new Date(tick))
  const selectedDay = view === 'today' ? today : day || today
  const locked = busy || aiBusy || readOnly || !ready
  useEffect(() => { onPending(busy || aiBusy || !!editing || !!marking || !!prompt || !!history || drafts.length > 0); return () => onPending(false) }, [busy, aiBusy, editing, marking, prompt, history, drafts, onPending])
  async function refresh() {
    setBusy(true)
    try { const result = await api<PlannerData>('/planner'); setData(result.version ? result : { ...result, timezone: emptyPlanner().timezone }); setReady(true) }
    catch (error) { await onError(error) }
    finally { setBusy(false) }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => { let alive = true; void existingPush().then(value => { if (alive) setPushEnabled(!!value) }).catch(() => {}); return () => { alive = false } }, [])
  useEffect(() => {
    if (ready && initialRequest && !initialSent.current && !readOnly) {
      initialSent.current = true; void propose(); onInitialHandled?.('')
    }
  }, [ready, initialRequest, readOnly])
  useEffect(() => { const timer = window.setInterval(() => setTick(Date.now()), 30000); return () => clearInterval(timer) }, [])
  async function save(next: PlannerData) {
    setBusy(true); setNotice('')
    try { const result = await api<PlannerData>('/planner', 'PUT', next); setData(result); return true }
    catch (error) { await onError(error); return false }
    finally { setBusy(false) }
  }
  function getMark(a: Activity, date: string): Mark { return data.marks.find(m => m.activityId === a.id && m.date === date) || { activityId: a.id, date, status: 'missed', focus: false, time: null } }
  async function mark(a: Activity, date: string, change: Partial<Mark>) {
    const next = { ...getMark(a, date), ...change }
    if (await save({ ...data, marks: [...data.marks.filter(m => !(m.activityId === a.id && m.date === date)), next] })) setMarking(null)
  }
  async function saveActivity(value: Activity) {
    if (draftIndex !== null) { setDrafts(drafts.map((a, i) => i === draftIndex ? value : a)); setDraftIndex(null); setEditing(null); return }
    if (await save({ ...data, activities: [...data.activities.filter(a => a.id !== value.id), value] })) { setEditing(null); setAutoAdded(previous => previous?.id === value.id ? value : previous) }
  }
  async function propose() {
    setAiBusy(true); setNotice('')
    const text = [history, prompt].filter(Boolean).join('\n')
    try {
      const result = await api<Proposal>('/planner/propose', 'POST', { text, timezone: data.timezone })
      const proposed = result.activities.map(a => ({ ...a, id: crypto.randomUUID(), archived: false }))
      setProposal(result); setDrafts(proposed)
      setHistory(result.clarification ? `${text}\nАгент: ${result.message}` : ''); setPrompt('')
      if (!history && canSaveReminderDirectly(text, result, today)) {
        if (await save({ ...data, activities: [...data.activities, ...proposed] })) {
          setAutoAdded(proposed[0]); setDrafts([]); setProposal(null)
          setNotice(`Добавлено: ${proposed[0].title} · ${proposed[0].start} · ${scheduleLabel(proposed[0])}`)
        }
      }
    } catch (error) { await onError(error) }
    finally { setAiBusy(false) }
  }
  async function enableNotifications() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Этот браузер не поддерживает push-уведомления. На iPhone откройте установленное приложение с экрана «Домой».')
      const config = await api<{ publicKey: string }>('/push/config')
      if (!config.publicKey) throw new Error('Уведомления ещё не настроены на сервере. Напоминания сохраняются в календаре.')
      if (await Notification.requestPermission() !== 'granted') throw new Error('Разрешение на уведомления не получено.')
      const registration = await navigator.serviceWorker.ready
      const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      await api('/push/subscribe', 'POST', subscription.toJSON())
      setPushEnabled(true)
      setNotice('Напоминания включены на этом устройстве.')
    } catch (error) { setNotice(error instanceof Error ? error.message : errorMessage(error)) }
  }
  const active = data.activities.filter(a => !a.archived)
  const scheduled = (date: string) => active.filter(a => occurs(a, date)).sort((a, b) => {
    if (view === 'today' && getMark(a, date).focus !== getMark(b, date).focus) return getMark(a, date).focus ? -1 : 1
    return (getMark(a, date).time || a.time || '99').localeCompare(getMark(b, date).time || b.time || '99')
  })
  const first = selectedDay.slice(0, 7) + '-01'
  const monthDays = Array.from({ length: new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0).getDate() }, (_, i) => plusDays(first, i))
  const monday = plusDays(selectedDay, -((new Date(selectedDay + 'T12:00:00Z').getUTCDay() + 6) % 7))
  const days = view === 'today' || mode === 'day' ? [selectedDay] : Array.from({ length: 7 }, (_, i) => plusDays(monday, i))
  function dayRows(date: string) {
    const items = scheduled(date)
    return items.length ? items.map(a => {
      const m = getMark(a, date)
      const state = m.status === 'missed' && date >= today ? 'pending' : m.status
      return <article key={a.id} className={`agenda-row ${m.focus ? 'focused' : ''}`}>
        <div className="agenda-time">{m.time || a.time || 'В течение дня'}{a.time && <small>{a.duration} мин</small>}</div>
        <button className="agenda-title" disabled={locked} onClick={() => { setDraftIndex(null); setEditing(a) }}><strong>{a.title}</strong><small>{a.program ? 'Открыть программу' : scheduleLabel(a)}</small></button>
        <button className={`focus-button ${m.focus ? 'on' : ''}`} disabled={locked} aria-label={`${m.focus ? 'Убрать фокус' : 'В фокус'}: ${a.title}`} onClick={() => void mark(a, date, { focus: !m.focus })}><Star size={17} /></button>
        <button className={`day-state ${state}`} disabled={locked} onClick={() => setMarking({ activity: a, date })}>{state === 'pending' ? 'Отметить' : markLabels[m.status]}</button>
      </article>
    }) : <p className="muted agenda-empty">На этот день ничего не запланировано.</p>
  }
  return <>
    <div className="page-heading"><div><h1>{view === 'today' ? 'Сегодня' : 'Календарь'}</h1><p>{view === 'today' ? 'Ваши дела и фокус на день.' : 'События, привычки и задачи по времени.'}</p></div><button className="primary-button" disabled={locked} onClick={() => { setDraftIndex(null); setEditing(blankActivity(selectedDay)) }}><Plus size={16} />Добавить</button></div>
    {notice && <div role="status" className="banner notice-banner">{notice}<button onClick={() => setNotice('')} aria-label="Закрыть уведомление"><X size={16} /></button></div>}
    {autoAdded && <div className="banner notice-banner"><span>Напоминание записано по вашей просьбе.</span><button disabled={locked} onClick={() => { setDraftIndex(null); setEditing(autoAdded) }}>Изменить</button><button disabled={locked} onClick={async () => { if (await save({ ...data, activities: data.activities.filter(a => a.id !== autoAdded.id), marks: data.marks.filter(m => m.activityId !== autoAdded.id) })) { setAutoAdded(null); setNotice('Добавление отменено.') } }}>Отменить добавление</button></div>}
    {readOnly && <p className="muted">Для загрузки и изменения календаря нужно подключение.</p>}
    <div className="planner-tools"><button className="text-button" onClick={() => void refresh()} disabled={busy || readOnly}><RefreshCw size={15} />Обновить</button><button className="text-button" disabled={locked} onClick={() => void enableNotifications()}><Bell size={15} />{pushEnabled ? "Напоминания включены" : "Напоминания"}</button>{pushEnabled && <button className="text-button" disabled={locked} onClick={async () => { try { await disablePush(); setPushEnabled(false); setNotice("Уведомления отключены на этом устройстве.") } catch (error) { await onError(error) } }}>Отключить</button>}<label>Часовой пояс <input aria-label="Часовой пояс" defaultValue={data.timezone} key={data.timezone} disabled={locked} onBlur={e => { if (e.target.value !== data.timezone) { try { localDate(e.target.value); void save({ ...data, timezone: e.target.value }) } catch { setNotice('Укажите часовой пояс, например Asia/Qyzylorda.') } } }} /></label></div>
    {view === 'calendar' && <details className="card schedule-assistant" open={assistantOpen} onToggle={e => setAssistantOpen(e.currentTarget.open)}><summary>Составить расписание с агентом</summary><p className="muted">Опишите событие или желаемый режим. Например: «12 ноября той у друга, напомни за день».</p>{proposal && <p role="status">{proposal.message}</p>}<form onSubmit={e => { e.preventDefault(); void propose() }}><label className="sr-only" htmlFor="schedule-prompt">Запрос к планировщику</label><textarea id="schedule-prompt" value={prompt} maxLength={Math.max(0, 6000 - history.length - 1)} onChange={e => setPrompt(e.target.value)} placeholder={history ? 'Ответьте на уточнение…' : 'Что и когда запланировать?'} required disabled={locked} /><button className="primary-button" disabled={locked || !prompt.trim()}>{aiBusy ? 'Составляю…' : 'Предложить расписание'}<ArrowRight size={16} /></button><button type="button" className="text-button" disabled={busy || aiBusy} onClick={() => { setHistory(''); setProposal(null); setDrafts([]); setPrompt('') }}>Новый запрос</button></form>
      {drafts.length > 0 && <div className="schedule-proposal"><p className="muted">Проверьте даты, время и программу. Пока ничего не сохранено.</p>{drafts.map((a, i) => <div key={a.id}><strong>{a.title}</strong><p>{a.start}{a.end ? ` — ${a.end}` : ''} · {scheduleLabel(a)}</p>{a.program && <p className="program-text">{a.program}</p>}<button className="text-button" onClick={() => { setDraftIndex(i); setEditing(a) }}>Изменить</button><button className="text-button" onClick={() => setDrafts(drafts.filter(d => d.id !== a.id))}>Убрать</button>{[...active, ...drafts.filter(d => d.id !== a.id)].some(b => Array.from({ length: 31 }, (_, n) => plusDays(a.start, n)).some(d => overlaps(a, b, d))) && <p className="conflict-note">Есть пересечение по времени в ближайшие 31 день. Проверьте расписание.</p>}</div>)}<button className="primary-button" disabled={locked} onClick={async () => { if (await save({ ...data, activities: [...data.activities, ...drafts] })) { setDrafts([]); setProposal(null); setNotice('План добавлен в календарь.') } }}>Утвердить и добавить в календарь</button></div>}
    </details>}
    <div className="calendar-controls"><label>{view === 'today' ? <strong>{today}</strong> : <input aria-label="Дата календаря" type="date" value={selectedDay} onChange={e => { if (e.target.value) setDay(e.target.value) }} />}</label>{view === 'calendar' && <div className="filters">{(['day', 'week', 'month'] as const).map(v => <button key={v} className={mode === v ? 'active' : ''} onClick={() => setMode(v)}>{v === 'day' ? 'День' : v === 'week' ? 'Неделя' : 'Месяц'}</button>)}</div>}</div>
    {view === 'calendar' && mode === 'month' ? <><p className="tracker-legend"><span>□ Пропуск</span><span>✓ Полностью</span><span>◐ Частично</span><span>— Выходной</span><span>★ Фокус</span><span>· Предстоит</span></p><div className="tracker-scroll"><table className="tracker"><caption>{first.slice(0, 7)} · личный трекер</caption><thead><tr><th>Действие</th>{monthDays.map(d => <th key={d}>{d.slice(8)}</th>)}</tr></thead><tbody>{data.activities.filter(a => !a.archived || data.marks.some(m => m.activityId === a.id && m.date.startsWith(first.slice(0, 7)))).map(a => <tr key={a.id}><th><button disabled={locked} onClick={() => { setDraftIndex(null); setEditing(a) }}>{a.title}{a.archived ? ' (архив)' : ''}</button></th>{monthDays.map(d => { const m = getMark(a, d); const status = !occurs(a, d) ? 'rest' : m.status === 'missed' && d >= today ? 'pending' : m.status; return <td key={d}><button className={`tracker-cell ${status} ${m.focus ? 'focused' : ''}`} disabled={locked || !occurs(a, d)} aria-label={`${a.title}, ${d}: ${status === 'pending' ? 'Предстоит' : markLabels[status]}${m.focus ? ', в фокусе' : ''}`} onClick={() => setMarking({ activity: a, date: d })}>{m.focus ? '★' : ''}{status === 'done' ? '✓' : status === 'partial' ? '◐' : status === 'rest' ? '—' : status === 'pending' ? '·' : ''}</button></td> })}</tr>)}</tbody></table></div></> : <div className="agenda">{days.map(d => <section key={d}><h2>{new Date(d + 'T12:00:00Z').toLocaleDateString('ru-RU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })}</h2>{dayRows(d)}</section>)}</div>}
    {!data.activities.length && ready && <p className="muted">Добавьте свои действия — список полностью ваш.</p>}
    {view === 'calendar' && <details className="archive-list" open={archive} onToggle={e => setArchive(e.currentTarget.open)}><summary>Все действия и архив</summary>{data.activities.map(a => <div key={a.id}><button className="text-button" disabled={locked} onClick={() => { setDraftIndex(null); setEditing(a) }}>{a.title}</button><span>{a.archived ? 'В архиве' : scheduleLabel(a)}</span></div>)}</details>}
    {editing && <ActivityEditor activity={editing} busy={busy} draft={draftIndex !== null} onClose={() => { setEditing(null); setDraftIndex(null) }} onSave={saveActivity} onArchive={async () => { if (await save({ ...data, activities: data.activities.map(a => a.id === editing.id ? { ...a, archived: !a.archived } : a) })) setEditing(null) }} onDelete={async () => { if (await save({ ...data, activities: data.activities.filter(a => a.id !== editing.id), marks: data.marks.filter(m => m.activityId !== editing.id) })) setEditing(null) }} existing={data.activities.some(a => a.id === editing.id)} />}
    {marking && <MarkEditor activity={marking.activity} date={marking.date} mark={getMark(marking.activity, marking.date)} future={marking.date > today} busy={busy} onClose={() => setMarking(null)} onSave={change => mark(marking.activity, marking.date, change)} onMove={async target => {
      const original = { ...getMark(marking.activity, marking.date), status: 'rest' as const, focus: false }
      const moved = { ...marking.activity, id: crypto.randomUUID(), start: target, end: null, recurrence: 'once' as const, time: original.time || marking.activity.time, weekdays: [] }
      if (await save({ ...data, activities: [...data.activities, moved], marks: [...data.marks.filter(m => !(m.activityId === original.activityId && m.date === original.date)), original] })) setMarking(null)
    }} />}
  </>
}

function Modal({ children, onClose, busy }: { children: React.ReactNode; onClose(): void; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current!.showModal(); return () => ref.current?.close() }, [])
  return <dialog ref={ref} className="draft-dialog planner-dialog" onCancel={e => { e.preventDefault(); if (!busy) onClose() }}>{children}</dialog>
}
function ActivityEditor({ activity, busy, draft, existing, onClose, onSave, onArchive, onDelete }: { activity: Activity; busy: boolean; draft: boolean; existing: boolean; onClose(): void; onSave(a: Activity): Promise<void>; onArchive(): Promise<void>; onDelete(): Promise<void> }) {
  const [value, setValue] = useState(activity)
  const [deleting, setDeleting] = useState(false)
  function patch(update: Partial<Activity>) { setValue(v => ({ ...v, ...update })) }
  return <Modal onClose={onClose} busy={busy}><form onSubmit={e => { e.preventDefault(); void onSave(value) }}><div className="dialog-header"><h2>{existing ? 'Действие и расписание' : 'Новое действие'}</h2><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Закрыть действие"><X size={18} /></button></div><fieldset disabled={busy}>
    <label>Название<input required maxLength={160} value={value.title} onChange={e => patch({ title: e.target.value })} /></label><label>Тип<select value={value.kind} onChange={e => patch({ kind: e.target.value as Activity['kind'] })}><option value="habit">Привычка</option><option value="task">Задача</option><option value="event">Событие</option></select></label>
    <div className="form-pair"><label>Начало<input type="date" required value={value.start} onChange={e => patch({ start: e.target.value })} /></label><label>До даты (необязательно)<input type="date" min={value.start} value={value.end || ''} onChange={e => patch({ end: e.target.value || null })} /></label></div>
    <label>Повторение<select value={value.recurrence} onChange={e => patch({ recurrence: e.target.value as Activity['recurrence'] })}><option value="once">Один раз</option><option value="daily">Каждый день</option><option value="weekly">По дням недели</option><option value="yearly">Ежегодно</option></select></label>
    {value.recurrence === 'weekly' && <div className="weekday-picker">{weekdays.map((name, i) => <label key={name}><input type="checkbox" checked={value.weekdays.includes(i)} onChange={e => patch({ weekdays: e.target.checked ? [...value.weekdays, i].sort() : value.weekdays.filter(d => d !== i) })} />{name}</label>)}</div>}
    <div className="form-pair"><label>Время<input type="time" value={value.time} onChange={e => patch({ time: e.target.value, reminder: e.target.value ? value.reminder : null })} /></label><label>Длительность, минут<input type="number" min={5} max={1440} required value={value.duration} onChange={e => patch({ duration: Number(e.target.value) })} /></label></div>
    <label>Напомнить<select disabled={!value.time} value={value.reminder === null ? '' : value.reminder} onChange={e => patch({ reminder: e.target.value === '' ? null : Number(e.target.value) })}><option value="">Не напоминать</option><option value="0">В момент начала</option><option value="15">За 15 минут</option><option value="60">За час</option><option value="1440">За день</option><option value="10080">За неделю</option>{value.reminder !== null && ![0,15,60,1440,10080].includes(value.reminder) && <option value={value.reminder}>За {value.reminder} мин</option>}</select></label>
    <label>Программа или подробности<textarea rows={6} maxLength={6000} value={value.program} onChange={e => patch({ program: e.target.value })} /></label>
    {existing && <p className="muted">Изменение расписания применяется ко всей серии. Для времени одного занятия откройте его отметку в календаре.</p>}
    </fieldset><div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Отмена</button><button className="primary-button" disabled={busy || !value.title.trim() || (value.recurrence === 'weekly' && !value.weekdays.length)}>{draft ? 'Применить к предложению' : 'Сохранить'}</button></div>
    {existing && <div className="manage-activity"><button type="button" className="text-button" disabled={busy} onClick={() => void onArchive()}>{activity.archived ? 'Вернуть из архива' : 'Архивировать'}</button><button type="button" className="text-button" disabled={busy} onClick={() => setDeleting(true)}>Удалить навсегда</button>{deleting && <div role="alert"><p>Удалить «{activity.title}» и все отметки? Восстановить историю будет нельзя.</p><button type="button" className="secondary-button" disabled={busy} onClick={() => setDeleting(false)}>Оставить</button><button type="button" className="primary-button" disabled={busy} onClick={() => void onDelete()}>Подтвердить удаление</button></div>}</div>}
  </form></Modal>
}
function MarkEditor({ activity, date, mark, future, busy, onClose, onSave, onMove }: { activity: Activity; date: string; mark: Mark; future: boolean; busy: boolean; onClose(): void; onSave(m: Partial<Mark>): Promise<void>; onMove(date: string): Promise<void> }) {
  const [value, setValue] = useState(mark)
  const [moveDate, setMoveDate] = useState(date)
  return <Modal onClose={onClose} busy={busy}><form onSubmit={e => { e.preventDefault(); void onSave(value) }}><h2>{activity.title}</h2><p>{date}</p><fieldset disabled={busy}><label>Результат<select value={value.status} onChange={e => setValue({ ...value, status: e.target.value as Mark['status'] })}>{Object.entries(markLabels).map(([key, label]) => <option key={key} value={key} disabled={future && key !== 'rest' && key !== 'missed'}>{future && key === 'missed' ? 'Предстоит' : label}</option>)}</select></label><label className="focus-check"><input type="checkbox" checked={value.focus} onChange={e => setValue({ ...value, focus: e.target.checked })} />В фокусе на этот день</label><label>Время только этого занятия<input type="time" value={value.time || activity.time} onChange={e => setValue({ ...value, time: e.target.value || null })} /></label>{activity.program && <p className="program-text">{activity.program}</p>}<label>Перенести это занятие на дату<input type="date" value={moveDate} onChange={e => setMoveDate(e.target.value)} /></label><button type="button" className="text-button" disabled={!moveDate || moveDate === date || busy} onClick={() => void onMove(moveDate)}>Перенести только это занятие</button></fieldset><div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Закрыть</button><button className="primary-button" disabled={busy}>Сохранить отметку</button></div></form></Modal>
}
