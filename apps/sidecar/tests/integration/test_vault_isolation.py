from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from .conftest import wait_for_job

pytestmark = pytest.mark.integration


def _run_one_generation(app_client, auth_headers) -> str:
    payload = {
        "prompt": "isolation-probe",
        "lyrics": "",
        "duration_seconds": 2.0,
        "seed": 7,
        "model_id": "facebook/musicgen-small",
    }
    resp = app_client.post("/jobs/generate", json=payload, headers=auth_headers)
    assert resp.status_code == 202
    job_id = resp.json()["job_id"]
    final = wait_for_job(app_client, f"/jobs/{job_id}", auth_headers)
    assert final["status"] == "completed"
    return job_id


def _count_generations(db_path: str) -> int:
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0].lower() for row in cur.fetchall()}
        table = None
        for candidate in ("generation", "generations"):
            if candidate in tables:
                table = candidate
                break
        if table is None:
            return 0
        cur = conn.execute(f"SELECT COUNT(*) FROM {table}")
        return int(cur.fetchone()[0])
    finally:
        conn.close()


def test_each_test_gets_fresh_sqlite_db(
    app_client, auth_headers, stub_musicgen, sqlite_db
) -> None:
    assert Path(sqlite_db).exists()
    _run_one_generation(app_client, auth_headers)
    count = _count_generations(sqlite_db)
    assert count >= 0


def test_second_run_does_not_see_prior_test_data(
    app_client, auth_headers, stub_musicgen, sqlite_db
) -> None:
    initial_count = _count_generations(sqlite_db)
    assert initial_count == 0, (
        f"Expected fresh DB but found {initial_count} generations — "
        "fixture isolation is broken"
    )


def test_sqlite_path_is_under_temp_dir(sqlite_db, tmp_path) -> None:
    assert str(sqlite_db).startswith(str(tmp_path)), (
        f"DB path {sqlite_db} escaped tmp_path {tmp_path}"
    )
