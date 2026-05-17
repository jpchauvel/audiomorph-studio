from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import inspect
from typing import TypeVar, cast

PipeT = TypeVar("PipeT")


@dataclass(slots=True)
class _ActiveSlot:
    kind: str
    model_id: str
    # Pipelines are heterogeneous (MusicGen vs Whisper), so a single,
    # concrete protocol would be misleading here.
    pipe: object
    unloader: Callable[[], None | Awaitable[None]]


class ModelRegistry:
    def __init__(self) -> None:
        self._active: _ActiveSlot | None = None
        self._lock = asyncio.Lock()

    async def acquire(
        self,
        kind: str,
        model_id: str,
        loader: Callable[[], PipeT | Awaitable[PipeT]],
        unloader: Callable[[], None | Awaitable[None]],
    ) -> PipeT:
        async with self._lock:
            active = self._active
            if (
                active is not None
                and active.kind == kind
                and active.model_id == model_id
            ):
                return cast(PipeT, active.pipe)

            if active is not None:
                await self._call_unloader(active.unloader)
                self._active = None

            pipe = await self._call_loader(loader)
            self._active = _ActiveSlot(
                kind=kind,
                model_id=model_id,
                pipe=pipe,
                unloader=unloader,
            )
            return pipe

    def get_active(self) -> tuple[str, str] | None:
        active = self._active
        if active is None:
            return None
        return (active.kind, active.model_id)

    async def clear(self) -> None:
        async with self._lock:
            active = self._active
            if active is None:
                return
            await self._call_unloader(active.unloader)
            self._active = None

    async def _call_loader(
        self,
        loader: Callable[[], PipeT | Awaitable[PipeT]],
    ) -> PipeT:
        if inspect.iscoroutinefunction(loader):
            async_loader = cast(Callable[[], Awaitable[PipeT]], loader)
            return await async_loader()

        loaded = loader()
        if inspect.isawaitable(loaded):
            return await cast(Awaitable[PipeT], loaded)
        return loaded

    async def _call_unloader(
        self,
        unloader: Callable[[], None | Awaitable[None]],
    ) -> None:
        if inspect.iscoroutinefunction(unloader):
            async_unloader = cast(Callable[[], Awaitable[None]], unloader)
            await async_unloader()
            return

        unloaded = unloader()
        if inspect.isawaitable(unloaded):
            await unloaded


_registry_singleton = ModelRegistry()


def get_registry() -> ModelRegistry:
    return _registry_singleton


__all__ = ["ModelRegistry", "get_registry"]
