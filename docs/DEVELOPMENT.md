# Разработка, проверки и публикация

Обновлено 20 октября 2026 года.

## Требования

- Python 3.12+ и виртуальное окружение `.venv` в корне проекта.
- Node.js 22.12+.
- Ollama и модель `qwen3:4b-instruct-2507-q4_K_M` — по желанию, только для сложных запросов помощника.

Установка с нуля:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r server/requirements-dev.txt
cd web; npm ci
```

`npm ci` удаляет `node_modules` целиком. Если запущен `vite preview` или dev-сервер, файл `esbuild.exe` заблокирован и установка падает посередине. Сначала остановите сервер или используйте `npm install`.

## Локальный запуск (Windows)

**Вариант 1. Собранная PWA, как в продакшене.** Порты: веб 15173, API 18080.

```powershell
cd web; npm run build; cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1
```

- Скрипт создаёт локальный аккаунт `owner`, если его нет. Пароль лежит в `.local/local-login.json`.
- API и `vite preview` запускаются скрытыми процессами, логи пишутся в `.local/*.log`.
- База — `server/intent.db` (SQLite).
- Если есть `.local/push-config.json`, подхватываются VAPID-ключи. Создать их можно скриптом `scripts/setup_push.py`.
- Если есть `.local/groq.env` (одна строка `GROQ_API_KEY=gsk_...`), помощник работает через Groq. Без этого файла — через локальную Ollama. Ключ создаётся на console.groq.com → API Keys. Не публиковать, не присылать в чат.
- После правок Python: `scripts/restart-local-api.ps1`. После правок веба: снова `npm run build`.

**Вариант 2. Dev-сервер с горячей перезагрузкой.** Порт 15174.

```powershell
cd server; $env:COOKIE_SECURE = "false"
../.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 18080
# в другом терминале
cd web; npm run dev
```

`COOKIE_SECURE=false` — только для локального HTTP, в облако эту настройку не переносить.

Сделать пользователя админом (из `server/`): `../.venv/Scripts/python.exe -m app.manage make-admin owner`.

## Проверки перед каждой сдачей работы

```powershell
cd server; ../.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider
cd web; npm test; npm run build
```

На 20.10.2026 проходят 44 серверных теста, 25 веб-тестов и сборка. Ключ `-p no:cacheprovider` нужен потому, что папка `server/.pytest_cache` недоступна для записи.

Дополнительные скрипты:

| Скрипт | Что делает |
| --- | --- |
| `scripts/check_diary_http.py` | smoke-проверка запущенного приложения под локальным аккаунтом, только чтение |
| `scripts/check_assistant.py` | точность и скорость помощника на 15 типовых фразах, изолированная БД. По умолчанию Groq из `.local/groq.env`, с ключом `--local` — Ollama. Отчёт пишется в `.local/assistant-check-*.json` |
| `scripts/check_planner_route.py` | настоящий маршрут помощника на изолированной пустой БД: событие и программа тренировок |
| `scripts/import_diary.py` | разовый импорт таблицы Google из `.local/sheet-*.json` в аккаунт; без `--apply` только формирует отчёт |
| `scripts/local_account.py` | создаёт локальный аккаунт `owner`, вызывается из `start-local.ps1` |
| `scripts/setup_push.py` | создаёт локальные VAPID-ключи |
| `scripts/setup_production.py` | создаёт `.env` на сервере: пароль БД и VAPID |
| `scripts/backup.sh` | дамп PostgreSQL на сервере |
| `scripts/generate_icons.py` | PNG-иконки PWA |

## Где лежит git и как публиковать

**Важно:** корень проекта `C:\Users\Admin\Desktop\Intent` — **не** git-репозиторий. Git-клон GitHub-репозитория `OmarTole/Intent` (ветка `main`) лежит в `.local/deploy-repo`.

Публикация:

1. `.venv/Scripts/python.exe scripts/publish.py` синхронизирует публикуемые файлы в `.local/deploy-repo`:
   - копирует их с окончаниями строк LF;
   - удаляет там файлы, которых больше нет в рабочей папке;
   - печатает список удалённого и добавленного.

   Список публикуемых файлов задан в самом скрипте.
2. В `.local/deploy-repo`:
   - `git add -A` и `git status`;
   - проверка на секреты: ключ Groq, пароль из `.local/local-login.json`, приватный VAPID-ключ;
   - серверные тесты;
   - `git commit`;
   - `git push origin main`. Вход в GitHub хранит Git Credential Manager. Если вход не сохранён, перед push снимите `GIT_TERMINAL_PROMPT`, тогда появится окно входа GitHub.
3. Render: **Auto-Deploy, похоже, выключен** — после push нажать Render → сервис → Manual Deploy → Deploy latest commit.

В GitHub попадают только:

- `web/src`, `web/public`, конфиги `web`;
- `server/app`, `server/tests`, конфиги `server`;
- `compose.yaml`, Dockerfile-ы, `render*.yaml`;
- `scripts/backup.sh`, `setup_production.py`, `generate_icons.py`;
- `docs/`, `README.md`, `CLAUDE.md`.

В GitHub никогда не попадают: `.local/` (личные данные, пароли, снимки таблиц, бэкапы), `server/intent.db`, `.env`, `.venv`, кеши. Старый вспомогательный скрипт `.local/prepare_publication.py` проверяет файлы на утечку паролей. Перед публикацией сравните папки, игнорируя окончания строк:

```powershell
git diff --no-index --ignore-cr-at-eol --stat .local/deploy-repo/server server
```

Окончания строк в двух копиях различаются (CRLF/LF). Поэтому без `--ignore-cr-at-eol` diff показывает изменённым каждый файл.

Коммит и push делаются только по явной просьбе владельца.

## Развёртывание

Для ИИ в облаке задайте секретную переменную `GROQ_API_KEY`:
- на Render — Environment;
- на своей VM — `.env`.

Код без неё тоже работает: тогда сложные фразы идут в Ollama, а если и её нет — работают только простые фразы.

- [RENDER.md](RENDER.md) — Render + Neon (текущий вариант; Free засыпает).
- [HOSTING.md](HOSTING.md) — своя VM с Docker Compose: Caddy, HTTPS, PostgreSQL, бэкапы.

После развёртывания проверьте:

- `/api/health`;
- регистрацию двух аккаунтов и приглашение между ними;
- установку PWA на iPhone и Android;
- push при закрытом приложении;
- восстановление бэкапа на отдельной БД.
