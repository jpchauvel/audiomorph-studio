from __future__ import annotations

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownParameterType=false

import json
import os
import socket
import sys
import threading
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Callable, Iterator

import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]
SIDECAR_SRC = Path(__file__).resolve().parents[2] / "src"
FIXTURES = REPO_ROOT / "packages" / "test-helpers" / "fixtures"

if str(SIDECAR_SRC) not in sys.path:
    sys.path.insert(0, str(SIDECAR_SRC))

TEST_TOKEN = "test-token-deterministic-do-not-use-in-prod"


@pytest.fixture(autouse=True)
def _test_mode_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUDIOMORPH_TEST_MODE", "1")


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"X-Audiomorph-Token": TEST_TOKEN}


@pytest.fixture
def sqlite_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("AUDIOMORPH_DATA_DIR", str(data_dir))

    from audiomorph.db import session as db_session

    db_session._engine_cache.clear()
    db_path = data_dir / "audiomorph.db"
    db_session.init_db(str(db_path))
    yield str(db_path)
    db_session._engine_cache.clear()


@pytest.fixture
def app_client(sqlite_db: str) -> Iterator[Any]:
    from fastapi.testclient import TestClient

    from audiomorph.app import create_app

    app = create_app(auth_token=TEST_TOKEN)
    with TestClient(app) as client:
        yield client


class _StubHandler(BaseHTTPRequestHandler):
    response_body: bytes = b"{}"
    recorded: list[dict[str, Any]] = []

    def log_message(self, *_args: Any) -> None:
        return

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", "0") or 0)
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            body = {"_raw": raw.decode("utf-8", errors="replace")}
        self.recorded.append(
            {
                "path": self.path,
                "headers": dict(self.headers),
                "body": body,
            }
        )
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(self.response_body)))
        self.end_headers()
        self.wfile.write(self.response_body)


@pytest.fixture
def openrouter_stub(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, Any]]:
    fixture = FIXTURES / "openrouter" / "chat-response.json"
    body = fixture.read_bytes()
    recorded: list[dict[str, Any]] = []

    class _Handler(_StubHandler):
        pass

    _Handler.response_body = body
    _Handler.recorded = recorded

    server = HTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    base_url = f"http://127.0.0.1:{port}"
    monkeypatch.setenv("AUDIOMORPH_OPENROUTER_BASE_URL", base_url)

    try:
        yield {
            "base_url": base_url,
            "recorded": recorded,
            "url": f"{base_url}/api/v1/chat/completions",
        }
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture
def stub_musicgen(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Callable[[], list[dict[str, Any]]]:
    """Monkeypatch GenerationEngine.generate to write a stub WAV and record calls."""
    from audiomorph.generation import engine as gen_engine
    from audiomorph.schemas import GenerationRequest, GenerationResult

    audio_fixture = FIXTURES / "audio" / "short.wav"
    audio_bytes = audio_fixture.read_bytes()
    output_dir = tmp_path / "generations"
    output_dir.mkdir(parents=True, exist_ok=True)
    calls: list[dict[str, Any]] = []

    async def fake_generate(
        self: Any,
        req: GenerationRequest,
        job_id: str,
        progress_cb: Callable[[dict[str, Any]], None],
    ) -> GenerationResult:
        out_path = output_dir / f"{job_id}.wav"
        out_path.write_bytes(audio_bytes)
        progress_cb({"step": 1, "total_steps": 2, "eta_s": 0.1, "phase": "encoding"})
        progress_cb({"step": 2, "total_steps": 2, "eta_s": 0.0, "phase": "finalizing"})
        calls.append({"job_id": job_id, "prompt": req.prompt, "model_id": req.model_id})
        return GenerationResult(
            job_id=job_id,
            file_path=str(out_path),
            duration_seconds=req.duration_seconds,
            model_id=req.model_id,
            seed=req.seed,
            prompt=req.prompt,
            lyrics=req.lyrics,
            created_at=datetime.now(UTC).isoformat(),
        )

    monkeypatch.setattr(gen_engine.GenerationEngine, "generate", fake_generate)
    return lambda: calls


@pytest.fixture
def stub_whisper(monkeypatch: pytest.MonkeyPatch) -> Callable[[], list[dict[str, Any]]]:
    """Monkeypatch TranscriptionEngine.transcribe."""
    from audiomorph.lyrics import engine as lyr_engine
    from audiomorph.schemas import LyricsResult, LyricsSegment

    calls: list[dict[str, Any]] = []

    async def fake_transcribe(
        self: Any,
        audio_path: str,
        job_id: str,
        progress_cb: Callable[[dict[str, Any]], None],
    ) -> LyricsResult:
        progress_cb({"step": 1, "total_steps": 2, "eta_s": 0.1, "phase": "transcribing"})
        progress_cb({"step": 2, "total_steps": 2, "eta_s": 0.0, "phase": "finalizing"})
        calls.append({"job_id": job_id, "audio_path": audio_path})
        return LyricsResult(
            text="hello this is a test recording",
            segments=[
                LyricsSegment(start=0, end=1500, text="hello this is"),
                LyricsSegment(start=1500, end=3000, text="a test recording"),
            ],
        )

    monkeypatch.setattr(lyr_engine.TranscriptionEngine, "transcribe", fake_transcribe)
    return lambda: calls


def wait_for_job(
    app_client: Any,
    job_url: str,
    headers: dict[str, str],
    *,
    terminal_statuses: tuple[str, ...] = ("completed", "failed", "cancelled"),
    max_iters: int = 200,
) -> dict[str, Any]:
    """Poll a job endpoint until status is terminal. TestClient.get yields to bg tasks via its portal."""
    for _ in range(max_iters):
        resp = app_client.get(job_url, headers=headers)
        if resp.status_code != 200:
            return {"job_id": "", "status": "failed", "_raw": resp.json()}
        data = resp.json()
        if data.get("status") in terminal_statuses:
            return data
    return {"job_id": "", "status": "timeout"}
