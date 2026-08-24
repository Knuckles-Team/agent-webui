"""FIX LANE Priority 3: the TTL + single-flight cache in front of
``_read_fleet_catalog``.

Measured without any caching: `/api/enhanced/tools` at 20.89s, `/api/registry
/skills?limit=1` at 9.84s, 5 identical back-to-back calls at 9.51/10.45/3.36/
11.67/2.96s (no warm-up), and a concurrency-4 dashboard burst timing out past
60s with `/graph/nodes`/`/graph/stats`/`/api/enhanced/skills` all returning
503. These tests prove the three load-bearing properties of the fix:
a cache hit costs zero engine calls, N concurrent misses on the SAME kind
collapse into exactly one fetch (the actual fix for the burst-503s), and the
free `last_synced_at` signal expires the cache early instead of always
waiting out the raw TTL.

The `_reset_fleet_catalog_cache` autouse fixture in this directory's
``conftest.py`` clears the cache before and after every test, so these tests
(and every other test file that patches ``_read_fleet_catalog``) never see
state left over from another test in the same pytest session.
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, patch

import pytest
from agent_webui import api_extensions


@pytest.mark.asyncio
async def test_cache_hit_serves_without_an_engine_call():
    calls = 0

    async def _fake_read(*kinds):
        nonlocal calls
        calls += 1
        return {kind: [{'id': f'{kind}-row'}] for kind in kinds}

    with patch.object(api_extensions, '_read_fleet_catalog', side_effect=_fake_read):
        first = await api_extensions._read_fleet_catalog_cached('servers')
        second = await api_extensions._read_fleet_catalog_cached('servers')

    assert calls == 1
    assert first == second == {'servers': [{'id': 'servers-row'}]}


@pytest.mark.asyncio
async def test_single_flight_collapses_concurrent_misses_into_one_fetch():
    calls = 0

    async def _fake_read(*kinds):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        return {kind: [{'id': f'{kind}-row'}] for kind in kinds}

    with patch.object(api_extensions, '_read_fleet_catalog', side_effect=_fake_read):
        results = await asyncio.gather(
            *(api_extensions._read_fleet_catalog_cached('skills') for _ in range(6))
        )

    assert calls == 1, 'six concurrent misses on the same kind must fetch once'
    assert all(r == {'skills': [{'id': 'skills-row'}]} for r in results)


@pytest.mark.asyncio
async def test_ttl_expiry_triggers_a_refetch(monkeypatch: pytest.MonkeyPatch):
    calls = 0

    async def _fake_read(*kinds):
        nonlocal calls
        calls += 1
        return {kind: [{'id': f'{kind}-{calls}'}] for kind in kinds}

    fake_now = 1000.0
    monkeypatch.setattr(time, 'monotonic', lambda: fake_now)

    with patch.object(api_extensions, '_read_fleet_catalog', side_effect=_fake_read):
        first = await api_extensions._read_fleet_catalog_cached('prompts')
        fake_now += api_extensions._FLEET_CATALOG_CACHE_TTL_SECONDS + 1
        second = await api_extensions._read_fleet_catalog_cached('prompts')

    assert calls == 2
    assert first != second


@pytest.mark.asyncio
async def test_a_failed_kind_is_never_cached():
    """A `None` (failed) kind must not be cached -- caching a failure would
    hide a transient outage for the whole TTL instead of retrying next
    request."""

    calls = 0

    async def _fake_read(*kinds):
        nonlocal calls
        calls += 1
        return dict.fromkeys(kinds)  # every kind fails

    with patch.object(api_extensions, '_read_fleet_catalog', side_effect=_fake_read):
        first = await api_extensions._read_fleet_catalog_cached('servers')
        second = await api_extensions._read_fleet_catalog_cached('servers')

    assert first == {'servers': None}
    assert second == {'servers': None}
    assert calls == 2, 'a failed read must be retried, never cached'


class TestNoteFleetCatalogSyncTime:
    def test_advancing_last_synced_at_expires_the_cache_early(self):
        api_extensions._fleet_catalog_cache_store('servers', [{'id': 'stale'}])

        api_extensions.note_fleet_catalog_sync_time('2026-08-24T00:00:00Z')
        hit, rows = api_extensions._fleet_catalog_cache_hit('servers')
        assert hit and rows == [{'id': 'stale'}]

        api_extensions.note_fleet_catalog_sync_time('2026-08-24T01:00:00Z')
        hit, _rows = api_extensions._fleet_catalog_cache_hit('servers')
        assert hit is False, 'a newer sync timestamp must drop the stale entry'

    def test_none_or_unchanged_timestamp_is_a_no_op(self):
        api_extensions._fleet_catalog_cache_store('servers', [{'id': 'kept'}])

        api_extensions.note_fleet_catalog_sync_time(None)
        api_extensions.note_fleet_catalog_sync_time('2026-08-24T00:00:00Z')
        api_extensions.note_fleet_catalog_sync_time('2026-08-24T00:00:00Z')

        hit, rows = api_extensions._fleet_catalog_cache_hit('servers')
        assert hit and rows == [{'id': 'kept'}]


@pytest.mark.asyncio
async def test_list_all_tools_serves_a_second_call_from_cache(
    mock_agent, mock_workspace_helpers, authenticated_client_factory
):
    """End-to-end: two `/api/enhanced/tools` requests, only one underlying
    fleet-catalog engine read."""
    from agent_webui.server import create_agent_web_app

    app = create_agent_web_app(mock_agent, mock_workspace_helpers)
    client = authenticated_client_factory(app, raise_server_exceptions=False)

    calls = 0

    async def _fake_read(*kinds):
        nonlocal calls
        calls += 1
        return dict.fromkeys(kinds, [])

    with (
        patch.object(
            api_extensions, '_get_engine_bounded', new=AsyncMock(return_value=None)
        ),
        patch.object(api_extensions, '_read_fleet_catalog', side_effect=_fake_read),
    ):
        r1 = client.get('/api/enhanced/tools')
        r2 = client.get('/api/enhanced/tools')

    assert r1.status_code == 200
    assert r2.status_code == 200
    # `list_all_tools` reads 4 kinds (servers, discoveries, skills, prompts)
    # -- the FIRST request is a miss on each, one fetch per kind; the SECOND
    # request is a hit on all 4 and adds zero calls.
    assert calls == 4
