import { useState } from 'react'
import { api, errorMessage } from './api'
import { existingPush } from './push'

export default function PushTest() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function test() {
    setBusy(true)
    setMessage('')
    try {
      const sub = await existingPush()
      if (!sub) throw new Error('Сначала нажмите «Включить уведомления» на этом устройстве.')
      await api('/push/test', 'POST', { endpoint: sub.endpoint })
      setMessage('Сервис телефона принял уведомление. Проверьте баннер или центр уведомлений. Если его нет — проверьте разрешение для Intent и режим «Фокусирование».')
    } catch (error) { setMessage(error instanceof Error ? error.message : errorMessage(error)) }
    finally { setBusy(false) }
  }
  return <div className="d-push-test">
    <button className="d-secondary" disabled={busy} onClick={() => void test()}>{busy ? 'Отправляем…' : 'Проверить уведомления'}</button>
    {message && <p role="status">{message}</p>}
    <p className="d-hint">Напоминание приходит как системное уведомление Intent. Укажите время задачи и проверьте часовой пояс ниже. На бесплатном сервере отправка может задерживаться во время его сна.</p>
  </div>
}
