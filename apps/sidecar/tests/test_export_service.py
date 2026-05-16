from __future__ import annotations

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false, reportMissingParameterType=false, reportUnknownLambdaType=false

import asyncio
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from audiomorph._errors import ApiError
from audiomorph.services import ffmpeg as ffmpeg_service


class _FakeProc:
    def __init__(
        self,
        returncode: int = 0,
        stderr: bytes = b"",
        stdout: bytes = b"",
        write_output: Path | None = None,
        output_bytes: bytes = b"FAKEDATA",
        sleep_s: float = 0.0,
    ) -> None:
        self.returncode = returncode
        self._stderr = stderr
        self._stdout = stdout
        self._write_output = write_output
        self._output_bytes = output_bytes
        self._sleep_s = sleep_s
        self.killed = False

    async def communicate(self) -> tuple[bytes, bytes]:
        if self._sleep_s > 0:
            await asyncio.sleep(self._sleep_s)
        if self._write_output is not None:
            self._write_output.write_bytes(self._output_bytes)
        return self._stdout, self._stderr

    def kill(self) -> None:
        self.killed = True


def _patch_subprocess(monkeypatch: pytest.MonkeyPatch, proc_factory):
    captured: dict[str, Any] = {}

    async def _fake_create_subprocess_exec(*cmd, **kwargs):
        captured["cmd"] = list(cmd)
        captured["kwargs"] = kwargs
        return proc_factory(captured)

    monkeypatch.setattr(
        ffmpeg_service.asyncio,
        "create_subprocess_exec",
        _fake_create_subprocess_exec,
    )
    return captured


