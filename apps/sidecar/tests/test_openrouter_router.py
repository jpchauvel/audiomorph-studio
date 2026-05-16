from __future__ import annotations

from pathlib import Path

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false, reportUnusedFunction=false, reportUntypedFunctionDecorator=false
import sys

from fastapi.testclient import TestClient
import httpx
import pytest
import respx

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from audiomorph.app import create_app

AUTH_TOKEN = "test-token"
AUTH_HEADERS = {"X-Audiomorph-Token": AUTH_TOKEN}
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def _client() -> TestClient:
    return TestClient(create_app(auth_token=AUTH_TOKEN))


@respx.mock
def test_openrouter_chat_happy_path_forwards_response() -> None:
    upstream_payload = {
        "id": "chatcmpl-abc",
        "choices": [
            {"message": {"role": "assistant", "content": "hello back"}}
        ],
    }
    route = respx.post(OPENROUTER_URL).mock(
        return_value=httpx.Response(200, json=upstream_payload)
    )

    with _client() as client:
        resp = client.post(
            "/openrouter/chat",
            headers={**AUTH_HEADERS, "X-OpenRouter-Key": "sk-or-test-abc"},
            json={
                "messages": [{"role": "user", "content": "hi"}],
                "model": "openai/gpt-4o-mini",
            },
        )

    assert resp.status_code == 200
    assert resp.json() == upstream_payload
    assert route.called
    sent_request = route.calls.last.request
    assert (
        sent_request.headers.get("Authorization") == "Bearer sk-or-test-abc"
    )
    assert (
        sent_request.headers.get("HTTP-Referer") == "https://audiomorph.local"
    )


@respx.mock
def test_openrouter_chat_missing_key_header_returns_validation_error() -> (
    None
):
    route = respx.post(OPENROUTER_URL).mock(
        return_value=httpx.Response(200, json={})
    )

    with _client() as client:
        resp = client.post(
            "/openrouter/chat",
            headers=AUTH_HEADERS,
            json={"messages": [{"role": "user", "content": "hi"}]},
        )

    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert "X-OpenRouter-Key" in body["message"]
    assert not route.called


@respx.mock
def test_openrouter_chat_retries_on_5xx_then_succeeds() -> None:
    upstream_payload = {"ok": True}
    route = respx.post(OPENROUTER_URL).mock(
        side_effect=[
            httpx.Response(500, json={"error": "boom"}),
            httpx.Response(200, json=upstream_payload),
        ]
    )

    with _client() as client:
        resp = client.post(
            "/openrouter/chat",
            headers={**AUTH_HEADERS, "X-OpenRouter-Key": "sk-or-retry"},
            json={"messages": [{"role": "user", "content": "hi"}]},
        )

    assert resp.status_code == 200
    assert resp.json() == upstream_payload
    assert route.call_count == 2


@respx.mock
def test_openrouter_chat_never_logs_api_key(
    capsys: pytest.CaptureFixture[str],
) -> None:
    secret = "sk-or-test-secret-marker"
    respx.post(OPENROUTER_URL).mock(
        return_value=httpx.Response(200, json={"ok": True})
    )

    with _client() as client:
        resp = client.post(
            "/openrouter/chat",
            headers={**AUTH_HEADERS, "X-OpenRouter-Key": secret},
            json={"messages": [{"role": "user", "content": "hi"}]},
        )

    assert resp.status_code == 200
    captured = capsys.readouterr()
    assert secret not in captured.out
    assert secret not in captured.err
