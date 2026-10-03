import { expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DiaryAssistant from './DiaryAssistant'
import { blankActivity } from './planner-model'

const mock = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), api: mock.api }))

it('saves a proposed event only after explicit confirmation and prevents another save', async () => {
  const user = userEvent.setup(), save = vi.fn(async () => true)
  mock.api.mockResolvedValue({ message: 'Встреча завтра', clarification: false, activities: [{ ...blankActivity('2026-10-04'), title: 'Встреча', recurrence: 'once' }] })
  render(<DiaryAssistant timezone="Asia/Qyzylorda" busy={false} onSave={save} />)
  await user.click(screen.getByText('Помощник — запланировать словами'))
  await user.type(screen.getByLabelText('Запрос помощнику'), 'Завтра в 18:00 встреча')
  await user.click(screen.getByRole('button', { name: 'Предложить план' }))
  await screen.findByText('Встреча завтра')
  expect(save).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Подтвердить и сохранить' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('button', { name: 'Подтвердить и сохранить' })).toBeNull()
})

it('keeps manual planning available when the model request fails', async () => {
  const user = userEvent.setup(), save = vi.fn()
  mock.api.mockRejectedValue(new TypeError('offline'))
  render(<DiaryAssistant timezone="Asia/Qyzylorda" busy={false} onSave={save} />)
  await user.click(screen.getByText('Помощник — запланировать словами'))
  await user.type(screen.getByLabelText('Запрос помощнику'), 'План')
  await user.click(screen.getByRole('button', { name: 'Предложить план' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Предложить план' }).hasAttribute('disabled')).toBe(false)
})

it('reuses proposal identities when confirmation is retried after a sync failure', async () => {
  const user = userEvent.setup(), save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  mock.api.mockResolvedValue({ message: 'Предложение', clarification: false, activities: [{ ...blankActivity('2026-10-04'), title: 'Встреча' }] })
  render(<DiaryAssistant timezone="Asia/Qyzylorda" busy={false} onSave={save} />)
  await user.click(screen.getByText('Помощник — запланировать словами'))
  await user.type(screen.getByLabelText('Запрос помощнику'), 'Встреча')
  await user.click(screen.getByRole('button', { name: 'Предложить план' }))
  await user.click(await screen.findByRole('button', { name: 'Подтвердить и сохранить' }))
  await screen.findByRole('alert')
  await user.click(screen.getByRole('button', { name: 'Подтвердить и сохранить' }))
  expect(save.mock.calls[0][0][0].id).toBe(save.mock.calls[1][0][0].id)
})
