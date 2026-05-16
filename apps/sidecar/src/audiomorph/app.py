from __future__ import annotations

import os

from fastapi import FastAPI

from audiomorph._auth import AuthMiddleware


def create_app(auth_token: str) -> FastAPI:
    app = FastAPI()
    app.add_middleware(AuthMiddleware, token=auth_token)

    @app.get("/healthz")
    async def healthz() -> dict[str, int | str | bool]:  # pyright: ignore[reportUnusedFunction]
        return {"ok": True, "version": "0.1.0", "pid": os.getpid()}

    return app
