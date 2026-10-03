import { useState } from 'react'
import { Check, ChevronDown, Clock, MessageCircle } from 'lucide-react'
import { validDate, weekdays, type Activity, type Mark, type TaskEntry } from './planner-model'
import { dayMark, type Diary } from './diary-model'

const displayDate = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
const entry = (text: string): TaskEntry => ({ id: crypto.randomUUID(), at: new Date().toISOString(), text })

export default function TaskForm({ value, date, data, busy, onSave }: {
  value: Activity; date: string; data: Diary; busy: boolean;
  onSave(a: Activity, date: string, mark?: Mark, only?: boolean): Promise<void>;
}) {
  const [a, setA] = useState(value)
  const [mark, setMark] = useState(dayMark(data, value, date))
  const [comment, setComment] = useState('')
  const [only, setOnly] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [duration, setDuration] = useState(value.time ? String(value.duration) : '')
  const [saveError, setSaveError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const existing = data.activities.some(v => v.id === a.id)
  const patch = (p: Partial<Activity>) => setA(v => ({ ...v, ...p }))
  async function submit() {
    setSaveError('')
    if (!a.title.trim()) { setSaveError('Введите название задачи.'); return }
    if (!validDate(a.start)) { setSaveError('Укажите корректную дату задачи.'); return }
    if (a.end && !validDate(a.end)) { setAdvanced(true); setSaveError('Укажите корректную дату окончания.'); return }
    if (a.recurrence === 'weekly' && !a.weekdays.length) { setSaveError('Выберите хотя бы один день недели для повторения.'); return }
    if (a.end && a.end < a.start && a.recurrence !== 'once') { setAdvanced(true); setSaveError('Дата окончания повторений должна быть не раньше даты начала.'); return }
    if (duration && (!Number.isInteger(Number(duration)) || Number(duration) < 5 || Number(duration) > 1440)) { setAdvanced(true); setSaveError('Укажите длительность от 5 до 1440 минут или оставьте поле пустым.'); return }
    const next = { ...a, duration: duration ? Number(duration) : value.duration || 30,
      end: a.recurrence === 'once' ? null : a.end,
      comments: comment.trim() ? [...(a.comments || []), entry(comment.trim())] : a.comments }
    setSubmitting(true)
    try { await onSave(next, date, { ...mark, time: only || a.time !== value.time ? null : mark.time, date: a.recurrence === 'once' ? a.start : date }, only) }
    catch (error) { setSaveError(error instanceof Error ? error.message : 'Не удалось сохранить задачу. Повторите попытку.') }
    finally { setSubmitting(false) }
  }
  return <form className="d-form d-task-form" noValidate onSubmit={e => { e.preventDefault(); if (!submitting && !busy) void submit() }}>
    <fieldset disabled={busy || submitting}>
      <input aria-label="Название задачи" className="d-title-input" required autoFocus maxLength={160} placeholder="Что хотите сделать?" value={a.title} onChange={e => patch({ title: e.target.value })} />
      <div className="d-form-pair">
        <label>Направление<select value={a.sectionId || ''} onChange={e => patch({ sectionId: e.target.value || null })}><option value="">Без раздела</option>{data.sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        <label>Тип<select value={a.kind} onChange={e => patch({ kind: e.target.value as Activity['kind'] })}><option value="task">Задача</option><option value="habit">Привычка</option><option value="event">Событие</option></select></label>
      </div>
      <label>Описание<textarea maxLength={6000} rows={3} placeholder="Необязательно — детали, идеи, важные мелочи…" value={a.program} onChange={e => patch({ program: e.target.value })} /></label>
      <div className="d-form-pair">
        <label>Дата<input required type="date" value={a.start} onChange={e => patch({ start: e.target.value })} /></label>
        <label>Повторение<select value={a.recurrence} onChange={e => patch({ recurrence: e.target.value as Activity['recurrence'] })}><option value="once">Без повторения</option><option value="daily">Каждый день</option><option value="weekly">По дням недели</option><option value="monthly">Каждый месяц</option><option value="yearly">Каждый год</option></select></label>
      </div>
      {a.recurrence === 'weekly' && <div className="d-weekdays">{weekdays.map((w, i) => <label key={w}><input type="checkbox" checked={a.weekdays.includes(i)} onChange={e => patch({ weekdays: e.target.checked ? [...a.weekdays, i].sort() : a.weekdays.filter(d => d !== i) })} />{w}</label>)}</div>}
      <button type="button" className="d-advanced-toggle" aria-expanded={advanced} aria-controls="task-advanced" onClick={() => setAdvanced(!advanced)}><span>Расширенные настройки<small>Необязательно</small></span><ChevronDown size={18} style={{ transform: advanced ? 'rotate(180deg)' : undefined }} /></button>
      {advanced && <div id="task-advanced" className="d-advanced-fields">
        {a.recurrence !== 'once' && <label>Повторять до<input type="date" min={a.start} value={a.end || ''} onChange={e => patch({ end: e.target.value || null })} /></label>}
        <div className="d-form-pair"><label>Время<input type="time" value={a.time} onChange={e => patch({ time: e.target.value, reminder: e.target.value ? a.reminder : null, reminderOffsets: e.target.value ? a.reminderOffsets : [] })} /></label><label>Длительность, минут<input type="number" min={5} max={1440} placeholder="Необязательно" value={duration} onChange={e => setDuration(e.target.value)} /></label></div>
        <label>Напомнить на телефон<select disabled={!a.time} value={a.reminder ?? ''} onChange={e => patch({ reminder: e.target.value === '' ? null : Number(e.target.value) })}><option value="">Без напоминания</option>{[[0,'В момент начала'],[15,'За 15 минут'],[60,'За час'],[1440,'За день'],[10080,'За неделю']].map(([v,t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <div className="d-weekdays">{([0, 1440, 10080] as const).map(minutes => <label key={minutes}><input type="checkbox" disabled={!a.time} checked={(a.reminderOffsets || []).includes(minutes)} onChange={e => patch({ reminderOffsets: e.target.checked ? [...(a.reminderOffsets || []), minutes] : (a.reminderOffsets || []).filter(m => m !== minutes) })} />{minutes === 0 ? 'Также в день события' : minutes === 1440 ? 'Также за день' : 'Также за неделю'}</label>)}</div>
        <label>Связанное событие<select value={a.parentEventId || ''} onChange={e => patch({ parentEventId: e.target.value || null })}><option value="">Без связи</option>{data.activities.filter(v => v.kind === 'event' && v.id !== a.id && !v.archived).map(v => <option key={v.id} value={v.id}>{v.title}</option>)}</select></label>
        {a.kind === 'event' && data.activities.some(v => v.parentEventId === a.id) && <div className="d-linked-tasks"><h3>Связанные задачи</h3>{data.activities.filter(v => v.parentEventId === a.id).map(v => <p key={v.id}>{v.title} · {displayDate(v.start)}</p>)}</div>}
        <label>Выполнение за {displayDate(a.recurrence === 'once' ? a.start : date)}<select value={mark.status} onChange={e => setMark({ ...mark, status: e.target.value as Mark['status'] })}><option value="missed">Запланировано</option><option value="partial">Частично выполнено</option><option value="done">Полностью выполнено</option><option value="rest">Пропустить в этот день</option></select></label>
        {existing && value.recurrence !== 'once' && <label>Применить изменения<select value={only ? 'one' : 'series'} onChange={e => setOnly(e.target.value === 'one')}><option value="series">Ко всей серии (отметка — только за выбранный день)</option><option value="one">Только к событию за {date}</option></select></label>}
        <h3>Комментарии и история</h3><label>Новый комментарий<textarea rows={3} maxLength={3000} value={comment} placeholder="Как всё прошло? Что нужно учесть?" onChange={e => setComment(e.target.value)} /></label>
        <div className="d-timeline">{[...(a.comments || []).map(e => ({ ...e, comment: true })), ...(a.history || []).map(e => ({ ...e, comment: false }))].sort((x, y) => y.at.localeCompare(x.at)).map(e => <article key={e.id}><span>{e.comment ? <MessageCircle size={15} /> : <Clock size={15} />}</span><div><small>{e.comment ? 'Комментарий' : 'История'} · {new Date(e.at).toLocaleString('ru-RU', { timeZone: data.timezone })}</small><p>{e.text}</p></div></article>)}</div>
        {existing && <button type="button" className="d-secondary" onClick={() => void onSave({ ...a, archived: !a.archived }, date).catch(error => setSaveError(error instanceof Error ? error.message : 'Не удалось сохранить изменения.'))}>{a.archived ? 'Восстановить' : 'В архив'}</button>}
      </div>}
    </fieldset>
    {saveError && <p role="alert" className="d-save-error">{saveError}</p>}
    <footer className="d-form-actions"><button type="submit" className="d-primary" disabled={busy || submitting}><Check size={16} />{busy || submitting ? 'Сохраняем…' : 'Сохранить'}</button></footer>
  </form>
}
