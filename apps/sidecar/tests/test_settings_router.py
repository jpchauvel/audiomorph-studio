from __future__ import annotations

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false, reportUnusedFunction=false, reportUntypedFunctionDecorator=false

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from audiomorph.app import create_app
from audiomorph.db.session import init_db, session_scope
from audiomorph.routers import settings as settings_router

AUTH_TOKEN = "test-token"
AUTH_HEADERS = {"X-Audiomorph-Token": AUTH_TOKEN}


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    p = tmp_path / "settings.db"
    init_db(str(p))
    return p


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch, db_path: Path) -> TestClient:
    monkeypatch.setattr(
        settings_router, "session_scope", lambda: session_scope(str(db_path))
    )
    return TestClient(create_app(auth_token=AUTH_TOKEN))


def test_get_settings_returns_defaults_on_fresh_db(client: TestClient) -> None:
    resp = client.get("/settings", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()

    assert body == {
        "models_dir": "",
        "default_model_id": "",
        "cpu_fallback_enabled": False,
        "hf_token_present": False,
        "openrouter_key_present": False,
        "first_run_completed": False,
        "theme": "system",
    }


def test_put_valid_key_persists_and_returns_value(client: TestClient) -> None:
    resp = client.put(
        "/settings/theme",
        headers=AUTH_HEADERS,
        json={"value": "dark"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"key": "theme", "value": "dark"}

    follow = client.get("/settings", headers=AUTH_HEADERS)
    assert follow.json()["theme"] == "dark"


def test_put_bool_setting_persists_as_bool(client: TestClient) -> None:
    resp = client.put(
        "/settings/cpu_fallback_enabled",
        headers=AUTH_HEADERS,
        json={"value": True},
    )
    assert resp.status_code == 200
    follow = client.get("/settings", headers=AUTH_HEADERS).json()
    assert follow["cpu_fallback_enabled"] is True


def test_put_unknown_key_returns_validation_error(client: TestClient) -> None:
    resp = client.put(
        "/settings/bogus_key",
        headers=AUTH_HEADERS,
        json={"value": "anything"},
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert "Unknown setting key" in body["message"]


def test_put_theme_invalid_value_returns_validation_error(client: TestClient) -> None:
    resp = client.put(
        "/settings/theme",
        headers=AUTH_HEADERS,
        json={"value": "neon"},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "VALIDATION_ERROR"


def test_put_bool_key_rejects_non_bool(client: TestClient) -> None:
    resp = client.put(
        "/settings/hf_token_present",
        headers=AUTH_HEADERS,
        json={"value": "true"},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "VALIDATION_ERROR"


def test_put_models_dir_rejects_relative_path(client: TestClient) -> None:
    resp = client.put(
        "/settings/models_dir",
        headers=AUTH_HEADERS,
        json={"value": "relative/path"},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "VALIDATION_ERROR"


def test_put_models_dir_accepts_absolute_path(client: TestClient) -> None:
    resp = client.put(
        "/settings/models_dir",
        headers=AUTH_HEADERS,
        json={"value": "/tmp/models"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"key": "models_dir", "value": "/tmp/models"}


def test_first_run_status_transitions(client: TestClient) -> None:
    resp = client.get("/first-run/status", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["completed"] is False
    assert body["missing_steps"] == [
        "pick_models_dir",
        "download_models",
        "first_run_completed",
    ]

    client.put(
        "/settings/models_dir",
        headers=AUTH_HEADERS,
        json={"value": "/tmp/models"},
    )
    body = client.get("/first-run/status", headers=AUTH_HEADERS).json()
    assert body["completed"] is False
    assert "pick_models_dir" not in body["missing_steps"]
    assert "download_models" in body["missing_steps"]

    client.put(
        "/settings/hf_token_present",
        headers=AUTH_HEADERS,
        json={"value": True},
    )
    body = client.get("/first-run/status", headers=AUTH_HEADERS).json()
    assert body["completed"] is False
    assert body["missing_steps"] == ["first_run_completed"]

    client.put(
        "/settings/first_run_completed",
        headers=AUTH_HEADERS,
        json={"value": True},
    )
    body = client.get("/first-run/status", headers=AUTH_HEADERS).json()
    assert body == {"completed": True, "missing_steps": []}
