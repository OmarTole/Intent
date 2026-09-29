import { beforeEach, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { readSnapshot, writeSnapshot } from './storage'
import type { Intent, MemoryData, User } from './types'

const owner: User = { id: 'alice-id', username: 'alice', expiresAt: Date.now() / 1000 + 3600 }
const emptyMemory: MemoryData = { displayName: '', about: '', preferences: '', availability: '' }
const initialGoal: Intent = {
  id: 'a6bb71c1-6d25-4b42-8e28-b2b35b403170', title: 'Моя цель', summary: 'Описание', rawText: 'Хочу бегать',
  kind: 'activity', status: 'active', version: 1, createdAt: Date.now() / 1000, updatedAt: Date.now() / 1000,
  steps: [{ id: 'fa5fae3b-871e-4557-919c-19b5be998807', title: 'Выбрать маршрут', isCompleted: false }],
}

beforeEach(async () => { window.history.replaceState({}, '', '/?view=agent'); await writeSnapshot(); Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }) })

function mockServer({ authenticated = true, aiFails = false, goals = [] as Intent[], conflict = false } = {}) {
  let loggedIn = authenticated
  const calls: { path: string; body: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    const body = options?.body ? JSON.parse(String(options.body)) : {}
    calls.push({ path, body })
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
    if (path === '/api/auth/login') { loggedIn = true; return reply(owner) }
    if (path === '/api/auth/logout') { loggedIn = false; return new Response(null, { status: 204 }) }
    if (!loggedIn) return reply({ detail: 'Войдите в свой аккаунт.' }, 401)
    if (path === '/api/auth/me') return reply(owner)
    if (path === '/api/events') return reply([])
    if (path === '/api/planner') return reply({ version: 0, timezone: 'UTC', activities: [], marks: [] })
    if (path === '/api/planner/propose') return reply({ clarification: true, message: 'В какое время начинается мероприятие?', activities: [] })
    if (path === '/api/memory' && options?.method === 'PUT') return reply(body)
    if (path === '/api/memory') return reply(emptyMemory)
    if (path === '/api/agent/messages' && options?.method === 'DELETE') return new Response(null, { status: 204 })
    if (path === '/api/agent/messages') return reply([])
    if (path === '/api/agent/respond') {
      if (aiFails) return reply({ detail: 'ИИ сейчас недоступен. Создайте цель вручную.' }, 503)
      const createdAt = Date.now() / 1000
      return reply({
        userMessage: { id: 'user-message', role: 'user', text: body.text, createdAt },
        assistantMessage: { id: 'assistant-message', role: 'assistant', text: 'Я подготовил план.', createdAt },
        response: { mode: 'draft', message: 'Я подготовил план.', title: 'Начать бегать', summary: 'Короткие пробежки', kind: 'activity', steps: ['Выбрать маршрут'] },
      })
    }
    if (path.endsWith('/coach')) return reply({ message: 'Начните с малого.', nextStep: 'Выйти на 10-минутную прогулку', encouragement: 'Этого достаточно для старта.' })
    if (path === '/api/intents' && options?.method === 'POST') {
      const goal = { ...body, version: 1, createdAt: Date.now() / 1000, updatedAt: Date.now() / 1000 } as Intent
      goals.push(goal); return reply(goal, 201)
    }
    if (path.startsWith('/api/intents/') && options?.method === 'PUT') {
      if (conflict) return reply({ detail: 'Цель изменена на другом устройстве. Обновите список.' }, 409)
      const goal = { ...goals[0], ...body, version: Number(body.version) + 1 }
      return reply(goal)
    }
    if (path === '/api/intents') return reply(goals)
    throw new Error(`Unexpected ${path}`)
  }))
  return calls
}

it('opens Today by default and routes reminder requests to the planner', async () => {
  window.history.replaceState({}, '', '/')
  const calls = mockServer()
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('heading', { name: 'Сегодня', level: 1 })
  await waitFor(() => expect((screen.getByRole('button', { name: 'Мой агент' }) as HTMLButtonElement).disabled).toBe(false))
  await user.click(screen.getByRole('button', { name: 'Мой агент' }))
  await user.type(screen.getByLabelText('Ваше желание'), 'Напомни про день рождения друга 12 ноября')
  await user.click(screen.getByRole('button', { name: 'Обсудить с агентом' }))
  await screen.findByText('В какое время начинается мероприятие?')
  expect(calls.filter(c => c.path === '/api/planner/propose')).toHaveLength(1)
  expect(calls.filter(c => c.path === '/api/agent/respond')).toHaveLength(0)
})

it('shows the sent message immediately and does not echo it again with the reply', async () => {
  mockServer()
  const normalFetch = globalThis.fetch
  let release!: (response: Response) => void
  let sent = 0
  vi.stubGlobal('fetch', vi.fn((url: string, options?: RequestInit) => {
    if (url === '/api/agent/respond') { sent++; return new Promise<Response>(resolve => { release = resolve }) }
    return normalFetch(url, options)
  }))
  const user = userEvent.setup()
  render(<App />)
  await user.type(await screen.findByLabelText('Ваше желание'), 'Хочу изучать английский')
  await user.click(screen.getByRole('button', { name: 'Обсудить с агентом' }))
  expect(screen.getAllByText('Хочу изучать английский')).toHaveLength(1)
  expect((screen.getByLabelText('Ответ агенту') as HTMLTextAreaElement).value).toBe('')
  expect(screen.getByText('Вы')).toBeTruthy()
  await act(async () => release(new Response(JSON.stringify({
    userMessage: { id: 'saved-user', role: 'user', text: 'Хочу изучать английский', createdAt: 1 },
    assistantMessage: { id: 'saved-agent', role: 'assistant', text: 'Какой у вас уровень?', createdAt: 2 },
    response: { mode: 'clarification', message: 'Какой у вас уровень?', title: null, summary: null, kind: null, steps: [] },
  }))))
  await screen.findByText('Какой у вас уровень?')
  expect(screen.getAllByText('Хочу изучать английский')).toHaveLength(1)
  expect(sent).toBe(1)
})

