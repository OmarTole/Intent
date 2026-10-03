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
export const markLabels = { missed: 'Пропуск', partial: 'Частично', done: 'Выполнено', rest: 'Выходной' }
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
  return (a.recurrence === 'daily' ? 'Каждый день' : a.recurrence === 'weekly' ? a.weekdays.map(d => weekdays[d]).join(', ') : a.recurrence === 'yearly' ? 'Ежегодно' : a.start) + (a.time ? ` · ${a.time} · ${a.duration} мин` : ' · Без времени') + (a.reminder === null ? '' : a.reminder === 0 ? ' · Напомнить в начале' : ` · Напомнить за ${a.reminder} мин`)
}
export function overlaps(a: Activity, b: Activity, day: string) {
  if (!a.time || !b.time || !occurs(a, day) || !occurs(b, day) || a.archived || b.archived) return false
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
  return minutes(a.time) < minutes(b.time) + b.duration && minutes(b.time) < minutes(a.time) + a.duration
}

// Only unambiguous, explicit reminder commands can bypass the plan approval step.
export function canSaveReminderDirectly(text: string, proposal: Proposal, today: string) {
  if (!/напомни/i.test(text) || proposal.clarification || proposal.activities.length !== 1 || /трениров|плаван|силов/i.test(text)) return false
  const activity = proposal.activities[0]
  if (activity.kind !== 'event' || !['once', 'yearly'].includes(activity.recurrence) || activity.reminder === null) return false
  if (!/за\s+(?:день|сутки|неделю|час|\d+\s*(?:мин|час|дн|день|недел))|в\s+момент\s+начала/i.test(text)) return false
  const at = text.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\s|[.,]|$)/)
  if (!at || activity.time !== `${at[1].padStart(2, '0')}:${at[2]}`) return false
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (iso) return activity.start === iso[1] && iso[1] >= today
  const date = text.toLowerCase().match(/(?:^|\s)(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(20\d{2}))?/)
  if (!date) return false
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']
  const tail = `${String(months.indexOf(date[2]) + 1).padStart(2, '0')}-${date[1].padStart(2, '0')}`
  let year = date[3] || today.slice(0, 4)
  if (!date[3] && `${year}-${tail}` < today) year = String(Number(year) + 1)
  return activity.start === `${year}-${tail}` && activity.start >= today
}
