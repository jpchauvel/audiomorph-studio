from __future__ import annotations

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnusedFunction=false
import importlib
import json
from pathlib import Path
import re
import sys
from types import SimpleNamespace
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from fastapi import APIRouter
from fastapi.testclient import TestClient

from audiomorph._errors import ApiError
from audiomorph.app import create_app


def _client() -> TestClient:
    return TestClient(create_app(auth_token="test-token"))


def test_api_error_returns_contract_envelope() -> None:
    app = create_app(auth_token="test-token")
    router = APIRouter()

    @router.get("/boom-api")
    async def boom_api() -> None:
        raise ApiError(
            code="MODEL_NOT_FOUND",
            message="Model is missing",
            hint="Download the model first",
            retriable=False,
        )

    app.include_router(router)

    with TestClient(app) as client:
        response = client.get(
            "/boom-api", headers={"X-Audiomorph-Token": "test-token"}
        )

    assert response.status_code == 404
    assert response.json() == {
        "code": "MODEL_NOT_FOUND",
        "message": "Model is missing",
        "hint": "Download the model first",
        "retriable": False,
    }


def test_unhandled_exception_returns_internal_error_without_traceback() -> (
    None
):
    app = create_app(auth_token="test-token")
    router = APIRouter()

    @router.get("/boom")
    async def boom() -> None:
        raise RuntimeError("kaboom")

    app.include_router(router)

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get(
            "/boom", headers={"X-Audiomorph-Token": "test-token"}
        )

    assert response.status_code == 500
    assert response.json() == {
        "code": "INTERNAL_ERROR",
        "message": "Internal server error",
        "hint": None,
        "retriable": False,
    }
    assert "traceback" not in response.text.lower()
    assert "RuntimeError" not in response.text


def test_healthz_returns_gpu_info_without_auth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_torch = SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: False),
        backends=SimpleNamespace(
            mps=SimpleNamespace(is_available=lambda: False)
        ),
    )
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    import audiomorph.app as app_module

    importlib.reload(app_module)
    app = app_module.create_app(auth_token="test-token")

    with TestClient(app) as client:
        response = client.get("/healthz")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert isinstance(payload["version"], str)
    assert isinstance(payload["models_dir"], str)
    assert isinstance(payload["python_version"], str)
    assert payload["gpu"] == {"available": False}


def test_auth_required_on_non_healthz_routes() -> None:
    with _client() as client:
        response = client.get("/models")

    assert response.status_code == 401
    assert response.json()["message"] == "Unauthorized"


def test_request_logging_has_required_fields(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with _client() as client:
        response = client.get("/healthz")
        assert response.status_code == 200

    out = capsys.readouterr().out
    request_logs: list[dict[str, Any]] = []
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        event = json.loads(line)
        if event.get("event") == "request":
            request_logs.append(event)

    assert request_logs, "expected at least one request log"
    entry = request_logs[-1]
    assert entry["method"] == "GET"
    assert entry["path"] == "/healthz"
    assert entry["status"] == 200
    assert isinstance(entry["duration_ms"], float | int)
    assert re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        str(entry["request_id"]),
    )
