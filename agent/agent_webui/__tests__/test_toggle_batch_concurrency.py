"""Regression coverage for bounded toggle-state reads.

Covers:
  * ``_batch_toggle_states`` no longer re-raises a 503 ``HTTPException`` from
    ``invoke_governed_helper`` -- it fails open (same as every other error
    path it already handled) and reports the failure via its ``ok`` return
    value instead of taking the whole ``/api/enhanced/tools`` response down.
  * ``_batch_toggle_states`` returns ``(states, ok)`` so a caller can tell "no
    preferences set (real, healthy answer)" apart from "the scan itself
    failed (states are a fabricated fail-open default)".
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine
from agent_webui import api_extensions


@pytest.fixture
def stub_engine():
    engine = MagicMock(spec=IntelligenceGraphEngine)
    engine.query_cypher.return_value = []
    return engine


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
    """Previously a 503 ``HTTPException`` from ``invoke_governed_helper``
    (capacity exhausted / per-call deadline exceeded) was re-raised out of
    ``_batch_toggle_states``, which took the ENTIRE ``/api/enhanced/tools``
    response down over a toggle-preference outage alone -- inconsistent with
    every other failure mode this function already degrades instead of
    propagating. It must now degrade the same way."""
    with patch.object(
        api_extensions,
        'invoke_governed_helper',
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
