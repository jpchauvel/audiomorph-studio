from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/export", tags=["export"])


@router.get("")
async def list_exports() -> dict[str, list[dict[str, str]]]:
    return {"items": []}
