# Intent — ежедневник

Intent начинается с намерения человека и помогает его реализовать. ИИ-ассистент превращает сказанное в задачи и напоминания, запросы знакомым идут с подтверждением, а в будущем открытая сеть будет соединять встречные намерения («куплю ↔ продам»). Идея и план — в [docs/VISION.md](docs/VISION.md).

Сейчас это бета для 100 пользователей: сайт и PWA. Что уже есть:

- Таблица месяца по направлениям с автоматическими и ручными отметками.
- Настраиваемые группы и порядок направлений.
- «Мой день», календарь, карточки задач с комментариями и историей.
- Повторяющиеся события и push-напоминания.
- Помощник: фраза → черновик → подтверждение (Ollama / Qwen3).
- Приглашения на события между аккаунтами по номеру телефона.
- Регистрация по телефону или почте, админка со статистикой.
- Офлайн-работа и синхронизация при подключении.

Стек: React, TypeScript, Vite, FastAPI, SQLAlchemy, PostgreSQL, Caddy.

## Документация

| Документ | О чём |
| --- | --- |
| [docs/STATUS.md](docs/STATUS.md) | текущее состояние и что делать дальше |
| [docs/VISION.md](docs/VISION.md) | идея, принципы, что не делаем |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | устройство кода, данные, API |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | локальный запуск, проверки, публикация |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | журнал изменений и проверок |
| [docs/RENDER.md](docs/RENDER.md), [docs/HOSTING.md](docs/HOSTING.md) | развёртывание |
| [docs/MARKET_AND_BETA.md](docs/MARKET_AND_BETA.md) | рынок и план проверки беты |

## Быстрый старт

```powershell
python -m venv .venv; .venv/Scripts/python.exe -m pip install -r server/requirements-dev.txt
cd server; $env:COOKIE_SECURE = "false"; ../.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 18080
# в другом терминале
cd web; npm ci; npm run dev   # http://127.0.0.1:15174
```

Проверки: `pytest` в `server`, `npm test` и `npm run build` в `web`.

## Личные данные

В репозитории нет паролей, VAPID-ключей, личной базы и резервных копий. Настройки создаются на сервере в `.env`. Новое размещение начинает работу с пустой базой; перенос существующих данных выполняется отдельно.
