from __future__ import annotations

import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from sqlmodel import text

from audiomorph.db.session import get_engine, init_db, session_scope
from audiomorph.db import repo
from audiomorph.schemas import GenerationResult


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    p = tmp_path / "test.db"
    init_db(str(p))
    return p


def _make_result(job_id: str, seed: int = 1) -> GenerationResult:
    return GenerationResult(
        job_id=job_id,
        file_path=f"/tmp/{job_id}.wav",
        duration_seconds=10.0,
        model_id="ace-step",
        seed=seed,
        prompt="rock anthem",
        lyrics="la la la",
        created_at="2025-01-01T00:00:00Z",
    )


def test_insert_and_list_generations(db_path: Path):
    with session_scope(str(db_path)) as session:
        repo.record_generation(session, _make_result("job-a"))
        repo.record_generation(session, _make_result("job-b", seed=2))
        repo.record_generation(session, _make_result("job-c", seed=3))

    with session_scope(str(db_path)) as session:
        rows = repo.list_generations(session, limit=10, offset=0)

    assert len(rows) == 3
    assert {r.job_id for r in rows} == {"job-a", "job-b", "job-c"}

    with session_scope(str(db_path)) as session:
        got = repo.get_generation_by_job_id(session, "job-b")
    assert got is not None
    assert got.seed == 2
    assert got.model_id == "ace-step"


def test_wal_mode_enabled(db_path: Path):
    engine = get_engine(str(db_path))
    with engine.connect() as conn:
        mode = conn.exec_driver_sql("PRAGMA journal_mode;").scalar()
    assert str(mode).lower() == "wal"


def test_settings_upsert(db_path: Path):
    with session_scope(str(db_path)) as session:
        repo.set_setting(session, "theme", "dark")
        assert repo.get_setting(session, "theme") == "dark"
        assert repo.get_setting(session, "missing", default="x") == "x"

        repo.set_setting(session, "theme", "light")
        assert repo.get_setting(session, "theme") == "light"


def test_concurrent_read_while_write_no_busy(db_path: Path):
    """WAL mode should allow concurrent reads during writes without SQLITE_BUSY."""
    with session_scope(str(db_path)) as session:
        repo.record_generation(session, _make_result("seed-job"))

    errors: list[Exception] = []

    def writer():
        try:
            for i in range(20):
                with session_scope(str(db_path)) as s:
                    repo.record_generation(s, _make_result(f"w-{i}", seed=i))
        except Exception as e:
            errors.append(e)

    def reader():
        try:
            for _ in range(20):
                with session_scope(str(db_path)) as s:
                    repo.list_generations(s, limit=100, offset=0)
        except Exception as e:
            errors.append(e)

    t1 = threading.Thread(target=writer)
    t2 = threading.Thread(target=reader)
    t1.start()
    t2.start()
    t1.join(timeout=10)
    t2.join(timeout=10)

    assert not errors, f"Concurrent ops failed: {errors}"
