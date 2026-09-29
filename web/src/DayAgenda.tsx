import { Check, MessageCircle } from 'lucide-react'
import { dayMark, tasksOn, type Diary } from './diary-model'
import type { Activity } from './planner-model'

export default function DayAgenda({ data, day, today, busy, onOpen, onToggle, onAdd }: {
  data: Diary; day: string; today: string; busy: boolean;
  onOpen(activity: Activity): void; onToggle(activity: Activity): void; onAdd(): void;
}) {
  const sections = [...data.sections, { id: '', title: 'Без раздела', group: '' }]
    .map(section => ({ ...section, tasks: tasksOn(data, day, section.id) })).filter(section => section.tasks.length)
  if (!sections.length) return <div className="d-day-empty"><p>На этот день задач пока нет.</p><button className="d-primary" disabled={busy} onClick={onAdd}>Добавить задачу</button></div>
  return <div className="d-day-list">{sections.map(section => <section className="d-day-section" aria-label={section.title} key={section.id}>
    <header><h2>{section.title}</h2><span>{section.tasks.filter(a => dayMark(data, a, day).status === 'done').length}/{section.tasks.length}</span></header>
    <ul>{section.tasks.map(a => {
      const mark = dayMark(data, a, day), completed = mark.status === 'done', time = mark.time || a.time
      return <li key={a.id} className={completed ? 'completed' : mark.status === 'partial' ? 'partial' : ''}>
        <button className="d-complete-task" aria-label={`${completed ? 'Возобновить' : 'Завершить'}: ${a.title}`} aria-pressed={completed} disabled={busy} onClick={() => onToggle(a)}>{completed ? <Check size={16} /> : mark.status === 'partial' ? '◐' : null}</button>
        <button className="d-day-task-open" aria-label={`Открыть задачу: ${a.title}`} onClick={() => onOpen(a)}><strong>{a.title}</strong>{(time || a.comments?.length || (day < today && !completed)) && <span className="d-day-task-meta">{time && <span>{time}</span>}{!!a.comments?.length && <span><MessageCircle size={12} />{a.comments.length}</span>}{day < today && !completed && <span className="d-overdue">Просрочено</span>}</span>}</button>
      </li>
    })}</ul>
  </section>)}</div>
}
