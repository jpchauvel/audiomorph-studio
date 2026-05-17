from __future__ import annotations

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false
import asyncio
from collections.abc import Callable
import os
from pathlib import Path
from typing import Any

from audiomorph._errors import ApiError
from audiomorph._logging import get_logger
from audiomorph.schemas import LyricsResult, LyricsSegment

MAX_AUDIO_BYTES = 50 * 1024 * 1024
SUPPORTED_EXTS = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}
MAX_DURATION_SECONDS = 600


def _api_error(
    *, code: str, message: str, retriable: bool, hint: str | None = None
) -> ApiError:
    return ApiError(
        code=code, message=message, retriable=retriable, hint=hint
    )


class TranscriptionEngine:
    def __init__(self) -> None:
        self._logger = get_logger("audiomorph.lyrics")
        self._transcription_lock = asyncio.Lock()
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._pipe: Any | None = None

    def get_cancel_event(self, job_id: str) -> asyncio.Event:
        evt = self._cancel_events.get(job_id)
        if evt is None:
            evt = asyncio.Event()
            self._cancel_events[job_id] = evt
        return evt

    def cancel(self, job_id: str) -> bool:
        self.get_cancel_event(job_id).set()
        return True

    def _validate(self, audio_path: str) -> Path:
        p = Path(audio_path)
        if not p.exists() or not p.is_file():
            raise _api_error(
                code="VALIDATION_ERROR",
                message=f"Audio file not found: {audio_path}",
                retriable=False,
            )
        if p.suffix.lower() not in SUPPORTED_EXTS:
            raise _api_error(
                code="VALIDATION_ERROR",
                message=f"Unsupported audio format: {p.suffix}",
                retriable=False,
                hint=f"Supported: {sorted(SUPPORTED_EXTS)}",
            )
        size = p.stat().st_size
        if size > MAX_AUDIO_BYTES:
            raise _api_error(
                code="VALIDATION_ERROR",
                message=f"Audio file exceeds {MAX_AUDIO_BYTES} bytes",
                retriable=False,
                hint="Trim audio to <= 50MB",
            )
        if p.suffix.lower() == ".wav":
            self._validate_wav_duration(p)
        return p

    def _validate_wav_duration(self, p: Path) -> None:
        import wave

        try:
            with wave.open(str(p), "rb") as wf:
                frames = wf.getnframes()
                rate = wf.getframerate() or 1
                duration = frames / float(rate)
        except Exception:
            return
        if duration > MAX_DURATION_SECONDS:
            raise _api_error(
                code="VALIDATION_ERROR",
                message=f"Audio duration exceeds {MAX_DURATION_SECONDS}s",
                retriable=False,
            )

    def _pick_device(self) -> tuple[Any, Any, Any]:
        import torch

        if (
            getattr(torch.backends, "mps", None)
            and torch.backends.mps.is_available()
        ):
            return torch.device("mps"), torch.float16, torch
        if torch.cuda.is_available():
            return torch.device("cuda"), torch.float16, torch
        if os.environ.get("AUDIOMORPH_REQUIRE_GPU") == "1":
            raise _api_error(
                code="GPU_UNAVAILABLE",
                message="GPU is required but unavailable",
                retriable=True,
                hint="Disable AUDIOMORPH_REQUIRE_GPU or enable CUDA/MPS",
            )
        return torch.device("cpu"), torch.float32, torch

    def _ensure_pipeline(
        self, model_root: Path, device: Any, dtype: Any
    ) -> Any:
        if self._pipe is not None:
            return self._pipe
        from heartlib import HeartTranscriptorPipeline

        self._pipe = HeartTranscriptorPipeline.from_pretrained(
            pretrained_path=str(model_root),
            device=device,
            dtype=dtype,
        )
        return self._pipe

    def _normalize_result(self, raw: Any) -> LyricsResult:
        if isinstance(raw, dict):
            text = str(raw.get("text", "")).strip()
            chunks = raw.get("chunks") or []
            segments: list[LyricsSegment] = []
            for c in chunks:
                ts = c.get("timestamp") if isinstance(c, dict) else None
                if not ts or len(ts) < 2:
                    continue
                start = float(ts[0] or 0.0)
                end = float(ts[1] or start)
                segments.append(
                    LyricsSegment(
                        start=int(start * 1000),
                        end=int(end * 1000),
                        text=str(c.get("text", "")).strip(),
                    )
                )
            return LyricsResult(text=text, segments=segments or None)
        return LyricsResult(text=str(raw).strip(), segments=None)

    async def transcribe(
        self,
        audio_path: str,
        job_id: str,
        progress_cb: Callable[[dict[str, Any]], None],
    ) -> LyricsResult:
        if self._transcription_lock.locked():
            raise _api_error(
                code="VALIDATION_ERROR",
                message="A transcription is already in progress",
                retriable=True,
                hint="Wait for current job to finish",
            )

        validated = self._validate(audio_path)
        cancel_event = self.get_cancel_event(job_id)

        def progress(step: int, total: int, eta_s: float, phase: str) -> None:
            if cancel_event.is_set():
                raise _api_error(
                    code="CANCELLED",
                    message="Transcription cancelled",
                    retriable=False,
                )
            progress_cb(
                {
                    "step": step,
                    "total_steps": total,
                    "eta_s": eta_s,
                    "phase": phase,
                }
            )

        async with self._transcription_lock:
            from audiomorph.models import get_manager

            device, dtype, _torch = self._pick_device()
            model_root = get_manager().pipeline_path("transcription")

            progress(1, 3, 2.0, "loading")
            pipe = self._ensure_pipeline(model_root, device, dtype)

            def _invoke() -> Any:
                return pipe(
                    str(validated),
                    max_new_tokens=256,
                    num_beams=2,
                    task="transcribe",
                    condition_on_prev_tokens=False,
                    compression_ratio_threshold=1.8,
                    temperature=(0.0, 0.1, 0.2, 0.4),
                    logprob_threshold=-1.0,
                    no_speech_threshold=0.4,
                )

            progress(2, 3, 5.0, "transcribing")
            try:
                raw = await asyncio.to_thread(_invoke)
            except asyncio.CancelledError:
                raise

            if cancel_event.is_set():
                raise _api_error(
                    code="CANCELLED",
                    message="Transcription cancelled",
                    retriable=False,
                )

            progress(3, 3, 0.0, "finalizing")
            return self._normalize_result(raw)


_engine_instance: TranscriptionEngine | None = None


def get_engine() -> TranscriptionEngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = TranscriptionEngine()
    return _engine_instance
