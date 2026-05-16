from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("")
async def read_settings() -> dict[str, str]:
    return {"status": "ok"}
