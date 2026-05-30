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
        "HeartMuLa/HeartTranscriptor-oss",
    ]


def test_compose_replaces_broken_symlinks(tmp_path: Path) -> None:
    src_repo = tmp_path / "HeartMuLa" / "HeartMuLaGen"
    src_repo.mkdir(parents=True)
    (src_repo / "tokenizer.json").write_text('{"v":1}')
    (src_repo / "gen_config.json").write_text("{}")

    composed = tmp_path / "_composed" / "HeartMuLaGen"
    composed.mkdir(parents=True)
    stale_target = tmp_path / "missing-blob"
    (composed / "tokenizer.json").symlink_to(stale_target)
    assert (composed / "tokenizer.json").is_symlink()
    assert not (composed / "tokenizer.json").exists()

    ModelDownloadManager(models_dir=tmp_path)

    healed = composed / "tokenizer.json"
    assert healed.exists()
    assert healed.read_text() == '{"v":1}'


def test_required_models_expose_role_for_pipeline_filtering(
    tmp_path: Path,
) -> None:
    manager = ModelDownloadManager(models_dir=tmp_path)
    roles = {m["id"]: m["role"] for m in manager.list_required_models()}
    assert roles == {
        "HeartMuLa/HeartMuLaGen": "generation",
        "HeartMuLa/HeartMuLa-oss-3B-happy-new-year": "component",
        "HeartMuLa/HeartCodec-oss-20260123": "component",
        "HeartMuLa/HeartTranscriptor-oss": "transcription",
    }


@pytest.mark.anyio
async def test_start_download_uses_resume_and_byok_token_with_global_single_flight(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HF_HOME", str(tmp_path / "hf-cache"))
    manager = ModelDownloadManager(models_dir=tmp_path)

    def _du_9g(_p: object) -> Any:
        return _disk_usage(9_000_000_000)

    monkeypatch.setattr("audiomorph.models.manager.shutil.disk_usage", _du_9g)
    monkeypatch.setenv("HF_TOKEN", "top-secret-token")

    lock = threading.Lock()
    active = 0
    max_active = 0
    calls: list[dict[str, object]] = []

    siblings = [_FakeSibling("weights.bin", 3)]

    def _model_info(self: Any, model_id: str, **kwargs: Any) -> Any:
        _ = (self, model_id, kwargs)
        return _FakeModelInfo(siblings)

    def fake_hf_hub_download(**kwargs: object) -> str:
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        calls.append(dict(kwargs))
        local_dir = Path(str(kwargs["local_dir"]))
        local_dir.mkdir(parents=True, exist_ok=True)
        time.sleep(0.2)
        target = local_dir / str(kwargs["filename"])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"abc")
        with lock:
            active -= 1
        return str(target)

    from audiomorph.models import manager as mod

    monkeypatch.setattr(mod.HfApi, "model_info", _model_info, raising=False)
    monkeypatch.setattr(mod, "hf_hub_download", fake_hf_hub_download)

    job_a = await manager.start_download("HeartMuLa/HeartMuLaGen")
    job_b = await manager.start_download("HeartMuLa/HeartCodec-oss-20260123")
    await _wait_for_terminal(manager, job_a)
    await _wait_for_terminal(manager, job_b)

    assert max_active == 1
    assert len(calls) == 2
    assert calls[0]["etag_timeout"] == 30
    assert calls[0]["token"] == "top-secret-token"
    assert calls[0]["filename"] == "weights.bin"


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
        assert len(listed.json()["items"]) == 4

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
            import json as _json

            data_lines = [
                _l[len("data:") :].strip()
                for _l in lines
                if _l.startswith("data:")
            ]
            assert data_lines
            parsed = _json.loads(data_lines[0])
            assert isinstance(parsed, dict), (
                f"SSE data not JSON object. raw={data_lines[0]!r} "
                f"parsed_type={type(parsed).__name__} parsed={parsed!r}"
            )
            assert "bytes_done" in parsed
            assert "bytes_total" in parsed
            assert "state" in parsed

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


