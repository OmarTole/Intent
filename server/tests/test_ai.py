import asyncio
import json
from dataclasses import replace
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException

from app.ai import Interpreter
from app.config import Settings
from app.planner import ScheduleGeneration, ScheduleProposal

VALID = {"message": "Уточните время.", "clarification": True, "activities": []}
LOCAL = Settings(ai_api_key="")
CLOUD = Settings(ai_api_key="gsk_test", ai_base_url="https://api.groq.com/openai/v1", ai_model="openai/gpt-oss-120b")


def client_for(payload, status=200):
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.post.return_value = httpx.Response(status, json=payload, request=httpx.Request("POST", "http://model/api"))
    return client


def generate(interpreter, schema=ScheduleProposal):
    return interpreter._generate(schema, "Планировщик.", [{"role": "user", "content": "Встреча"}], 700)


def test_cloud_api_uses_openai_compatible_request_with_schema():
    client = client_for({"choices": [{"message": {"content": json.dumps(VALID)}}]})
    with patch("app.ai.httpx.AsyncClient", return_value=client):
        result = asyncio.run(generate(Interpreter(CLOUD)))
    assert result.clarification is True
    assert client.post.call_args.args[0] == "https://api.groq.com/openai/v1/chat/completions"
    assert client.post.call_args.kwargs["headers"] == {"Authorization": "Bearer gsk_test"}
    body = client.post.call_args.kwargs["json"]
    assert body["model"] == "openai/gpt-oss-120b"
    assert body["response_format"]["json_schema"]["name"] == "ScheduleProposal"
    assert body["response_format"]["json_schema"]["schema"]["type"] == "object"
    assert body["messages"][0]["role"] == "system"
    assert body["messages"][-1] == {"role": "user", "content": "Встреча"}


@pytest.mark.parametrize("remaining, message", [("5", "перегружен"), ("0", "Дневной лимит")])
def test_cloud_rate_limits_are_reported_and_release_queue(remaining, message):
    interpreter = Interpreter(CLOUD)
    client = client_for({"error": {}}, status=429)
    client.post.return_value.headers["x-ratelimit-remaining-requests"] = remaining
    with patch("app.ai.httpx.AsyncClient", return_value=client):
        with pytest.raises(HTTPException) as error:
            asyncio.run(generate(interpreter))
    assert error.value.status_code == 429
    assert message in error.value.detail
    assert interpreter.waiting == 0


def test_cloud_request_keeps_token_budget_small():
    client = client_for({"choices": [{"message": {"content": json.dumps(VALID)}}]})
    with patch("app.ai.httpx.AsyncClient", return_value=client):
        asyncio.run(Interpreter(CLOUD)._generate(ScheduleGeneration, "Планировщик.", [{"role": "user", "content": "x"}], 3000))
    body = client.post.call_args.kwargs["json"]
    assert body["max_completion_tokens"] == 1000
    assert "JSON-схеме" not in body["messages"][0]["content"]


def test_missing_local_model_says_ai_is_not_configured():
    client = client_for({})
    client.post.side_effect = httpx.ConnectError("refused")
    with patch("app.ai.httpx.AsyncClient", return_value=client):
        with pytest.raises(HTTPException) as error:
            asyncio.run(generate(Interpreter(LOCAL)))
    assert error.value.status_code == 503
    assert "не настроен" in error.value.detail


def test_cloud_schema_mismatch_is_recoverable():
    with patch("app.ai.httpx.AsyncClient", return_value=client_for({"error": {"code": "json_validate_failed"}}, status=400)):
        with pytest.raises(HTTPException) as error:
            asyncio.run(generate(Interpreter(CLOUD)))
    assert error.value.status_code == 503


def test_structured_response_and_private_ollama_request():
    client = client_for({"message": {"content": json.dumps(VALID)}})
    with patch("app.ai.httpx.AsyncClient", return_value=client):
        result = asyncio.run(generate(Interpreter(LOCAL)))
    assert result.clarification is True
    body = client.post.call_args.kwargs["json"]
    assert body["stream"] is False
    assert body["format"]["type"] == "object"
    assert body["options"]["num_ctx"] == 4096
    assert body["options"]["num_predict"] == 700
    assert body["messages"][-1] == {"role": "user", "content": "Встреча"}


def test_generation_schemas_get_a_larger_context():
    client = client_for({"message": {"content": json.dumps(VALID)}})
    with patch("app.ai.httpx.AsyncClient", return_value=client):
        asyncio.run(generate(Interpreter(LOCAL), ScheduleGeneration))
    assert client.post.call_args.kwargs["json"]["options"]["num_ctx"] == 8192


@pytest.mark.parametrize("payload", [{}, {"message": {"content": "not JSON"}}, {"message": {"content": '{"message":"x"}'}}])
def test_invalid_model_output_is_recoverable(payload):
    interpreter = Interpreter(LOCAL)
    with patch("app.ai.httpx.AsyncClient", return_value=client_for(payload)):
        with pytest.raises(HTTPException) as error:
            asyncio.run(generate(interpreter))
    assert error.value.status_code == 503
    assert interpreter.waiting == 0
    assert not interpreter.gate.locked()


def test_model_timeout_releases_queue():
    client = client_for({})
    client.post.side_effect = httpx.ReadTimeout("slow")
    interpreter = Interpreter(LOCAL)
    with patch("app.ai.httpx.AsyncClient", return_value=client):
        with pytest.raises(HTTPException) as error:
            asyncio.run(generate(interpreter))
    assert error.value.status_code == 503
    assert interpreter.waiting == 0


def test_queue_has_a_bound_and_wait_timeout():
    async def run():
        interpreter = Interpreter(replace(LOCAL, ai_queue_timeout=0.01))
        interpreter.waiting = 4
        with pytest.raises(HTTPException) as error:
            await generate(interpreter)
        assert error.value.status_code == 429
        interpreter.waiting = 0
        await interpreter.gate.acquire()
        with pytest.raises(HTTPException) as error:
            await generate(interpreter)
        assert error.value.status_code == 503
        assert interpreter.waiting == 0
        interpreter.gate.release()
    asyncio.run(run())
