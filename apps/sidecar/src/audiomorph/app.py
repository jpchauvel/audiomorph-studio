from __future__ import annotations

# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownParameterType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false

import platform
import traceback
import os
from contextlib import asynccontextmanager
from time import perf_counter
from typing import Any, AsyncIterator, cast
from uuid import uuid4

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from ._auth import AuthMiddleware
from ._errors import ApiError
from ._logging import get_logger, setup_logging
from .db.session import init_db
from .paths import get_models_dir
from .routers.export import router as export_router
from .routers.jobs import router as jobs_router
from .routers.lyrics import router as lyrics_router
from .routers.models import router as models_router
from .routers.openrouter import router as openrouter_router
from .routers.settings import router as settings_router

def _gpu_info() -> dict[str, Any]:
    try:
        import torch  # pyright: ignore[reportMissingImports]
    except Exception:
        return {"available": False}

    torch_any = cast(Any, torch)

    if torch_any.cuda.is_available():
        props = torch_any.cuda.get_device_properties(0)
        return {
            "available": True,
            "name": props.name,
            "vram_gb": round(float(props.total_memory) / (1024**3), 2),
        }

    mps = getattr(torch_any.backends, "mps", None)
    if mps and mps.is_available():
        return {
            "available": True,
            "name": "Apple Silicon (MPS)",
        }

    return {"available": False}


def create_app(auth_token: str = "") -> FastAPI:
    setup_logging()
    logger = get_logger("audiomorph.api")

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            init_db()
        except Exception as e:
            logger.error("db_init_failed", error=str(e))
        yield

    app = FastAPI(lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^http://localhost:\d+$",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(AuthMiddleware, token=auth_token)

    @app.middleware("http")
    async def request_logging_middleware(request: Request, call_next: Any) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        request_id = str(uuid4())
        started = perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            duration_ms = round((perf_counter() - started) * 1000, 2)
            logger.info(
                "request",
                method=request.method,
                path=request.url.path,
                status=500,
                duration_ms=duration_ms,
                request_id=request_id,
            )
            raise

        duration_ms = round((perf_counter() - started) * 1000, 2)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=duration_ms,
            request_id=request_id,
        )
        return response

    @app.exception_handler(ApiError)
    async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        return JSONResponse(status_code=exc.status_code, content=exc.envelope())

    @app.exception_handler(Exception)
    async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
        logger.error("unhandled_exception", traceback=traceback.format_exc(), error=str(exc))
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_ERROR",
                "message": "Internal server error",
                "hint": None,
                "retriable": False,
            },
        )

    root_router = APIRouter()

    @root_router.get("/healthz")
    async def healthz() -> dict[str, Any]:  # pyright: ignore[reportUnusedFunction]
        health_data: dict[str, Any] = {
            "ok": True,
            "pid": os.getpid(),
            "version": "0.1.0",
            "gpu": _gpu_info(),
            "models_dir": str(get_models_dir()),
            "python_version": platform.python_version(),
        }
        
        # AUDIOMORPH_TEST_MODE hook
        if os.environ.get("AUDIOMORPH_TEST_MODE") == "1":
            health_data["test_mode"] = True
        
        return health_data

    app.include_router(root_router)
    app.include_router(models_router)
    app.include_router(jobs_router, prefix="/jobs")
    app.include_router(lyrics_router)
    app.include_router(export_router)
    app.include_router(settings_router)
    app.include_router(openrouter_router)

    return app