# ---------------------------------------------------------------------------
# Regression: download progress + HF auth (RED tests written first).
# Bug 1: progress bar stuck at 0 because the manager polled
# `_bytes_done(model_dir)` while snapshot_download writes to the HF cache
# first and only symlinks/copies into local_dir at the end. Manager must
# emit per-file progress driven by an actual file iteration.
# Bug 2: no way to authenticate with HuggingFace from the renderer. Manager
# must accept a per-call `hf_token` (so the Electron bridge can forward the
# user-provided token from the OS keychain) and surface a stable
# `error_code = "AUTH_REQUIRED"` when downloads fail for auth reasons.
# ---------------------------------------------------------------------------


class _FakeSibling:
    def __init__(
        self, rfilename: str, size: int, sha256: str | None = None
    ) -> None:
        self.rfilename = rfilename
        self.size = size

        class _Lfs:
            def __init__(self, sha: str | None) -> None:
                self.sha256 = sha

        self.lfs = _Lfs(sha256)


class _FakeModelInfo:
    def __init__(self, siblings: list[_FakeSibling]) -> None:
        self.siblings = siblings


def _install_hf_stubs(
    monkeypatch: pytest.MonkeyPatch,
    *,
    siblings: list[_FakeSibling],
    download_side_effect: Any,
    model_info_side_effect: Any | None = None,
) -> dict[str, list[Any]]:
    from audiomorph.models import manager as mod

    calls: dict[str, list[Any]] = {"downloads": [], "model_info": []}

    def _model_info(self: Any, model_id: str, **kwargs: Any) -> Any:
        _ = self
        calls["model_info"].append({"model_id": model_id, **kwargs})
        if model_info_side_effect is not None:
            if isinstance(model_info_side_effect, BaseException):
                raise model_info_side_effect
            return model_info_side_effect
        return _FakeModelInfo(siblings)

    def _hf_hub_download(**kwargs: Any) -> str:
        calls["downloads"].append(dict(kwargs))
        if callable(download_side_effect):
            return str(download_side_effect(**kwargs))
        if isinstance(download_side_effect, BaseException):
            raise download_side_effect
        return str(download_side_effect)

    monkeypatch.setattr(mod.HfApi, "model_info", _model_info, raising=False)
    monkeypatch.setattr(
        mod, "hf_hub_download", _hf_hub_download, raising=False
    )
    # disk-space happy path
    monkeypatch.setattr(
        mod.shutil, "disk_usage", lambda _p: _disk_usage(9_000_000_000)
    )
    return calls


@pytest.mark.anyio
async def test_start_download_accepts_hf_token_and_threads_it_through(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HF_HOME", str(tmp_path / "hf-cache"))
    manager = ModelDownloadManager(models_dir=tmp_path)

    siblings = [_FakeSibling("config.json", 10)]

    def _write(**kwargs: Any) -> str:
        local_dir = Path(str(kwargs["local_dir"]))
        local_dir.mkdir(parents=True, exist_ok=True)
        target = local_dir / str(kwargs["filename"])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"x" * 10)
        return str(target)

    calls = _install_hf_stubs(
        monkeypatch, siblings=siblings, download_side_effect=_write
    )

    job_id = await manager.start_download(
        "HeartMuLa/HeartMuLaGen", hf_token="hf_user_token_abc"
    )
    job = manager.get_job(job_id)
    assert job["hf_token"] == "hf_user_token_abc"

    await _wait_for_terminal(manager, job_id)

    assert any(
        call.get("token") == "hf_user_token_abc"
        for call in calls["downloads"]
    ), (
        f"hf_hub_download was not called with token. calls={calls['downloads']}"
    )
    assert any(
        call.get("token") == "hf_user_token_abc"
        for call in calls["model_info"]
    ), f"model_info was not called with token. calls={calls['model_info']}"


