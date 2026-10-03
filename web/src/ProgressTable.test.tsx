import { expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProgressTable, { trackerDates } from './ProgressTable'
import { emptyDiary } from './diary-model'

it('includes every day in a leap February', () => {
  expect(trackerDates('2028-02-20')).toHaveLength(29)
})

it('aligns date headings with the same day cells, including scroll spacers', () => {
  render(<ProgressTable data={{ ...emptyDiary(), groups: ['Обязательное'], sections: [{ id: 'work', title: 'Работа', group: 'Обязательное' }] }} day="2026-10-03" today="2026-10-03" busy={false} onDay={vi.fn()} onOpenDay={vi.fn()} onSection={vi.fn()} onAdd={vi.fn()} onSettings={vi.fn()} />)
  const table = screen.getByRole('table') as HTMLTableElement
  const header = table.rows[0]
  const body = table.rows[2]
  expect(header.cells.length).toBe(body.cells.length)
  for (let day = 1; day <= 31; day++) {
    expect(header.cells[day + 1].textContent).toMatch(new RegExp(`^${day}`))
    expect(body.cells[day + 1].querySelector('button')?.getAttribute('aria-label')).toContain(`2026-10-${String(day).padStart(2, '0')}`)
  }
})

it('switches periods, collapses groups and opens the correct cell from fullscreen', async () => {
  const user = userEvent.setup()
  const onSection = vi.fn(), onDay = vi.fn()
  render(<ProgressTable data={{ ...emptyDiary(), groups: ['Обязательное'], sections: [{ id: 'work', title: 'Работа', group: 'Обязательное' }] }} day="2026-10-01" today="2026-10-01" busy={false} onDay={onDay} onOpenDay={vi.fn()} onSection={onSection} onAdd={vi.fn()} onSettings={vi.fn()} />)
  expect(within(within(screen.getByRole('table')).getAllByRole('row')[0]).getAllByRole('columnheader')).toHaveLength(32)
  await user.click(screen.getByRole('button', { name: 'Следующий период' }))
  expect(onDay).toHaveBeenCalledWith('2026-11-01')
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
