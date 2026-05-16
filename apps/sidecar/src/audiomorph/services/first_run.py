from __future__ import annotations

from sqlmodel import Session

from ..db import repo

FIRST_RUN_STEPS: list[str] = [
    "pick_models_dir",
    "download_models",
    "first_run_completed",
]


def _is_truthy(value: str | None) -> bool:
    return value is not None and value.strip().lower() == "true"


def get_first_run_status(session: Session) -> dict[str, object]:
    missing: list[str] = []

    models_dir = repo.get_setting(session, "models_dir")
    if not models_dir or not models_dir.strip():
        missing.append("pick_models_dir")

    hf_present = repo.get_setting(session, "hf_token_present")
    if not _is_truthy(hf_present):
        missing.append("download_models")

    completed = repo.get_setting(session, "first_run_completed")
    if not _is_truthy(completed):
        missing.append("first_run_completed")

    return {"completed": len(missing) == 0, "missing_steps": missing}
