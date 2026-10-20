import { useState, type FormEvent } from 'react'
import { api, errorMessage } from './api'

export default function PhoneSettings({ current, busy, onSaved }: { current?: string | null; busy: boolean; onSaved(phone: string): void }) {
  const [phone, setPhone] = useState(current || ''), [password, setPassword] = useState(''), [working, setWorking] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); setWorking(true); setError(''); setNotice('')
    try {
      const result = await api<{ phone: string }>('/auth/phone', 'PUT', { phone, password })
      setPhone(result.phone); setPassword(''); onSaved(result.phone); setNotice('Номер телефона сохранён для поиска и входа.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  return <form className="d-form d-phone-form" onSubmit={e => void submit(e)}>
    <label>Номер телефона<input type="tel" inputMode="tel" autoComplete="tel" required pattern="\+[1-9][0-9 ()-]{6,24}" placeholder="+7 701 123 45 67" value={phone} onChange={e => setPhone(e.target.value)} /></label>
    <label>Текущий пароль<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
    <button className="d-secondary" disabled={busy || working}>{working ? 'Сохраняем…' : current ? 'Обновить номер' : 'Добавить номер'}</button>
    <p className="d-hint">Подтверждение по SMS пока не включено. Номер могут использовать для поиска вашего аккаунта.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </form>
}
