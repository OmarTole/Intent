import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, Search, Settings } from 'lucide-react'
import { plusDays, weekdays } from './planner-model'
import { cellStatus, groupNames, labels, type CellStatus, type Diary } from './diary-model'
import TableScroll from './TableScroll'
import './progress-table.css'

type Props = {
  data: Diary; day: string; today: string; busy: boolean
  onDay(date: string): void; onOpenDay(date: string): void
  onSection(id: string, date?: string): void; onAdd(): void; onSettings(): void
}
const format = (date: string, options: Intl.DateTimeFormatOptions) => new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', options)
const icon = (status: CellStatus) => ({ empty: '', done: '✓', partial: '◐', pending: '·', skipped: '−', missed: '×' })[status]
export function trackerDates(day: string) {
  const count = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0).getDate()
  return Array.from({ length: count }, (_, index) => plusDays(day.slice(0, 7) + '-01', index))
}
function dateClass(date: string, today: string, selected: string) {
  const weekday = new Date(date + 'T12:00:00').getDay()
  return [weekday === 0 || weekday === 6 ? 'is-weekend' : '', weekday === 6 ? 'weekend-start' : '', date === today ? 'is-today' : '', date === selected ? 'is-selected-day' : ''].join(' ')
}

export default function ProgressTable({ data, day, today, onDay, onOpenDay, onSection, onAdd, onSettings }: Props) {
  const [centerRequest, setCenterRequest] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<string[]>([])
  const dialog = useRef<HTMLDialogElement>(null)
  const expandButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!expanded) return
    const element = dialog.current!
    element.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previous; expandButton.current?.focus() }
  }, [expanded])
  const dates = trackerDates(day)
  const sections = data.sections.filter(section => section.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  function leave(action: () => void) { setExpanded(false); action() }
  function shift(amount: number) {
    {
      const target = new Date(day.slice(0, 7) + '-01T12:00:00')
      target.setMonth(target.getMonth() + amount)
      onDay(`${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-01`)
    }
  }
  const content = <section className="d-panel d-progress-table d-month-days">
    <div className="d-progress-heading">
      <h2 id="progress-title">Мой прогресс</h2>
      <button ref={expanded ? undefined : expandButton} className="d-expand-table" aria-label={expanded ? 'Свернуть таблицу' : 'Развернуть таблицу на весь экран'} title={expanded ? 'Свернуть' : 'На весь экран'} onClick={() => { setExpanded(!expanded) }}>
        {expanded ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
      </button>
    </div>
    <div className="d-progress-controls">
      <div className="d-progress-period">
        <button aria-label="Предыдущий период" onClick={() => shift(-1)}><ChevronLeft size={19} /></button>
        <strong>{format(day, { month: 'long', year: 'numeric' })}</strong>
        <button aria-label="Следующий период" onClick={() => shift(1)}><ChevronRight size={19} /></button>
      </div>
      <button className="d-progress-today" onClick={() => { onDay(today); setCenterRequest(value => value + 1) }}>Сегодня</button>
      <input aria-label="Выбранная дата" type="date" value={day} onChange={event => { if (event.target.value) onDay(event.target.value) }} />
    </div>
    <label className="d-progress-search"><Search size={17} /><input aria-label="Найти направление" placeholder="Найти направление" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <TableScroll centerKey={`${day}:${expanded}:${centerRequest}`}>
      <table className="d-tracker" aria-label="Таблица прогресса">
        <colgroup><col className="d-direction-col" /><col className="d-tracker-edge" />{dates.map(date => <col key={date} />)}<col className="d-tracker-edge" /></colgroup>
        <thead><tr><th scope="col">Направление</th><td className="d-tracker-edge" aria-hidden="true" />{dates.map(date => <th scope="col" key={date} data-center={date === day || undefined} className={dateClass(date, today, day)}>
          <button aria-label={`Открыть задачи на ${date}`} onClick={() => leave(() => onOpenDay(date))}>
            <span>{Number(date.slice(8))}</span><small>{date === today ? 'сег.' : weekdays[(new Date(date + 'T12:00:00').getDay() + 6) % 7]}</small>
          </button>
        </th>)}<td className="d-tracker-edge" aria-hidden="true" /></tr></thead>
        {groupNames(data).filter(group => !query || sections.some(section => section.group === group)).map(group => <tbody key={group}>
          <tr className="d-group-row"><th scope="rowgroup" colSpan={dates.length + 3}><button className="d-group-toggle" aria-expanded={!collapsed.includes(group)} onClick={() => setCollapsed(current => current.includes(group) ? current.filter(name => name !== group) : [...current, group])}>
            <ChevronRight size={13} className={!collapsed.includes(group) ? 'is-expanded' : ''} /><span>{group}</span>
          </button></th></tr>
          {!collapsed.includes(group) && sections.filter(section => section.group === group).map(section => <tr key={section.id}>
            <th scope="row"><button onClick={() => leave(() => onSection(section.id))}>{section.title}</button></th><td className="d-tracker-edge" aria-hidden="true" />
            {dates.map(date => {
              const status = cellStatus(data, section.id, date)
              const manual = data.sectionMarks.some(mark => mark.sectionId === section.id && mark.date === date)
              const label = `${section.title}, ${date}: ${labels[status]}${manual ? ', вручную' : ''}`
              return <td key={date} className={dateClass(date, today, day)}><button aria-label={label} title={label} className={`d-cell ${status} ${manual ? 'manual' : ''}`} onClick={() => leave(() => onSection(section.id, date))}>{icon(status)}</button></td>
            })}<td className="d-tracker-edge" aria-hidden="true" />
          </tr>)}
        </tbody>)}
      </table>
    </TableScroll>
    {!sections.length && <p className="d-progress-empty">{data.sections.length ? 'Направления не найдены.' : 'Добавьте первое направление — например, «Работа» или «Здоровье».'}</p>}
    <div className="d-table-footer">
      <button onClick={() => leave(onAdd)}><Plus size={17} />Направление</button>
      <button aria-label="Настроить группы и порядок" onClick={() => leave(onSettings)}><Settings size={17} />Группы и порядок</button>
      <div className="d-legend">{(['done', 'partial', 'pending', 'skipped', 'missed'] as const).map(status => <span key={status}><i className={status} />{labels[status]}</span>)}</div>
    </div>
  </section>
  return expanded ? <dialog ref={dialog} className="d-progress-fullscreen" aria-labelledby="progress-title" onCancel={event => { event.preventDefault(); setExpanded(false) }}>{content}</dialog> : content
}
