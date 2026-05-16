from __future__ import annotations

from dataclasses import dataclass

ERROR_HTTP_STATUS: dict[str, int] = {
    "VALIDATION_ERROR": 422,
    "MODEL_NOT_FOUND": 404,
    "GPU_UNAVAILABLE": 503,
    "OUT_OF_MEMORY": 503,
    "SIDECAR_DOWN": 503,
    "JOB_NOT_FOUND": 404,
    "CANCELLED": 409,
    "EXPORT_FAILED": 500,
    "DOWNLOAD_FAILED": 500,
    "KEY_VAULT_ERROR": 500,
    "INTERNAL_ERROR": 500,
}


@dataclass(slots=True)
class ApiError(Exception):
    code: str
    message: str
    retriable: bool
    hint: str | None = None

    @property
    def status_code(self) -> int:
        return ERROR_HTTP_STATUS.get(self.code, 500)

    def envelope(self) -> dict[str, str | bool | None]:
        return {
            "code": self.code,
            "message": self.message,
            "hint": self.hint,
            "retriable": self.retriable,
        }
