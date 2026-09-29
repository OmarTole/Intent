import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { ArrowDownToLine, ArrowRight, Brain, Check, CheckCheck, ChevronRight, Circle, Compass, Flag, LayoutGrid, LoaderCircle, LogOut, MessageCircle, Plus, RefreshCw, Save, Sparkles, WifiOff, X } from 'lucide-react'
import { api, ApiError, errorMessage, setAccountId } from './api'
import { readSnapshot, writeSnapshot } from './storage'
import Planner from './Planner'
import { existingPush, disablePush } from './push'
import { editable, kinds, progress, statuses, type AgentMessage, type AgentTurn, type CoachResponse, type Draft, type Intent, type LogEvent, type MemoryData, type Status, type User } from './types'

type Tab = 'agent' | 'goals' | 'memory' | 'journal' | 'today' | 'calendar'
type EditingDraft = Draft & { id: string; rawText: string; source: 'ai' | 'manual' }
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

const date = (timestamp: number) => new Date(timestamp * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
const emptyMemory: MemoryData = { displayName: '', about: '', preferences: '', availability: '' }

export default function App() {
  const [user, setUserState] = useState<User | null>(null)
  function setUser(value: User | null) { setAccountId(value?.id ?? null); setUserState(value) }
  const [intents, setIntents] = useState<Intent[]>([])
  const [events, setEvents] = useState<LogEvent[]>([])
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [memory, setMemory] = useState<MemoryData>(emptyMemory)
  const [coach, setCoach] = useState<CoachResponse | null>(null)
  const [coachBusy, setCoachBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const sendingMessage = useRef(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [reachable, setReachable] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<Tab>(new URLSearchParams(window.location.search).get('view') === 'agent' ? 'agent' : 'today')
  const [filter, setFilter] = useState<Status>('active')
  const [wish, setWish] = useState('')
  const [draft, setDraft] = useState<EditingDraft | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState(0)
  const [install, setInstall] = useState<InstallEvent | null>(null)
  const [updatingApp, setUpdatingApp] = useState(false)
  const [plannerPending, setPlannerPending] = useState(false)
  const [plannerRequest, setPlannerRequest] = useState('')
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()
  const readOnly = !online || !reachable

  useEffect(() => {
    let alive = true
    if (user && online) {
      void existingPush().then(subscription => {
        if (alive && subscription) return api('/push/subscribe', 'POST', subscription.toJSON())
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [user?.id, online])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    const offerInstall = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent) }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    window.addEventListener('beforeinstallprompt', offerInstall)
    return () => {
      window.removeEventListener('online', on); window.removeEventListener('offline', off)
      window.removeEventListener('beforeinstallprompt', offerInstall)
    }
  }, [])

  useEffect(() => {
    let alive = true
    async function load() {
      const cached = await readSnapshot().catch(() => undefined)
      let verified: User | undefined
      try {
        const current = await api<User>('/auth/me')
        verified = current
        if (!alive) return
        setUser(current)
        if (cached?.user.id === current.id) {
          setIntents(cached.intents); setEvents(cached.events); setSavedAt(cached.savedAt)
        } else await writeSnapshot().catch(() => {})
        const [goals, log, remembered, chat] = await Promise.all([api<Intent[]>('/intents'), api<LogEvent[]>('/events'), api<MemoryData>('/memory'), api<AgentMessage[]>('/agent/messages')])
        if (!alive) return
        setIntents(goals); setEvents(log); setMemory(remembered); setMessages(chat); setSavedAt(Date.now())
      } catch (err) {
        if (!alive) return
        if (err instanceof ApiError && err.status === 401) {
          await writeSnapshot().catch(() => {})
          setUser(null); setIntents([]); setEvents([])
        } else {
          setReachable(false)
          if (cached && (!verified || verified.id === cached.user.id) && cached.user.expiresAt * 1000 > Date.now()) {
            setUser(cached.user); setIntents(cached.intents); setEvents(cached.events); setSavedAt(cached.savedAt)
          }
          setError(errorMessage(err))
        }
      } finally { if (alive) setLoading(false) }
    }
    void load()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!loading && user) {
      void writeSnapshot({ user, intents, events, savedAt }).catch(() => {
        setNotice('Браузер не разрешил локальное сохранение. Офлайн-просмотр недоступен.')
      })
    }
  }, [user, intents, events, savedAt, loading])

  async function fail(err: unknown) {
    if (!(err instanceof ApiError)) setReachable(false)
    if (err instanceof ApiError && err.status === 401) {
      setUser(null); setIntents([]); setEvents([]); setMessages([]); setMemory(emptyMemory); setDraft(null); setSelected(null); setWish('')
      await writeSnapshot().catch(() => {})
    }
    setError(errorMessage(err))
  }

  async function refresh() {
    setBusy(true); setError('')
    try {
      const current = await api<User>('/auth/me')
      const [goals, log, remembered, chat] = await Promise.all([api<Intent[]>('/intents'), api<LogEvent[]>('/events'), api<MemoryData>('/memory'), api<AgentMessage[]>('/agent/messages')])
      setUser(current); setIntents(goals); setEvents(log); setMemory(remembered); setMessages(chat); setSavedAt(Date.now()); setReachable(true)
    } catch (err) { setReachable(false); await fail(err) }
    finally { setBusy(false) }
  }

  async function login(username: string, password: string) {
    setBusy(true); setError('')
    try {
      const current = await api<User>('/auth/login', 'POST', { username, password })
      await writeSnapshot().catch(() => {})
      setIntents([]); setEvents([]); setUser(current); setReachable(true); setSavedAt(0)
      const [goals, log, remembered, chat] = await Promise.all([api<Intent[]>('/intents'), api<LogEvent[]>('/events'), api<MemoryData>('/memory'), api<AgentMessage[]>('/agent/messages')])
      setIntents(goals); setEvents(log); setMemory(remembered); setMessages(chat); setSavedAt(Date.now())
    } catch (err) { await fail(err) }
    finally { setBusy(false) }
  }

  async function logout() {
    setBusy(true); setError('')
    try {
      await disablePush()
      await api('/auth/logout', 'POST')
      let cleared = true
      await writeSnapshot().catch(() => { cleared = false })
      setUser(null); setIntents([]); setEvents([]); setMessages([]); setMemory(emptyMemory); setDraft(null); setSelected(null); setWish(''); setNotice(''); setTab('agent')
      if (!cleared) setError('Сессия завершена. Браузер не позволил удалить локальную копию: очистите данные этого сайта в настройках браузера.')
    } catch (err) { setError('Для полного выхода и завершения сессии нужен сервер. ' + errorMessage(err)) }
    finally { setBusy(false) }
  }

  async function interpret(event: FormEvent) {
    event.preventDefault()
    if (sendingMessage.current || !wish.trim()) return
    sendingMessage.current = true
    setAiBusy(true); setError(''); setNotice('')
    const prompt = wish.trim()
    const pendingId = crypto.randomUUID()
    try {
      if (/напом|календар|расписан|график|трениров|день рождения|мероприяти|\bтой\b/i.test(prompt)) {
        setPlannerRequest(prompt); setTab('calendar'); setWish(''); return
      }
      const rawText = [...messages.filter(item => item.role === 'user').map(item => item.text), prompt].join('\n')
      setMessages(previous => [...previous, { id: pendingId, role: 'user', text: prompt, createdAt: Date.now() / 1000 }])
      setWish('')
      const turn = await api<AgentTurn>('/agent/respond', 'POST', { text: prompt })
      setMessages(previous => [...previous.filter(item => ![pendingId, turn.userMessage.id, turn.assistantMessage.id].includes(item.id)), turn.userMessage, turn.assistantMessage])
      if (turn.response.mode === 'draft' && turn.response.title && turn.response.summary && turn.response.kind) {
        setDraft({ title: turn.response.title, summary: turn.response.summary, kind: turn.response.kind,
          steps: turn.response.steps, id: crypto.randomUUID(), rawText, source: 'ai' })
      }
    } catch (err) {
      setMessages(previous => previous.filter(item => item.id !== pendingId))
      setWish(prompt)
      await fail(err)
    }
    finally { sendingMessage.current = false; setAiBusy(false) }
  }

  async function clearConversation() {
    setBusy(true); setError('')
    try { await api('/agent/messages', 'DELETE'); setMessages([]); setWish(''); setNotice('Начат новый разговор с агентом.') }
    catch (err) { await fail(err) }
    finally { setBusy(false) }
  }

  async function saveMemory(value: MemoryData) {
    setBusy(true); setError('')
    try { const saved = await api<MemoryData>('/memory', 'PUT', value); setMemory(saved); setNotice('Память сохранена. Агент будет учитывать её в новых ответах.'); setEvents(await api<LogEvent[]>('/events').catch(() => events)) }
    catch (err) { await fail(err) }
    finally { setBusy(false) }
  }

  async function askCoach(goal: Intent) {
    setCoachBusy(true); setError(''); setCoach(null)
    try { setCoach(await api<CoachResponse>(`/intents/${goal.id}/coach`, 'POST', { note: '' })); setEvents(await api<LogEvent[]>('/events').catch(() => events)) }
    catch (err) { await fail(err) }
    finally { setCoachBusy(false) }
  }

  async function saveDraft(value: EditingDraft) {
    setBusy(true); setError('')
    try {
      const goal = await api<Intent>('/intents', 'POST', {
        id: value.id, title: value.title.trim(), summary: value.summary.trim(), rawText: value.rawText,
        kind: value.kind, status: 'active',
        steps: value.steps.map((title, index) => ({ id: stepId(value.id, index), title: title.trim(), isCompleted: false })),
      })
      setIntents(previous => [goal, ...previous.filter(item => item.id !== goal.id)])
      await api('/agent/messages', 'DELETE').catch(() => undefined)
      setMessages([]); setSavedAt(Date.now()); setDraft(null); setWish(''); setSelected(goal.id); setTab('goals'); setFilter('active')
      setNotice('Цель сохранена. Начните с небольшого шага.')
      setEvents(await api<LogEvent[]>('/events').catch(() => events))
    } catch (err) { await fail(err) }
    finally { setBusy(false) }
  }

  async function change(goal: Intent, update: Partial<Intent>) {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await api<Intent>(`/intents/${goal.id}`, 'PUT', { ...editable(goal), ...update, version: goal.version })
      setIntents(previous => previous.map(item => item.id === result.id ? result : item))
      setSavedAt(Date.now())
      setEvents(await api<LogEvent[]>('/events').catch(() => events))
    } catch (err) { await fail(err) }
    finally { setBusy(false) }
  }

  async function applyAppUpdate() {
    if (updatingApp) return
    setUpdatingApp(true); setError('')
    try {
      await updateServiceWorker(true)
      window.setTimeout(() => window.location.reload(), 750)
    } catch {
      setUpdatingApp(false)
      setError('Не удалось применить обновление. Перезагрузите страницу.')
    }
  }

  const locked = busy || aiBusy || coachBusy || plannerPending
  useEffect(() => {
    if (needRefresh && !locked && !draft && !wish.trim() && !updatingApp) void applyAppUpdate()
  }, [needRefresh, locked, draft, wish, updatingApp])
  const active = intents.filter(goal => goal.status === 'active')
  const completed = intents.filter(goal => goal.status === 'completed')
  const doneSteps = intents.reduce((total, goal) => total + goal.steps.filter(step => step.isCompleted).length, 0)
  const focused = intents.find(goal => goal.id === selected)

  if (loading) return <main className="loading-screen"><Brand /><LoaderCircle className="spin" /><p>Открываем ваше пространство…</p></main>
  if (!user) return <LoginScreen busy={busy} online={online} error={error} onLogin={login} />

  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <nav aria-label="Основная навигация">
        {([{ id: 'today', label: 'Сегодня', icon: Check }, { id: 'calendar', label: 'Календарь', icon: LayoutGrid }, { id: 'agent', label: 'Мой агент', icon: Sparkles }, { id: 'goals', label: 'Мои цели', icon: Flag }] as const).map(item =>
          <button key={item.id} disabled={plannerPending} className={`nav-item ${tab === item.id ? 'selected' : ''}`} onClick={() => { setTab(item.id); setSelected(null) }} aria-current={tab === item.id ? 'page' : undefined}>
            <item.icon size={20} /><span>{item.label}</span>{item.id === 'goals' && <span className="nav-count">{active.length}</span>}
          </button>)}
      </nav>
      <div className="sidebar-bottom">
        <button className="install-link" onClick={async () => {
          if (install) { await install.prompt(); await install.userChoice; setInstall(null) }
          else setNotice('На iPhone: Safari → «Поделиться» → «На экран Домой». На Android: меню браузера → «Установить приложение». Установка доступна по HTTPS или на localhost.')
        }}><ArrowDownToLine size={17} /> Установить приложение</button>
        <div className="account"><span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span><div><strong>{user.username}</strong><small>Личный аккаунт</small></div><button className="icon-button" aria-label="Выйти" title="Выйти" onClick={logout} disabled={locked || !online}><LogOut size={18} /></button></div>
      </div>
    </aside>

    <main className="main-content">
      <header className="topbar"><span><strong>{tab === 'agent' ? 'Мой агент' : tab === 'goals' ? 'Мои цели' : tab === 'memory' ? 'Память' : tab === 'today' ? 'Сегодня' : tab === 'calendar' ? 'Календарь' : 'Журнал'}</strong></span><div className={`connection ${readOnly ? 'offline' : ''}`}><i />{readOnly ? 'Офлайн-просмотр' : 'На связи'}</div><nav className="utility-nav" aria-label="Дополнительно"><button disabled={plannerPending} className={`text-button ${tab === 'memory' ? 'current' : ''}`} onClick={() => { setTab('memory'); setSelected(null) }} aria-current={tab === 'memory' ? 'page' : undefined}><Brain size={16} />Память</button><button disabled={plannerPending} className={`text-button ${tab === 'journal' ? 'current' : ''}`} onClick={() => { setTab('journal'); setSelected(null) }} aria-current={tab === 'journal' ? 'page' : undefined}><LayoutGrid size={16} />Журнал</button></nav><div className="mobile-account"><button className="icon-button" aria-label="Установить на телефон" onClick={async () => { if (install) { await install.prompt(); setInstall(null) } else setNotice('На iPhone: Safari → «Поделиться» → «На экран Домой». На Android: меню браузера → «Установить приложение».') }}><ArrowDownToLine size={17} /></button><button className="icon-button" aria-label="Выйти на телефоне" disabled={locked || !online} onClick={logout}><LogOut size={17} /></button></div></header>
      <div className="page-body">
        {readOnly && <div className="banner offline-banner"><WifiOff size={18} /><span>Доступна сохранённая копия{savedAt ? ` от ${new Date(savedAt).toLocaleString('ru-RU')}` : ''}. Для изменений и ИИ нужно подключение.</span><button onClick={refresh} disabled={locked || !online}>Подключиться</button></div>}
        {error && <div role="alert" className="banner error-banner"><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть сообщение об ошибке"><X size={18} /></button></div>}
        {notice && <div role="status" className="banner notice-banner"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Закрыть сообщение"><X size={18} /></button></div>}
        {needRefresh && <div className="banner notice-banner"><span>{draft || wish.trim() ? 'Доступна новая версия. Сохраните черновик перед обновлением.' : 'Применяем новую версию…'}</span><button onClick={() => void applyAppUpdate()} disabled={locked || !!draft || !!wish.trim() || updatingApp}>{updatingApp ? 'Обновляем…' : 'Обновить сейчас'}</button></div>}

        {(tab === 'today' || tab === 'calendar') && <Planner key={user.id} view={tab} readOnly={readOnly} onError={fail} onPending={setPlannerPending} initialRequest={plannerRequest} onInitialHandled={setPlannerRequest} />}
        {tab === 'agent' && <>
          <div className="page-heading"><div><h1>Что вы хотите сделать?</h1><p>Опишите задачу. Агент поможет выбрать первый шаг.</p></div></div>
          <button className="text-button" onClick={() => setTab('calendar')}>Событие, напоминание или программа по расписанию →</button>
          <div className="agent-grid">
            <section className="composer card">
              <div className="section-kicker"><span className="icon-tile"><Sparkles size={18} /></span><span>{messages.length ? 'Разговор с агентом' : 'Начните с мысли'}</span>{messages.length > 0 && <button className="text-button conversation-reset" onClick={() => void clearConversation()} disabled={locked || readOnly}>Новый разговор</button>}</div>
              {messages.length > 0 && <div className="conversation" aria-label="Разговор с персональным агентом">{messages.map(message => <div key={message.id} className={`message ${message.role}`}><span aria-hidden="true">{message.role === 'assistant' ? <Sparkles size={14} /> : user.username.slice(0, 1).toUpperCase()}</span><div className="message-content"><small className="message-author">{message.role === 'assistant' ? 'Агент' : 'Вы'}</small><p>{message.text}</p></div></div>)}</div>}
              <form onSubmit={interpret}>
                <label className="sr-only" htmlFor="wish">{messages.length ? 'Ответ агенту' : 'Ваше желание'}</label>
                <textarea id="wish" value={wish} onChange={event => setWish(event.target.value)} placeholder={messages.length ? 'Ответьте агенту или добавьте важную деталь…' : 'Например, хочу найти время для английского…'} minLength={1} maxLength={2000} disabled={readOnly || locked} required />
                <div className="composer-bottom"><span>{wish.length ? `${wish.length} / 2000` : 'Напишите своими словами'}</span><button className="primary-button" disabled={readOnly || locked || wish.trim().length < 1}>{aiBusy ? <><LoaderCircle className="spin" size={18} />Агент думает…</> : <>{messages.length ? 'Ответить агенту' : 'Обсудить с агентом'} <ArrowRight size={18} /></>}</button></div>
              </form>
              <button className="text-button manual-button" disabled={readOnly || locked} onClick={() => setDraft({ id: crypto.randomUUID(), title: wish.slice(0, 120), rawText: wish, summary: '', kind: 'general', steps: [''], source: 'manual' })}><Plus size={16} /> Создать цель самостоятельно</button>
              {aiBusy && <p className="ai-hint" role="status">ИИ работает на вашем сервере. Подготовка ответа может занять до двух минут.</p>}
            </section>
          </div>
          <div className="section-heading"><div><h2>Текущие цели</h2></div><button className="text-button" onClick={() => { setTab('goals'); setSelected(null) }}>Все цели <ArrowRight size={16} /></button></div>
          {active.length ? <div className="goal-grid">{active.slice(0, 4).map(goal => <GoalCard key={goal.id} goal={goal} onClick={() => { setSelected(goal.id); setTab('goals') }} />)}</div> : <Empty title="Здесь появится ваша первая цель" text="Расскажите о желании выше — вместе найдём, с чего начать." />}
        </>}

        {tab === 'goals' && <>
          <div className="page-heading"><div><h1>Мои цели</h1><p>Ваши планы и ближайшие шаги.</p></div><button className="primary-button" onClick={() => setTab('agent')}><Plus size={18} />Новая цель</button></div>
          <section className="stats" aria-label="Ваш прогресс"><Stat value={active.length} label="целей в процессе" icon={<Flag size={20} />} /><Stat value={doneSteps} label="шагов сделано" icon={<CheckCheck size={20} />} /><Stat value={completed.length} label="целей достигнуто" icon={<Compass size={20} />} /></section>
          <div className="goals-toolbar"><div className="filters" aria-label="Статус целей">{(Object.keys(statuses) as Status[]).map(status => <button key={status} className={filter === status ? 'active' : ''} onClick={() => { setFilter(status); setSelected(null) }}>{statuses[status]} <span>{intents.filter(goal => goal.status === status).length}</span></button>)}</div><button className="icon-button" aria-label="Обновить список" onClick={refresh} disabled={locked || !online}><RefreshCw size={18} className={busy ? 'spin' : ''} /></button></div>
          {focused ? <section className="card goal-detail"><button className="text-button" onClick={() => setSelected(null)}>← К списку целей</button><div className="detail-heading"><span className="category">{kinds[focused.kind]}</span><span className="status-label">{statuses[focused.status]}</span></div><h2>{focused.title}</h2><p className="detail-summary">{focused.summary || 'Ваш план. Выполняйте шаги в удобном темпе.'}</p><Progress goal={focused} />
            <div className="step-list">{focused.steps.map((step, index) => <label key={step.id} className={`step ${step.isCompleted ? 'done' : ''}`}><input type="checkbox" checked={step.isCompleted} disabled={readOnly || locked || focused.status !== 'active'} onChange={() => void change(focused, { steps: focused.steps.map(item => item.id === step.id ? { ...item, isCompleted: !item.isCompleted } : item) })} /><span className="step-box">{step.isCompleted ? <Check size={15} /> : index + 1}</span><span>{step.title}</span></label>)}</div>
            <section className="coach-box"><div><span className="icon-tile"><MessageCircle size={17} /></span><div><strong>Следующий шаг с агентом</strong><p>Агент учтёт прогресс и вашу сохранённую память.</p></div></div>{coach && <div className="coach-answer"><p>{coach.message}</p><strong>{coach.nextStep}</strong>{coach.encouragement && <small>{coach.encouragement}</small>}</div>}<button className="secondary-button" disabled={readOnly || locked} onClick={() => void askCoach(focused)}>{coachBusy ? <><LoaderCircle className="spin" size={17} />Думаю…</> : <><Sparkles size={17} />{coach ? 'Спросить ещё раз' : 'Спросить агента'}</>}</button></section>
            <div className="detail-actions">{focused.status !== 'completed' && focused.status !== 'cancelled' && <button className="primary-button" disabled={readOnly || locked} onClick={() => void change(focused, { status: 'completed', steps: focused.steps.map(step => ({ ...step, isCompleted: true })) })}><CheckCheck size={17} />Завершить цель</button>}{focused.status === 'active' ? <button className="secondary-button" disabled={readOnly || locked} onClick={() => void change(focused, { status: 'paused' })}>Отложить</button> : <button className="secondary-button" disabled={readOnly || locked} onClick={() => void change(focused, { status: 'active' })}>Возобновить</button>}{focused.status !== 'cancelled' && focused.status !== 'completed' && <button className="text-button" disabled={readOnly || locked} onClick={() => void change(focused, { status: 'cancelled' })}>Отменить цель</button>}</div>
            {focused.kind === 'reminder' && <p className="muted">Push-напоминания появятся на следующем этапе. Эта цель пока не отправляет уведомления.</p>}
          </section> : intents.some(goal => goal.status === filter) ? <div className="goal-grid">{intents.filter(goal => goal.status === filter).map(goal => <GoalCard key={goal.id} goal={goal} onClick={() => setSelected(goal.id)} />)}</div> : <Empty title="Пока нет целей в этом разделе" text="Начните с нового желания или выберите другой статус." />}
        </>}

        {tab === 'memory' && <MemoryPage memory={memory} busy={locked} readOnly={readOnly} onSave={saveMemory} />}

        {tab === 'journal' && <>
          <div className="page-heading"><div><h1>Журнал</h1><p>История целей и изменений.</p></div><button className="icon-button" aria-label="Обновить журнал" onClick={refresh} disabled={locked || !online}><RefreshCw size={19} /></button></div>
          {events.length ? <section className="card journal">{events.map(event => <div className="journal-row" key={event.id}><span className="journal-dot"><Check size={16} /></span><div><p>{event.message}</p><time dateTime={new Date(event.createdAt * 1000).toISOString()}>{date(event.createdAt)} · {new Date(event.createdAt * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time></div></div>)}</section> : <Empty title="Ваша история начинается здесь" text="Сохранённые цели и изменения шагов появятся в журнале." />}
        </>}
      </div>
    </main>
    {draft && <DraftDialog draft={draft} busy={busy} error={error} onClose={() => { setDraft(null); setError('') }} onSave={saveDraft} />}
  </div>
}

// Stable IDs preserve retry idempotency when a create response is lost.
function stepId(draftId: string, index: number) { return draftId.slice(0, -4) + index.toString(16).padStart(4, '0') }
function Brand() { return <div className="brand"><img src="/icon.svg" alt="" /><span>intent<span className="brand-period">.</span></span></div> }
function Stat({ value, label, icon }: { value: number; label: string; icon: React.ReactNode }) { return <div className="stat"><span className="stat-icon">{icon}</span><div><strong>{value}</strong><span>{label}</span></div></div> }
function Empty({ title, text }: { title: string; text: string }) { return <section className="empty-state"><span><Flag size={24} strokeWidth={1.5} /></span><h3>{title}</h3><p>{text}</p></section> }
function Progress({ goal }: { goal: Intent }) { return <div className="progress-block"><div><span>{goal.steps.filter(step => step.isCompleted).length} из {goal.steps.length} шагов</span><strong>{progress(goal)}%</strong></div><progress max="100" value={progress(goal)} aria-label={`Прогресс цели ${goal.title}`} /></div> }
function GoalCard({ goal, onClick }: { goal: Intent; onClick(): void }) {
  const done = goal.steps.filter(step => step.isCompleted).length
  return <button className="card goal-card" onClick={onClick}>
    <div className="goal-card-top"><h3>{goal.title}</h3><ChevronRight size={17} /></div>
    <div className="goal-next"><Circle size={13} /><span>{goal.status === 'completed' ? 'Цель достигнута' : goal.steps.find(step => !step.isCompleted)?.title || 'Все шаги выполнены — завершите цель'}</span></div>
    <div className="goal-meta"><span>{done} из {goal.steps.length} шагов</span><progress max={goal.steps.length} value={done} aria-label={`Прогресс цели ${goal.title}`} /></div>
  </button>
}

function MemoryPage({ memory, busy, readOnly, onSave }: { memory: MemoryData; busy: boolean; readOnly: boolean; onSave(value: MemoryData): Promise<void> }) {
  const [value, setValue] = useState(memory)
  useEffect(() => setValue(memory), [memory])
  return <>
    <div className="page-heading"><div><h1>Память агента</h1><p>Расскажите то, что агенту полезно учитывать в планах и следующих шагах.</p></div></div>
    <form className="card memory-form" onSubmit={event => { event.preventDefault(); void onSave(value) }}>
      <div className="memory-intro"><span className="icon-tile"><Brain size={18} /></span><div><strong>Вы управляете памятью</strong><p>ИИ не добавляет сюда сведения сам. Можно изменить или удалить любой текст.</p></div></div>
      <fieldset disabled={busy || readOnly}>
        <label htmlFor="memory-name">Как к вам обращаться</label>
        <input id="memory-name" value={value.displayName} onChange={event => setValue({ ...value, displayName: event.target.value })} maxLength={80} placeholder="Например: Алексей" />
        <label htmlFor="memory-about">О вас и текущих приоритетах</label>
        <textarea id="memory-about" value={value.about} onChange={event => setValue({ ...value, about: event.target.value })} maxLength={1000} rows={4} placeholder="Чем вы занимаетесь, чему сейчас хотите уделять больше внимания…" />
        <label htmlFor="memory-preferences">Как вам удобнее двигаться к целям</label>
        <textarea id="memory-preferences" value={value.preferences} onChange={event => setValue({ ...value, preferences: event.target.value })} maxLength={1500} rows={4} placeholder="Короткие шаги, спокойный темп, напоминать заранее…" />
        <label htmlFor="memory-availability">Обычное свободное время</label>
        <textarea id="memory-availability" value={value.availability} onChange={event => setValue({ ...value, availability: event.target.value })} maxLength={1000} rows={3} placeholder="Например: будни после 19:00, суббота утром" />
      </fieldset>
      <div className="memory-actions"><span>Эти сведения передаются только модели на вашем сервере.</span><button className="primary-button" disabled={busy || readOnly}><Save size={17} />Сохранить память</button></div>
    </form>
  </>
}

function LoginScreen({ busy, online, error, onLogin }: { busy: boolean; online: boolean; error: string; onLogin(username: string, password: string): Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  return <main className="login-page"><section className="login-form-area"><div className="login-form-wrap"><div className="mobile-brand"><Brand /></div><h2>Ваше пространство</h2><p>Войдите, чтобы продолжить работу с целями.</p><form onSubmit={event => { event.preventDefault(); void onLogin(username, password).finally(() => setPassword('')) }}><label htmlFor="username">Логин</label><input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={event => setUsername(event.target.value)} placeholder="Ваш логин" maxLength={80} required disabled={busy} /><label htmlFor="password">Пароль</label><input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Ваш пароль" maxLength={256} required disabled={busy} />{error && <p role="alert" className="login-error">{error}</p>}{!online && <p className="login-error">Для первого входа нужно подключение к интернету.</p>}<button className="primary-button" disabled={busy || !online}>{busy ? <LoaderCircle size={18} className="spin" /> : <>Войти <ArrowRight size={18} /></>}</button></form><p className="login-help">Закрытая тестовая версия.<br />Логин и пароль выдаёт владелец приложения.</p><p className="device-note">После входа цели сохраняются на этом устройстве для офлайн-просмотра. На общем устройстве выходите из аккаунта.</p></div></section></main>
}

function DraftDialog({ draft, busy, error, onClose, onSave }: { draft: EditingDraft; busy: boolean; error: string; onClose(): void; onSave(value: EditingDraft): Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState(draft)
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog ref={ref} className="draft-dialog" aria-labelledby="draft-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}><form onSubmit={event => { event.preventDefault(); void onSave(value) }}><div className="dialog-header"><div><span className="eyebrow">{draft.source === 'ai' ? 'ПРЕДЛОЖЕНИЕ ВАШЕГО АГЕНТА' : 'НОВОЕ НАМЕРЕНИЕ'}</span><h2 id="draft-title">Давайте уточним цель</h2></div><button type="button" className="icon-button" aria-label="Закрыть черновик" disabled={busy} onClick={onClose}><X size={20} /></button></div><p className="muted">Измените формулировки и шаги так, как подходит вам. Пока ничего не сохранено.</p><fieldset disabled={busy}><label htmlFor="draft-name">Название</label><input id="draft-name" autoFocus value={value.title} onChange={event => setValue({ ...value, title: event.target.value })} required maxLength={120} /><label htmlFor="draft-kind">Тип цели</label><select id="draft-kind" value={value.kind} onChange={event => setValue({ ...value, kind: event.target.value as Draft['kind'] })}>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><label htmlFor="draft-summary">Описание</label><textarea id="draft-summary" value={value.summary} onChange={event => setValue({ ...value, summary: event.target.value })} maxLength={1000} rows={3} /><label>Небольшие шаги</label><div className="draft-steps">{value.steps.map((step, index) => <div key={index}><span>{index + 1}</span><input aria-label={`Шаг ${index + 1}`} value={step} required maxLength={200} onChange={event => setValue({ ...value, steps: value.steps.map((item, i) => i === index ? event.target.value : item) })} /><button className="icon-button" type="button" aria-label={`Удалить шаг ${index + 1}`} disabled={value.steps.length === 1} onClick={() => setValue({ ...value, steps: value.steps.filter((_, i) => i !== index) })}><X size={16} /></button></div>)}</div><button type="button" className="text-button" disabled={value.steps.length >= 6} onClick={() => setValue({ ...value, steps: [...value.steps, ''] })}><Plus size={16} />Добавить шаг</button>{value.kind === 'reminder' && <p className="muted">В этой версии напоминание сохраняется как цель без push-уведомления.</p>}</fieldset>{error && <p role="alert" className="login-error">{error}</p>}<div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Вернуться</button><button className="primary-button" disabled={busy || !value.title.trim() || value.steps.some(step => !step.trim())}>{busy ? <LoaderCircle size={18} className="spin" /> : <Check size={18} />}Сохранить цель</button></div></form></dialog>
}
