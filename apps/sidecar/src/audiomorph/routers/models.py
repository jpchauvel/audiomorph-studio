from __future__ import annotations

from collections.abc import AsyncGenerator, AsyncIterator

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownParameterType=false, reportArgumentType=false
import json
from typing import Any

from fastapi import APIRouter, Request, Response

try:
    from sse_starlette.sse import EventSourceResponse
except (
    Exception
):  # pragma: no cover - fallback when dependency not installed yet
    from starlette.responses import StreamingResponse

    class EventSourceResponse(StreamingResponse):  # type: ignore[no-redef]
        def __init__(
            self, generator: AsyncGenerator[dict[str, object], None]
        ):
            async def _encode() -> AsyncGenerator[str, None]:
                async for item in generator:
                    data = item.get("data", {})
                    payload = (
                        data if isinstance(data, str) else json.dumps(data)
                    )
                    yield f"event: {item.get('event', 'message')}\ndata: {payload}\n\n"

            super().__init__(_encode(), media_type="text/event-stream")


from audiomorph.models.manager import get_manager

router = APIRouter(prefix="/models", tags=["models"])
_MANAGER = get_manager()


async def _serialize_sse(
    gen: AsyncIterator[dict[str, Any]],
) -> AsyncGenerator[dict[str, object], None]:
    async for item in gen:
        data = item.get("data", {})
        yield {
            "event": item.get("event", "message"),
            "data": data if isinstance(data, str) else json.dumps(data),
        }


@router.get("")
async def list_models() -> dict[str, list[dict[str, object]]]:
    items: list[dict[str, object]] = []
    for model in _MANAGER.list_required_models():
        status = _MANAGER.get_status(model["id"])
        items.append(
            {
                "id": model["id"],
                "name": model["name"],
                "role": model["role"],
                "size_gb": model["size_gb"],
                **status,
            }
        )
    return {"items": items}


@router.post("/{model_id}/download")
async def start_download(model_id: str, request: Request) -> dict[str, str]:
    normalized = _MANAGER.normalize_and_validate_model_id(model_id)
    hf_token = request.headers.get("X-HuggingFace-Token") or None
    job_id = await _MANAGER.start_download(normalized, hf_token=hf_token)
    return {"job_id": job_id}


@router.delete("/{model_id}/download/{job_id}")
async def cancel_download(model_id: str, job_id: str) -> dict[str, str]:
    normalized = _MANAGER.normalize_and_validate_model_id(model_id)
    job = _MANAGER.get_job(job_id)
    if job["model_id"] != normalized:
        return {"job_id": job_id, "state": "cancelled"}
    result = await _MANAGER.cancel_download(job_id)
    return {"job_id": str(result["job_id"]), "state": str(result["state"])}


@router.post("/{model_id}/verify")
async def verify_model(model_id: str) -> dict[str, object]:
    normalized = _MANAGER.normalize_and_validate_model_id(model_id)
    return await _MANAGER.verify(normalized)


@router.delete("/{model_id}", status_code=204)
async def delete_model(model_id: str) -> Response:
    normalized = _MANAGER.normalize_and_validate_model_id(model_id)
    await _MANAGER.delete(normalized)
    return Response(status_code=204)


@router.get("/jobs/{job_id}/events")
async def stream_job(job_id: str) -> EventSourceResponse:
    return EventSourceResponse(
        _serialize_sse(_MANAGER.stream_job_events(job_id))
    )
