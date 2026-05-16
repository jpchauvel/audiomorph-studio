from __future__ import annotations

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false
import asyncio
import contextlib
from pathlib import Path
import sys
import time
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from audiomorph._errors import ApiError
from audiomorph.schemas import GenerationRequest


def _install_fake_torch(
    monkeypatch: pytest.MonkeyPatch,
    *,
    cuda_available: bool = False,
    mps_available: bool = False,
) -> type[Exception]:
    class FakeOOMError(RuntimeError):
        pass

    @contextlib.contextmanager
    def inference_mode():
        yield

    fake_torch = ModuleType("torch")
    fake_torch.bfloat16 = object()
    fake_torch.float32 = object()
    fake_torch.device = lambda value: SimpleNamespace(
        type=str(value).split(":")[0]
    )
    fake_torch.manual_seed = lambda _seed: None
    fake_torch.inference_mode = inference_mode
    fake_torch.backends = SimpleNamespace(
        mps=SimpleNamespace(is_available=lambda: mps_available)
    )
    fake_torch.cuda = SimpleNamespace(
        is_available=lambda: cuda_available,
        manual_seed_all=lambda _seed: None,
        empty_cache=lambda: None,
        OutOfMemoryError=FakeOOMError,
    )
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    return FakeOOMError


def _install_fake_heartlib(
    monkeypatch: pytest.MonkeyPatch, pipe_factory: Any
) -> None:
    fake_heartlib = ModuleType("heartlib")

    class _Pipeline:
        @classmethod
        def from_pretrained(cls, *args: object, **kwargs: object):
            return pipe_factory(*args, **kwargs)

    fake_heartlib.HeartMuLaGenPipeline = _Pipeline
    monkeypatch.setitem(sys.modules, "heartlib", fake_heartlib)


def _req(**overrides: object) -> GenerationRequest:
    base = {
        "prompt": "warm synth pop",
        "lyrics": "hello world",
        "duration_seconds": 8.0,
        "seed": 123,
        "model_id": "test-model",
    }
    base.update(overrides)
    return GenerationRequest(**base)


@pytest.mark.asyncio
async def test_generation_engine_happy_path_writes_wav_and_returns_result(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from audiomorph.generation.engine import GenerationEngine

    monkeypatch.setenv("AUDIOMORPH_DATA_DIR", str(tmp_path))
    model_dir = tmp_path / "models" / "test-model"
    model_dir.mkdir(parents=True)
    _install_fake_torch(monkeypatch, mps_available=True)

    def pipe_factory(*_args: object, **_kwargs: object):
        class Pipe:
            def __call__(
                self,
                _inputs: dict[str, str],
                *,
                save_path: str,
                **_kw: object,
            ) -> None:
                Path(save_path).write_bytes(b"RIFF....WAVE")

        return Pipe()

    _install_fake_heartlib(monkeypatch, pipe_factory)

    engine = GenerationEngine()
    updates: list[dict[str, object]] = []
    result = await engine.generate(_req(), "job-happy", updates.append)

    out = tmp_path / "jobs" / "job-happy" / "audio.wav"
    assert out.exists()
    assert result.job_id == "job-happy"
    assert result.file_path == str(out)
    assert result.model_id == "test-model"
    assert result.seed == 123
    assert any(u["phase"] == "loading" for u in updates)
    assert any(u["phase"] == "finalizing" for u in updates)


@pytest.mark.asyncio
async def test_generation_engine_validation_rejects_duration_too_long(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from audiomorph.generation.engine import GenerationEngine

    monkeypatch.setenv("AUDIOMORPH_DATA_DIR", str(tmp_path))
    (tmp_path / "models" / "test-model").mkdir(parents=True)
    _install_fake_torch(monkeypatch)
    _install_fake_heartlib(monkeypatch, lambda *_a, **_k: object())

    engine = GenerationEngine()
    with pytest.raises(ApiError) as exc:
        await engine.generate(
            _req(duration_seconds=999.0), "job-too-long", lambda _u: None
        )
    assert exc.value.code == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_generation_engine_cancelled_removes_partial_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from audiomorph.generation.engine import GenerationEngine

    monkeypatch.setenv("AUDIOMORPH_DATA_DIR", str(tmp_path))
    (tmp_path / "models" / "test-model").mkdir(parents=True)
    _install_fake_torch(monkeypatch)

    def pipe_factory(*_args: object, **_kwargs: object):
        class Pipe:
            def __call__(
                self,
                _inputs: dict[str, str],
                *,
                save_path: str,
                **_kw: object,
            ) -> None:
                Path(save_path).write_bytes(b"partial")
                time.sleep(2)

        return Pipe()

    _install_fake_heartlib(monkeypatch, pipe_factory)
    engine = GenerationEngine()
    cancel_event = engine.get_cancel_event("job-cancel")

    async def _cancel_soon() -> None:
        await asyncio.sleep(0.2)
        cancel_event.set()

    canceller = asyncio.create_task(_cancel_soon())
    started = time.monotonic()
    with pytest.raises(ApiError) as exc:
        await engine.generate(_req(), "job-cancel", lambda _u: None)
    elapsed = time.monotonic() - started
    await canceller

    assert exc.value.code == "CANCELLED"
    assert elapsed < 5
    assert not (tmp_path / "jobs" / "job-cancel" / "audio.wav").exists()


@pytest.mark.asyncio
async def test_generation_engine_force_oom_raises_out_of_memory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from audiomorph.generation.engine import GenerationEngine

    monkeypatch.setenv("AUDIOMORPH_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AUDIOMORPH_FORCE_OOM", "1")
    (tmp_path / "models" / "test-model").mkdir(parents=True)
    _install_fake_torch(monkeypatch, cuda_available=True)
    _install_fake_heartlib(monkeypatch, lambda *_a, **_k: object())

    engine = GenerationEngine()
    with pytest.raises(ApiError) as exc:
        await engine.generate(_req(), "job-oom", lambda _u: None)

    assert exc.value.code == "OUT_OF_MEMORY"
    assert exc.value.hint is not None
    assert "shorter duration" in exc.value.hint.lower()


@pytest.mark.asyncio
async def test_generation_engine_rejects_when_generation_lock_is_held(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from audiomorph.generation.engine import GenerationEngine

    monkeypatch.setenv("AUDIOMORPH_DATA_DIR", str(tmp_path))
    (tmp_path / "models" / "test-model").mkdir(parents=True)
    _install_fake_torch(monkeypatch)
    _install_fake_heartlib(monkeypatch, lambda *_a, **_k: object())

    engine = GenerationEngine()
    await engine._generation_lock.acquire()  # noqa: SLF001 - explicit concurrency test
    try:
        with pytest.raises(ApiError) as exc:
            await engine.generate(_req(), "job-busy", lambda _u: None)
    finally:
        engine._generation_lock.release()  # noqa: SLF001 - explicit concurrency test

    assert exc.value.code == "VALIDATION_ERROR"
    assert "already in progress" in exc.value.message


@pytest.mark.asyncio
async def test_generation_engine_model_not_found(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from audiomorph.generation.engine import GenerationEngine

    monkeypatch.setenv("AUDIOMORPH_DATA_DIR", str(tmp_path))
    _install_fake_torch(monkeypatch)
    _install_fake_heartlib(monkeypatch, lambda *_a, **_k: object())

    engine = GenerationEngine()
    with pytest.raises(ApiError) as exc:
        await engine.generate(
            _req(model_id="does-not-exist"), "job-missing", lambda _u: None
        )

    assert exc.value.code == "MODEL_NOT_FOUND"
