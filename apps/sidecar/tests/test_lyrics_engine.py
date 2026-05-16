from __future__ import annotations

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false

import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from audiomorph._errors import ApiError


def _install_fake_torch(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_torch = ModuleType("torch")
    fake_torch.float16 = object()
    fake_torch.float32 = object()
    fake_torch.bfloat16 = object()
    fake_torch.device = lambda value: SimpleNamespace(type=str(value).split(":")[0])
    fake_torch.backends = SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False))
    fake_torch.cuda = SimpleNamespace(is_available=lambda: False, empty_cache=lambda: None)

    class _NoGrad:
        def __enter__(self) -> None:
            return None

        def __exit__(self, *_: object) -> None:
            return None

    fake_torch.no_grad = _NoGrad
    monkeypatch.setitem(sys.modules, "torch", fake_torch)


def _install_fake_heartlib(monkeypatch: pytest.MonkeyPatch, pipe_factory: Any) -> None:
    fake_heartlib = ModuleType("heartlib")

    class _Pipeline:
        @classmethod
        def from_pretrained(cls, *args: object, **kwargs: object) -> Any:
            return pipe_factory(*args, **kwargs)

    fake_heartlib.HeartTranscriptorPipeline = _Pipeline
    monkeypatch.setitem(sys.modules, "heartlib", fake_heartlib)


def _make_audio(path: Path, *, size_bytes: int = 1024) -> Path:
    path.write_bytes(b"\x00" * size_bytes)
    return path


@pytest.mark.asyncio
async def test_transcription_engine_happy_path_returns_text_and_segments(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from audiomorph.lyrics.engine import TranscriptionEngine

    monkeypatch.setenv("AUDIOMORPH_DATA_DIR", str(tmp_path))
    _install_fake_torch(monkeypatch)

    def pipe_factory(*_args: object, **_kwargs: object) -> Any:
        class Pipe:
            def __call__(self, _audio_path: str, **_kw: object) -> dict[str, Any]:
                return {
                    "text": "hello world",
                    "chunks": [{"timestamp": [0.0, 2.5], "text": "hello world"}],
                }

        return Pipe()

    _install_fake_heartlib(monkeypatch, pipe_factory)
    audio = _make_audio(tmp_path / "song.wav")

    engine = TranscriptionEngine()
    updates: list[dict[str, object]] = []
    result = await engine.transcribe(str(audio), "job-happy", updates.append)

    assert result.text == "hello world"
    assert result.segments is not None
    assert len(result.segments) == 1
    assert result.segments[0].start == 0.0
    assert result.segments[0].text == "hello world"
    assert any(u.get("phase") == "loading" for u in updates)
    assert any(u.get("phase") == "finalizing" for u in updates)


@pytest.mark.asyncio
async def test_transcription_engine_rejects_file_too_large(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from audiomorph.lyrics.engine import TranscriptionEngine

    monkeypatch.setenv("AUDIOMORPH_DATA_DIR", str(tmp_path))
    _install_fake_torch(monkeypatch)
    _install_fake_heartlib(monkeypatch, lambda *_a, **_k: object())

    big = tmp_path / "huge.wav"
    # Create sparse file > 50MB without writing all bytes
    with open(big, "wb") as f:
        f.seek(51 * 1024 * 1024)
        f.write(b"\x00")

    engine = TranscriptionEngine()
    with pytest.raises(ApiError) as exc:
        await engine.transcribe(str(big), "job-big", lambda _u: None)

    assert exc.value.code == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_transcription_engine_rejects_unsupported_format(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from audiomorph.lyrics.engine import TranscriptionEngine

    monkeypatch.setenv("AUDIOMORPH_DATA_DIR", str(tmp_path))
    _install_fake_torch(monkeypatch)
    _install_fake_heartlib(monkeypatch, lambda *_a, **_k: object())

    bad = _make_audio(tmp_path / "weird.xyz")

    engine = TranscriptionEngine()
    with pytest.raises(ApiError) as exc:
        await engine.transcribe(str(bad), "job-bad-fmt", lambda _u: None)

    assert exc.value.code == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_transcription_engine_rejects_when_lock_held(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from audiomorph.lyrics.engine import TranscriptionEngine

    monkeypatch.setenv("AUDIOMORPH_DATA_DIR", str(tmp_path))
    _install_fake_torch(monkeypatch)
    _install_fake_heartlib(monkeypatch, lambda *_a, **_k: object())

    audio = _make_audio(tmp_path / "song.wav")

    engine = TranscriptionEngine()
    await engine._transcription_lock.acquire()  # noqa: SLF001 - explicit concurrency test
    try:
        with pytest.raises(ApiError) as exc:
            await engine.transcribe(str(audio), "job-busy", lambda _u: None)
    finally:
        engine._transcription_lock.release()  # noqa: SLF001 - explicit concurrency test

    assert exc.value.code == "VALIDATION_ERROR"
    assert "already in progress" in exc.value.message
