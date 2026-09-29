import asyncio
import json
from dataclasses import replace
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException

from app.ai import Interpreter
from app.config import Settings
from app.schemas import MemoryData

VALID = {"title": "Начать бегать", "summary": "Начните с короткой прогулки", "kind": "activity", "steps": ["Выберите маршрут"]}
VALID_AGENT = {"mode": "clarification", "message": "Сколько времени есть?", "title": None, "summary": None, "kind": None, "steps": []}
VALID_AGENT_DRAFT = {"mode": "draft", "message": "План готов.", **VALID}
VALID_COACH = {"message": "Начните с малого.", "nextStep": "Пройти 10 минут", "encouragement": "Этого достаточно."}


def client_for(payload):
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.post.return_value = httpx.Response(200, json=payload, request=httpx.Request("POST", "http://ollama/api/chat"))
    return client


def test_structured_response_and_private_ollama_request():
    client = client_for({"message": {"content": json.dumps(VALID)}})
    with patch("app.ai.httpx.AsyncClient", return_value=client):
        result = asyncio.run(Interpreter(Settings()).interpret("Хочу бегать"))
    assert result.title == VALID["title"]
    body = client.post.call_args.kwargs["json"]
    assert body["stream"] is False
    assert body["format"]["type"] == "object"
    assert body["options"]["num_ctx"] == 4096


def test_conversation_passes_confirmed_memory_and_history():
    client = client_for({"message": {"content": json.dumps(VALID_AGENT)}})
    memory = MemoryData(displayName="Алексей", preferences="Короткие шаги")
    history = [{"role": "user", "content": "Хочу бегать"}]
    with patch("app.ai.httpx.AsyncClient", return_value=client):
        result = asyncio.run(Interpreter(Settings()).converse(history, memory))
    assert result.mode == "clarification"
    body = client.post.call_args.kwargs["json"]
    assert body["messages"][-1] == history[0]
    assert "Алексей" in body["messages"][0]["content"]
    assert body["format"]["properties"]["mode"]


def test_coach_uses_structured_output():
    client = client_for({"message": {"content": json.dumps(VALID_COACH)}})
    with patch("app.ai.httpx.AsyncClient", return_value=client):
        result = asyncio.run(Interpreter(Settings()).coach({"title": "Бег"}, MemoryData(), ""))
    assert result.nextStep == VALID_COACH["nextStep"]
    assert client.post.call_args.kwargs["json"]["options"]["num_predict"] == 500


def test_third_agent_turn_schema_requires_a_draft():
    client = client_for({"message": {"content": json.dumps(VALID_AGENT_DRAFT)}})
    history = [
        {"role": "user", "content": "Хочу бегать"},
        {"role": "assistant", "content": "Когда?"},
        {"role": "user", "content": "Вечером"},
        {"role": "assistant", "content": "Сколько времени?"},
        {"role": "user", "content": "20 минут"},
    ]
    with patch("app.ai.httpx.AsyncClient", return_value=client):
        result = asyncio.run(Interpreter(Settings()).converse(history, MemoryData()))
    assert result.mode == "draft"
    schema = client.post.call_args.kwargs["json"]["format"]
    assert schema["properties"]["mode"]["const"] == "draft"
    assert "title" in schema["required"]


@pytest.mark.parametrize("payload", [{}, {"message": {"content": "not JSON"}}, {"message": {"content": '{"title":"x"}'}}])
def test_invalid_model_output_is_recoverable(payload):
    interpreter = Interpreter(Settings())
    with patch("app.ai.httpx.AsyncClient", return_value=client_for(payload)):
        with pytest.raises(HTTPException) as error:
            asyncio.run(interpreter.interpret("Хочу бегать"))
    assert error.value.status_code == 503
    assert interpreter.waiting == 0
    assert not interpreter.gate.locked()


def test_model_timeout_releases_queue():
    client = client_for({})
    client.post.side_effect = httpx.ReadTimeout("slow")
    interpreter = Interpreter(Settings())
    with patch("app.ai.httpx.AsyncClient", return_value=client):
        with pytest.raises(HTTPException) as error:
            asyncio.run(interpreter.interpret("Хочу бегать"))
    assert error.value.status_code == 503
    assert interpreter.waiting == 0


def test_queue_has_a_bound_and_wait_timeout():
    async def run():
        interpreter = Interpreter(replace(Settings(), ai_queue_timeout=0.01))
        interpreter.waiting = 4
        with pytest.raises(HTTPException) as error:
            await interpreter.interpret("Хочу бегать")
        assert error.value.status_code == 429
        interpreter.waiting = 0
        await interpreter.gate.acquire()
        with pytest.raises(HTTPException) as error:
            await interpreter.interpret("Хочу бегать")
        assert error.value.status_code == 503
        assert interpreter.waiting == 0
        interpreter.gate.release()
    asyncio.run(run())
