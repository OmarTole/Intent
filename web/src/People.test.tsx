import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import People, { parseVCardContacts } from './People'
import { emptyDiary } from './diary-model'

const mock = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), api: mock.api }))

it('requires synced local changes before accepting and refreshes the calendar after acceptance', async () => {
  const user = userEvent.setup(), accepted = vi.fn(async () => true)
  const invitation = { id: 'invite', senderId: 'alice', recipientId: 'bob', sender: 'alice@example.com', recipient: 'bob@example.com', status: 'pending', event: { title: 'Встреча', start: '2026-10-04', time: '18:00', duration: 30, timezone: 'Asia/Qyzylorda' } }
  mock.api.mockImplementation(async (_path: string, method?: string) => method === 'POST' ? { ...invitation, status: 'accepted' } : [invitation])
  const app = render(<People data={emptyDiary()} accountId="bob" busy={false} dirty onAccepted={accepted} />)
  const button = await screen.findByRole('button', { name: 'Принять и добавить в календарь' })
  expect(button.hasAttribute('disabled')).toBe(true)
  app.rerender(<People data={emptyDiary()} accountId="bob" busy={false} dirty={false} onAccepted={accepted} />)
  await user.click(button)
  expect(mock.api).toHaveBeenCalledWith('/invitations/invite/respond', 'POST', { status: 'accepted' })
  expect(accepted).toHaveBeenCalledTimes(1)
})

it('parses vCard contacts and searches registered phone numbers from an uploaded file', async () => {
  expect(parseVCardContacts('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alex Smith\r\nTEL;TYPE=CELL:+7 701 123 45 67\r\nEND:VCARD')).toEqual([{ name: 'Alex Smith', phone: '+77011234567' }])
  const user = userEvent.setup()
  mock.api.mockImplementation(async (path: string) => path === '/contacts/lookup' ? { registered: ['+77011234567'] } : [])
  render(<People data={emptyDiary()} accountId="alice" busy={false} dirty={false} onAccepted={async () => true} />)
  const file = new File(['BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alex Smith\r\nTEL;TYPE=CELL:+7 701 123 45 67\r\nEND:VCARD'], 'contacts.vcf', { type: 'text/vcard' })
  await user.upload(screen.getByLabelText(/\.vcf/), file)
  expect(await screen.findByText('Alex Smith')).toBeTruthy()
  expect(mock.api).toHaveBeenCalledWith('/contacts/lookup', 'POST', { phones: ['+77011234567'] })
})