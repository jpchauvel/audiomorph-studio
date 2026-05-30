from __future__ import annotations

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false, reportCallIssue=false
import asyncio
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import re
import shutil
import time
from typing import Any
from uuid import uuid4

try:
    from huggingface_hub import HfApi, hf_hub_download, snapshot_download
except Exception:  # pragma: no cover - optional at test-runtime

    class HfApi:  # type: ignore[no-redef]
        def model_info(self, *args: Any, **kwargs: Any) -> Any:
            _ = (args, kwargs)
            raise RuntimeError(
                "huggingface_hub is required for model metadata"
            )

    def hf_hub_download(**_: Any) -> str:
        raise RuntimeError("huggingface_hub is required for downloads")

    def snapshot_download(**_: Any) -> str:
        raise RuntimeError("huggingface_hub is required for downloads")


try:
    from huggingface_hub.errors import (
        GatedRepoError,
        HfHubHTTPError,
        RepositoryNotFoundError,
    )
except Exception:  # pragma: no cover

    class GatedRepoError(Exception):  # type: ignore[no-redef]
        pass

    class HfHubHTTPError(Exception):  # type: ignore[no-redef]
        pass

    class RepositoryNotFoundError(Exception):  # type: ignore[no-redef]
        pass


from audiomorph._errors import ApiError
from audiomorph._logging import get_logger
from audiomorph.paths import get_models_dir

_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9_/-]+$")


def _api_error(
    *, code: str, message: str, retriable: bool, hint: str | None = None
) -> Exception:
    return ApiError(
        code=code, message=message, retriable=retriable, hint=hint
    )


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


_GEN_COMPOSED_ID = "HeartMuLa/HeartMuLaGen"
_GEN_3B_REPO = "HeartMuLa/HeartMuLa-oss-3B-happy-new-year"
_GEN_CODEC_REPO = "HeartMuLa/HeartCodec-oss-20260123"
_TRANSCRIPTOR_REPO = "HeartMuLa/HeartTranscriptor-oss"

# Priority 1: Documents the composed-layout contract required by
# heartlib's HeartMuLaGenPipeline.from_pretrained (see
# docs/heartlib-api-surface.md:220-260). Each tuple is
# (source-repo-id, subdir-name-inside-composed-root | None for flat).
_GEN_COMPOSITION: tuple[tuple[str, str | None], ...] = (
    (_GEN_COMPOSED_ID, None),
    (_GEN_3B_REPO, "HeartMuLa-oss-3B"),
    (_GEN_CODEC_REPO, "HeartCodec-oss"),
)


