from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.integration


def test_test_mode_env_is_set(app_client) -> None:
    assert os.environ.get("AUDIOMORPH_TEST_MODE") == "1"


def test_healthz_reports_test_mode(app_client) -> None:
    resp = app_client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("test_mode") is True


def test_no_keyring_import_during_request(app_client, auth_headers) -> None:
    import sys

    assert "keyring" not in sys.modules, (
        "keyring must NOT be imported in test mode (vault is in-memory)"
    )
    resp = app_client.get("/settings", headers=auth_headers)
    assert resp.status_code == 200
    assert "keyring" not in sys.modules


def test_no_telemetry_module_imported(app_client) -> None:
    import sys

    banned_prefixes = (
        "sentry_sdk",
        "posthog",
        "analytics",
        "segment_analytics",
        "mixpanel",
    )
    for mod in list(sys.modules):
        for prefix in banned_prefixes:
            assert not mod.startswith(prefix), (
                f"telemetry module imported: {mod}"
            )


def test_openrouter_url_default_is_not_overridden_in_test_mode(
    monkeypatch,
) -> None:
    monkeypatch.delenv("AUDIOMORPH_OPENROUTER_BASE_URL", raising=False)
    from audiomorph.routers import openrouter as or_router

    assert (
        or_router.OPENROUTER_URL
        == "https://openrouter.ai/api/v1/chat/completions"
    )
