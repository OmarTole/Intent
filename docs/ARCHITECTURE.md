# Как устроен Intent

Обновлено 20 октября 2026 года. Здесь описано, где что лежит и как работает код. Если изменение затрагивает описанное ниже, обновите этот файл.

## Структура репозитория

```
web/              PWA: React 19 + TypeScript + Vite, тесты Vitest
  src/main.tsx      точка входа → DiaryApp
  src/DiaryApp.tsx  оболочка: вход, навигация, синхронизация, push, админка
                    разделы (View): chat (главный) · day «Сегодня» · calendar · people
                    · progress · settings · admin · more («Ещё», только на телефоне)
  src/shell.css     раскладка и цветовые токены светлой и тёмной темы, подключается последним
  src/DiaryAssistant.tsx + assistant.css  главный экран — чат; всегда смонтирован,
                    чтобы переписка не терялась при переходе между разделами
  src/ProgressTable.tsx  месячная таблица прогресса (раздел «Прогресс»)
  src/DayAgenda.tsx, TaskForm.tsx  «Сегодня» и карточка задачи
  src/People.tsx          вкладка «Люди» (приглашения)
  src/DirectionSettings.tsx, PhoneSettings.tsx, PushTest.tsx, QuickGuide.tsx, ThemeToggle.tsx
  src/diary-model.ts   типы ежедневника, статусы ячеек, трёхстороннее слияние
  src/planner-model.ts типы задач, даты, повторения
  src/diary-store.ts   IndexedDB: локальная копия и флаг «есть несинхронизированное»
  src/api.ts, push.ts  запросы к API, подписка на push
  public/push-handler.js  обработчик push в service worker
server/           API: FastAPI + SQLAlchemy, тесты pytest
  app/main.py        приложение, middleware защиты, вход/выход, подключение модулей
  app/accounts.py    регистрация (телефон/почта), привязка телефона, админка
  app/planner.py     схема ежедневника (Pydantic), повторения, расчёт напоминаний
  app/planner_api.py GET/PUT ежедневника, POST /planner/propose (помощник)
  app/commands.py    бесплатный разбор простых фраз и сверка ответа модели с текстом
  app/ai.py          очередь к Ollama со структурированным JSON-ответом
  app/invitations.py приглашения и поиск по номерам
  app/push.py        Web Push: подписки, фоновый цикл раз в 30 с
  app/cloud.py       вариант для Render: API + собранная PWA в одном процессе
  app/manage.py      CLI: create-user, make-admin
  app/db.py, security.py, schemas.py, config.py
scripts/          запуск, проверки, импорт, бэкап (см. DEVELOPMENT.md)
docs/             документация
compose.yaml      Caddy + API + PostgreSQL (+ Ollama в профиле ai)
render.yaml       Render Free (засыпает); render.beta.yaml — платный starter
Dockerfile.render образ для Render: сборка web + сервер (cloud.py)
```

## Модель данных

Весь ежедневник пользователя хранится **одним JSON-документом** в таблице `planner_states` (`user_id`, `version`, `data`). Схема документа — `PlannerData` в [planner.py](../server/app/planner.py):

- `activities` — задачи, привычки и события. Поля: `kind`, `start`, `end`, `time`, `duration`, `recurrence` (once/daily/weekly/monthly/yearly), `weekdays` (0 = Пн), `reminder` и `reminderOffsets` в минутах до начала, `sectionId`, `parentEventId`, `comments`, `history`, `archived`;
- `marks` — отметки выполнения конкретного дня (`done`/`partial`/`missed`/`rest`), `focus` и перенос времени одного повторения;
- `sections` и `groups` — направления таблицы прогресса и их группы с порядком;
- `sectionMarks` — ручные оценки ячейки таблицы, имеют приоритет над автоматическим статусом;
- `timezone` — часовой пояс ежедневника, по умолчанию `Asia/Qyzylorda`.

Лимиты: до 2000 activities и 20 000 marks; размер тела PUT `/api/planner` — до 4 МБ, остальных запросов — до 32 КБ.

Другие таблицы:

- `users`, `sessions` — вход; хранится хеш токена;
- `account_profiles` — admin, blocked, last_seen;
- `phone_identities` — связь телефона с аккаунтом;
- `invitations`;
- `push_subscriptions`, `push_deliveries`;
- `events` — журнал изменений: пишется, но через API не читается;
- `user_memories` — «память» из старого интерфейса агента. Редактора нет, но если запись есть, она подставляется в запрос к модели.

Таблицы создаются `Base.metadata.create_all` при старте. **Миграций нет**: новые колонки в существующих таблицах не появятся сами. В старых базах могут остаться неиспользуемые таблицы `intents` и `agent_messages`.

## Синхронизация

