from __future__ import annotations

# pyright: reportMissingImports=false, reportMissingTypeStubs=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false
import asyncio
import contextlib
from datetime import UTC, datetime
import gc
import os
from pathlib import Path
from typing import Any

from audiomorph._errors import ApiError
from audiomorph._logging import get_logger
from audiomorph.paths import get_jobs_dir
from audiomorph.schemas import GenerationRequest, GenerationResult


def _api_error(
    *, code: str, message: str, retriable: bool, hint: str | None = None
) -> ApiError:
    return ApiError(
        code=code, message=message, retriable=retriable, hint=hint
    )


class GenerationEngine:
    def __init__(self) -> None:
        self._logger = get_logger("audiomorph.generation")
        self._generation_lock = asyncio.Lock()
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._pipe: Any | None = None

    def get_cancel_event(self, job_id: str) -> asyncio.Event:
        evt = self._cancel_events.get(job_id)
        if evt is None:
            evt = asyncio.Event()
            self._cancel_events[job_id] = evt
        return evt

    def cancel(self, job_id: str) -> bool:
        evt = self.get_cancel_event(job_id)
        evt.set()
        return True

    def _validate(self, req: GenerationRequest) -> None:
        if len(req.prompt) > 2000:
            raise _api_error(
                code="VALIDATION_ERROR",
                message="prompt exceeds 2000 chars",
                retriable=False,
            )
        if len(req.lyrics) > 4000:
            raise _api_error(
                code="VALIDATION_ERROR",
                message="lyrics exceeds 4000 chars",
                retriable=False,
            )
        if req.duration_seconds > 240:
            raise _api_error(
                code="VALIDATION_ERROR",
                message="duration_seconds exceeds 240",
                retriable=False,
            )
        if req.seed < -2147483648 or req.seed > 2147483647:
            raise _api_error(
                code="VALIDATION_ERROR",
                message="seed out of int32 range",
                retriable=False,
            )

    def _resolve_model_root(self, model_id: str) -> Path:
        # Priority 3: canonical HeartMuLaGen routes through composed pipeline
        # (multi-repo layout); any other id resolves to its per-id dir under
        # AUDIOMORPH_DATA_DIR/models — preserves original MODEL_NOT_FOUND
        # semantics for unknown ids (tests + engineering tools rely on this).
        from audiomorph.paths import get_models_dir

        if model_id == "HeartMuLa/HeartMuLaGen":
            from audiomorph.models import get_manager

            model_root = get_manager().pipeline_path("generation")
        else:
            model_root = get_models_dir() / model_id
        if not model_root.exists() or not model_root.is_dir():
            raise _api_error(
                code="MODEL_NOT_FOUND",
                message=f"Model not found: {model_id}",
                retriable=False,
                hint="Download and verify model first",
            )
        return model_root

    def _pick_device(self) -> tuple[dict[str, Any], dict[str, Any], Any]:
        import torch

        if (
            getattr(torch.backends, "mps", None)
            and torch.backends.mps.is_available()
        ):
            device = {
                "mula": torch.device("mps"),
                "codec": torch.device("mps"),
            }
            dtype = {"mula": torch.bfloat16, "codec": torch.float32}
            return device, dtype, torch
        if torch.cuda.is_available():
            device = {
                "mula": torch.device("cuda"),
                "codec": torch.device("cuda"),
            }
            dtype = {"mula": torch.bfloat16, "codec": torch.float32}
            return device, dtype, torch

        if os.environ.get("AUDIOMORPH_REQUIRE_GPU") == "1":
            raise _api_error(
                code="GPU_UNAVAILABLE",
                message="GPU is required but unavailable",
                retriable=True,
                hint="Disable AUDIOMORPH_REQUIRE_GPU or enable CUDA/MPS",
            )

        device = {"mula": torch.device("cpu"), "codec": torch.device("cpu")}
        dtype = {"mula": torch.float32, "codec": torch.float32}
        return device, dtype, torch

    def _unload_pipeline(self, torch_mod: Any) -> None:
        self._pipe = None
        gc.collect()

        with contextlib.suppress(Exception):
            if torch_mod.cuda.is_available():
                torch_mod.cuda.empty_cache()

        with contextlib.suppress(Exception):
            mps_backend = getattr(torch_mod.backends, "mps", None)
            if mps_backend and mps_backend.is_available():
                mps_mod = getattr(torch_mod, "mps", None)
                empty_cache = getattr(mps_mod, "empty_cache", None)
                if callable(empty_cache):
                    empty_cache()

    async def _ensure_pipeline(
        self,
        model_id: str,
        model_root: Path,
        device: dict[str, Any],
        dtype: dict[str, Any],
        torch_mod: Any,
    ) -> Any:
        from audiomorph.models import get_registry
        from heartlib import HeartMuLaGenPipeline

        def _loader() -> Any:
            if self._pipe is not None:
                return self._pipe

            self._pipe = HeartMuLaGenPipeline.from_pretrained(
                pretrained_path=str(model_root),
                device=device,
                dtype=dtype,
                version="3B",
                lazy_load=True,
            )
            return self._pipe

        def _unloader() -> None:
            self._unload_pipeline(torch_mod)

        return await get_registry().acquire(
            kind="generation",
            model_id=model_id,
            loader=_loader,
            unloader=_unloader,
        )

    def _cleanup_after_cancel(self, output_path: Path) -> None:
        if output_path.exists():
            output_path.unlink()

    def _recover_oom(self, torch_mod: Any) -> None:
        with contextlib.suppress(Exception):
            if torch_mod.cuda.is_available():
                torch_mod.cuda.empty_cache()
        gc.collect()

    async def generate(
        self, req: GenerationRequest, job_id: str, progress_cb: Any
    ) -> GenerationResult:
        if self._generation_lock.locked():
            raise GenerationBusyError(
                code="VALIDATION_ERROR",
                message="A generation is already in progress",
                hint="Wait for current job to finish",
                retriable=True,
            )

        self._validate(req)
        model_root = self._resolve_model_root(req.model_id)
        job_dir = get_jobs_dir() / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        output_path = job_dir / "audio.wav"
        cancel_event = self.get_cancel_event(job_id)

        def progress(
            step: int, total_steps: int, eta_s: float, phase: str
        ) -> None:
            if cancel_event.is_set():
                raise _api_error(
                    code="CANCELLED",
                    message="Generation cancelled",
                    retriable=False,
                )
            progress_cb(
                {
                    "step": step,
                    "total_steps": total_steps,
                    "eta_s": eta_s,
                    "phase": phase,
                }
            )

        async with self._generation_lock:
            device, dtype, torch = self._pick_device()

            torch.manual_seed(req.seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(req.seed)

            progress(1, 4, 2.0, "loading")
            pipe = await self._ensure_pipeline(
                req.model_id,
                model_root,
                device,
                dtype,
                torch,
            )

            force_oom = os.environ.get("AUDIOMORPH_FORCE_OOM") == "1"

            def _invoke(duration_s: float) -> None:
                if force_oom:
                    raise torch.cuda.OutOfMemoryError("forced oom")
                with torch.inference_mode():
                    pipe(
                        {"lyrics": req.lyrics, "tags": req.prompt},
                        max_audio_length_ms=int(duration_s * 1000),
                        topk=50,
                        temperature=1.0,
                        cfg_scale=1.5,
                        save_path=str(output_path),
                    )

            try:
                progress(
                    2, 4, max(0.1, float(req.duration_seconds)), "generating"
                )
                await asyncio.to_thread(_invoke, req.duration_seconds)
            except asyncio.CancelledError:
                self._cleanup_after_cancel(output_path)
                raise
            except Exception as exc:
                is_oom = isinstance(exc, torch.cuda.OutOfMemoryError) or (
                    isinstance(exc, RuntimeError)
                    and "out of memory" in str(exc).lower()
                )
                if not is_oom:
                    self._cleanup_after_cancel(output_path)
                    raise

                self._recover_oom(torch)
                try:
                    await asyncio.to_thread(
                        _invoke, max(1.0, req.duration_seconds / 2)
                    )
                except Exception as exc2:
                    is_oom_2 = isinstance(
                        exc2, torch.cuda.OutOfMemoryError
                    ) or (
                        isinstance(exc2, RuntimeError)
                        and "out of memory" in str(exc2).lower()
                    )
                    if is_oom_2:
                        self._recover_oom(torch)
                        self._cleanup_after_cancel(output_path)
                        raise _api_error(
                            code="OUT_OF_MEMORY",
                            message="Generation failed due to memory pressure",
                            retriable=True,
                            hint="Try shorter duration or close other GPU apps",
                        )
                    self._cleanup_after_cancel(output_path)
                    raise

            if cancel_event.is_set():
                self._cleanup_after_cancel(output_path)
                raise _api_error(
                    code="CANCELLED",
                    message="Generation cancelled",
                    retriable=False,
                )

            if not output_path.exists():
                raise _api_error(
                    code="INTERNAL_ERROR",
                    message="Generation did not produce output",
                    retriable=False,
                )

            progress(3, 4, 0.2, "encoding")
            progress(4, 4, 0.0, "finalizing")

            created_at = datetime.now(tz=UTC).isoformat()
            return GenerationResult(
                job_id=job_id,
                file_path=str(output_path),
                duration_seconds=req.duration_seconds,
                model_id=req.model_id,
                seed=req.seed,
                prompt=req.prompt,
                lyrics=req.lyrics,
                created_at=created_at,
            )


class GenerationBusyError(ApiError):
    @property
    def status_code(self) -> int:
        return 429


_engine_instance: GenerationEngine | None = None


def get_engine() -> GenerationEngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = GenerationEngine()
    return _engine_instance
