export type Activity = {
  id: string; title: string; kind: 'habit' | 'task' | 'event'; start: string; end: string | null;
  time: string; duration: number; recurrence: 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  weekdays: number[]; reminder: number | null; program: string; archived: boolean;
  sectionId?: string | null; comments?: TaskEntry[]; history?: TaskEntry[];
  parentEventId?: string | null; reminderOffsets?: number[];
}
export type TaskEntry = { id: string; text: string; at: string }
export type Mark = { activityId: string; date: string; status: 'missed' | 'partial' | 'done' | 'rest'; focus: boolean; time: string | null }
export type PlannerData = { version: number; timezone: string; activities: Activity[]; marks: Mark[] }
export type Proposal = { message: string; clarification: boolean; activities: Omit<Activity, 'id' | 'archived'>[] }
export const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export function validDate(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const value = new Date(day + 'T12:00:00Z')
  return !Number.isNaN(value.getTime()) && value.toISOString().slice(0, 10) === day
}
export function localDate(zone: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key)!.value).join('-')
}
export function plusDays(day: string, n: number) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export function occurs(a: Activity, day: string) {
  if (day < a.start || (a.end && day > a.end)) return false
  if (a.recurrence === 'once') return day === a.start
  if (a.recurrence === 'yearly') return day.slice(5) === a.start.slice(5)
  if (a.recurrence === 'monthly') return day.slice(8) === a.start.slice(8)
  if (a.recurrence === 'weekly') return a.weekdays.includes((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7)
  return true
}
export function blankActivity(day: string): Activity {
  return { id: crypto.randomUUID(), title: '', kind: 'habit', start: day, end: null, time: '', duration: 30, recurrence: 'daily', weekdays: [], reminder: null, program: '', archived: false }
}
export function emptyPlanner(): PlannerData { return { version: 0, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Qyzylorda', activities: [], marks: [] } }
export function scheduleLabel(a: Activity) {
  const date = (options: Intl.DateTimeFormatOptions) => new Date(a.start + 'T12:00:00').toLocaleDateString('ru-RU', options)
  return (a.recurrence === 'daily' ? 'Каждый день' : a.recurrence === 'weekly' ? a.weekdays.map(d => weekdays[d]).join(', ') : a.recurrence === 'yearly' ? `Ежегодно, ${date({ day: 'numeric', month: 'long' })}` : a.recurrence === 'monthly' ? `Каждый месяц, ${Number(a.start.slice(8))} числа` : date({ weekday: 'short', day: 'numeric', month: 'long' })) + (a.time ? ` · ${a.time} · ${a.duration} мин` : ' · Без времени') + (a.reminder === null ? '' : a.reminder === 0 ? ' · Напомнить в начале' : ` · Напомнить за ${a.reminder} мин`)
}
