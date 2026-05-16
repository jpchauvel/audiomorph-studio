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
    from huggingface_hub import HfApi, snapshot_download
except Exception:  # pragma: no cover - optional at test-runtime

    class HfApi:  # type: ignore[no-redef]
        def model_info(self, *args: Any, **kwargs: Any) -> Any:
            _ = (args, kwargs)
            raise RuntimeError(
                "huggingface_hub is required for model metadata"
            )

    def snapshot_download(**_: Any) -> str:
        raise RuntimeError("huggingface_hub is required for downloads")


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


class ModelDownloadManager:
    REQUIRED_MODELS: list[dict[str, Any]] = [
        {
            "id": "HeartMuLa/HeartMuLaGen",
            "name": "HeartMuLaGen",
            "size_gb": 4,
            "bytes_total": 4 * 1024 * 1024 * 1024,
        },
        {
            "id": "HeartMuLa/HeartMuLa-oss-3B-happy-new-year",
            "name": "HeartMuLa-oss-3B-happy-new-year",
            "size_gb": 3,
            "bytes_total": 3 * 1024 * 1024 * 1024,
        },
        {
            "id": "HeartMuLa/HeartCodec-oss-20260123",
            "name": "HeartCodec-oss-20260123",
            "size_gb": 1,
            "bytes_total": 1 * 1024 * 1024 * 1024,
        },
    ]

    def __init__(self, models_dir: Path | None = None) -> None:
        self._logger = get_logger("audiomorph.models")
        self._models_dir = (models_dir or get_models_dir()).resolve()
        self._models_dir.mkdir(parents=True, exist_ok=True)
        self._api = HfApi()
        self._download_lock = asyncio.Lock()
        self._hash_pool = ThreadPoolExecutor(max_workers=4)
        self._jobs: dict[str, dict[str, Any]] = {}
        self._job_tasks: dict[str, asyncio.Task[None]] = {}
        self._job_events: dict[str, asyncio.Queue[dict[str, Any]]] = {}
        self._model_states: dict[str, str] = {}

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

    async def start_download(self, model_id: str) -> str:
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
        payload = {
            "bytes_done": status["bytes_done"],
            "bytes_total": status["bytes_total"],
            "current_file": current_file,
            "speed_mbps": round(speed_mbps, 3),
            "state": job["state"],
        }
        self._job_events[job_id].put_nowait(payload)

    async def _run_download(self, job_id: str) -> None:
        job = self._jobs[job_id]
        model_id = str(job["model_id"])
        model_dir = self.model_path(model_id)

        async with self._download_lock:
            if job["cancel_requested"]:
                return

            model_dir.mkdir(parents=True, exist_ok=True)
            job["state"] = "running"
            job["updated_at"] = time.time()
            self._model_states[model_id] = "partial"
            self._emit_progress(job_id, current_file=None, speed_mbps=0.0)

            token = os.environ.get("HF_TOKEN") or None

            kwargs: dict[str, Any] = {
                "repo_id": model_id,
                "local_dir": str(model_dir),
                "resume_download": True,
                "max_workers": 4,
                "etag_timeout": 30,
                "token": token,
            }

            task = asyncio.create_task(
                asyncio.to_thread(snapshot_download, **kwargs)
            )
            last_bytes = self._bytes_done(model_dir)
            last_ts = time.monotonic()

            try:
                while not task.done():
                    await asyncio.sleep(0.15)
                    now = time.monotonic()
                    done = self._bytes_done(model_dir)
                    delta_bytes = max(0, done - last_bytes)
                    delta_t = max(1e-6, now - last_ts)
                    speed_mbps = (delta_bytes / (1024 * 1024)) / delta_t
                    self._emit_progress(
                        job_id, current_file=None, speed_mbps=speed_mbps
                    )
                    last_bytes = done
                    last_ts = now

                await task

                if job["cancel_requested"]:
                    job["state"] = "cancelled"
                    self._model_states[model_id] = "partial"
                else:
                    job["state"] = "completed"
                    self._model_states[model_id] = "partial"
                job["updated_at"] = time.time()
                self._emit_progress(job_id, current_file=None, speed_mbps=0.0)
            except Exception as exc:
                self._logger.error(
                    "model_download_failed",
                    model_id=model_id,
                    job_id=job_id,
                    error=str(exc),
                )
                job["state"] = "failed"
                job["error"] = str(exc)
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
