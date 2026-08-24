"""Defect C (FIX LANE 2): ``_batch_toggle_states``/``_batch_toggle_states_many``
and their wiring into ``list_all_tools``.

Covers:
  * ``_batch_toggle_states`` no longer re-raises a 503 ``HTTPException`` from
    ``_invoke_governed_helper`` -- it fails open (same as every other error
    path it already handled) and reports the failure via its ``ok`` return
    value instead of taking the whole ``/api/enhanced/tools`` response down.
  * ``_batch_toggle_states`` returns ``(states, ok)`` so a caller can tell "no
    preferences set (real, healthy answer)" apart from "the scan itself
    failed (states are a fabricated fail-open default)".
  * ``_batch_toggle_states_many`` runs its scans concurrently via
    ``asyncio.gather``, not sequentially.
  * ``list_all_tools`` surfaces a batch failure via the new top-level
    ``toggle_status`` field rather than staying silent about it.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine
from agent_webui import api_extensions


@pytest.fixture
def stub_engine():
    engine = MagicMock(spec=IntelligenceGraphEngine)
    engine.query_cypher.return_value = []
    return engine


@pytest.fixture
def bounded_engine(stub_engine):
    async def _get_engine():
        return stub_engine

    return _get_engine


def _server_row(*, id: str, name: str) -> dict[str, Any]:
    return {
        'id': id,
        'name': name,
        'transport': 'http',
        'url': '',
        'enabled': True,
    }


def _skill_row(*, id: str, name: str) -> dict[str, Any]:
    return {
        'id': id,
        'name': name,
        'description': '',
        'uri': '',
        'skill_type': 'skill',
        'classification': 'Atomic Skill',
        'provider': '',
        'mcp_server': '',
        'enabled': True,
    }


def _patch_catalog(rows: dict[str, list[dict[str, Any]]] | None):
    return patch(
        'agent_webui.api_extensions._read_fleet_catalog',
        AsyncMock(return_value=rows),
    )


# ---------------------------------------------------------------------------
# _batch_toggle_states
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_toggle_states_returns_states_and_ok_true_on_success(stub_engine):
    stub_engine.query_cypher.return_value = [
        {'id': 'preference:toggle:skill:skill-a', 'value': 'disabled'},
    ]

    states, ok = await api_extensions._batch_toggle_states(stub_engine, 'skill')

    assert ok is True
    assert states == {'skill-a': False}


@pytest.mark.asyncio
async def test_batch_toggle_states_fails_open_and_reports_ok_false_on_query_error(
    stub_engine,
):
    stub_engine.query_cypher.side_effect = RuntimeError('CypherEngineError-like boom')

    states, ok = await api_extensions._batch_toggle_states(stub_engine, 'skill')

    # Fail-open: an unreadable toggle scan must not deny/hide items, only
    # report that its answer is not to be trusted as a real read.
    assert states == {}
    assert ok is False


@pytest.mark.asyncio
async def test_batch_toggle_states_no_longer_reraises_a_503_http_exception(
    stub_engine,
):
    """Previously a 503 ``HTTPException`` from ``_invoke_governed_helper``
    (capacity exhausted / per-call deadline exceeded) was re-raised out of
    ``_batch_toggle_states``, which took the ENTIRE ``/api/enhanced/tools``
    response down over a toggle-preference outage alone -- inconsistent with
    every other failure mode this function already degrades instead of
    propagating. It must now degrade the same way."""
    with patch.object(
        api_extensions,
        '_invoke_governed_helper',
        AsyncMock(
            side_effect=api_extensions.HTTPException(
                status_code=503, detail='Synchronous backend deadline exceeded'
            )
        ),
    ):
        states, ok = await api_extensions._batch_toggle_states(stub_engine, 'skill')

    assert states == {}
    assert ok is False


# ---------------------------------------------------------------------------
# _batch_toggle_states_many
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_toggle_states_many_runs_scans_concurrently(stub_engine):
    """5 sequential 0.2s scans would take >= 1.0s; run through
    ``asyncio.gather`` they take close to a single scan's 0.2s."""

    async def _slow(engine, item_type):
        await asyncio.sleep(0.2)
        return {item_type: True}, True

    with patch.object(api_extensions, '_batch_toggle_states', _slow):
        started = time.monotonic()
        result = await api_extensions._batch_toggle_states_many(
            stub_engine,
            ['mcp_server', 'builtin_tool', 'skill', 'skill_workflow', 'skill_graph'],
        )
        elapsed = time.monotonic() - started

    assert elapsed < 0.5, (
        f'expected concurrent execution (~0.2s), took {elapsed:.2f}s -- '
        'looks sequential'
    )
    assert set(result) == {
        'mcp_server',
        'builtin_tool',
        'skill',
        'skill_workflow',
        'skill_graph',
    }
    for item_type, (states, ok) in result.items():
        assert ok is True
        assert states == {item_type: True}


