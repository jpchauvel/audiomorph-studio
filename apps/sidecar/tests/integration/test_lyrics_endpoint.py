from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration

PLANTED_KEY = "sk-or-v1-PLANTED-FAKE-TEST-TOKEN"


def test_openrouter_chat_routed_through_stub(
    app_client, auth_headers, openrouter_stub, monkeypatch
) -> None:
    from audiomorph.routers import openrouter as or_router

    monkeypatch.setattr(or_router, "OPENROUTER_URL", openrouter_stub["url"])

    payload = {
        "model": "openai/gpt-4o-mini",
        "messages": [{"role": "user", "content": "say hi"}],
    }
    resp = app_client.post(
        "/openrouter/chat",
        json=payload,
        headers={**auth_headers, "X-OpenRouter-Key": PLANTED_KEY},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "choices" in body or "id" in body

    recorded = openrouter_stub["recorded"]
    assert len(recorded) == 1
    forwarded = recorded[0]
    assert forwarded["body"]["model"] == "openai/gpt-4o-mini"
    auth_hdr = {k.lower(): v for k, v in forwarded["headers"].items()}.get(
        "authorization"
    )
    assert auth_hdr == f"Bearer {PLANTED_KEY}"


def test_openrouter_chat_requires_key_header(
    app_client, auth_headers
) -> None:
    payload = {
        "model": "openai/gpt-4o-mini",
        "messages": [{"role": "user", "content": "hi"}],
    }
    resp = app_client.post(
        "/openrouter/chat", json=payload, headers=auth_headers
    )
    assert resp.status_code == 422


def test_openrouter_rejects_empty_messages(
    app_client, auth_headers, openrouter_stub, monkeypatch
) -> None:
    from audiomorph.routers import openrouter as or_router

    monkeypatch.setattr(or_router, "OPENROUTER_URL", openrouter_stub["url"])

    resp = app_client.post(
        "/openrouter/chat",
        json={"model": "x", "messages": []},
        headers={**auth_headers, "X-OpenRouter-Key": PLANTED_KEY},
    )
    assert resp.status_code == 422
