# pyright: reportMissingTypeStubs=false, reportUnusedFunction=false

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from pathlib import Path
import sys

import pytest

SIDECAR_SRC = Path(__file__).resolve().parents[1] / "src"
if str(SIDECAR_SRC) not in sys.path:
    sys.path.insert(0, str(SIDECAR_SRC))


@pytest.fixture(autouse=True)
def _reset_model_registry() -> Iterator[None]:
    from audiomorph.models import get_registry

    registry = get_registry()
    asyncio.run(registry.clear())
    yield
    asyncio.run(registry.clear())
