from __future__ import annotations

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false

import asyncio
import json
from collections.abc import AsyncGenerator
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Response

try:
    from sse_starlette.sse import EventSourceResponse
except Exception:  # pragma: no cover - fallback when dependency not installed yet
    from starlette.responses import StreamingResponse

    class EventSourceResponse(StreamingResponse):  # type: ignore[no-redef]
        def __init__(self, generator: AsyncGenerator[dict[str, object], None]):
            async def _encode() -> AsyncGenerator[str, None]:
                async for item in generator:
                    payload = json.dumps(item.get("data", {}))
                    yield f"event: {item.get('event', 'message')}\ndata: {payload}\n\n"

            super().__init__(_encode(), media_type="text/event-stream")

from audiomorph._errors import ApiError
from audiomorph.lyrics import TranscriptionEngine, get_engine
from audiomorph.schemas import JobStatus, LyricsRequest

router = APIRouter(prefix="/lyrics", tags=["lyrics"])

_ENGINE: TranscriptionEngine = get_engine()
_JOBS: dict[str, dict[str, Any]] = {}
_JOB_EVENTS: dict[str, asyncio.Queue[dict[str, Any]]] = {}
_JOB_TASKS: dict[str, asyncio.Task[None]] = {}


def _not_found(job_id: str) -> ApiError:
    return ApiError(code="JOB_NOT_FOUND", message=f"Unknown lyrics job: {job_id}", retriable=False)


def _job_state(job_id: str) -> dict[str, Any]:
    state = _JOBS.get(job_id)
    if state is None:
        raise _not_found(job_id)
    return state


def _emit(job_id: str, event: str, data: dict[str, Any]) -> None:
    queue = _JOB_EVENTS.get(job_id)
    if queue is not None:
        queue.put_nowait({"event": event, "data": data})


async def _run_transcription(job_id: str, req: LyricsRequest) -> None:
    state = _job_state(job_id)
    try:
        state["status"] = JobStatus.running.value

        def _progress(payload: dict[str, Any]) -> None:
            _emit(job_id, "progress", payload)

        result = await _ENGINE.transcribe(req.audio_path, job_id, _progress)
        state["status"] = JobStatus.completed.value
        state["result"] = result.model_dump()
        _emit(job_id, "done", state["result"])
    except ApiError as exc:
        state["status"] = (
            JobStatus.cancelled.value if exc.code == "CANCELLED" else JobStatus.failed.value
        )
        state["error"] = exc.envelope()
        _emit(job_id, "error", state["error"])
    except asyncio.CancelledError:
        state["status"] = JobStatus.cancelled.value
        state["error"] = {
            "code": "CANCELLED",
            "message": "Transcription cancelled",
            "hint": None,
            "retriable": False,
        }
        _emit(job_id, "error", state["error"])
        raise
    finally:
        _emit(job_id, "terminal", {"status": state["status"]})


@router.get("")
async def list_lyrics_jobs() -> dict[str, list[dict[str, Any]]]:
    return {
        "items": [
            {"job_id": jid, "status": state["status"]}
            for jid, state in _JOBS.items()
        ]
    }


@router.post("/transcribe", status_code=202)
async def transcribe_lyrics(req: LyricsRequest) -> dict[str, str]:
    job_id = str(uuid4())
    _JOBS[job_id] = {
        "job_id": job_id,
        "status": JobStatus.pending.value,
        "result": None,
        "error": None,
    }
    _JOB_EVENTS[job_id] = asyncio.Queue()
    _JOB_TASKS[job_id] = asyncio.create_task(_run_transcription(job_id, req))
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
async def get_lyrics_job(job_id: str) -> dict[str, Any]:
    state = _job_state(job_id)
    payload: dict[str, Any] = {"job_id": job_id, "status": state["status"]}
    if state.get("result") is not None:
        payload["result"] = state["result"]
    if state.get("error") is not None:
        payload["error"] = state["error"]
    return payload


@router.get("/jobs/{job_id}/events")
async def stream_lyrics_events(job_id: str) -> EventSourceResponse:
    if job_id not in _JOBS:
        raise _not_found(job_id)

    async def _events() -> AsyncGenerator[dict[str, Any], None]:
        queue = _JOB_EVENTS[job_id]
        terminal = {JobStatus.completed.value, JobStatus.failed.value, JobStatus.cancelled.value}
        while True:
            item = await queue.get()
            if item["event"] != "terminal":
                yield item
            if _JOBS[job_id]["status"] in terminal and queue.empty():
                break

    return EventSourceResponse(_events())


@router.delete("/jobs/{job_id}", status_code=202)
async def cancel_lyrics_job(job_id: str) -> Response:
    _job_state(job_id)
    _ENGINE.cancel(job_id)
    return Response(status_code=202)