class ModelDownloadManager:
    REQUIRED_MODELS: list[dict[str, Any]] = [
        {
            "id": _GEN_COMPOSED_ID,
            "name": "HeartMuLaGen",
            "size_gb": 4,
            "bytes_total": 4 * 1024 * 1024 * 1024,
        },
        {
            "id": _GEN_3B_REPO,
            "name": "HeartMuLa-oss-3B-happy-new-year",
            "size_gb": 3,
            "bytes_total": 3 * 1024 * 1024 * 1024,
        },
        {
            "id": _GEN_CODEC_REPO,
            "name": "HeartCodec-oss-20260123",
            "size_gb": 1,
            "bytes_total": 1 * 1024 * 1024 * 1024,
        },
        {
            "id": _TRANSCRIPTOR_REPO,
            "name": "HeartTranscriptor-oss",
            "size_gb": 1,
            "bytes_total": 1 * 1024 * 1024 * 1024,
        },
    ]

    def __init__(self, models_dir: Path | None = None) -> None:
        self._logger = get_logger("audiomorph.models")
        self._models_dir = (models_dir or get_models_dir()).resolve()
        self._models_dir.mkdir(parents=True, exist_ok=True)
        self._composed_dir = (self._models_dir / "_composed").resolve()
        self._api = HfApi()
        self._download_lock = asyncio.Lock()
        self._hash_pool = ThreadPoolExecutor(max_workers=4)
        self._jobs: dict[str, dict[str, Any]] = {}
        self._job_tasks: dict[str, asyncio.Task[None]] = {}
        self._job_events: dict[str, asyncio.Queue[dict[str, Any]]] = {}
        self._model_states: dict[str, str] = {}
        # Priority 2: Adopt pre-downloaded HF cache so users with warmed
        # ~/.cache/huggingface/hub don't re-download multi-GB weights.
        self._adopt_hf_cache()
        self._compose_generation_pipeline()

    def list_required_models(self) -> list[dict[str, Any]]:
        return [dict(m) for m in self.REQUIRED_MODELS]

    def _required_model(self, model_id: str) -> dict[str, Any]:
        for model in self.REQUIRED_MODELS:
            if model["id"] == model_id:
                return model
        raise _api_error(
            code="MODEL_NOT_FOUND",
            message=f"Unknown model: {model_id}",
            retriable=False,
            hint="Use GET /models to list required model IDs",
        )

    def normalize_and_validate_model_id(self, model_id: str) -> str:
        normalized = model_id.replace("__", "/")
        if ".." in normalized or not _MODEL_ID_RE.fullmatch(normalized):
            raise _api_error(
                code="VALIDATION_ERROR",
                message="Invalid model id",
                retriable=False,
                hint="model_id must match [A-Za-z0-9_/-] and not contain '..'",
            )
        self._required_model(normalized)
        return normalized

    def model_path(self, model_id: str) -> Path:
        safe = self.normalize_and_validate_model_id(model_id)
        path = (self._models_dir / safe).resolve()
        if self._models_dir not in path.parents and path != self._models_dir:
            raise _api_error(
                code="VALIDATION_ERROR",
                message="Invalid model path",
                retriable=False,
                hint="Path traversal is not allowed",
            )
        return path

    def _relative_files(self, model_dir: Path) -> list[str]:
        if not model_dir.exists():
            return []
        files: list[str] = []
        for p in model_dir.rglob("*"):
            if p.is_file():
                files.append(str(p.relative_to(model_dir)))
        return sorted(files)

    def _bytes_done(self, model_dir: Path) -> int:
        if not model_dir.exists():
            return 0
        total = 0
        for p in model_dir.rglob("*"):
            if p.is_file():
                total += p.stat().st_size
        return total

    def get_status(self, model_id: str) -> dict[str, Any]:
        safe = self.normalize_and_validate_model_id(model_id)
        model = self._required_model(safe)
        model_dir = self.model_path(safe)
        files = self._relative_files(model_dir)
        bytes_done = self._bytes_done(model_dir)
        bytes_total = int(model["bytes_total"])

        state = self._model_states.get(safe)
        if not model_dir.exists() or not files:
            state = "missing"
        elif state not in {"verified", "corrupted"}:
            state = "partial"

        return {
            "state": state,
            "bytes_done": bytes_done,
            "bytes_total": bytes_total,
            "files": files,
        }

    def get_job(self, job_id: str) -> dict[str, Any]:
        job = self._jobs.get(job_id)
        if not job:
            raise _api_error(
                code="JOB_NOT_FOUND",
                message=f"Unknown job: {job_id}",
                retriable=False,
            )
        return dict(job)

    def _required_bytes_with_headroom(self, model_id: str) -> int:
        model = self._required_model(model_id)
        return int(float(model["bytes_total"]) * 1.2)

    def composed_generation_path(self) -> Path:
        return (self._composed_dir / "HeartMuLaGen").resolve()

    def pipeline_path(self, kind: str) -> Path:
        if kind == "generation":
            return self.composed_generation_path()
        if kind == "transcription":
            return self.model_path(_TRANSCRIPTOR_REPO)
        raise _api_error(
            code="VALIDATION_ERROR",
            message=f"Unknown pipeline kind: {kind}",
            retriable=False,
        )

    def _hf_cache_snapshot(self, repo_id: str) -> Path | None:
        hub = Path(
            os.environ.get("HF_HOME")
            or os.environ.get("HUGGINGFACE_HUB_CACHE")
            or (Path.home() / ".cache" / "huggingface")
        )
        if hub.name != "hub":
            hub = hub / "hub"
        repo_dir = hub / f"models--{repo_id.replace('/', '--')}"
        snapshots = repo_dir / "snapshots"
        if not snapshots.is_dir():
            return None
        revs = [p for p in snapshots.iterdir() if p.is_dir()]
        if not revs:
            return None
        return max(revs, key=lambda p: p.stat().st_mtime)

    def _link_or_copy(self, src: Path, dst: Path) -> None:
        if dst.exists() or dst.is_symlink():
            return
        dst.parent.mkdir(parents=True, exist_ok=True)
        resolved = src.resolve()
        try:
            dst.symlink_to(resolved)
        except (OSError, NotImplementedError):
            shutil.copy2(resolved, dst)

    def _populate_from_snapshot(self, snapshot: Path, dest: Path) -> int:
        copied = 0
        for entry in snapshot.rglob("*"):
            if not entry.is_file():
                continue
            rel = entry.relative_to(snapshot)
            target = dest / rel
            if target.exists() or target.is_symlink():
                continue
            self._link_or_copy(entry, target)
            copied += 1
        return copied

    def _adopt_hf_cache(self) -> None:
        for model in self.REQUIRED_MODELS:
            repo_id = str(model["id"])
            dest = self._models_dir / repo_id
            if dest.exists() and any(dest.rglob("*")):
                continue
            snapshot = self._hf_cache_snapshot(repo_id)
            if snapshot is None:
                continue
            copied = self._populate_from_snapshot(snapshot, dest)
            if copied > 0:
                self._logger.info(
                    "hf_cache_adopted",
                    model_id=repo_id,
                    files=copied,
                )

    def _compose_generation_pipeline(self) -> None:
        composed = self.composed_generation_path()
        for repo_id, subdir in _GEN_COMPOSITION:
            source = self._models_dir / repo_id
            if not source.exists():
                continue
            target = composed if subdir is None else composed / subdir
            self._populate_from_snapshot(source, target)

    def _disk_free_bytes(self) -> int:
        return int(shutil.disk_usage(self._models_dir).free)

    def _assert_disk_space(self, model_id: str) -> None:
        needed = self._required_bytes_with_headroom(model_id)
        free = self._disk_free_bytes()
        if free < needed:
            need_gb = needed / (1024**3)
            raise _api_error(
                code="DOWNLOAD_FAILED",
                message="Insufficient disk space",
                retriable=True,
                hint=f"Need {need_gb:.2f} GB free",
            )

    async def start_download(
        self, model_id: str, hf_token: str | None = None
    ) -> str:
        safe = self.normalize_and_validate_model_id(model_id)
        self._assert_disk_space(safe)

        for job in self._jobs.values():
            if job["model_id"] == safe and job["state"] in {
                "queued",
                "running",
            }:
                raise _api_error(
                    code="DOWNLOAD_FAILED",
                    message="Download already in progress for model",
                    retriable=False,
                )

        job_id = str(uuid4())
        now = time.time()
        job = {
            "job_id": job_id,
            "model_id": safe,
            "state": "queued",
            "cancel_requested": False,
            "created_at": now,
            "updated_at": now,
            "error": None,
            "error_code": None,
            "hf_token": hf_token,
            "bytes_total_override": None,
            "current_file": None,
        }
        self._jobs[job_id] = job
        self._job_events[job_id] = asyncio.Queue()
        self._emit_progress(job_id, current_file=None, speed_mbps=0.0)
        self._job_tasks[job_id] = asyncio.create_task(
            self._run_download(job_id)
        )
        return job_id

    async def cancel_download(self, job_id: str) -> dict[str, Any]:
        if job_id not in self._jobs:
            raise _api_error(
                code="JOB_NOT_FOUND",
                message=f"Unknown job: {job_id}",
                retriable=False,
            )

        job = self._jobs[job_id]
        job["cancel_requested"] = True
        job["state"] = "cancelled"
        job["updated_at"] = time.time()
        self._model_states[job["model_id"]] = "partial"
        self._emit_progress(job_id, current_file=None, speed_mbps=0.0)
        return {"job_id": job_id, "state": "cancelled"}

    async def delete(self, model_id: str) -> None:
        safe = self.normalize_and_validate_model_id(model_id)
        model_dir = self.model_path(safe)
        if model_dir.exists():
            shutil.rmtree(model_dir)
        self._model_states.pop(safe, None)

    async def verify(self, model_id: str) -> dict[str, Any]:
        safe = self.normalize_and_validate_model_id(model_id)
        model_dir = self.model_path(safe)
        if not model_dir.exists():
            self._model_states[safe] = "missing"
            return {"valid": False, "mismatches": []}

        remote_sha = await self._remote_sha256_map(safe)
        mismatches: list[str] = []
        loop = asyncio.get_running_loop()

        for rel_path, expected_sha in remote_sha.items():
            local_file = model_dir / rel_path
            if not local_file.exists() or not local_file.is_file():
                mismatches.append(rel_path)
                continue
            actual_sha = await loop.run_in_executor(
                self._hash_pool, _sha256_file, local_file
            )
            if actual_sha.lower() != expected_sha.lower():
                mismatches.append(rel_path)

        valid = len(mismatches) == 0
        self._model_states[safe] = "verified" if valid else "corrupted"
        return {"valid": valid, "mismatches": sorted(mismatches)}

    async def _remote_sha256_map(self, model_id: str) -> dict[str, str]:
        info = await asyncio.to_thread(
            self._api.model_info, model_id, files_metadata=True
        )
        hashes: dict[str, str] = {}
        for sibling in getattr(info, "siblings", []) or []:
            rel = getattr(sibling, "rfilename", None)
            if not rel:
                continue
            lfs = getattr(sibling, "lfs", None)
            sha = getattr(lfs, "sha256", None) if lfs is not None else None
            if isinstance(sha, str) and sha:
                hashes[str(rel)] = sha
        return hashes

    def _emit_progress(
        self, job_id: str, current_file: str | None, speed_mbps: float
    ) -> None:
        job = self._jobs[job_id]
        status = self.get_status(job["model_id"])
        override = job.get("bytes_total_override")
        bytes_total = (
            int(override) if override is not None else status["bytes_total"]
        )
        effective_file = current_file if current_file is not None else job.get(
            "current_file"
        )
        if current_file is not None:
            job["current_file"] = current_file
        payload: dict[str, Any] = {
            "bytes_done": status["bytes_done"],
            "bytes_total": bytes_total,
            "current_file": effective_file,
            "speed_mbps": round(speed_mbps, 3),
            "state": job["state"],
        }
        if job.get("error"):
            payload["error"] = job["error"]
        if job.get("error_code"):
            payload["error_code"] = job["error_code"]
        self._job_events[job_id].put_nowait(payload)

    def _classify_hf_error(self, exc: BaseException) -> str | None:
        if isinstance(exc, GatedRepoError):
            return "AUTH_REQUIRED"
        if isinstance(exc, HfHubHTTPError):
            resp = getattr(exc, "response", None)
            status = getattr(resp, "status_code", None)
            if status in (401, 403):
                return "AUTH_REQUIRED"
        if isinstance(exc, RepositoryNotFoundError):
            return "AUTH_REQUIRED"
        msg = str(exc).lower()
        if "401" in msg or "403" in msg or "gated" in msg or "unauthorized" in msg:
            return "AUTH_REQUIRED"
        return None

    async def _run_download(self, job_id: str) -> None:
        job = self._jobs[job_id]
        model_id = str(job["model_id"])
        model_dir = self.model_path(model_id)
        token = job.get("hf_token") or os.environ.get("HF_TOKEN") or None

        async with self._download_lock:
            if job["cancel_requested"]:
                return

            model_dir.mkdir(parents=True, exist_ok=True)
            job["state"] = "running"
            job["updated_at"] = time.time()
            self._model_states[model_id] = "partial"
            self._emit_progress(job_id, current_file=None, speed_mbps=0.0)

            try:
                info = await asyncio.to_thread(
                    self._api.model_info,
                    model_id,
                    files_metadata=True,
                    token=token,
                )
            except Exception as exc:
                self._finalize_failure(job_id, model_id, exc)
                return

            siblings = list(getattr(info, "siblings", []) or [])
            total_bytes = 0
            for sibling in siblings:
                size = getattr(sibling, "size", None)
                if isinstance(size, int) and size > 0:
                    total_bytes += size
            if total_bytes > 0:
                job["bytes_total_override"] = total_bytes
                self._emit_progress(
                    job_id, current_file=None, speed_mbps=0.0
                )

            last_bytes = self._bytes_done(model_dir)
            last_ts = time.monotonic()

            try:
                for sibling in siblings:
                    if job["cancel_requested"]:
                        break
                    rel = getattr(sibling, "rfilename", None)
                    if not rel:
                        continue
                    rel_str = str(rel)
                    job["current_file"] = rel_str
                    self._emit_progress(
                        job_id, current_file=rel_str, speed_mbps=0.0
                    )
                    await asyncio.to_thread(
                        hf_hub_download,
                        repo_id=model_id,
                        filename=rel_str,
                        local_dir=str(model_dir),
                        token=token,
                        etag_timeout=30,
                    )
                    now = time.monotonic()
                    done = self._bytes_done(model_dir)
                    delta_bytes = max(0, done - last_bytes)
                    delta_t = max(1e-6, now - last_ts)
                    speed_mbps = (delta_bytes / (1024 * 1024)) / delta_t
                    self._emit_progress(
                        job_id, current_file=rel_str, speed_mbps=speed_mbps
                    )
                    last_bytes = done
                    last_ts = now

                if job["cancel_requested"]:
                    job["state"] = "cancelled"
                    self._model_states[model_id] = "partial"
                else:
                    job["state"] = "completed"
                    self._model_states[model_id] = "partial"
                    self._compose_generation_pipeline()
                job["updated_at"] = time.time()
                self._emit_progress(job_id, current_file=None, speed_mbps=0.0)
            except Exception as exc:
                self._finalize_failure(job_id, model_id, exc)

    def _finalize_failure(
        self, job_id: str, model_id: str, exc: BaseException
    ) -> None:
        job = self._jobs[job_id]
        self._logger.error(
            "model_download_failed",
            model_id=model_id,
            job_id=job_id,
            error=str(exc),
        )
        job["state"] = "failed"
        job["error"] = str(exc)
        code = self._classify_hf_error(exc)
        if code:
            job["error_code"] = code
        job["updated_at"] = time.time()
        self._model_states[model_id] = "partial"
        self._emit_progress(job_id, current_file=None, speed_mbps=0.0)

    async def stream_job_events(
        self, job_id: str
    ) -> AsyncIterator[dict[str, Any]]:
        if job_id not in self._jobs:
            raise _api_error(
                code="JOB_NOT_FOUND",
                message=f"Unknown job: {job_id}",
                retriable=False,
            )

        queue = self._job_events[job_id]
        terminal = {"completed", "failed", "cancelled"}

        while True:
            payload = await queue.get()
            yield {"event": "progress", "data": payload}
            if self._jobs[job_id]["state"] in terminal and queue.empty():
                break


_manager_singleton: ModelDownloadManager | None = None


def get_manager() -> ModelDownloadManager:
    global _manager_singleton
    if _manager_singleton is None:
        _manager_singleton = ModelDownloadManager()
    return _manager_singleton
