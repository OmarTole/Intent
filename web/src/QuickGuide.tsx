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
        <p>Скажите, что нужно сделать, — Intent запишет и напомнит.</p>
        <ol>
          <li><strong>Чат.</strong> Напишите своими словами: «Завтра в 9 позвонить врачу, напомни за час». Помощник покажет запись — нажмите «Добавить».</li>
          <li><strong>Сегодня.</strong> Дела на выбранный день. Кружок отмечает выполнение, нажатие на название открывает карточку. Задачу можно добавить и вручную.</li>
          <li><strong>Календарь.</strong> Весь месяц; нажмите на день, чтобы открыть его дела.</li>
          <li><strong>Люди.</strong> Пригласите знакомого на событие по номеру телефона.</li>
          <li><strong>Ещё.</strong> Таблица прогресса по направлениям, настройки и напоминания на телефон.</li>
        </ol>
        <p className="d-hint">Записи доступны без интернета и синхронизируются при подключении — статус показан вверху. Эту подсказку можно снова открыть кнопкой «?».</p>
        <button className="d-primary" onClick={close}>Начать пользоваться</button>
      </div>
    </dialog>
  </>
}
