import { expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProgressTable, { trackerDates } from './ProgressTable'
import { emptyDiary } from './diary-model'

it('shows five consecutive days across month/year boundaries and leap February', () => {
  expect(trackerDates('2026-01-01', 'five')).toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03'])
  expect(trackerDates('2028-02-20', 'month')).toHaveLength(29)
})

it('switches periods, collapses groups and opens the correct cell from fullscreen', async () => {
  const user = userEvent.setup()
  const onSection = vi.fn(), onDay = vi.fn()
  render(<ProgressTable data={{ ...emptyDiary(), groups: ['Обязательное'], sections: [{ id: 'work', title: 'Работа', group: 'Обязательное' }] }} day="2026-10-01" today="2026-10-01" busy={false} onDay={onDay} onOpenDay={vi.fn()} onSection={onSection} onAdd={vi.fn()} onSettings={vi.fn()} />)
  expect(within(within(screen.getByRole('table')).getAllByRole('row')[0]).getAllByRole('columnheader')).toHaveLength(6)
  await user.click(screen.getByRole('button', { name: 'Следующий период' }))
  expect(onDay).toHaveBeenCalledWith('2026-10-02')
  await user.click(screen.getByRole('button', { name: 'Обязательное' }))
  expect(screen.queryByRole('button', { name: 'Работа' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Обязательное' }))
  await user.click(screen.getByRole('button', { name: 'Развернуть таблицу на весь экран' }))
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(within(within(screen.getByRole('table')).getAllByRole('row')[0]).getAllByRole('columnheader')).toHaveLength(32)
  await user.click(screen.getByRole('button', { name: 'Работа, 2026-10-03: Без отметки' }))
  expect(onSection).toHaveBeenCalledWith('work', '2026-10-03')
  expect(screen.queryByRole('dialog')).toBeNull()
})
