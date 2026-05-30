from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from audiomorph._errors import ApiError
from audiomorph.app import create_app
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


def test_get_job_audio_returns_wav_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    job_id = "job-audio-1"
    job_dir = tmp_path / job_id
    job_dir.mkdir()
    audio_path = job_dir / "audio.wav"
    wav_bytes = b"RIFF\x24\x00\x00\x00WAVEfake-pcm-data"
    audio_path.write_bytes(wav_bytes)

    import audiomorph.routers.jobs as jobs_mod

    monkeypatch.setattr(jobs_mod, "get_jobs_dir", lambda: tmp_path)

    app = create_app(auth_token="t")
    with TestClient(app) as client:
        r = client.get(
            f"/jobs/{job_id}/audio",
            headers={"X-Audiomorph-Token": "t"},
        )

    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("audio/wav")
    assert r.content == wav_bytes


def test_get_job_audio_returns_404_when_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    import audiomorph.routers.jobs as jobs_mod

    monkeypatch.setattr(jobs_mod, "get_jobs_dir", lambda: tmp_path)

    app = create_app(auth_token="t")
    with TestClient(app) as client:
        r = client.get(
            "/jobs/missing-job/audio",
            headers={"X-Audiomorph-Token": "t"},
        )

    assert r.status_code == 404
    assert r.json()["code"] == "JOB_NOT_FOUND"
