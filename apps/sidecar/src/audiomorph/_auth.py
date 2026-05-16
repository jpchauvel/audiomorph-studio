from __future__ import annotations

import hmac

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, token: str, exempt_paths: set[str] | None = None) -> None:
        super().__init__(app)
        self._token = token
        self._exempt_paths = exempt_paths or {"/healthz"}

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.url.path in self._exempt_paths:
            return await call_next(request)

        provided = request.headers.get("X-Audiomorph-Token", "")
        if not provided or not hmac.compare_digest(provided, self._token):
            return JSONResponse(
                status_code=401,
                content={
                    "code": "KEY_VAULT_ERROR",
                    "message": "Unauthorized",
                    "retriable": False,
                },
            )

        return await call_next(request)
