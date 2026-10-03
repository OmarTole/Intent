import { expect, it } from 'vitest'
import { localDate, plusDays, occurs, blankActivity, validDate } from './planner-model'

it('keeps Kazakhstan civil dates around UTC midnight and year boundaries', () => {
  expect(localDate('Asia/Qyzylorda', new Date('2026-10-02T20:00:00Z'))).toBe('2026-10-03')
  expect(plusDays('2026-12-31', 1)).toBe('2027-01-01')
  expect(plusDays('2028-03-01', -1)).toBe('2028-02-29')
  const saturday = { ...blankActivity('2026-10-01'), recurrence: 'weekly' as const, weekdays: [5] }
  expect(occurs(saturday, '2026-10-03')).toBe(true)
  expect(occurs(saturday, '2026-10-02')).toBe(false)
  expect(validDate('2026-02-30')).toBe(false)
  expect(validDate('2028-02-29')).toBe(true)
})