@pytest.mark.anyio
async def test_per_file_download_emits_incremental_progress(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HF_HOME", str(tmp_path / "hf-cache"))
    manager = ModelDownloadManager(models_dir=tmp_path)
    siblings = [
        _FakeSibling("config.json", 100),
        _FakeSibling("weights/part-1.bin", 200),
        _FakeSibling("weights/part-2.bin", 300),
    ]

    def _write_file(**kwargs: Any) -> str:
        local_dir = Path(str(kwargs["local_dir"]))
        local_dir.mkdir(parents=True, exist_ok=True)
        target = local_dir / str(kwargs["filename"])
        target.parent.mkdir(parents=True, exist_ok=True)
        # Match sibling size for accurate bytes_done assertions.
        size_map = {s.rfilename: s.size for s in siblings}
        target.write_bytes(b"x" * size_map[str(kwargs["filename"])])
        return str(target)

    _install_hf_stubs(
        monkeypatch, siblings=siblings, download_side_effect=_write_file
    )

    job_id = await manager.start_download("HeartMuLa/HeartMuLaGen")

    # Drain the queue concurrently with the running job.
    queue = manager._job_events[job_id]  # noqa: SLF001 - test surface
    seen: list[dict[str, Any]] = []
    while True:
        payload = await asyncio.wait_for(queue.get(), timeout=3.0)
        seen.append(payload)
        if (
            manager.get_job(job_id)["state"]
            in {"completed", "failed", "cancelled"}
            and queue.empty()
        ):
            break

    # The first event should be the initial queued event (bytes_done=0).
    assert seen[0]["bytes_done"] == 0
    # At least one event during the download should report bytes_done > 0
    # AND name a current_file (the per-file regression check).
    intermediates = [
        p for p in seen if p["bytes_done"] > 0 and p.get("state") == "running"
    ]
    assert intermediates, (
        f"expected at least one running-state progress event with bytes_done>0; "
        f"got {seen}"
    )
    files_reported = {p.get("current_file") for p in intermediates}
    assert any(f and f != "" for f in files_reported), (
        f"expected current_file to be populated in progress events; got {files_reported}"
    )
    # bytes_done should be monotonically non-decreasing across running events.
    running_bytes = [
        p["bytes_done"] for p in seen if p.get("state") == "running"
    ]
    assert running_bytes == sorted(running_bytes), (
        f"bytes_done regressed during download: {running_bytes}"
    )


@pytest.mark.anyio
async def test_bytes_total_reflects_real_file_sizes_from_model_info(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HF_HOME", str(tmp_path / "hf-cache"))
    manager = ModelDownloadManager(models_dir=tmp_path)
    siblings = [
        _FakeSibling("a.bin", 1024),
        _FakeSibling("b.bin", 2048),
    ]

    def _write(**kwargs: Any) -> str:
        local_dir = Path(str(kwargs["local_dir"]))
        local_dir.mkdir(parents=True, exist_ok=True)
        target = local_dir / str(kwargs["filename"])
        size_map = {s.rfilename: s.size for s in siblings}
        target.write_bytes(b"y" * size_map[str(kwargs["filename"])])
        return str(target)

    _install_hf_stubs(
        monkeypatch, siblings=siblings, download_side_effect=_write
    )
    job_id = await manager.start_download("HeartMuLa/HeartMuLaGen")

    queue = manager._job_events[job_id]  # noqa: SLF001
    payloads: list[dict[str, Any]] = []
    while True:
        payload = await asyncio.wait_for(queue.get(), timeout=3.0)
        payloads.append(payload)
        if (
            manager.get_job(job_id)["state"]
            in {"completed", "failed", "cancelled"}
            and queue.empty()
        ):
            break

    running = [p for p in payloads if p.get("state") == "running"]
    assert running, "no running-state progress payloads observed"
    # Once siblings are known, bytes_total must equal sum(sizes) = 3072.
    assert any(p["bytes_total"] == 3072 for p in running), (
        f"bytes_total never reached real per-file sum 3072. payloads={running}"
    )


@pytest.mark.anyio
async def test_gated_repo_error_yields_AUTH_REQUIRED_error_code(  # noqa: N802
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HF_HOME", str(tmp_path / "hf-cache"))
    manager = ModelDownloadManager(models_dir=tmp_path)

    class FakeGatedRepoError(Exception):
        pass

    # Monkey-patch the manager's view of GatedRepoError so the check picks
    # up our fake; this isolates the test from huggingface_hub version drift.
    from audiomorph.models import manager as mod

    monkeypatch.setattr(
        mod, "GatedRepoError", FakeGatedRepoError, raising=False
    )

    siblings = [_FakeSibling("config.json", 10)]
    _install_hf_stubs(
        monkeypatch,
        siblings=siblings,
        download_side_effect=FakeGatedRepoError("403 gated"),
    )

    job_id = await manager.start_download("HeartMuLa/HeartMuLaGen")
    job = await _wait_for_terminal(manager, job_id)
    assert job["state"] == "failed"
    assert job.get("error_code") == "AUTH_REQUIRED"


@pytest.mark.anyio
async def test_http_401_from_model_info_is_AUTH_REQUIRED(  # noqa: N802
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HF_HOME", str(tmp_path / "hf-cache"))
    manager = ModelDownloadManager(models_dir=tmp_path)

    class FakeHfHubHTTPError(Exception):
        def __init__(self) -> None:
            super().__init__("401 Unauthorized")

            class _Resp:
                status_code = 401

            self.response = _Resp()

    from audiomorph.models import manager as mod

    monkeypatch.setattr(
        mod, "HfHubHTTPError", FakeHfHubHTTPError, raising=False
    )

    _install_hf_stubs(
        monkeypatch,
        siblings=[],
        download_side_effect=lambda **_: "",
        model_info_side_effect=FakeHfHubHTTPError(),
    )

    job_id = await manager.start_download("HeartMuLa/HeartMuLaGen")
    job = await _wait_for_terminal(manager, job_id)
    assert job["state"] == "failed"
    assert job.get("error_code") == "AUTH_REQUIRED"


@pytest.mark.anyio
async def test_intra_file_progress_polls_incomplete_during_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HF_HOME", str(tmp_path / "hf-cache"))
    manager = ModelDownloadManager(models_dir=tmp_path)
    siblings = [_FakeSibling("big.bin", 4000)]

    def _slow_grow(**kwargs: Any) -> str:
        local_dir = Path(str(kwargs["local_dir"]))
        local_dir.mkdir(parents=True, exist_ok=True)
        incomplete_dir = local_dir / ".cache" / "huggingface" / "download"
        incomplete_dir.mkdir(parents=True, exist_ok=True)
        partial = incomplete_dir / "big.bin.incomplete"
        partial.write_bytes(b"")
        for _ in range(4):
            with partial.open("ab") as f:
                f.write(b"x" * 1000)
            time.sleep(0.6)
        partial.unlink()
        final = local_dir / "big.bin"
        final.write_bytes(b"x" * 4000)
        return str(final)

    _install_hf_stubs(
        monkeypatch, siblings=siblings, download_side_effect=_slow_grow
    )

    job_id = await manager.start_download("HeartMuLa/HeartMuLaGen")

    queue = manager._job_events[job_id]  # noqa: SLF001
    seen: list[dict[str, Any]] = []
    while True:
        payload = await asyncio.wait_for(queue.get(), timeout=10.0)
        seen.append(payload)
        if (
            manager.get_job(job_id)["state"]
            in {"completed", "failed", "cancelled"}
            and queue.empty()
        ):
            break

    intra_file = [
        p
        for p in seen
        if p.get("current_file") == "big.bin"
        and p.get("state") == "running"
        and p["bytes_done"] > 0
    ]
    distinct_progress = sorted({p["bytes_done"] for p in intra_file})
    assert len(distinct_progress) >= 2, (
        f"expected at least 2 distinct intra-file progress samples for big.bin; "
        f"got bytes_done values={distinct_progress}; all payloads={seen}"
    )
