from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

from ..paths import ensure_dir, get_user_data_dir
from . import models as _models  # noqa: F401  (register tables)


_engine_cache: dict[str, Engine] = {}


def _default_db_path() -> str:
    base = ensure_dir(get_user_data_dir())
    return str(base / "audiomorph.db")


def get_engine(db_path: Optional[str] = None) -> Engine:
    path = db_path or _default_db_path()
    if path in _engine_cache:
        return _engine_cache[path]

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    url = f"sqlite:///{path}"
    engine = create_engine(
        url,
        connect_args={"check_same_thread": False, "timeout": 5.0},
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_conn, _conn_record):  # pyright: ignore[reportUnusedFunction]
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA busy_timeout=5000;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.close()

    _engine_cache[path] = engine
    return engine


def init_db(db_path: Optional[str] = None) -> Engine:
    engine = get_engine(db_path)
    SQLModel.metadata.create_all(engine)
    with engine.connect() as conn:
        conn.exec_driver_sql("PRAGMA journal_mode=WAL;")
    return engine


@contextmanager
def session_scope(db_path: Optional[str] = None) -> Iterator[Session]:
    engine = get_engine(db_path)
    session = Session(engine, expire_on_commit=False)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
