import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Planner from './Planner'
import { blankActivity, canSaveReminderDirectly, localDate, occurs, type PlannerData } from './planner-model'

const onError = vi.fn(async () => {})
const onPending = vi.fn()
beforeEach(() => { vi.clearAllMocks() })
function setup(withActivity = true, conflict = false, reminder = false) {
  const today = localDate('UTC')
  let data: PlannerData = { version: 1, timezone: 'UTC', activities: withActivity ? [{ ...blankActivity(today), title: 'Чтение', time: '19:00' }] : [], marks: [] }
  const writes: PlannerData[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/planner' && options?.method === 'PUT') {
      const body = JSON.parse(String(options.body)); writes.push(body)
      if (conflict) return new Response(JSON.stringify({ detail: 'Расписание изменено' }), { status: 409 })
      data = { ...body, version: body.version + 1 }
    } else if (url === '/api/planner/propose') {
      if (reminder) return new Response(JSON.stringify({ clarification: false, message: 'Напоминание готово', activities: [{ ...blankActivity('2099-11-12'), title: 'Той у друга', kind: 'event', recurrence: 'once', time: '18:00', reminder: 1440 }] }))
      return new Response(JSON.stringify({ clarification: false, message: 'План готов', activities: [{ ...blankActivity(today), title: 'Плавание', recurrence: 'weekly', weekdays: [1, 4] }] }))
    }
    return new Response(JSON.stringify(data))
  }))
  return { writes, today }
}
it('keeps daily focus when completion is recorded', async () => {
  const { writes } = setup()
  const user = userEvent.setup()
  render(<Planner view="today" readOnly={false} onError={onError} onPending={onPending} />)
  await user.click(await screen.findByRole('button', { name: 'В фокус: Чтение' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  await user.click(screen.getByRole('button', { name: 'Отметить' }))
  await user.selectOptions(screen.getByLabelText('Результат'), 'done')
  await user.click(screen.getByRole('button', { name: 'Сохранить отметку' }))
  await waitFor(() => expect(writes.at(-1)?.marks[0]).toMatchObject({ focus: true, status: 'done' }))
})
it('requires a calendar proposal to be approved before saving', async () => {
  const { writes } = setup(false)
  const user = userEvent.setup()
  render(<Planner view="calendar" readOnly={false} onError={onError} onPending={onPending} />)
  await user.click(screen.getByText('Составить расписание с агентом'))
  await waitFor(() => expect((screen.getByLabelText('Запрос к планировщику') as HTMLTextAreaElement).disabled).toBe(false))
  await user.type(screen.getByLabelText('Запрос к планировщику'), 'Хочу плавать')
  await user.click(screen.getByRole('button', { name: 'Предложить расписание' }))
  await screen.findByText('План готов')
  expect(writes).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Утвердить и добавить в календарь' }))
  await waitFor(() => expect(writes[0].activities[0].title).toBe('Плавание'))
})
it('does not apply a mark after a version conflict', async () => {
  setup(true, true)
  const user = userEvent.setup()
  render(<Planner view="today" readOnly={false} onError={onError} onPending={onPending} />)
  await user.click(await screen.findByRole('button', { name: 'В фокус: Чтение' }))
  await waitFor(() => expect(onError).toHaveBeenCalled())
  expect(screen.getByRole('button', { name: 'В фокус: Чтение' })).toBeTruthy()
})
it('moves a single occurrence and leaves the series intact', async () => {
  const { writes, today } = setup()
  const user = userEvent.setup()
  render(<Planner view="today" readOnly={false} onError={onError} onPending={onPending} />)
  await user.click(await screen.findByRole('button', { name: 'Отметить' }))
  await user.clear(screen.getByLabelText('Перенести это занятие на дату'))
  await user.type(screen.getByLabelText('Перенести это занятие на дату'), '2027-01-12')
  await user.click(screen.getByRole('button', { name: 'Перенести только это занятие' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].activities[0].recurrence).toBe('daily')
  expect(writes[0].activities[1]).toMatchObject({ recurrence: 'once', start: '2027-01-12' })
  expect(writes[0].marks[0]).toMatchObject({ date: today, status: 'rest' })
})
it('handles weekly and annual recurrence without shifting local dates', () => {
  const activity = { ...blankActivity('2026-09-22'), recurrence: 'weekly' as const, weekdays: [1, 4] }
  expect(occurs(activity, '2026-09-22')).toBe(true)
  expect(occurs(activity, '2026-09-23')).toBe(false)
  expect(localDate('Asia/Qyzylorda', new Date('2026-09-21T20:00:00Z'))).toBe('2026-09-22')
})

it('only auto-saves explicit reminders with matching date and time', () => {
  const proposal = { message: 'Напоминание', clarification: false, activities: [{ ...blankActivity('2026-11-12'), kind: 'event' as const, recurrence: 'once' as const, time: '18:00', reminder: 1440 }] }
  expect(canSaveReminderDirectly('Напомни 12 ноября 2026 в 18:00 той у друга, за день.', proposal, '2026-09-22')).toBe(true)
  expect(canSaveReminderDirectly('Напомни 12 ноября про той у друга.', proposal, '2026-09-22')).toBe(false)
  expect(canSaveReminderDirectly('Напомни 13 ноября в 18:00 той у друга.', proposal, '2026-09-22')).toBe(false)
  expect(canSaveReminderDirectly('Предложи мероприятие 12 ноября в 18:00.', proposal, '2026-09-22')).toBe(false)
})

it('saves an explicit reminder and can undo the addition', async () => {
  const { writes } = setup(false, false, true)
  const user = userEvent.setup()
  render(<Planner view="calendar" readOnly={false} onError={onError} onPending={onPending} />)
  await user.click(screen.getByText('Составить расписание с агентом'))
  await waitFor(() => expect((screen.getByLabelText('Запрос к планировщику') as HTMLTextAreaElement).disabled).toBe(false))
  await user.type(screen.getByLabelText('Запрос к планировщику'), 'Напомни 12 ноября 2099 в 18:00 той у друга, за день.')
  await user.click(screen.getByRole('button', { name: 'Предложить расписание' }))
  await screen.findByText('Напоминание записано по вашей просьбе.')
  expect(writes).toHaveLength(1)
  expect(writes[0].activities[0].reminder).toBe(1440)
  await user.click(screen.getByRole('button', { name: 'Отменить добавление' }))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[1].activities).toHaveLength(0)
})
