from __future__ import annotations

# pyright: reportMissingImports=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false, reportUnknownParameterType=false
import asyncio
import hashlib
from pathlib import Path
import sys
import threading
import time
from typing import Any, NamedTuple

from fastapi.testclient import TestClient
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from audiomorph._errors import ApiError
from audiomorph.app import create_app
from audiomorph.models.manager import ModelDownloadManager


class _DiskUsage(NamedTuple):
    total: int
    used: int
    free: int


def _disk_usage(free: int) -> Any:
    return _DiskUsage(total=10_000_000_000, used=1_000_000_000, free=free)


async def _wait_for_terminal(
    manager: ModelDownloadManager, job_id: str, timeout_s: float = 3.0
) -> dict[str, Any]:
    assert isinstance(manager, ModelDownloadManager)
    started = time.monotonic()
    while True:
        job = manager.get_job(job_id)
        if job["state"] in {"completed", "failed", "cancelled"}:
            return job
        if time.monotonic() - started > timeout_s:
            raise AssertionError(f"job {job_id} did not reach terminal state")
        await asyncio.sleep(0.05)


def test_list_required_models_has_expected_repos(tmp_path: Path) -> None:
    manager = ModelDownloadManager(models_dir=tmp_path)
    repos = [m["id"] for m in manager.list_required_models()]
    assert repos == [
        "HeartMuLa/HeartMuLaGen",
        "HeartMuLa/HeartMuLa-oss-3B-happy-new-year",
        "HeartMuLa/HeartCodec-oss-20260123",
    ]


@pytest.mark.anyio
async def test_start_download_uses_resume_and_byok_token_with_global_single_flight(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = ModelDownloadManager(models_dir=tmp_path)

    def _du_9g(_p: object) -> Any:
        return _disk_usage(9_000_000_000)

    monkeypatch.setattr("audiomorph.models.manager.shutil.disk_usage", _du_9g)
    monkeypatch.setenv("HF_TOKEN", "top-secret-token")

    lock = threading.Lock()
    active = 0
    max_active = 0
    calls: list[dict[str, object]] = []

    def fake_snapshot_download(**kwargs: object) -> str:
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)

        calls.append(dict(kwargs))
        local_dir = Path(str(kwargs["local_dir"]))
        local_dir.mkdir(parents=True, exist_ok=True)
        time.sleep(0.2)
        (local_dir / "weights.bin").write_bytes(b"abc")

        with lock:
            active -= 1
        return str(local_dir)

    monkeypatch.setattr(
        "audiomorph.models.manager.snapshot_download", fake_snapshot_download
    )

    job_a = await manager.start_download("HeartMuLa/HeartMuLaGen")
    job_b = await manager.start_download("HeartMuLa/HeartCodec-oss-20260123")
    await _wait_for_terminal(manager, job_a)
    await _wait_for_terminal(manager, job_b)

    assert max_active == 1
    assert len(calls) == 2
    assert calls[0]["resume_download"] is True
    assert calls[0]["max_workers"] == 4
    assert calls[0]["etag_timeout"] == 30
    assert calls[0]["token"] == "top-secret-token"


@pytest.mark.anyio
async def test_start_download_refuses_when_disk_is_too_full(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manager = ModelDownloadManager(models_dir=tmp_path)

    def _du_1(_p: object) -> Any:
        return _disk_usage(1)

    monkeypatch.setattr("audiomorph.models.manager.shutil.disk_usage", _du_1)

    with pytest.raises(ApiError) as exc:
        await manager.start_download("HeartMuLa/HeartMuLaGen")

    assert exc.value.code == "DOWNLOAD_FAILED"
    assert "Need" in str(exc.value.hint)


@pytest.mark.anyio
async def test_verify_reports_sha_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manager = ModelDownloadManager(models_dir=tmp_path)
    model_id = "HeartMuLa/HeartMuLaGen"
    model_dir = manager.model_path(model_id)
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "weights.bin").write_bytes(b"wrong")

    async def fake_remote_hashes(_: str) -> dict[str, str]:
        return {"weights.bin": hashlib.sha256(b"expected").hexdigest()}

    monkeypatch.setattr(manager, "_remote_sha256_map", fake_remote_hashes)
    result = await manager.verify(model_id)

    assert result["valid"] is False
    assert result["mismatches"] == ["weights.bin"]
    status = manager.get_status(model_id)
    assert status["state"] == "corrupted"


def test_models_router_endpoints_and_sse_stream(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from audiomorph.routers import models as models_router

    manager = ModelDownloadManager(models_dir=tmp_path)
    monkeypatch.setattr(models_router, "_MANAGER", manager)

    def _du_9g(_p: object) -> Any:
        return _disk_usage(9_000_000_000)

    monkeypatch.setattr("audiomorph.models.manager.shutil.disk_usage", _du_9g)

    def fake_snapshot_download(**kwargs: object) -> str:
        local_dir = Path(str(kwargs["local_dir"]))
        local_dir.mkdir(parents=True, exist_ok=True)
        (local_dir / "weights.bin").write_bytes(b"abc")
        return str(local_dir)

    monkeypatch.setattr(
        "audiomorph.models.manager.snapshot_download", fake_snapshot_download
    )

    app = create_app(auth_token="test-token")
    with TestClient(app) as client:
        listed = client.get(
            "/models", headers={"X-Audiomorph-Token": "test-token"}
        )
        assert listed.status_code == 200
        assert len(listed.json()["items"]) == 3

        started = client.post(
            "/models/HeartMuLa__HeartMuLaGen/download",
            headers={"X-Audiomorph-Token": "test-token"},
        )
        assert started.status_code == 200
        job_id = started.json()["job_id"]

        with client.stream(
            "GET",
            f"/models/jobs/{job_id}/events",
            headers={"X-Audiomorph-Token": "test-token"},
        ) as response:
            assert response.status_code == 200
            lines = []
            for line in response.iter_lines():
                if line:
                    lines.append(line)
                if len(lines) >= 2:
                    break
            assert any(line.startswith("data:") for line in lines)

        cancelled = client.delete(
            f"/models/HeartMuLa__HeartMuLaGen/download/{job_id}",
            headers={"X-Audiomorph-Token": "test-token"},
        )
        assert cancelled.status_code in {200, 409}

        deleted = client.delete(
            "/models/HeartMuLa__HeartMuLaGen",
            headers={"X-Audiomorph-Token": "test-token"},
        )
        assert deleted.status_code == 204
