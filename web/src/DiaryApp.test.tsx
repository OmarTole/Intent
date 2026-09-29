import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DiaryApp from './DiaryApp'
import { emptyDiary, orderedSections, type Diary } from './diary-model'
import { blankActivity, localDate } from './planner-model'
import { persist, readLocal } from './diary-store'
import { ApiError } from './api'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(), api: mocks.api }))
vi.mock('./push', () => ({ existingPush: vi.fn(async () => null), disablePush: vi.fn(async () => {}) }))
const account = { id: 'account-1', username: 'me@example.com', expiresAt: 9999999999, admin: false }
let server: Diary
beforeEach(async () => {
  await persist()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  server = { ...emptyDiary(), sections: [{ id: 'work', title: 'Работа', group: 'Обязательное' }], activities: [] }
  mocks.api.mockReset().mockImplementation(async (path: string, method?: string, body?: Diary) => {
    if (path === '/auth/me') return account
    if (path === '/planner' && method === 'PUT') { server = { ...body!, version: server.version + 1 }; return structuredClone(server) }
    if (path === '/planner') return structuredClone(server)
    throw new Error('Unexpected request ' + path)
  })
})

it('creates a task, saves a comment, and updates its day color', async () => {
  const user = userEvent.setup()
  render(<DiaryApp />)
  await screen.findByRole('heading', { name: 'Всё начинается с дня' })
  await user.click(screen.getByRole('button', { name: 'Добавить задачу' }))
  await user.type(screen.getByLabelText('Название задачи'), 'Подготовить отчет')
  await user.click(screen.getByRole('button', { name: /Расширенные настройки/ }))
  await user.selectOptions(screen.getByLabelText(/Выполнение за/), 'done')
  await user.type(screen.getByLabelText('Новый комментарий'), 'Все цифры проверены')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(server.activities).toHaveLength(1))
  expect(server.activities[0].comments?.[0].text).toBe('Все цифры проверены')
  expect(server.marks[0].status).toBe('done')
  expect(server.activities[0].history?.[0].text).toBe('Создана задача')
  await waitFor(() => expect(screen.getByRole('button', { name: /Работа, .*: Выполнено/ })).toBeTruthy())
})

it('keeps offline task edits across reload and syncs them when connection returns', async () => {
  const data = { ...server, activities: [{ ...blankActivity('2026-09-29'), title: 'Рабочая задача', sectionId: 'work', recurrence: 'once' as const }] }
  server = structuredClone(data)
  await persist({ account, data, base: data, dirty: false })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
  mocks.api.mockRejectedValue(new TypeError('offline'))
  const user = userEvent.setup()
  const mounted = render(<DiaryApp />)
  await screen.findByRole('heading', { name: 'Всё начинается с дня' })
  await user.click(screen.getAllByRole('button', { name: 'Работа' })[0])
  await user.click(screen.getByRole('button', { name: /Рабочая задача/ }))
  await user.clear(screen.getByLabelText('Название задачи'))
  await user.type(screen.getByLabelText('Название задачи'), 'Изменено без интернета')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(async () => expect((await readLocal())?.dirty).toBe(true))
  mounted.unmount()
  render(<DiaryApp />)
  await screen.findByRole('heading', { name: 'Всё начинается с дня' })
  expect((await readLocal())?.data.activities[0].title).toBe('Изменено без интернета')
  mocks.api.mockImplementation(async (path: string, method?: string, body?: Diary) => {
    if (path === '/auth/me') return account
    if (method === 'PUT') { server = { ...body!, version: 1 }; return structuredClone(server) }
    return structuredClone(server)
  })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  window.dispatchEvent(new Event('online'))
  await waitFor(async () => expect((await readLocal())?.dirty).toBe(false))
  expect(server.activities[0].title).toBe('Изменено без интернета')
})

it('does not discard pending offline changes when a session expires', async () => {
  await persist({ account, data: server, base: server, dirty: true })
  mocks.api.mockRejectedValue(new ApiError('Войдите снова', 401))
  render(<DiaryApp />)
  await screen.findByRole('heading', { name: 'С возвращением' })
  expect((await readLocal())?.dirty).toBe(true)
  expect(screen.queryByRole('heading', { name: 'Всё начинается с дня' })).toBeNull()
})

it('saves a simple task without opening or filling advanced settings', async () => {
  const user = userEvent.setup()
  render(<DiaryApp />)
  await screen.findByRole('heading', { name: 'Всё начинается с дня' })
  await user.click(screen.getByRole('button', { name: 'Добавить задачу' }))
  expect(screen.queryByLabelText('Время')).toBeNull()
  expect(screen.queryByLabelText('Длительность, минут')).toBeNull()
  expect(screen.getByRole('button', { name: /Расширенные настройки/ }).getAttribute('aria-expanded')).toBe('false')
  await user.type(screen.getByLabelText('Название задачи'), 'Простое дело')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(server.activities[0]?.title).toBe('Простое дело'))
  expect(server.activities[0].time).toBe('')
  expect(server.activities[0].reminder).toBeNull()
})

