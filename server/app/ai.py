import asyncio
import json

import httpx
from fastapi import HTTPException
from pydantic import ValidationError

from .config import Settings


class Interpreter:
    """Bounded queue to the assistant model with JSON-schema constrained output.

    Uses an OpenAI-compatible cloud API (Groq) when a key is configured, otherwise local Ollama.
    """

    def __init__(self, config: Settings):
        self.config = config
        self.cloud = bool(config.ai_api_key)
        # A local model serves one request at a time; the cloud API handles a few in parallel.
        self.gate = asyncio.Semaphore(4 if self.cloud else 1)
        self.waiting = 0

    async def _generate(self, schema_type, instruction: str, messages: list[dict[str, str]], predict: int):
        if self.waiting >= self.config.ai_queue_size:
            raise HTTPException(429, "ИИ занят. Попробуйте немного позже или создайте запись вручную.")
        self.waiting += 1
        acquired = False
        try:
            try:
                await asyncio.wait_for(self.gate.acquire(), timeout=self.config.ai_queue_timeout)
                acquired = True
            except TimeoutError:
                raise HTTPException(503, "Очередь ИИ занята. Попробуйте ещё раз через минуту.")
            schema = schema_type.model_json_schema()
            # The cloud API receives the schema in response_format; repeating it would only spend the token budget.
            system = {"role": "system", "content": instruction if self.cloud else instruction + " Ответ строго по JSON-схеме: " + json.dumps(schema, ensure_ascii=False)}
            async with httpx.AsyncClient(timeout=self.config.ai_timeout) as client:
                content = await (self._cloud(client, schema_type, schema, [system, *messages], predict) if self.cloud
                                 else self._ollama(client, schema_type, schema, [system, *messages], predict))
            return schema_type.model_validate_json(content)
        except (httpx.HTTPError, ValidationError, ValueError, KeyError, TypeError, IndexError):
            raise HTTPException(503, "ИИ сейчас недоступен. Повторите позже или создайте запись вручную.")
        finally:
            if acquired:
                self.gate.release()
            self.waiting -= 1

    async def _ollama(self, client, schema_type, schema, messages, predict) -> str:
        response = await client.post(
            f"{self.config.ollama_url.rstrip('/')}/api/chat",
            json={
                "model": self.config.ollama_model,
                "stream": False,
                "format": schema,
                "keep_alive": "15m",
                "options": {"temperature": 0.2, "num_ctx": 8192 if schema_type.__name__.endswith('Generation') else 4096, "num_predict": predict},
                "messages": messages,
            },
        )
        response.raise_for_status()
        return response.json()["message"]["content"]

    async def _cloud(self, client, schema_type, schema, messages, predict) -> str:
        response = await client.post(
            f"{self.config.ai_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {self.config.ai_api_key}"},
            json={
                "model": self.config.ai_model,
                "messages": messages,
                "temperature": 0.2,
                # The free tier reserves this budget against tokens-per-minute, so keep it near the real answer size;
                # only training programs with exercise details need long answers.
                "max_completion_tokens": min(predict, 2500 if schema_type.__name__.startswith("Training") else 1000),
                **({"reasoning_effort": "low"} if "gpt-oss" in self.config.ai_model else {}),
                # Best-effort mode: our schemas have optional fields; Pydantic validates the result.
                "response_format": {"type": "json_schema", "json_schema": {"name": schema_type.__name__, "schema": schema, "strict": False}},
            },
        )
        if response.status_code == 429:
            if response.headers.get("x-ratelimit-remaining-requests") == "0":
                raise HTTPException(429, "Дневной лимит ИИ исчерпан. Простые фразы и ручной ввод работают; попробуйте позже.")
            raise HTTPException(429, "ИИ сейчас перегружен. Повторите через минуту; ручной ввод работает.")
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]
