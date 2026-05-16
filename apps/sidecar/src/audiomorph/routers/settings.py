from __future__ import annotations

from pathlib import PurePosixPath, PureWindowsPath
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from .._errors import ApiError
from ..db import repo
from ..db.session import session_scope
from ..services.first_run import get_first_run_status

router = APIRouter(tags=["settings"])

_STR_KEYS: set[str] = {"models_dir", "default_model_id"}
_BOOL_KEYS: set[str] = {
    "cpu_fallback_enabled",
    "hf_token_present",
    "openrouter_key_present",
    "first_run_completed",
}
_ENUM_KEYS: dict[str, set[str]] = {
    "theme": {"light", "dark", "system"},
}

ALL_KEYS: set[str] = _STR_KEYS | _BOOL_KEYS | set(_ENUM_KEYS.keys())

_DEFAULTS: dict[str, Any] = {
    "models_dir": "",
    "default_model_id": "",
    "cpu_fallback_enabled": False,
    "hf_token_present": False,
    "openrouter_key_present": False,
    "first_run_completed": False,
    "theme": "system",
}


class _SettingBody(BaseModel):
    value: Any


def _coerce_read(key: str, raw: str | None) -> Any:
    if raw is None:
        return _DEFAULTS[key]
    if key in _BOOL_KEYS:
        return raw.strip().lower() == "true"
    return raw


def _is_absolute_path(value: str) -> bool:
    if not value:
        return False
    return PurePosixPath(value).is_absolute() or PureWindowsPath(value).is_absolute()


def _validate_value(key: str, value: Any) -> str:
    if key in _BOOL_KEYS:
        if not isinstance(value, bool):
            raise ApiError(
                code="VALIDATION_ERROR",
                message=f"Invalid value for {key}: expected bool",
                retriable=False,
            )
        return "true" if value else "false"

    if key in _ENUM_KEYS:
        allowed = _ENUM_KEYS[key]
        if not isinstance(value, str) or value not in allowed:
            raise ApiError(
                code="VALIDATION_ERROR",
                message=f"Invalid value for {key}: expected one of {sorted(allowed)}",
                retriable=False,
            )
        return value

    if key in _STR_KEYS:
        if not isinstance(value, str):
            raise ApiError(
                code="VALIDATION_ERROR",
                message=f"Invalid value for {key}: expected str",
                retriable=False,
            )
        if key == "models_dir" and value and not _is_absolute_path(value):
            raise ApiError(
                code="VALIDATION_ERROR",
                message=f"Invalid value for {key}: expected absolute path",
                retriable=False,
            )
        return value

    raise ApiError(
        code="VALIDATION_ERROR",
        message=f"Unknown setting key: {key}",
        retriable=False,
    )


@router.get("/settings")
async def read_settings() -> dict[str, Any]:
    with session_scope() as session:
        return {key: _coerce_read(key, repo.get_setting(session, key)) for key in ALL_KEYS}


@router.put("/settings/{key}")
async def write_setting(key: str, body: _SettingBody) -> dict[str, Any]:
    if key not in ALL_KEYS:
        raise ApiError(
            code="VALIDATION_ERROR",
            message=f"Unknown setting key: {key}",
            retriable=False,
        )

    stored = _validate_value(key, body.value)

    with session_scope() as session:
        repo.set_setting(session, key, stored)

    return {"key": key, "value": body.value}


@router.get("/first-run/status")
async def read_first_run_status() -> dict[str, Any]:
    with session_scope() as session:
        return get_first_run_status(session)