@pytest.mark.asyncio
async def test_batch_toggle_states_many_empty_input_makes_no_calls(stub_engine):
    calls: list[str] = []

    async def _tracked(engine, item_type):
        calls.append(item_type)
        return {}, True

    with patch.object(api_extensions, '_batch_toggle_states', _tracked):
        result = await api_extensions._batch_toggle_states_many(stub_engine, [])

    assert result == {}
    assert calls == []


# ---------------------------------------------------------------------------
# list_all_tools wiring: concurrency + visible failure via `toggle_status`
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_all_tools_fetches_toggle_states_concurrently(
    monkeypatch, bounded_engine
) -> None:
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    call_count = 0

    async def _slow_batch_toggle_states(engine, item_type):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.2)
        return {}, True

    monkeypatch.setattr(
        api_extensions, '_batch_toggle_states', _slow_batch_toggle_states
    )

    catalog = {
        'servers': [_server_row(id='srv:a', name='server-a')],
        'discoveries': [],
        'skills': [_skill_row(id='skill-a', name='skill-a')],
        'prompts': [],
    }

    with _patch_catalog(catalog):
        started = time.monotonic()
        await api_extensions.list_all_tools()
        elapsed = time.monotonic() - started

    # servers present + a real `tools/` dir on disk + skills present -> all
    # 5 toggle item_types are requested.
    assert call_count == 5
    assert elapsed < 0.5, (
        f'expected concurrent execution (~0.2s), took {elapsed:.2f}s -- '
        'looks sequential'
    )


@pytest.mark.asyncio
async def test_list_all_tools_surfaces_a_toggle_batch_failure_via_toggle_status(
    monkeypatch, bounded_engine
) -> None:
    """A previously-silent fail-open (every toggle scan raising
    ``CypherEngineError`` on 100% of live calls, defaulting every item to
    "enabled" while looking like it worked) must now be visible in the
    response, not just in a redacted server log."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    async def _always_fails(engine, item_type):
        return {}, False

    monkeypatch.setattr(api_extensions, '_batch_toggle_states', _always_fails)

    catalog = {
        'servers': [_server_row(id='srv:a', name='server-a')],
        'discoveries': [],
        'skills': [_skill_row(id='skill-a', name='skill-a')],
        'prompts': [],
    }

    with _patch_catalog(catalog):
        result = await api_extensions.list_all_tools()

    assert result['toggle_status']['error']
    # Still fail-open (an outage here must not hide/disable real items).
    assert result['mcp_tools'][0]['enabled'] is True
    assert result['skills'][0]['enabled'] is True


@pytest.mark.asyncio
async def test_list_all_tools_toggle_status_is_healthy_when_all_batches_succeed(
    monkeypatch, bounded_engine
) -> None:
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    async def _ok(engine, item_type):
        return {}, True

    monkeypatch.setattr(api_extensions, '_batch_toggle_states', _ok)

    catalog = {
        'servers': [_server_row(id='srv:a', name='server-a')],
        'discoveries': [],
        'skills': [],
        'prompts': [],
    }

    with _patch_catalog(catalog):
        result = await api_extensions.list_all_tools()

    assert result['toggle_status']['error'] is None
