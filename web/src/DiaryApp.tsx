import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { BookOpen, CalendarDays, Columns3, Settings, Shield, Plus, ChevronLeft, ChevronRight, X, Check, ArrowUpRight, Bell, LogOut, RefreshCw, WifiOff, Download, Folder, Clock, MessageCircle } from 'lucide-react'
import { api, ApiError, errorMessage, setAccountId } from './api'
import { blankActivity, localDate, plusDays, weekdays, validDate, type Activity, type Mark, type TaskEntry } from './planner-model'
import { automaticStatus, calendarStatus, dayMark, emptyDiary, groupNames, orderedSections, labels, mergeDiary, MergeConflict, normalize, tasksOn, type CellStatus, type Diary, type Section } from './diary-model'
import { persist, readLocal, type Account, type LocalDiary } from './diary-store'
import { disablePush, existingPush } from './push'
import './diary.css'
import './diary-controls.css'
import './day-agenda.css'
import './readability.css'
import PushTest from './PushTest'
import DirectionSettings from './DirectionSettings'
import TaskForm from './TaskForm'
import DayAgenda from './DayAgenda'
import ProgressTable from './ProgressTable'
import ThemeToggle from './ThemeToggle'
import QuickGuide from './QuickGuide'
import DiaryAssistant from './DiaryAssistant'
import People from './People'

type View = 'table' | 'day' | 'calendar' | 'settings' | 'admin' | 'people'
type InstallEvent = Event & { prompt(): Promise<void> }
const entry = (text: string): TaskEntry => ({ id: crypto.randomUUID(), at: new Date().toISOString(), text })
const displayDate = (date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) => new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', options)
const statusIcon = (status: CellStatus) => status === 'done' ? '✓' : status === 'partial' ? '◐' : status === 'pending' ? '·' : status === 'skipped' ? '−' : status === 'missed' ? '×' : ''

const dateClass = (date: string, today: string) => {
  const weekday = new Date(date + 'T12:00:00').getDay()
  return [weekday === 0 || weekday === 6 ? 'is-weekend' : '', weekday === 6 ? 'weekend-start' : '', date === today ? 'is-today' : ''].filter(Boolean).join(' ')
}

