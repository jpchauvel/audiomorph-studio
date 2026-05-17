# pyright: reportMissingTypeStubs=false

from __future__ import annotations

import asyncio

import pytest

from audiomorph.models.registry import ModelRegistry


@pytest.mark.asyncio
async def test_acquire_same_key_reuses_loaded_pipeline() -> None:
    registry = ModelRegistry()
    load_calls = 0
    unload_calls = 0
    pipe = object()

    def loader() -> object:
        nonlocal load_calls
        load_calls += 1
        return pipe

    def unloader() -> None:
        nonlocal unload_calls
        unload_calls += 1

    first = await registry.acquire("generation", "model-a", loader, unloader)
    second = await registry.acquire("generation", "model-a", loader, unloader)

    assert first is pipe
    assert second is pipe
    assert load_calls == 1
    assert unload_calls == 0
    assert registry.get_active() == ("generation", "model-a")


@pytest.mark.asyncio
async def test_acquire_different_key_unloads_before_loading_next() -> None:
    registry = ModelRegistry()
    events: list[str] = []

    async def load_a() -> str:
        events.append("load:model-a")
        return "pipe:model-a"

    async def load_b() -> str:
        events.append("load:model-b")
        return "pipe:model-b"

    def unload_a() -> None:
        events.append("unload:model-a")

    def unload_b() -> None:
        events.append("unload:model-b")

    await registry.acquire("generation", "model-a", load_a, unload_a)
    await registry.acquire("generation", "model-b", load_b, unload_b)

    assert events == ["load:model-a", "unload:model-a", "load:model-b"]
    assert registry.get_active() == ("generation", "model-b")


@pytest.mark.asyncio
async def test_concurrent_acquire_serializes_swaps_without_torn_state() -> (
    None
):
    registry = ModelRegistry()
    events: list[str] = []
    unload_calls = 0
    loading_count = 0
    max_loading_count = 0

    async def acquire(model_id: str) -> str:
        nonlocal unload_calls, loading_count, max_loading_count

        async def loader() -> str:
            nonlocal loading_count, max_loading_count
            events.append(f"load:{model_id}:start")
            loading_count += 1
            max_loading_count = max(max_loading_count, loading_count)
            await asyncio.sleep(0.01)
            loading_count -= 1
            events.append(f"load:{model_id}:end")
            return f"pipe:{model_id}"

        def unloader() -> None:
            nonlocal unload_calls
            unload_calls += 1
            events.append(f"unload:{model_id}")

        return await registry.acquire(
            "generation", model_id, loader, unloader
        )

    first, second = await asyncio.gather(
        acquire("model-a"),
        acquire("model-b"),
    )

    unload_events = [event for event in events if event.startswith("unload:")]
    assert {first, second} == {"pipe:model-a", "pipe:model-b"}
    assert len(unload_events) == 1
    assert unload_calls == 1
    assert max_loading_count == 1

    unloaded = unload_events[0].split(":", maxsplit=1)[1]
    loaded_after = "model-b" if unloaded == "model-a" else "model-a"
    assert events.index(unload_events[0]) < events.index(
        f"load:{loaded_after}:start"
    )
    assert registry.get_active() == ("generation", loaded_after)


@pytest.mark.asyncio
async def test_clear_unloads_active_slot() -> None:
    registry = ModelRegistry()
    unload_calls = 0

    async def loader() -> str:
        return "pipe:model-a"

    def unloader() -> None:
        nonlocal unload_calls
        unload_calls += 1

    await registry.acquire("generation", "model-a", loader, unloader)
    await registry.clear()

    assert unload_calls == 1
    assert registry.get_active() is None