1. Клиент держит в IndexedDB `{account, base, data, dirty}`. При открытии сначала показывается локальная копия, затем идёт запрос к серверу.
2. Запись — `PUT /api/planner` с `version`. Если версия устарела, сервер отвечает 409.
3. Тогда клиент делает трёхстороннее слияние `mergeDiary(base, local, remote)` по id записей. Если одну запись изменили на двух устройствах, пользователь выбирает «моё» или «с сервера».
4. Повторная отправка срабатывает при возвращении сети или приложения и по интервалу. Внутри `api()` автоматических повторов нет.

## API

| Метод и путь | Назначение |
| --- | --- |
| `GET /api/health` | проверка живости и БД |
| `POST /api/auth/register`, `/login`, `/logout`; `GET /api/auth/me`; `PUT /api/auth/phone` | аккаунт |
| `GET/PUT /api/planner` | ежедневник целиком, с версией |
| `POST /api/planner/propose` | черновик от помощника; ничего не сохраняет |
| `GET/POST /api/invitations`, `POST /api/invitations/{id}/respond`, `POST /api/contacts/lookup` | люди и приглашения |
| `GET /api/push/config`, `POST /api/push/subscribe`, `/unsubscribe`, `/test` | push |
| `GET /api/admin/users`, `POST /api/admin/users/{id}/block`, `/reset-password` | админка |

## Безопасность

- Сессия хранится в HttpOnly-cookie `intent_session` (SameSite=strict, path `/api`). Срок — 10 лет, продлевается при использовании.
- Пароли хешируются через scrypt.
- Каждая запись должна нести заголовок `X-Intent-Request: 1`, cross-site запросы отклоняются. CORS не включён.
- `X-Intent-User` защищает от записи из вкладки, где уже вошёл другой аккаунт.
- Rate limit работает в памяти процесса. Поэтому, как и фоновый push-цикл и очередь ИИ, он требует **ровно одного процесса API**.
- Push принимает endpoint только известных push-сервисов (Google, Mozilla, Apple, Microsoft).
- Телефон при регистрации **не подтверждается по SMS**.

## Помощник (ИИ)

`POST /api/planner/propose` работает в таком порядке:

1. `simple_proposal` из [commands.py](../server/app/commands.py) пытается разобрать фразу правилами, без модели.
2. Если не получилось, `Interpreter._generate` из [ai.py](../server/app/ai.py) запрашивает модель с JSON-схемой ответа. Провайдер выбирается настройками в [config.py](../server/app/config.py):
   - **Облако** — если задан `GROQ_API_KEY` (или `AI_API_KEY`). Используется OpenAI-совместимый `POST {AI_BASE_URL}/chat/completions`, по умолчанию `https://api.groq.com/openai/v1` и модель `openai/gpt-oss-120b`. Схема передаётся в `response_format` в нестрогом режиме (`strict: false`), результат проверяет Pydantic. Одновременно — до 4 запросов.
   - **Локально** — если ключа нет: Ollama (`OLLAMA_URL`, модель `qwen3:4b-instruct-2507-q4_K_M`). Одновременно — 1 запрос.

   В обоих режимах ожидать в очереди могут не больше 4 запросов.
3. Ответ модели проверяется: `enforce_explicit_details` сверяет дату, день недели и длительность с текстом пользователя, `enforce_reminder_request` — срок напоминания.
4. Клиент показывает черновик. Сохранение — отдельный обычный `PUT /api/planner` после нажатия «Подтвердить».

Инструкция модели (в [planner_api.py](../server/app/planner_api.py)) требует заполнять второстепенные детали по умолчанию, а не переспрашивать:
- нет даты начала у повторения — сегодня;
- нет длительности — 60 минут для встреч и событий, 30 для остального;
- нет времени — дело на весь день.

Уточнение модель задаёт, только если непонятно, что или когда записать, или если просят напомнить, но не указано время.

**Бесплатный Groq** даёт ~8000 токенов в минуту и ~1000 запросов в день. Запрос стоит ~1–2 тыс. токенов, причём заранее резервируется `max_completion_tokens`, поэтому он ограничен: 1000 токенов, 2500 для программ тренировок. На практике это ~4 запроса в минуту на всё приложение. При 429 пользователь видит сообщение «перегружен, повторите через минуту» или «дневной лимит исчерпан». Если модель недоступна, сервер отвечает 503. Ручной ввод работает всегда.

Точность проверяется скриптом `scripts/check_assistant.py` на 15 типовых фразах. Ваши данные он не трогает.

## Напоминания

`reminder_loop` в [push.py](../server/app/push.py) раз в 30 секунд проходит по всем подпискам и считает `due_reminders` за последние 24 часа с учётом часового пояса, переносов и отметок `done`/`rest`. Доставленное фиксируется в `push_deliveries`, поэтому повторов нет. Пока сервер спит (Render Free), напоминания не уходят.
