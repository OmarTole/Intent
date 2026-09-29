export const kinds = {
  personalGoal: 'Личная цель', reminder: 'Напоминание', meeting: 'Встреча',
  activity: 'Активность', project: 'Проект', general: 'Намерение',
} as const
export const statuses = { active: 'В процессе', paused: 'Отложено', completed: 'Завершено', cancelled: 'Отменено' } as const
export type Kind = keyof typeof kinds
export type Status = keyof typeof statuses
export interface User { id: string; username: string; expiresAt: number }
export interface Step { id: string; title: string; isCompleted: boolean }
export interface IntentData {
  title: string; rawText: string; summary: string; kind: Kind; status: Status; steps: Step[]
}
export interface Intent extends IntentData { id: string; version: number; createdAt: number; updatedAt: number }
export interface Draft { title: string; summary: string; kind: Kind; steps: string[] }
export interface LogEvent { id: string; intentId: string; message: string; createdAt: number }
export interface MemoryData { displayName: string; about: string; preferences: string; availability: string }
export interface AgentMessage { id: string; role: 'user' | 'assistant'; text: string; createdAt: number }
export interface AgentResponse {
  mode: 'clarification' | 'draft'; message: string; title: string | null; summary: string | null;
  kind: Kind | null; steps: string[]
}
export interface AgentTurn { userMessage: AgentMessage; assistantMessage: AgentMessage; response: AgentResponse }
export interface CoachResponse { message: string; nextStep: string; encouragement: string }
export interface Snapshot { user: User; intents: Intent[]; events: LogEvent[]; savedAt: number }

export function editable(intent: Intent): IntentData {
  const { title, rawText, summary, kind, status, steps } = intent
  return { title, rawText, summary, kind, status, steps }
}
export function progress(intent: Intent) {
  return intent.status === 'completed' ? 100 : Math.round(intent.steps.filter(s => s.isCompleted).length / Math.max(1, intent.steps.length) * 100)
}
