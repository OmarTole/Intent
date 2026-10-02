import { useEffect, useRef, useState } from 'react'
import { CircleHelp, X } from 'lucide-react'
import './quick-guide.css'

export default function QuickGuide({ accountId, isEmpty }: { accountId: string; isEmpty: boolean }) {
  const storageKey = `intent-guide-v1:${accountId}`
  const [open, setOpen] = useState(() => {
    try { return isEmpty && localStorage.getItem(storageKey) !== 'seen' }
    catch { return isEmpty }
  })
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  function close() {
    try { localStorage.setItem(storageKey, 'seen') } catch { /* Optional device preference. */ }
    setOpen(false)
  }
  return <>
    <button className="d-theme-toggle" title="Как пользоваться Intent" aria-label="Как пользоваться Intent" onClick={() => setOpen(true)}><CircleHelp size={18} /></button>
    <dialog ref={dialog} className="d-modal d-quick-guide" aria-labelledby="quick-guide-title" onCancel={event => { event.preventDefault(); close() }}>
      <header><h2 id="quick-guide-title">Добро пожаловать в Intent</h2><button aria-label="Закрыть инструкцию" onClick={close}><X size={20} /></button></header>
      <div className="d-guide-content">
        <p>Ваши планы и привычки — в одном ежедневнике.</p>
        <ol>
          <li><strong>Создайте направление.</strong> Например, «Работа» или «Здоровье». Группы и их порядок меняются кнопкой «Настроить группы и порядок» под таблицей.</li>
          <li><strong>Добавьте задачу.</strong> Укажите название, направление и дату. Для привычки или дня рождения выберите повторение. Расширенные настройки необязательны.</li>
          <li><strong>Откройте «Мой день».</strong> Здесь собраны задачи на выбранную дату. Кружок отмечает выполнение, нажатие на название открывает карточку с комментариями и историей.</li>
          <li><strong>Отмечайте прогресс.</strong> В таблице зелёный — выполнено, светло-зелёный — частично, жёлтый — есть задачи. Нажмите ячейку, чтобы выставить свою оценку. Синий намеренный пропуск и красный пропуск выбираете только вы.</li>
        </ol>
        <p className="d-hint">Таблица показывает пять дней вокруг выбранной даты. Кнопка «Месяц» открывает весь месяц, значок разворота — таблицу на весь экран. Группы сворачиваются нажатием на заголовок. Значок луны или солнца переключает тему.</p>
        <p className="d-hint">Уже загруженные записи доступны офлайн. После подключения проверьте статус синхронизации вверху. Эту инструкцию можно снова открыть кнопкой «?» рядом с темой.</p>
        <button className="d-primary" onClick={close}>Начать пользоваться</button>
      </div>
    </dialog>
  </>
}
