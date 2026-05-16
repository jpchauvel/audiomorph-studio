from __future__ import annotations

from typing import Optional

from sqlmodel import Field, SQLModel


class Generation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    job_id: str = Field(index=True, unique=True)
    model_id: str
    prompt: str
    lyrics: str
    seed: int
    duration_s: float
    file_path: str
    created_at: str
    status: str = "completed"


class Job(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str
    status: str
    created_at: str
    updated_at: str
    error_code: Optional[str] = None
    error_message: Optional[str] = None


class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value_json: str
