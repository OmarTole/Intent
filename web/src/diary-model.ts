import { emptyPlanner, occurs, type Activity, type Mark, type PlannerData } from './planner-model'
export type Section = { id: string; title: string; group: string; position?: number }
export type CellStatus = 'empty' | 'pending' | 'partial' | 'done' | 'skipped' | 'missed'
export type SectionMark = { sectionId: string; date: string; status: CellStatus }
export type Diary = PlannerData & { sections: Section[]; sectionMarks: SectionMark[]; groups?: string[] | null }
export const groups = ['Обязательное', 'Хочу внедрить', 'На выбор', 'Без вредных привычек']
export function groupNames(data: Diary): string[] { return data.groups ?? [...new Set([...data.sections.map(s => s.group), ...groups])] }
export function orderedSections(data: Diary): Section[] {
  const names = groupNames(data)
  return [...data.sections].sort((a, b) => names.indexOf(a.group) - names.indexOf(b.group) || (a.position || 0) - (b.position || 0))
}
export const labels: Record<CellStatus, string> = { empty: 'Без отметки', pending: 'Запланировано', partial: 'Частично', done: 'Выполнено', skipped: 'Намеренный пропуск', missed: 'Пропуск' }
export function emptyDiary(): Diary { return { ...emptyPlanner(), sections: [], sectionMarks: [] } }
export function normalize(data: PlannerData & Partial<Diary>): Diary { return { ...data, sections: data.sections || [], sectionMarks: data.sectionMarks || [] } }
export function dayMark(data: Diary, activity: Activity, day: string): Mark {
  return data.marks.find(m => m.activityId === activity.id && m.date === day) || { activityId: activity.id, date: day, status: 'missed', focus: false, time: null }
}
export function tasksOn(data: Diary, day: string, section?: string) {
  return data.activities.filter(a => !a.archived && occurs(a, day) && (section === undefined || (a.sectionId || '') === section) && dayMark(data, a, day).status !== 'rest')
    .sort((a, b) => (dayMark(data, a, day).time || a.time || '99').localeCompare(dayMark(data, b, day).time || b.time || '99'))
}
export function automaticStatus(data: Diary, day: string, section?: string): CellStatus {
  const tasks = tasksOn(data, day, section)
  if (!tasks.length) return 'empty'
  const statuses = tasks.map(a => dayMark(data, a, day).status)
  return statuses.every(s => s === 'done') ? 'done' : statuses.some(s => s === 'done' || s === 'partial') ? 'partial' : 'pending'
}
export function cellStatus(data: Diary, section: string, day: string): CellStatus {
  return data.sectionMarks.find(m => m.sectionId === section && m.date === day)?.status ?? automaticStatus(data, day, section)
}
export function calendarStatus(data: Diary, day: string): CellStatus {
  const states = [...data.sections.map(s => cellStatus(data, s.id, day)), automaticStatus(data, day, '')].filter(s => s !== 'empty')
  return !states.length ? 'empty' : states.every(s => s === 'done') ? 'done' : states.some(s => s === 'done' || s === 'partial') ? 'partial' : 'pending'
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export class MergeConflict extends Error {}
// Merge independent records; edits to the same record require an explicit choice.
export function mergeDiary(base: Diary, local: Diary, remote: Diary, prefer?: 'local' | 'remote'): Diary {
  function scalar<T>(b: T, l: T, r: T): T {
    if (equal(l, b)) return r
    if (equal(r, b) || equal(l, r)) return l
    if (prefer) return prefer === 'local' ? l : r
    throw new MergeConflict('Одни и те же данные изменены на другом устройстве.')
  }
  function rows<T>(b: T[], l: T[], r: T[], key: (v: T) => string): T[] {
    const bm = new Map(b.map(v => [key(v), v])), lm = new Map(l.map(v => [key(v), v])), rm = new Map(r.map(v => [key(v), v]))
    return [...new Set([...rm.keys(), ...lm.keys(), ...bm.keys()])].map(k => scalar(bm.get(k), lm.get(k), rm.get(k))).filter((v): v is T => v !== undefined)
  }
  return { version: remote.version, timezone: scalar(base.timezone, local.timezone, remote.timezone),
    groups: scalar(base.groups ?? null, local.groups ?? null, remote.groups ?? null),
    sections: rows(base.sections, local.sections, remote.sections, v => v.id),
    activities: rows(base.activities, local.activities, remote.activities, v => v.id),
    marks: rows(base.marks, local.marks, remote.marks, v => v.activityId + v.date),
    sectionMarks: rows(base.sectionMarks, local.sectionMarks, remote.sectionMarks, v => v.sectionId + v.date) }
}