def test_convert_wav_to_mp3_success(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    src = tmp_path / "input.wav"
    src.write_bytes(b"RIFFFAKE")
    dst = tmp_path / "output.mp3"

    captured = _patch_subprocess(
        monkeypatch,
        lambda _c: _FakeProc(returncode=0, write_output=dst, output_bytes=b"ID3FAKE"),
    )

    asyncio.run(
        ffmpeg_service.convert(str(src), str(dst), format="mp3", bitrate_kbps=192)
    )

    cmd = captured["cmd"]
    assert cmd[0] == "ffmpeg"
    assert "-y" in cmd
    assert "-i" in cmd
    assert str(src) in cmd
    assert str(dst) == cmd[-1]
    assert "libmp3lame" in cmd
    assert "192k" in cmd
    assert dst.exists()
    assert dst.read_bytes() == b"ID3FAKE"


def test_convert_unknown_format_raises(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    src = tmp_path / "input.wav"
    src.write_bytes(b"RIFFFAKE")
    dst = tmp_path / "output.ogg"

    with pytest.raises(ApiError) as ei:
        asyncio.run(ffmpeg_service.convert(str(src), str(dst), format="ogg"))

    assert ei.value.code == "EXPORT_FAILED"


def test_convert_ffmpeg_missing_raises(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    src = tmp_path / "input.wav"
    src.write_bytes(b"RIFFFAKE")
    dst = tmp_path / "output.mp3"

    async def _raise_fnf(*_cmd, **_kwargs):
        raise FileNotFoundError("ffmpeg not in PATH")

    monkeypatch.setattr(
        ffmpeg_service.asyncio, "create_subprocess_exec", _raise_fnf
    )

    with pytest.raises(ApiError) as ei:
        asyncio.run(ffmpeg_service.convert(str(src), str(dst), format="mp3"))

    assert ei.value.code == "EXPORT_FAILED"
    assert "ffmpeg" in (ei.value.message + (ei.value.hint or "")).lower()


def test_convert_nonzero_returncode_raises_with_stderr_hint(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    src = tmp_path / "input.wav"
    src.write_bytes(b"RIFFFAKE")
    dst = tmp_path / "output.flac"

    _patch_subprocess(
        monkeypatch,
        lambda _c: _FakeProc(
            returncode=1,
            stderr=b"\nInvalid data found when processing input\nSome other line\n",
        ),
    )

    with pytest.raises(ApiError) as ei:
        asyncio.run(ffmpeg_service.convert(str(src), str(dst), format="flac"))

    assert ei.value.code == "EXPORT_FAILED"
    assert ei.value.hint is not None
    assert "Invalid data found" in ei.value.hint


def test_convert_flac_uses_flac_codec(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    src = tmp_path / "input.wav"
    src.write_bytes(b"RIFFFAKE")
    dst = tmp_path / "output.flac"

    captured = _patch_subprocess(
        monkeypatch,
        lambda _c: _FakeProc(returncode=0, write_output=dst, output_bytes=b"fLaC"),
    )

    asyncio.run(ffmpeg_service.convert(str(src), str(dst), format="flac"))

    assert "flac" in captured["cmd"]
    assert "libmp3lame" not in captured["cmd"]


@pytest.fixture()
def db_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    from audiomorph.db.session import init_db

    p = tmp_path / "test.db"
    init_db(str(p))
    monkeypatch.setenv("AUDIOMORPH_TEST_DB", str(p))
    return p


def _seed_generation(db_path: Path, job_id: str, source_path: Path) -> None:
    from audiomorph.db.session import session_scope
    from audiomorph.db import repo
    from audiomorph.schemas import GenerationResult

    with session_scope(str(db_path)) as session:
        repo.record_generation(
            session,
            GenerationResult(
                job_id=job_id,
                file_path=str(source_path),
                duration_seconds=10.0,
                model_id="ace-step",
                seed=1,
                prompt="rock",
                lyrics="la",
                created_at="2025-01-01T00:00:00Z",
            ),
        )


def test_export_router_invalid_format_returns_422(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, db_path: Path
) -> None:
    from fastapi.testclient import TestClient

    from audiomorph.app import create_app
    from audiomorph.db.session import session_scope

    src = tmp_path / "src.wav"
    src.write_bytes(b"RIFFFAKE")
    _seed_generation(db_path, "job-1", src)

    import audiomorph.routers.export as export_router

    def _scope():
        return session_scope(str(db_path))

    monkeypatch.setattr(export_router, "session_scope", _scope)
    monkeypatch.setattr(export_router, "get_jobs_dir", lambda: tmp_path)

    app = create_app(auth_token="t")
    with TestClient(app) as client:
        r = client.post(
            "/export",
            headers={"X-Audiomorph-Token": "t"},
            json={"job_id": "job-1", "format": "ogg"},
        )

    assert r.status_code == 422
    assert r.json()["code"] == "VALIDATION_ERROR"


def test_export_router_unknown_job_returns_404(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, db_path: Path
) -> None:
    from fastapi.testclient import TestClient

    from audiomorph.app import create_app
    from audiomorph.db.session import session_scope

    import audiomorph.routers.export as export_router

    monkeypatch.setattr(export_router, "session_scope", lambda: session_scope(str(db_path)))
    monkeypatch.setattr(export_router, "get_jobs_dir", lambda: tmp_path)

    app = create_app(auth_token="t")
    with TestClient(app) as client:
        r = client.post(
            "/export",
            headers={"X-Audiomorph-Token": "t"},
            json={"job_id": "nope", "format": "mp3"},
        )

    assert r.status_code == 404
    assert r.json()["code"] == "JOB_NOT_FOUND"


def test_export_router_happy_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, db_path: Path
) -> None:
    from fastapi.testclient import TestClient

    from audiomorph.app import create_app
    from audiomorph.db.session import session_scope

    src = tmp_path / "src.wav"
    src.write_bytes(b"RIFFFAKE")
    _seed_generation(db_path, "job-x", src)

    import audiomorph.routers.export as export_router

    monkeypatch.setattr(export_router, "session_scope", lambda: session_scope(str(db_path)))
    monkeypatch.setattr(export_router, "get_jobs_dir", lambda: tmp_path)

    async def _fake_convert(input_path: str, output_path: str, format: str, bitrate_kbps=None):
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_bytes(b"ID3DATA" * 10)

    monkeypatch.setattr(export_router.ffmpeg_service, "convert", _fake_convert)

    app = create_app(auth_token="t")
    with TestClient(app) as client:
        r = client.post(
            "/export",
            headers={"X-Audiomorph-Token": "t"},
            json={"job_id": "job-x", "format": "mp3", "bitrate_kbps": 192},
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["format"] == "mp3"
    assert body["size_bytes"] == len(b"ID3DATA" * 10)
    assert body["file_path"].endswith("export.mp3")


def test_export_router_bitrate_invalid_for_wav(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, db_path: Path
) -> None:
    from fastapi.testclient import TestClient

    from audiomorph.app import create_app
    from audiomorph.db.session import session_scope

    src = tmp_path / "src.wav"
    src.write_bytes(b"RIFFFAKE")
    _seed_generation(db_path, "job-y", src)

    import audiomorph.routers.export as export_router

    monkeypatch.setattr(export_router, "session_scope", lambda: session_scope(str(db_path)))
    monkeypatch.setattr(export_router, "get_jobs_dir", lambda: tmp_path)

    app = create_app(auth_token="t")
    with TestClient(app) as client:
        r = client.post(
            "/export",
            headers={"X-Audiomorph-Token": "t"},
            json={"job_id": "job-y", "format": "wav", "bitrate_kbps": 128},
        )

    assert r.status_code == 422
    assert r.json()["code"] == "VALIDATION_ERROR"