export default function DiaryApp() {
  const [local, setLocal] = useState<LocalDiary | null>(null)
  const localRef = useRef<LocalDiary | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const syncing = useRef(false)
  const persisting = useRef(false)
  const editorOpen = useRef(false)
  const saveError = useRef('')
  const [online, setOnline] = useState(navigator.onLine)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [serverAvailable, setServerAvailable] = useState(false)
  const [clockTick, setClockTick] = useState(0)
  const [conflict, setConflict] = useState(false)
  const [view, setView] = useState<View>('table')
  const [day, setDay] = useState(localDate(Intl.DateTimeFormat().resolvedOptions().timeZone))
  const [sectionView, setSectionView] = useState<{ id: string; date?: string } | null>(null)
  const [edit, setEdit] = useState<{ activity: Activity; date: string } | null>(null)
  const [sectionEditor, setSectionEditor] = useState(false)
  const [directionsOpen, setDirectionsOpen] = useState(false)
  const [install, setInstall] = useState<InstallEvent | null>(null)
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()
  const rawData = local?.data || emptyDiary()
  const data = { ...rawData, sections: orderedSections(rawData) }
  const today = localDate(data.timezone)
  const previousToday = useRef(today)
  useEffect(() => {
    if (previousToday.current !== today) {
      const previousDate = previousToday.current
      setDay(current => current === previousDate ? today : current)
      previousToday.current = today
    }
  }, [today, clockTick])
  useEffect(() => {
    if (!local) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') !== 'today') return
    const date = params.get('date') || today
    setDay(validDate(date) ? date : today)
    setView('day')
    window.history.replaceState(null, '', window.location.pathname)
  }, [local?.account.id, today])
  const locked = working || loading
  editorOpen.current = !!edit || sectionEditor || directionsOpen
  async function accept(value: LocalDiary | null) {
    await persist(value || undefined)
    localRef.current = value; setLocal(value); setAccountId(value?.account.id || null)
  }
  async function synchronize(prefer?: 'local' | 'remote') {
    if (!navigator.onLine) return true
    if (syncing.current || persisting.current || !localRef.current) return false
    syncing.current = true; setWorking(true)
    const current = localRef.current
    try {
      const account = await api<Account>('/auth/me')
      if (account.id !== current.account.id) throw new ApiError('Аккаунт изменился. Войдите снова.', 401)
      const remote = normalize(await api<Diary>('/planner'))
      const merged = current.dirty ? mergeDiary(current.base, current.data, remote, prefer) : remote
      const saved = current.dirty ? normalize(await api<Diary>('/planner', 'PUT', merged)) : remote
      await accept({ account, data: saved, base: saved, dirty: false }); setConflict(false); setError(''); setNotice(''); setServerAvailable(true)
      return true
    } catch (err) {
      setServerAvailable(false)
      saveError.current = err instanceof Error ? err.message : 'Не удалось сохранить изменения.'
      if (err instanceof MergeConflict) { setConflict(true); setError(err.message) }
      else if (err instanceof ApiError && err.status === 401) { localRef.current = null; setLocal(null); setAccountId(null); setError(err.message) }
      else if (err instanceof ApiError) setError(err.message)
      else setNotice('Изменения сохранены на устройстве. Синхронизируем, когда сервер будет доступен.')
      return !(err instanceof ApiError || err instanceof MergeConflict)
    } finally { syncing.current = false; setWorking(false) }
  }
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const cached = await readLocal().catch(() => undefined)
      if (cached && cached.account.expiresAt * 1000 > Date.now() && !cancelled) {
        await accept(cached)
        setDay(localDate(cached.data.timezone))
        setLoading(false)
      }
      try {
        const account = await api<Account>('/auth/me')
        if (cancelled) return
        setAccountId(account.id)
        if (cached?.account.id === account.id) {
          await accept({ ...(localRef.current || cached), account })
          if (!editorOpen.current) await synchronize()
        }
        else { const remote = normalize(await api<Diary>('/planner')); await accept({ account, data: remote, base: remote, dirty: false }); setDay(localDate(remote.timezone)); setServerAvailable(true) }
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError) { if (err.status === 401) { localRef.current = null; setLocal(null); setAccountId(null) } else setError(err.message) }
        else if (cached && cached.account.expiresAt * 1000 > Date.now() && !localRef.current) await accept(cached)
        else if (cached) setError('Для продления входа подключитесь к интернету. Локальные изменения сохранены.')
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    const on = () => { setOnline(true); if (!editorOpen.current) void synchronize() }, off = () => setOnline(false)
    const offer = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent) }
    const refresh = () => { setClockTick(value => value + 1); if (!document.hidden && !editorOpen.current) void synchronize() }
    const timer = window.setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('beforeinstallprompt', offer)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('beforeinstallprompt', offer) }
  }, [])
  async function save(next: Diary) {
    saveError.current = ''
    if (!localRef.current || working || syncing.current || persisting.current) { saveError.current = 'Дождитесь завершения синхронизации и повторите сохранение.'; return false }
    persisting.current = true
    setWorking(true)
    try { await accept({ ...localRef.current, data: next, dirty: true }) }
    catch { saveError.current = 'Не удалось сохранить на устройстве. Освободите место; изменения не сохранены.'; setError(saveError.current); return false }
    finally { persisting.current = false; setWorking(false) }
    return await synchronize()
  }
  async function authenticate(email: string, password: string, register: boolean) {
    setWorking(true); setError('')
    try {
      setAccountId(null)
      if (register) await api('/auth/register', 'POST', { email, password })
      const account = await api<Account>('/auth/login', 'POST', { username: email, password })
      setAccountId(account.id)
      const remote = normalize(await api<Diary>('/planner'))
      const cached = await readLocal()
      await accept(cached?.account.id === account.id ? { ...cached, account } : { account, data: remote, base: remote, dirty: false })
      setDay(localDate(remote.timezone)); setView('table')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
    void synchronize()
  }
  async function logout() {
    if (local?.dirty) { setError('Сначала синхронизируйте изменения, чтобы не потерять их при выходе.'); return }
    setWorking(true)
    try { await disablePush(); await api('/auth/logout', 'POST'); await accept(null); setEdit(null); setSectionView(null); setNotice('') }
    catch (err) { setError(errorMessage(err)) } finally { setWorking(false) }
  }
  async function enablePush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('На iPhone установите сайт на экран «Домой» и откройте оттуда. Устройство должно поддерживать Web Push.')
      const permission = await Notification.requestPermission()
      const config = await api<{ publicKey: string; error?: string }>('/push/config')
      if (config.error) throw new Error(config.error)
      if (!config.publicKey) throw new Error('Для push-уведомлений нужно настроить ключи VAPID на сервере.')
      if (permission !== 'granted') throw new Error('Разрешите уведомления в настройках устройства.')
      const registration = await navigator.serviceWorker.ready
      const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
      let sub = await existingPush()
      const previousKey = sub?.options.applicationServerKey
      if (sub && previousKey && Array.from(new Uint8Array(previousKey)).join() !== Array.from(key).join()) { await sub.unsubscribe(); sub = null }
      sub = sub || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      await api('/push/subscribe', 'POST', sub.toJSON()); setNotice('Напоминания на этом телефоне включены.')
    } catch (err) { setError(err instanceof Error ? err.message : errorMessage(err)) }
  }
  function openNew(sectionId?: string, date = day) { setEdit({ activity: { ...blankActivity(date), kind: 'task', recurrence: 'once', sectionId: sectionId || data.sections[0]?.id || null, comments: [], history: [] }, date }) }
  async function updateActivity(a: Activity, date: string, mark?: Mark, onlyOccurrence = false) {
    let next = { ...data }
    const previous = data.activities.find(v => v.id === a.id)
    if (onlyOccurrence && previous && previous.recurrence !== 'once') {
      const moved = { ...a, id: crypto.randomUUID(), start: a.start === previous.start ? date : a.start, end: null, recurrence: 'once' as const, weekdays: [], history: [...(a.history || []), entry(`Отдельное событие из серии за ${date}`)] }
      next.activities = [...data.activities, moved]
      next.marks = [...data.marks.filter(m => !(m.activityId === a.id && m.date === date)), { ...dayMark(data, a, date), status: 'rest' }]
      if (mark) next.marks.push({ ...mark, activityId: moved.id, date: moved.start })
    } else {
      const saved = { ...a, history: [...(a.history || []), entry(previous ? `Обновлено${mark ? ` · ${mark.date}: ${mark.status === 'done' ? 'выполнено' : mark.status === 'partial' ? 'частично' : 'запланировано'}` : ''}` : 'Создана задача')] }
      next.activities = previous ? data.activities.map(v => v.id === a.id ? saved : v) : [...data.activities, saved]
      if (mark) next.marks = [...data.marks.filter(m => !(m.activityId === mark.activityId && m.date === mark.date)), mark]
    }
    if (await save(next)) setEdit(null)
    else throw new Error(saveError.current || 'Не удалось сохранить задачу. Повторите попытку.')
  }
  async function toggleTask(activity: Activity) {
    const mark = dayMark(data, activity, day)
    const status = mark.status === 'done' ? 'missed' : 'done'
    await save({ ...data,
      marks: [...data.marks.filter(m => !(m.activityId === activity.id && m.date === day)), { ...mark, status }],
      activities: data.activities.map(a => a.id === activity.id ? { ...a, history: [...(a.history || []), entry(`${day}: ${status === 'done' ? 'Выполнено' : 'Возобновлено'}`)] } : a) })
  }
  async function override(sectionId: string, date: string, status: CellStatus | 'auto') {
    await save({ ...data, sectionMarks: [...data.sectionMarks.filter(m => !(m.sectionId === sectionId && m.date === date)), ...(status === 'auto' ? [] : [{ sectionId, date, status }])] })
  }
  const month = day.slice(0, 7), first = month + '-01'
  const dates = Array.from({ length: new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0).getDate() }, (_, i) => plusDays(first, i))
  const todaysTasks = tasksOn(data, day)
  const done = todaysTasks.filter(a => dayMark(data, a, day).status === 'done').length
  function shiftMonth(n: number) { const d = new Date(first + 'T12:00:00'); d.setMonth(d.getMonth() + n); setDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`) }
  function taskCard(a: Activity, date: string) {
    const mark = dayMark(data, a, date), state = mark.status === 'done' ? 'done' : mark.status === 'partial' ? 'partial' : 'pending'
    return <button key={a.id + date} className={`d-task ${state}`} onClick={() => setEdit({ activity: a, date })}><span className={`d-task-check ${state}`}>{statusIcon(state)}</span><strong>{a.title}</strong><span className="d-task-meta"><Clock size={13} />{mark.time || a.time || 'Без времени'}{(mark.time || a.time) && ` · ${a.duration} мин`}{!!a.comments?.length && <><MessageCircle size={13} />{a.comments.length}</>}</span>{date < today && mark.status !== 'done' && <small className="d-overdue">Просрочено · {displayDate(date)}</small>}</button>
  }
  if (loading) return <div className="d-loading"><BookOpen /><p>Открываем ежедневник…</p></div>
  if (!local) return <Auth busy={working} error={error} onSubmit={authenticate} />
  const nav = [{ id: 'table', title: 'Ежедневник', icon: BookOpen }, { id: 'day', title: 'Мой день', icon: Columns3 }, { id: 'calendar', title: 'Календарь', icon: CalendarDays }, { id: 'people', title: 'Люди', icon: MessageCircle }] as const
  return <div className="diary-app">
    <aside className="d-sidebar"><a className="d-brand" href="/" aria-label="Intent — главная"><span><BookOpen size={23} /></span>intent<span className="d-brand-dot">.</span></a><p className="d-sidebar-caption">МЕСТО ДЛЯ ВАШЕГО ДНЯ</p><nav>{nav.map(n => <button key={n.id} className={view === n.id ? 'active' : ''} onClick={() => { setView(n.id); setSectionView(null) }}><n.icon size={19} />{n.title}</button>)}</nav><div className="d-section-heading">МОИ НАПРАВЛЕНИЯ<button aria-label="Добавить направление" onClick={() => setSectionEditor(true)} disabled={locked}><Plus size={16} /></button></div><div className="d-side-sections">{data.sections.map(s => <button key={s.id} onClick={() => setSectionView({ id: s.id })}><Folder size={15} /><span>{s.title}</span><ChevronRight size={13} /></button>)}{!data.sections.length && <p>Добавьте первое направление</p>}</div><div className="d-sidebar-bottom">{local.account.admin && <button onClick={() => setView('admin')}><Shield size={18} />Администрирование</button>}<button onClick={() => setView('settings')}><Settings size={18} />Настройки</button><div className="d-account"><span className="d-avatar">{local.account.username[0].toUpperCase()}</span><div><strong>{local.account.username}</strong><small>Личное пространство</small></div><button aria-label="Выйти" onClick={() => void logout()} disabled={locked}><LogOut size={17} /></button></div></div></aside>
    <main className="d-main"><header className="d-topbar"><span>Мой ежедневник <ChevronRight size={13} />{view === 'table' ? 'Обзор месяца' : view === 'day' ? 'Мой день' : view === 'calendar' ? 'Календарь' : view === 'admin' ? 'Администрирование' : view === 'people' ? 'Люди' : 'Настройки'}</span><div className="d-topbar-actions"><QuickGuide key={local.account.id} accountId={local.account.id} isEmpty={!data.sections.length && !data.activities.length} /><ThemeToggle /><button className="d-sync" disabled={locked || !online} onClick={() => void synchronize()}>{!online ? <WifiOff size={14} /> : <RefreshCw size={14} className={working ? 'd-spin' : ''} />}{!online ? 'Офлайн' : working ? 'Синхронизация…' : !serverAvailable ? 'Сервер недоступен' : local.dirty ? 'Есть изменения' : 'Синхронизировано'}</button></div></header>
      {error && <div role="alert" className="d-banner d-error">{error}<button aria-label="Закрыть ошибку" onClick={() => setError('')}><X size={16} /></button></div>}
      {notice && <div role="status" className="d-banner">{notice}<button aria-label="Закрыть сообщение" onClick={() => setNotice('')}><X size={16} /></button></div>}
      {conflict && <div className="d-banner d-conflict"><p>Изменения разных записей объединятся. Для совпавших записей выберите версию. Перед выбором можно скачать локальную копию в настройках.</p><button disabled={locked} onClick={() => void synchronize('local')}>Использовать мои изменения</button><button disabled={locked} onClick={() => void synchronize('remote')}>Использовать серверные изменения</button></div>}
      {needRefresh && <div className="d-banner"><span>Доступна новая версия приложения.</span><button disabled={locked || local.dirty || !!edit} onClick={() => void updateServiceWorker(true)}>Обновить</button></div>}
      <div className={`d-content d-view-${view}`}>
        {view === 'people' && <People data={data} accountId={local.account.id} busy={locked} dirty={local.dirty} onAccepted={synchronize} />}
        {['table', 'day', 'calendar'].includes(view) && <DiaryAssistant timezone={data.timezone} busy={locked} onSave={async activities => save({ ...data, activities: [...data.activities.filter(a => !activities.some(draft => draft.id === a.id)), ...activities] })} />}
        {['table', 'day', 'calendar'].includes(view) && <><div className="d-heading"><div><div className="d-eyebrow">МАЛЕНЬКИЕ ШАГИ. КАЖДЫЙ ДЕНЬ.</div><h1>{view === 'table' ? 'Всё начинается с дня' : view === 'day' ? 'Мой день' : 'Календарь'}</h1><p>{view === 'table' ? 'Планы, привычки и немного внимания к себе.' : view === 'day' ? 'У каждого дела — своё место. У вас — свой ритм.' : 'Важные даты и события, которые хочется помнить.'}</p></div><button className="d-primary" onClick={() => openNew()} disabled={locked}><Plus size={18} />Добавить задачу</button></div>
        <div className="d-summary"><div><span className="d-summary-icon"><CalendarDays size={21} /></span><div><small>ВЫБРАННЫЙ ДЕНЬ</small><strong>{displayDate(day)}<em>{displayDate(day, { weekday: 'long' })}</em></strong></div></div><div><span className="d-summary-icon green"><Check size={21} /></span><div><small>ЗАВЕРШЕНО</small><strong>{done}<em>из {todaysTasks.length} задач</em></strong></div><div className="d-progress"><i style={{ width: `${todaysTasks.length ? done / todaysTasks.length * 100 : 0}%` }} /></div></div><button className="d-summary-link" onClick={() => { setDay(today); setView('day') }}>Посмотреть сегодняшний день<ArrowUpRight size={20} /></button></div>
        {view !== 'table' && <div className="d-toolbar"><div className="d-date-controls"><button aria-label="Предыдущий период" onClick={() => view === 'day' ? setDay(plusDays(day, -1)) : shiftMonth(-1)}><ChevronLeft size={19} /></button><h2>{displayDate(view === 'day' ? day : first, view === 'day' ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' })}</h2><button aria-label="Следующий период" onClick={() => view === 'day' ? setDay(plusDays(day, 1)) : shiftMonth(1)}><ChevronRight size={19} /></button><button className="d-today" onClick={() => setDay(today)}>Сегодня</button></div><label className="d-date-input">Дата<input aria-label="Выбранная дата" type="date" value={day} onChange={e => { if (e.target.value) setDay(e.target.value) }} /></label></div>}</>}
        {view === 'table' && <ProgressTable data={data} day={day} today={today} busy={locked} onDay={setDay} onOpenDay={date => { setDay(date); setView('day') }} onSection={(id, date) => setSectionView({ id, date })} onAdd={() => setSectionEditor(true)} onSettings={() => setDirectionsOpen(true)} />}
        {view === 'day' && <DayAgenda data={data} day={day} today={today} busy={locked} onOpen={activity => setEdit({ activity, date: day })} onToggle={activity => void toggleTask(activity)} onAdd={() => openNew()} />}
        {view === 'calendar' && <section className="d-panel"><div className="d-calendar">{weekdays.map(w => <div key={w} className={`d-weekday ${w === weekdays[5] || w === weekdays[6] ? 'is-weekend' : ''}`}>{w}</div>)}{Array.from({ length: (new Date(first + 'T12:00:00').getDay() + 6) % 7 }, (_, i) => <div key={'blank' + i} className="d-calendar-blank" />)}{dates.map(date => { const tasks = tasksOn(data, date), state = calendarStatus(data, date); return <button key={date} className={`d-calendar-day ${state} ${dateClass(date, today)}`} onClick={() => { setDay(date); setView('day') }}><strong>{Number(date.slice(8))}</strong>{tasks.slice(0, 3).map(a => <span key={a.id}>{a.time && `${a.time} `}{a.title}</span>)}{tasks.length > 3 && <small>Ещё {tasks.length - 3}</small>}{!tasks.length && state !== 'empty' && <small>{labels[state]}</small>}</button> })}</div><div className="d-table-footer"><Legend /></div></section>}
        {view === 'settings' && <section className="d-settings"><div className="d-heading"><div><h1>Настройки</h1><p>Ваш ежедневник, в вашем ритме.</p></div></div><div className="d-panel d-settings-card"><h2>Напоминания на телефон</h2><p>Получайте уведомления о событиях и задачах. На iPhone сначала добавьте сайт на экран «Домой» через меню «Поделиться».</p><PushTest /><button className="d-primary" onClick={() => void enablePush()}><Bell size={17} />Включить уведомления</button><button className="d-secondary" onClick={() => void disablePush().then(() => setNotice('Уведомления отключены.')).catch(e => setError(errorMessage(e)))}>Отключить</button></div><div className="d-panel d-settings-card"><h2>Приложение и синхронизация</h2><p>{local.dirty ? 'Есть изменения, сохранённые на устройстве.' : !serverAvailable ? 'Локальная копия доступна. Сервер пока не подтвердил синхронизацию.' : 'Все изменения синхронизированы.'} Офлайн доступны уже загруженные данные. Напоминания доставляются при подключении к интернету.</p>{install && <button className="d-primary" onClick={() => void install.prompt()}><Download size={17} />Установить приложение</button>}<button className="d-secondary" disabled={locked || !online} onClick={() => void synchronize()}>Синхронизировать</button><button className="d-secondary" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `diary-${today}.json`; a.click(); URL.revokeObjectURL(url) }}>Скачать резервную копию</button><label>Часовой пояс<input defaultValue={data.timezone} key={data.timezone} onBlur={e => { try { localDate(e.target.value); if (e.target.value !== data.timezone) void save({ ...data, timezone: e.target.value }) } catch { setError('Неизвестный часовой пояс. Например: Asia/Qyzylorda') } }} /></label></div><div className="d-panel d-settings-card"><h2>Доступ к аккаунту</h2><p>{local.account.username}</p><p>Для восстановления пароля обратитесь к администратору.</p><button className="d-secondary" disabled={locked} onClick={() => void logout()}>Выйти из аккаунта</button></div></section>}
        {view === 'settings' && data.activities.some(a => a.archived) && <section className="d-panel d-settings-card"><h2>Архив</h2><p>Откройте задачу, чтобы восстановить её.</p>{data.activities.filter(a => a.archived).map(a => taskCard(a, a.start))}</section>}
        {view === 'admin' && local.account.admin && <Admin onError={setError} />}
        {view === 'table' && <div className="d-bottom-note"><span>Не обязательно идеально. Главное — замечать свой прогресс.</span><span>Ваше личное пространство <BookOpen size={14} /></span></div>}
      </div>
    </main>
    <nav className="d-mobile-nav">{nav.map(n => <button className={view === n.id ? 'active' : ''} key={n.id} onClick={() => setView(n.id)}><n.icon size={20} />{n.title}</button>)}<button onClick={() => setView('settings')}><Settings size={20} />Настройки</button>{local.account.admin && <button onClick={() => setView('admin')}><Shield size={20} />Админка</button>}</nav>
    {directionsOpen && <Modal title="Группы и порядок направлений" onClose={() => setDirectionsOpen(false)}><DirectionSettings data={data} busy={locked} onSave={async next => { if (await save(next)) setDirectionsOpen(false) }} /></Modal>}
    {sectionEditor && <SectionEditor groups={groupNames(data)} busy={locked} onClose={() => setSectionEditor(false)} onSave={async section => { if (await save({ ...data, sections: [...data.sections, { ...section, position: Math.max(0, ...data.sections.map(s => s.position || 0)) + 1 }] })) setSectionEditor(false) }} />}
    {sectionView && <Modal title={data.sections.find(s => s.id === sectionView.id)?.title || 'Без раздела'} onClose={() => setSectionView(null)}><div className="d-section-modal">{sectionView.date ? <><p>{displayDate(sectionView.date, { day: 'numeric', month: 'long', year: 'numeric' })}</p><label>Как вы оцениваете этот день?<select disabled={locked} value={data.sectionMarks.find(m => m.sectionId === sectionView.id && m.date === sectionView.date)?.status || 'auto'} onChange={e => void override(sectionView.id, sectionView.date!, e.target.value as CellStatus | 'auto')}><option value="auto">Автоматически · {labels[automaticStatus(data, sectionView.date, sectionView.id)]}</option>{Object.entries(labels).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label><p className="d-hint">Ручная оценка отражает ваши ощущения и не меняет выполнение отдельных задач.</p>{tasksOn(data, sectionView.date, sectionView.id).map(a => taskCard(a, sectionView.date!))}</> : <><p>Все задачи и привычки направления</p>{data.activities.filter(a => !a.archived && a.sectionId === sectionView.id).map(a => taskCard(a, a.recurrence === 'once' ? a.start : day))}</>}<button className="d-primary" disabled={locked} onClick={() => openNew(sectionView.id, sectionView.date || day)}><Plus size={16} />Добавить задачу</button></div></Modal>}
    {edit && <Modal title={data.activities.some(a => a.id === edit.activity.id) ? 'Карточка задачи' : 'Новое дело'} onClose={() => setEdit(null)}><TaskForm key={edit.activity.id + edit.date} value={edit.activity} date={edit.date} data={data} busy={locked} onSave={updateActivity} /></Modal>}
  </div>
}

function Legend() { return <div className="d-legend">{(['done', 'partial', 'pending', 'skipped', 'missed'] as const).map(s => <span key={s}><i className={s} />{labels[s]}</span>)}</div> }
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog className="d-modal" ref={ref} onCancel={e => { e.preventDefault(); onClose() }}><header><h2>{title}</h2><button aria-label="Закрыть окно" onClick={onClose}><X size={20} /></button></header>{children}</dialog>
}
function Auth({ busy, error, onSubmit }: { busy: boolean; error: string; onSubmit(email: string, password: string, register: boolean): Promise<void> }) {
  const [register, setRegister] = useState(false), [email, setEmail] = useState(''), [password, setPassword] = useState('')
  return <main className="d-auth"><div className="d-auth-art"><span className="d-brand"><span><BookOpen /></span>intent.</span><div><p className="d-eyebrow">ВАШ ДЕНЬ. ВАШ РИТМ.</p><h1>Большие перемены<br />начинаются<br />с маленьких дел.</h1><p>Ежедневник, который помогает видеть главное.<br />Планы, привычки и важные даты — в одном месте.</p><div className="d-auth-cells">{['done','done','partial','done','pending','empty','done','partial','done','pending','empty','empty','done','done','done','partial','pending','empty'].map((s,i) => <i className={s} key={i}>{statusIcon(s as CellStatus)}</i>)}</div></div><small>Немного внимания к себе. Каждый день.</small></div><div className="d-auth-form"><form onSubmit={e => { e.preventDefault(); void onSubmit(email, password, register) }}><BookOpen className="d-auth-logo" size={35} /><h2>{register ? 'Ваше новое начало' : 'С возвращением'}</h2><p>{register ? 'Создайте личное пространство для ваших планов.' : 'Ваши планы уже ждут вас.'}</p>{error && <div className="d-banner d-error" role="alert">{error}</div>}<label>Электронная почта<input type={register ? 'email' : 'text'} autoComplete="username" required maxLength={80} value={email} placeholder="you@example.com" onChange={e => setEmail(e.target.value)} /></label><label>Пароль<input type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 12 : 1} maxLength={256} required value={password} placeholder={register ? 'Не менее 12 символов' : 'Введите пароль'} onChange={e => setPassword(e.target.value)} /></label><button className="d-primary" disabled={busy}>{busy ? 'Подождите…' : register ? 'Создать аккаунт' : 'Войти'}<ArrowUpRight size={18} /></button><button type="button" className="d-auth-switch" disabled={busy} onClick={() => setRegister(!register)}>{register ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}</button><p className="d-hint">Забыли пароль? Обратитесь к администратору для восстановления доступа.</p></form></div></main>
}
function SectionEditor({ groups, busy, onSave, onClose }: { groups: string[]; busy: boolean; onSave(s: Section): Promise<void>; onClose(): void }) {
  const [title, setTitle] = useState(''), [group, setGroup] = useState(groups[0] || '')
  return <Modal title="Новое направление" onClose={onClose}><form className="d-form" onSubmit={e => { e.preventDefault(); void onSave({ id: crypto.randomUUID(), title: title.trim(), group }) }}><label>Название<input autoFocus required maxLength={160} placeholder="Например, Работа" value={title} onChange={e => setTitle(e.target.value)} /></label><label>Группа<select value={group} onChange={e => setGroup(e.target.value)}>{groups.map(g => <option key={g}>{g}</option>)}</select></label><button className="d-primary" disabled={busy || !title.trim() || !group}>Добавить направление</button></form></Modal>
}


type AdminUser = { id: string; email: string; admin: boolean; blocked: boolean; createdAt: number | null; lastSeen: number | null; tasks: number; habits: number; events: number; completed: number }
function Admin({ onError }: { onError(s: string): void }) {
  const [result, setResult] = useState<{ users: AdminUser[]; active: Record<string, number> } | null>(null), [reset, setReset] = useState<AdminUser | null>(null), [password, setPassword] = useState(''), [busy, setBusy] = useState(false)
  async function refresh() { try { setResult(await api('/admin/users')) } catch (e) { onError(errorMessage(e)) } }
  useEffect(() => { void refresh() }, [])
  async function action(path: string, body: unknown) { setBusy(true); try { await api(path, 'POST', body); setReset(null); setPassword(''); await refresh() } catch (e) { onError(errorMessage(e)) } finally { setBusy(false) } }
  return <><div className="d-heading"><div><h1>Активность пользователей</h1><p>Статистика использования без доступа к личным записям.</p></div></div><div className="d-admin-stats">{[1,7,30].map(days => <div className="d-panel" key={days}><small>Активны за {days === 1 ? 'день' : days === 7 ? 'неделю' : 'месяц'}</small><strong>{result?.active[days] ?? '—'}</strong></div>)}</div><div className="d-panel d-table-scroll"><table className="d-admin-table"><thead><tr><th>Пользователь</th><th>Регистрация</th><th>Последний визит</th><th>Задачи / привычки / события</th><th>Выполнено</th><th>Доступ</th></tr></thead><tbody>{result?.users.map(u => <tr key={u.id}><td>{u.email}{u.admin && <small>Администратор</small>}</td><td>{u.createdAt ? new Date(u.createdAt * 1000).toLocaleDateString('ru-RU') : '—'}</td><td>{u.lastSeen ? new Date(u.lastSeen * 1000).toLocaleString('ru-RU') : '—'}</td><td>{u.tasks} / {u.habits} / {u.events}</td><td>{u.completed}</td><td><button disabled={busy || u.admin} onClick={() => void action(`/admin/users/${u.id}/block`, { blocked: !u.blocked })}>{u.blocked ? 'Разблокировать' : 'Заблокировать'}</button><button disabled={busy} onClick={() => setReset(u)}>Сбросить пароль</button></td></tr>)}</tbody></table></div>{reset && <Modal title="Восстановление доступа" onClose={() => setReset(null)}><form className="d-form" onSubmit={e => { e.preventDefault(); void action(`/admin/users/${reset.id}/reset-password`, { password }) }}><p>{reset.email}</p><label>Новый пароль<input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label><p className="d-hint">Все действующие сессии будут завершены. Передайте новый пароль пользователю лично.</p><button className="d-primary" disabled={busy}>Сменить пароль</button></form></Modal>}</>
}
