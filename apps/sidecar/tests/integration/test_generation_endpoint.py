from __future__ import annotations

from pathlib import Path

import pytest

from .conftest import wait_for_job

pytestmark = pytest.mark.integration


def _post_generation(app_client, auth_headers) -> str:
    payload = {
        "prompt": "lofi hip hop beat",
        "lyrics": "",
        "duration_seconds": 3.0,
        "seed": 42,
        "model_id": "facebook/musicgen-small",
    }
    resp = app_client.post(
        "/jobs/generate", json=payload, headers=auth_headers
    )
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert "job_id" in body
    return body["job_id"]


def test_generation_happy_path_with_stubbed_engine(
    app_client, auth_headers, stub_musicgen
) -> None:
    job_id = _post_generation(app_client, auth_headers)
    final = wait_for_job(app_client, f"/jobs/{job_id}", auth_headers)
    assert final["status"] == "completed", final
    assert "result" in final
    result = final["result"]
    assert result["job_id"] == job_id
    assert Path(result["file_path"]).exists()
    assert result["prompt"] == "lofi hip hop beat"
    assert result["seed"] == 42

    calls = stub_musicgen()
    assert len(calls) == 1
    assert calls[0]["prompt"] == "lofi hip hop beat"


def test_generation_persists_to_sqlite(
    app_client, auth_headers, stub_musicgen, sqlite_db
) -> None:
    job_id = _post_generation(app_client, auth_headers)
    wait_for_job(app_client, f"/jobs/{job_id}", auth_headers)

    import sqlite3

    conn = sqlite3.connect(sqlite_db)
    try:
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
        tables = {row[0] for row in cur.fetchall()}
        table = next(
            (t for t in tables if t.lower() in {"generation", "generations"}),
            None,
        )
        assert table is not None, f"Expected generation table, got {tables}"
        cur = conn.execute(
            f"SELECT job_id, file_path FROM {table} WHERE job_id = ?",
            (job_id,),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    assert len(rows) == 1, f"Expected row for job_id={job_id}, got {rows}"
    assert rows[0][0] == job_id
    assert rows[0][1], "file_path must be persisted for export to work"


def test_export_after_generation_finds_job(
    app_client, auth_headers, stub_musicgen, sqlite_db, monkeypatch, tmp_path
) -> None:
    async def _fake_convert(
        src: str, dst: str, fmt: str, kbps: int | None
    ) -> None:
        Path(dst).write_bytes(b"RIFFfakewav")  # noqa: ASYNC240

    from audiomorph.services import ffmpeg as ffmpeg_service

    monkeypatch.setattr(ffmpeg_service, "convert", _fake_convert)

    job_id = _post_generation(app_client, auth_headers)
    wait_for_job(app_client, f"/jobs/{job_id}", auth_headers)

    resp = app_client.post(
        "/export",
        json={"job_id": job_id, "format": "wav"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["format"] == "wav"
    assert Path(body["file_path"]).exists()


def test_generation_rejects_invalid_payload(app_client, auth_headers) -> None:
    resp = app_client.post(
        "/jobs/generate", json={"prompt": "x"}, headers=auth_headers
    )
    assert resp.status_code == 422
