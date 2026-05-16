from __future__ import annotations

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false
import asyncio
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
import httpx

from audiomorph._errors import ApiError
from audiomorph._logging import get_logger

router = APIRouter(prefix="/openrouter", tags=["openrouter"])

_logger = get_logger("audiomorph.openrouter")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
_REFERER = "https://audiomorph.local"
_TIMEOUT_SECONDS = 60.0
_MAX_RETRIES = 2
_RETRY_BACKOFF_BASE = 0.1


def _validate_payload(body: dict[str, Any]) -> None:
    messages = body.get("messages")
    if not isinstance(messages, list) or len(messages) == 0:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="messages must be a non-empty list",
            retriable=False,
        )


async def _post_with_retry(
    payload: dict[str, Any],
    key: str,
    stream: bool,
) -> httpx.Response:
    headers = {
        "Authorization": f"Bearer {key}",
        "HTTP-Referer": _REFERER,
        "Content-Type": "application/json",
    }
    last_exc: Exception | None = None
    client = httpx.AsyncClient(timeout=_TIMEOUT_SECONDS)
    try:
        for attempt in range(_MAX_RETRIES + 1):
            try:
                if stream:
                    req = client.build_request(
                        "POST", OPENROUTER_URL, json=payload, headers=headers
                    )
                    response = await client.send(req, stream=True)
                else:
                    response = await client.post(
                        OPENROUTER_URL, json=payload, headers=headers
                    )
            except httpx.TimeoutException as exc:
                last_exc = exc
                _logger.warning("openrouter_timeout", attempt=attempt + 1)
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(_RETRY_BACKOFF_BASE * (2**attempt))
                    continue
                await client.aclose()
                raise ApiError(
                    code="INTERNAL_ERROR",
                    message="OpenRouter request timed out",
                    retriable=True,
                ) from exc

            if response.status_code >= 500 and attempt < _MAX_RETRIES:
                _logger.warning(
                    "openrouter_5xx_retry",
                    attempt=attempt + 1,
                    status=response.status_code,
                )
                if stream:
                    await response.aclose()
                await asyncio.sleep(_RETRY_BACKOFF_BASE * (2**attempt))
                continue

            response.extensions["_openrouter_client"] = client
            return response

        await client.aclose()
        raise ApiError(
            code="INTERNAL_ERROR",
            message="OpenRouter request failed",
            retriable=True,
            hint=str(last_exc) if last_exc else None,
        )
    except ApiError:
        raise
    except Exception:
        await client.aclose()
        raise


async def _read_error_hint(response: httpx.Response) -> str:
    try:
        text = response.text
    except Exception:
        try:
            raw = await response.aread()
            text = raw.decode("utf-8", errors="replace")
        except Exception:
            text = ""
    first_line = text.strip().splitlines()[0] if text.strip() else ""
    return first_line[:500]


@router.post("/chat")
async def openrouter_chat(request: Request) -> Any:
    key = request.headers.get("X-OpenRouter-Key", "").strip()
    if not key:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="X-OpenRouter-Key header required",
            retriable=False,
        )

    try:
        body = await request.json()
    except Exception as exc:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Invalid JSON body",
            retriable=False,
        ) from exc

    if not isinstance(body, dict):
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Body must be a JSON object",
            retriable=False,
        )

    _validate_payload(body)

    stream = bool(body.get("stream", False))

    _logger.info(
        "openrouter_request",
        model=body.get("model"),
        stream=stream,
        message_count=len(body["messages"]),
    )

    response = await _post_with_retry(body, key, stream)
    client: httpx.AsyncClient = response.extensions.get("_openrouter_client")  # type: ignore[assignment]

    if response.status_code >= 400:
        hint = await _read_error_hint(response)
        if stream:
            await response.aclose()
        await client.aclose()
        _logger.warning(
            "openrouter_upstream_error",
            status=response.status_code,
        )
        raise ApiError(
            code="INTERNAL_ERROR",
            message="OpenRouter error",
            retriable=response.status_code >= 500,
            hint=hint or None,
        )

    if stream:

        async def _iter() -> AsyncIterator[bytes]:
            try:
                async for chunk in response.aiter_bytes():
                    yield chunk
            finally:
                await response.aclose()
                await client.aclose()

        media_type = response.headers.get("content-type", "text/event-stream")
        return StreamingResponse(_iter(), media_type=media_type)

    try:
        data = response.json()
    finally:
        await client.aclose()
    return JSONResponse(content=data, status_code=response.status_code)
