from __future__ import annotations

from typing import Optional

from sqlmodel import Session, select

from ..schemas import GenerationResult
from .models import Generation, Setting


def record_generation(session: Session, result: GenerationResult) -> Generation:
    row = Generation(
        job_id=result.job_id,
        model_id=result.model_id,
        prompt=result.prompt,
        lyrics=result.lyrics,
        seed=result.seed,
        duration_s=result.duration_seconds,
        file_path=result.file_path,
        created_at=result.created_at,
        status="completed",
    )
    session.add(row)
    session.flush()
    session.refresh(row)
    return row


def list_generations(session: Session, limit: int = 50, offset: int = 0) -> list[Generation]:
    stmt = select(Generation).order_by(Generation.id).offset(offset).limit(limit)
    return list(session.exec(stmt).all())


def get_generation_by_job_id(session: Session, job_id: str) -> Optional[Generation]:
    stmt = select(Generation).where(Generation.job_id == job_id)
    return session.exec(stmt).first()


def get_setting(session: Session, key: str, default: Optional[str] = None) -> Optional[str]:
    row = session.get(Setting, key)
    return row.value_json if row is not None else default


def set_setting(session: Session, key: str, value: str) -> None:
    row = session.get(Setting, key)
    if row is None:
        session.add(Setting(key=key, value_json=value))
    else:
        row.value_json = value
        session.add(row)
    session.flush()