it('logs in and never stores credentials in the offline snapshot', async () => {
  mockServer({ authenticated: false })
  const user = userEvent.setup()
  render(<App />)
  await screen.findByLabelText('Логин')
  await user.type(screen.getByLabelText('Логин'), 'alice')
  await user.type(screen.getByLabelText('Пароль'), 'test-password-123')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  await screen.findByRole('heading', { name: 'Что вы хотите сделать?' })
  await waitFor(async () => expect((await readSnapshot())?.user.username).toBe('alice'))
  expect(JSON.stringify(await readSnapshot())).not.toContain('test-password-123')
})

it('requires confirmation of the AI draft before saving and then updates a step', async () => {
  const calls = mockServer()
  const user = userEvent.setup()
  render(<App />)
  await user.type(await screen.findByLabelText('Ваше желание'), 'Хочу начать бегать')
  await user.click(screen.getByRole('button', { name: 'Обсудить с агентом' }))
  await screen.findByRole('dialog')
  expect(calls.filter(call => call.path === '/api/intents' && call.body.id)).toHaveLength(0)
  await user.clear(screen.getByLabelText('Название'))
  await user.type(screen.getByLabelText('Название'), 'Мои пробежки')
  await user.click(screen.getByRole('button', { name: 'Сохранить цель' }))
  await screen.findByRole('heading', { name: 'Мои пробежки' })
  await user.click(screen.getByRole('checkbox'))
  await waitFor(() => expect(calls.some(call => call.path.startsWith('/api/intents/') && call.body.version === 1)).toBe(true))
  await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
})

it('keeps manual creation available when Ollama is unavailable', async () => {
  mockServer({ aiFails: true })
  const user = userEvent.setup()
  render(<App />)
  await user.type(await screen.findByLabelText('Ваше желание'), 'Хочу начать бегать')
  await user.click(screen.getByRole('button', { name: 'Обсудить с агентом' }))
  await screen.findByRole('alert')
  await user.click(screen.getByRole('button', { name: 'Создать цель самостоятельно' }))
  expect(await screen.findByRole('dialog')).toBeTruthy()
})

it('shows a valid cached account read-only when the server is offline', async () => {
  await writeSnapshot({ user: owner, intents: [initialGoal], events: [], savedAt: Date.now() })
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  render(<App />)
  await screen.findByRole('heading', { name: 'Моя цель' })
  expect((screen.getByLabelText('Ваше желание') as HTMLTextAreaElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Создать цель самостоятельно' }) as HTMLButtonElement).disabled).toBe(true)
})

it('does not show another account cache after successful authentication and a failed data request', async () => {
  await writeSnapshot({ user: { ...owner, id: 'old-user', username: 'bob' }, intents: [initialGoal], events: [], savedAt: Date.now() })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/me') return new Response(JSON.stringify(owner))
    throw new TypeError('offline')
  }))
  render(<App />)
  await screen.findByRole('heading', { name: 'Что вы хотите сделать?' })
  expect(screen.queryByRole('heading', { name: 'Моя цель' })).toBeNull()
  expect(screen.queryByText('bob')).toBeNull()
})

it('does not silently overwrite a conflict and clears the snapshot on logout', async () => {
  mockServer({ goals: [initialGoal], conflict: true })
  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole('button', { name: /Моя цель/ }))
  await user.click(screen.getByRole('checkbox'))
  await screen.findByRole('alert')
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Выйти' }))
  await screen.findByLabelText('Логин')
  expect(await readSnapshot()).toBeUndefined()
})

it('clears a cached account when the server rejects its session', async () => {
  await writeSnapshot({ user: owner, intents: [initialGoal], events: [], savedAt: Date.now() })
  mockServer({ authenticated: false })
  render(<App />)
  await screen.findByLabelText('Логин')
  expect(screen.queryByRole('heading', { name: 'Моя цель' })).toBeNull()
  expect(await readSnapshot()).toBeUndefined()
})

it('does not open an expired offline session', async () => {
  await writeSnapshot({ user: { ...owner, expiresAt: 1 }, intents: [initialGoal], events: [], savedAt: Date.now() })
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  render(<App />)
  await screen.findByLabelText('Логин')
  expect(screen.queryByRole('heading', { name: 'Моя цель' })).toBeNull()
})

it('saves owner-controlled memory for future agent replies', async () => {
  const calls = mockServer()
  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole('button', { name: 'Память' }))
  await user.type(screen.getByLabelText('Как к вам обращаться'), 'Алексей')
  await user.type(screen.getByLabelText('Как вам удобнее двигаться к целям'), 'Короткие шаги')
  await user.click(screen.getByRole('button', { name: 'Сохранить память' }))
  await waitFor(() => expect(calls.some(call => call.path === '/api/memory' && call.body.displayName === 'Алексей')).toBe(true))
})

it('asks the agent for the next step of an owned goal', async () => {
  const calls = mockServer({ goals: [initialGoal] })
  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole('button', { name: /Моя цель/ }))
  await user.click(screen.getByRole('button', { name: 'Спросить агента' }))
  expect(await screen.findByText('Выйти на 10-минутную прогулку')).toBeTruthy()
  expect(calls.some(call => call.path.endsWith('/coach'))).toBe(true)
})
