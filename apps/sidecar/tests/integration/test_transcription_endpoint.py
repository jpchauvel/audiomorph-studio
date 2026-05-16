from __future__ import annotations

from pathlib import Path

import pytest

from .conftest import FIXTURES, wait_for_job

pytestmark = pytest.mark.integration


def test_transcription_happy_path_with_stubbed_whisper(
    app_client, auth_headers, stub_whisper
) -> None:
    audio = FIXTURES / "audio" / "speech-3s.wav"
    resp = app_client.post(
        "/lyrics/transcribe",
        json={"audio_path": str(audio)},
        headers=auth_headers,
    )
    assert resp.status_code == 202, resp.text
    job_id = resp.json()["job_id"]

    final = wait_for_job(app_client, f"/lyrics/jobs/{job_id}", auth_headers)
    assert final["status"] == "completed", final
    result = final["result"]
    assert "text" in result and result["text"]
    assert "segments" in result and len(result["segments"]) >= 1

    calls = stub_whisper()
    assert len(calls) == 1
    assert calls[0]["audio_path"] == str(audio)


def test_transcription_invalid_payload(app_client, auth_headers) -> None:
    resp = app_client.post("/lyrics/transcribe", json={}, headers=auth_headers)
    assert resp.status_code == 422


def test_transcription_requires_auth(app_client) -> None:
    resp = app_client.post(
        "/lyrics/transcribe", json={"audio_path": "/tmp/x.wav"}
    )
    assert resp.status_code == 401
