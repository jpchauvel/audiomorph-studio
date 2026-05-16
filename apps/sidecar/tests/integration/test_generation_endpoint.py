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
    finally:
        conn.close()

    assert "generation" in {t.lower() for t in tables} or "generations" in {
        t.lower() for t in tables
    }, f"Expected generation table, got {tables}"


def test_generation_rejects_invalid_payload(app_client, auth_headers) -> None:
    resp = app_client.post(
        "/jobs/generate", json={"prompt": "x"}, headers=auth_headers
    )
    assert resp.status_code == 422
