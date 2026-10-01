import { describe, expect, it } from 'vitest'
import { blankActivity, occurs } from './planner-model'
import { automaticStatus, cellStatus, emptyDiary, mergeDiary, MergeConflict, type Diary } from './diary-model'
import { persist, readLocal } from './diary-store'

function fixture(): Diary {
  return { ...emptyDiary(), sections: [{ id: 'work', title: 'Работа', group: 'Обязательное' }], activities: [1, 2].map(i => ({ ...blankActivity('2026-09-29'), id: String(i), sectionId: 'work' })) }
}
describe('daily progress', () => {
  it('uses skip colors only for explicit manual marks and restores automatic progress', () => {
    const d = fixture()
    for (const status of ['skipped', 'missed'] as const) {
      d.sectionMarks = [{ sectionId: 'work', date: '2026-09-29', status }]
      expect(cellStatus(d, 'work', '2026-09-29')).toBe(status)
      expect(automaticStatus(d, '2026-09-29', 'work')).toBe('pending')
      expect(d.marks).toHaveLength(0)
    }
    d.sectionMarks = []
    expect(cellStatus(d, 'work', '2026-09-29')).toBe('pending')
  })
  it('calculates all three states and honors manual feelings without changing tasks', () => {
    const d = fixture()
    expect(automaticStatus(d, '2026-09-29', 'work')).toBe('pending')
    d.marks.push({ activityId: '1', date: '2026-09-29', status: 'done', focus: false, time: null })
    expect(automaticStatus(d, '2026-09-29', 'work')).toBe('partial')
    d.sectionMarks.push({ sectionId: 'work', date: '2026-09-29', status: 'done' })
    expect(cellStatus(d, 'work', '2026-09-29')).toBe('done')
    expect(d.marks).toHaveLength(1)
    d.sectionMarks = []
    d.marks.push({ ...d.marks[0], activityId: '2' })
    expect(cellStatus(d, 'work', '2026-09-29')).toBe('done')
    expect(cellStatus(d, 'work', '2026-09-28')).toBe('empty')
  })
  it('uses calendar dates for monthly and yearly events', () => {
    const a = { ...blankActivity('2026-01-31'), recurrence: 'monthly' as const }
    expect(occurs(a, '2026-02-28')).toBe(false)
    expect(occurs(a, '2026-03-31')).toBe(true)
    expect(occurs({ ...a, recurrence: 'yearly' }, '2027-01-31')).toBe(true)
  })
})
describe('offline synchronization', () => {
  it('merges independent device edits and deletions', () => {
    const base = fixture(), local = structuredClone(base), remote = structuredClone(base)
    local.activities[0].title = 'Локально'; remote.activities[1].title = 'На сервере'; remote.version = 8
    const merged = mergeDiary(base, local, remote)
    expect(merged.activities.map(a => a.title)).toEqual(['Локально', 'На сервере'])
    expect(merged.version).toBe(8)
    local.activities.pop()
    expect(() => mergeDiary(base, local, remote)).toThrow(MergeConflict)
    expect(mergeDiary(base, local, remote, 'local').activities).toHaveLength(1)
  })
  it('never silently overwrites two edits of the same record', () => {
    const base = fixture(), local = structuredClone(base), remote = structuredClone(base)
    local.activities[0].title = 'A'; remote.activities[0].title = 'B'
    expect(() => mergeDiary(base, local, remote)).toThrow(MergeConflict)
    expect(mergeDiary(base, local, remote, 'remote').activities[0].title).toBe('B')
  })
  it('persists pending data and clears the active account on logout', async () => {
    const data = fixture(), value = { account: { id: 'alice', username: 'a@example.com', expiresAt: 9999999999 }, base: data, data, dirty: true }
    await persist(value); expect(await readLocal()).toEqual(value)
    await persist(); expect(await readLocal()).toBeUndefined()
  })
})