it('saves custom group names and user-defined group and direction order', async () => {
  server.groups = ['Обязательное', 'На выбор']
  server.sections.push({ id: 'health', title: 'Здоровье', group: 'Обязательное' })
  const user = userEvent.setup()
  const app = render(<DiaryApp />)
  await screen.findByRole('heading', { name: 'Всё начинается с дня' })
  await user.click(screen.getByRole('button', { name: 'Настроить группы и порядок' }))
  await user.clear(screen.getByLabelText('Название группы 1'))
  await user.type(screen.getByLabelText('Название группы 1'), 'Важное для меня')
  await user.click(screen.getByRole('button', { name: 'Поднять направление Здоровье' }))
  await user.click(screen.getByRole('button', { name: 'Поднять группу На выбор' }))
  await user.type(screen.getByLabelText('Новая группа'), 'Семья')
  await user.click(screen.getByRole('button', { name: 'Добавить группу' }))
  await user.click(screen.getByRole('button', { name: 'Сохранить порядок и группы' }))
  await waitFor(() => expect(server.groups).toEqual(['На выбор', 'Важное для меня', 'Семья']))
  expect(orderedSections(server).map(s => s.title)).toEqual(['Здоровье', 'Работа'])
  expect(server.sections.every(s => s.group === 'Важное для меня')).toBe(true)
  app.unmount()
  render(<DiaryApp />)
  await screen.findByRole('heading', { name: 'Всё начинается с дня' })
  await user.click(screen.getByRole('button', { name: 'Настроить группы и порядок' }))
  expect((screen.getByLabelText('Название группы 1') as HTMLInputElement).value).toBe('На выбор')
  expect((screen.getByLabelText('Название группы 2') as HTMLInputElement).value).toBe('Важное для меня')
})

it('explains missing fields instead of disabling Save and then saves a weekly task', async () => {
  const user = userEvent.setup()
  render(<DiaryApp />)
  await screen.findByRole('heading', { name: 'Всё начинается с дня' })
  await user.click(screen.getByRole('button', { name: 'Добавить задачу' }))
  const save = screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement
  expect(save.disabled).toBe(false)
  await user.click(save)
  expect(screen.getByRole('alert').textContent).toContain('Введите название')
  await user.type(screen.getByLabelText('Название задачи'), 'Регулярное дело')
  await user.selectOptions(screen.getByLabelText('Повторение'), 'weekly')
  expect(save.disabled).toBe(false)
  await user.click(save)
  expect(screen.getByRole('alert').textContent).toContain('Выберите хотя бы один день недели')
  await user.click(screen.getByLabelText('Пн'))
  await user.click(save)
  await waitFor(() => expect(server.activities[0]?.weekdays).toEqual([0]))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('shows save failures inside the task dialog and keeps the draft available', async () => {
  const implementation = mocks.api.getMockImplementation()!
  mocks.api.mockImplementation((path: string, method?: string, body?: Diary) => method === 'PUT' ? Promise.reject(new ApiError('Сохранение отклонено. Проверьте дату.', 422)) : implementation(path, method, body))
  const user = userEvent.setup()
  render(<DiaryApp />)
  await screen.findByRole('heading', { name: 'Всё начинается с дня' })
  await user.click(screen.getByRole('button', { name: 'Добавить задачу' }))
  await user.type(screen.getByLabelText('Название задачи'), 'Не терять черновик')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('Проверьте дату'))
  expect((screen.getByLabelText('Название задачи') as HTMLInputElement).value).toBe('Не терять черновик')
  expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(false)
})

it('shows only populated day sections and completes tasks without opening their cards', async () => {
  const day = localDate(server.timezone)
  const activity = { ...blankActivity(day), title: 'Отправить отчет', sectionId: 'work', recurrence: 'once' as const }
  server.activities = [activity]
  server.sections.push({ id: 'empty', title: 'Пустое направление', group: 'Обязательное' })
  const user = userEvent.setup()
  render(<DiaryApp />)
  await screen.findByRole('heading', { name: 'Всё начинается с дня' })
  await user.click(screen.getAllByRole('button', { name: 'Мой день' })[0])
  expect(screen.getByRole('heading', { name: 'Работа' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Пустое направление' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Завершить: Отправить отчет' }))
  await waitFor(() => expect(server.marks.find(m => m.activityId === activity.id)?.status).toBe('done'))
  expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => expect((screen.getByRole('button', { name: 'Возобновить: Отправить отчет' }) as HTMLButtonElement).disabled).toBe(false))
  await user.click(screen.getByRole('button', { name: 'Возобновить: Отправить отчет' }))
  await waitFor(() => expect(server.marks.find(m => m.activityId === activity.id)?.status).toBe('missed'))
  await user.click(screen.getByRole('button', { name: 'Открыть задачу: Отправить отчет' }))
  expect(screen.getByRole('dialog')).toBeTruthy()
})
