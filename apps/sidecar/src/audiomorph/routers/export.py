from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from .._errors import ApiError
from ..db import repo
from ..db.session import session_scope
from ..paths import get_jobs_dir
from ..services import ffmpeg as ffmpeg_service

router = APIRouter(prefix="/export", tags=["export"])

_ALLOWED_FORMATS = {"wav", "mp3", "flac"}
_MP3_MIN_KBPS = 64
_MP3_MAX_KBPS = 320


class _ExportBody(BaseModel):
    job_id: str
    format: str
    bitrate_kbps: Optional[int] = None


class _ExportResponse(BaseModel):
    file_path: str
    format: str
    size_bytes: int


def _validate(body: _ExportBody) -> None:
    if body.format not in _ALLOWED_FORMATS:
        raise ApiError(
            code="VALIDATION_ERROR",
            message=f"Unsupported format: {body.format}",
            retriable=False,
            hint=f"Allowed: {sorted(_ALLOWED_FORMATS)}",
        )

    if body.bitrate_kbps is not None:
        if body.format != "mp3":
            raise ApiError(
                code="VALIDATION_ERROR",
                message="bitrate_kbps is only valid for mp3 format",
                retriable=False,
            )
        if not (_MP3_MIN_KBPS <= body.bitrate_kbps <= _MP3_MAX_KBPS):
            raise ApiError(
                code="VALIDATION_ERROR",
                message=f"bitrate_kbps must be between {_MP3_MIN_KBPS} and {_MP3_MAX_KBPS}",
                retriable=False,
            )


def _resolve_source(job_id: str) -> Path:
    with session_scope() as session:
        row = repo.get_generation_by_job_id(session, job_id)
        if row is None:
            raise ApiError(
                code="JOB_NOT_FOUND",
                message=f"Unknown job: {job_id}",
                retriable=False,
            )
        return Path(row.file_path)


@router.post("", response_model=_ExportResponse)
async def export_audio(body: _ExportBody) -> _ExportResponse:
    _validate(body)
    source = _resolve_source(body.job_id)

    out_dir = Path(get_jobs_dir()) / body.job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    output = out_dir / f"export.{body.format}"

    await ffmpeg_service.convert(str(source), str(output), body.format, body.bitrate_kbps)

    return _ExportResponse(
        file_path=str(output),
        format=body.format,
        size_bytes=output.stat().st_size,
    )


@router.get("")
async def list_exports() -> dict[str, list[dict[str, str]]]:
    return {"items": []}
