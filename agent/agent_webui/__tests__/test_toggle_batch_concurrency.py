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

    states, ok = await api_extensions._batch_toggle_states(
        stub_engine, 'skill', ['skill-a']
    )

    assert ok is True
    assert states == {'skill-a': False}


@pytest.mark.asyncio
async def test_batch_toggle_states_queries_by_id_not_starts_with(stub_engine):
    """FIX LANE Priority 4: the deployed engine does not parse ``STARTS
    WITH`` with a bound-parameter operand at all (fails 5/5, live) -- the
    scan must be ``WHERE p.id IN $ids`` built from the exact ids rendered,
    never a prefix scan."""
    stub_engine.query_cypher.return_value = []

    await api_extensions._batch_toggle_states(
        stub_engine, 'skill', ['skill-a', 'skill-b']
    )

    query, params = stub_engine.query_cypher.call_args[0]
    assert 'STARTS WITH' not in query
    assert 'IN $ids' in query
    assert set(params['ids']) == {
        'preference:toggle:skill:skill-a',
        'preference:toggle:skill:skill-b',
    }


@pytest.mark.asyncio
async def test_batch_toggle_states_empty_ids_makes_no_call(stub_engine):
    states, ok = await api_extensions._batch_toggle_states(stub_engine, 'skill', [])

    assert states == {}
    assert ok is True
    stub_engine.query_cypher.assert_not_called()


@pytest.mark.asyncio
async def test_batch_toggle_states_fails_open_and_reports_ok_false_on_query_error(
    stub_engine,
):
    stub_engine.query_cypher.side_effect = RuntimeError('CypherEngineError-like boom')

    states, ok = await api_extensions._batch_toggle_states(
        stub_engine, 'skill', ['skill-a']
    )

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
        states, ok = await api_extensions._batch_toggle_states(
            stub_engine, 'skill', ['skill-a']
        )

    assert states == {}
    assert ok is False


# ---------------------------------------------------------------------------
# _batch_toggle_states_many
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_toggle_states_many_runs_scans_concurrently(stub_engine):
    """5 sequential 0.2s scans would take >= 1.0s; run through
    ``asyncio.gather`` they take close to a single scan's 0.2s."""

    async def _slow(engine, item_type, item_ids):
        await asyncio.sleep(0.2)
        return {item_type: True}, True

    with patch.object(api_extensions, '_batch_toggle_states', _slow):
        started = time.monotonic()
        result = await api_extensions._batch_toggle_states_many(
            stub_engine,
            {
                'mcp_server': ['a'],
                'builtin_tool': ['b'],
                'skill': ['c'],
                'skill_workflow': ['d'],
                'skill_graph': ['e'],
            },
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

    async def _tracked(engine, item_type, item_ids):
        calls.append(item_type)
        return {}, True

    with patch.object(api_extensions, '_batch_toggle_states', _tracked):
        result = await api_extensions._batch_toggle_states_many(stub_engine, {})

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

    async def _slow_batch_toggle_states(engine, item_type, item_ids):
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

    async def _always_fails(engine, item_type, item_ids):
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

    async def _ok(engine, item_type, item_ids):
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


@pytest.mark.asyncio
async def test_list_all_tools_toggle_status_names_the_degraded_item_types(
    monkeypatch, bounded_engine
) -> None:
    """FIX LANE Priority 4 (item 3): `ok` was already threaded per
    item_type, but every per-ITEM fallback still rendered "enabled" during
    an outage -- indistinguishable from a real preference. `toggle_status
    .degraded_item_types` names exactly which item_type(s) are not to be
    trusted, additive to the existing `error` field."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    async def _mixed(engine, item_type, item_ids):
        if item_type == 'skill':
            return {}, False
        return {}, True

    monkeypatch.setattr(api_extensions, '_batch_toggle_states', _mixed)

    catalog = {
        'servers': [_server_row(id='srv:a', name='server-a')],
        'discoveries': [],
        'skills': [_skill_row(id='skill-a', name='skill-a')],
        'prompts': [],
    }

    with _patch_catalog(catalog):
        result = await api_extensions.list_all_tools()

    assert result['toggle_status']['degraded_item_types'] == ['skill']


# ---------------------------------------------------------------------------
# get_toggle_state: row-governance id projection (FIX LANE Priority 4)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_toggle_state_projects_a_governed_id():
    engine = MagicMock()
    engine.query_cypher.return_value = [
        {'id': 'preference:toggle:skill:skill-a', 'value': 'disabled'}
    ]

    result = await api_extensions.get_toggle_state(engine, 'skill', 'skill-a')

    query, _params = engine.query_cypher.call_args.args
    assert 'AS id' in query
    assert result is False


@pytest.mark.asyncio
async def test_get_toggle_state_disabled_preference_is_not_swallowed_by_row_governance():
    """Regression proof for the exact reported defect: a preference written
    "disabled" must read back disabled, not silently degrade to the
    fail-open "enabled" default via a swallowed ``PermissionError``.

    Mirrors ``secured_reads.row_node_ids()``'s real contract: a row with NO
    governed id key raises ``PermissionError: Graph result contains a row
    without a governed node id`` -- which this function's broad ``except
    Exception`` previously turned into "enabled by default", indistinguishable
    from a genuinely-absent preference. With ``p.id AS id`` projected, the
    row is governable and the REAL persisted value is returned.
    """
    engine = MagicMock()

    def _governed_query_cypher(cypher, params):
        row = {'value': 'disabled'}
        if 'AS id' in cypher:
            row['id'] = params['pref_id']
        if 'id' not in row:
            raise PermissionError(
                'Graph result contains a row without a governed node id'
            )
        return [row]

    engine.query_cypher.side_effect = _governed_query_cypher

    result = await api_extensions.get_toggle_state(engine, 'skill', 'skill-a')

    assert result is False
