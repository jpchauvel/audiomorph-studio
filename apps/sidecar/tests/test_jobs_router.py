from __future__ import annotations

import asyncio
from typing import Any
from uuid import uuid4

import pytest

from audiomorph._errors import ApiError
from audiomorph.routers import jobs as jobs_router
from audiomorph.schemas import GenerationRequest, JobStatus


def _seed_job(req: GenerationRequest) -> str:
    job_id = str(uuid4())
    jobs_router._JOBS[job_id] = {
        "job_id": job_id,
        "status": JobStatus.pending.value,
        "result": None,
        "error": None,
    }
    jobs_router._JOB_EVENTS[job_id] = asyncio.Queue()
    return job_id


def _drain(queue: asyncio.Queue[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    while not queue.empty():
        items.append(queue.get_nowait())
    return items


@pytest.mark.asyncio
async def test_run_generation_converts_unexpected_exception_to_error_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("torch.mps init failed: synthetic")

    monkeypatch.setattr(jobs_router._ENGINE, "generate", _boom)

    req = GenerationRequest(
        prompt="x",
        lyrics="",
        duration_seconds=3.0,
        seed=1,
        model_id="facebook/musicgen-small",
    )
    job_id = _seed_job(req)

    await jobs_router._run_generation(job_id, req)

    state = jobs_router._JOBS[job_id]
    assert state["status"] == JobStatus.failed.value, state
    assert state["error"] is not None
    assert state["error"]["code"] == "INTERNAL_ERROR"
    assert "synthetic" not in state["error"]["message"]
    assert state["error"]["retriable"] is False

    events = _drain(jobs_router._JOB_EVENTS[job_id])
    kinds = [e["event"] for e in events]
    assert "error" in kinds, events
    assert kinds[-1] == "terminal", events
    assert events[-1]["data"]["status"] == JobStatus.failed.value


@pytest.mark.asyncio
async def test_run_generation_still_handles_apierror(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise ApiError(
            code="MODEL_NOT_FOUND",
            message="missing",
            retriable=False,
        )

    monkeypatch.setattr(jobs_router._ENGINE, "generate", _boom)

    req = GenerationRequest(
        prompt="x",
        lyrics="",
        duration_seconds=3.0,
        seed=1,
        model_id="facebook/musicgen-small",
    )
    job_id = _seed_job(req)

    await jobs_router._run_generation(job_id, req)

    state = jobs_router._JOBS[job_id]
    assert state["status"] == JobStatus.failed.value
    assert state["error"]["code"] == "MODEL_NOT_FOUND"
