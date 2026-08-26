"""Wiring proof for ``api_extensions._read_fleet_catalog``.

Unlike ``test_mcp_server_inventory.py`` (which patches
``api_extensions._read_fleet_catalog`` itself to test the routes' shaping
logic), these tests patch ONLY the low-level private functions inside
``agent_utilities.gateway.registry_api`` -- the real, in-process, tenant-scoped
SQL catalog read path (CONCEPT:AU-KG.ingest.fleet-catalog-relational-tables)
this app's own ``/api/registry/*`` routes use (mounted by
``register_graph_routes`` -> ``register_registry_routes`` in ``server.py``).
This proves ``_read_fleet_catalog`` actually reaches that path end to end,
not just that some other test's mock of ``_read_fleet_catalog`` behaves as
expected.

These tests patch ``_authorized_page`` (the real, current, paginated
registry_api entrypoint ``_read_fleet_catalog`` calls) -- earlier versions of
this file patched a ``_authorized_rows`` name that no longer exists in
``registry_api`` at all (it was renamed to the paginated ``_authorized_page``
some time ago), which meant 2 of these 3 tests had been silently failing
with ``AttributeError`` on every run since, undetected because nothing here
gates on this suite's own green/red status. Fixed as part of the FIX LANE 2
per-kind-degradation change below, which these tests now also cover.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from agent_webui import api_extensions


def _fake_page(rows_by_kind: dict[str, list[dict]], calls: list[str] | None = None):
    """A drop-in ``_authorized_page`` replacement returning ``rows_by_kind[kind]``
    on the first page and an empty page thereafter (so the keyset-pagination
    loop in ``_read_fleet_catalog`` terminates after one round trip)."""

    def _page(kind, *, tenant, principal, grant_digests, query, after, limit, engine):
        if calls is not None:
            calls.append(f'rows:{kind}')
        if after is not None:
            return []
        return list(rows_by_kind.get(kind, []))

    return _page


@pytest.mark.asyncio
async def test_read_fleet_catalog_calls_the_real_registry_api_read_path():
    from agent_utilities.gateway import registry_api

    calls: list[str] = []

    def _fake_require_catalog_authority(*, require_discovery_binding: bool):
        calls.append('auth')
        assert require_discovery_binding is True
        return 'tenant-1', 'principal-1', ('grant-a',)

    def _fake_get_catalog_engine():
        calls.append('engine')
        return object()

    with (
        patch.object(
            registry_api,
            '_require_catalog_authority',
            side_effect=_fake_require_catalog_authority,
        ),
        patch.object(
            registry_api, '_get_catalog_engine', side_effect=_fake_get_catalog_engine
        ),
        patch.object(
            registry_api,
            '_authorized_page',
            side_effect=_fake_page(
                {
                    'servers': [
                        {
                            'id': 'srv:x',
                            'tenant_id': 'tenant-1',
                            'name': 'x-mcp',
                            'transport': 'http',
                            'url': '',
                            'enabled': True,
                        }
                    ]
                },
                calls,
            ),
        ),
    ):
        result = await api_extensions._read_fleet_catalog('servers', 'skills')

    assert calls == ['auth', 'engine', 'rows:servers', 'rows:skills']
    assert result is not None
    servers = result['servers']
    assert servers is not None
    assert [row['name'] for row in servers] == ['x-mcp']
    assert result['skills'] == []


@pytest.mark.asyncio
async def test_read_fleet_catalog_returns_none_on_denied_authority():
    """Total failure (authority denied before any kind-specific read is even
    attempted) still returns the WHOLE mapping as ``None`` -- unchanged from
    before per-kind degradation existed, since there is no per-kind result to
    report at all in this case."""
    from agent_utilities.gateway import registry_api

    def _deny(*, require_discovery_binding: bool):
        raise PermissionError('registry authority is unavailable')

    with patch.object(registry_api, '_require_catalog_authority', side_effect=_deny):
        result = await api_extensions._read_fleet_catalog('servers')

    assert result is None


@pytest.mark.asyncio
async def test_read_fleet_catalog_degrades_one_failed_kind_to_none_not_the_whole_mapping():
    """Defect A: a SINGLE kind's read failing (``CatalogUnavailable`` from
    ``_authorized_page``) must degrade ONLY that kind to ``None`` inside the
    returned mapping -- the whole-mapping ``None`` sentinel is now reserved
    for a total, pre-kind-loop authority failure. Before this fix,
    ``_read_fleet_catalog`` returned ``None`` for the WHOLE multi-kind read
    the instant any single requested kind failed, discarding a
    perfectly-healthy read of every other kind already fetched (or about to
    be fetched) alongside it -- the confirmed live root cause of three
    simultaneously-reported bugs ("No MCP servers registered", "The MCP
    fleet catalog could not be read", and an empty skills list) all stemming
    from ONE ``servers`` failure, since ``skills`` was read third of four and
    never reached.
    """
    from agent_utilities.gateway import registry_api

    def _page(kind, *, tenant, principal, grant_digests, query, after, limit, engine):
        if kind == 'servers':
            raise registry_api.CatalogUnavailable('servers scan failed')
        if after is not None:
            return []
        if kind == 'skills':
            return [
                {
                    'id': 'skill-1',
                    'name': 'skill-1',
                    'description': '',
                    'uri': '',
                    'skill_type': 'skill',
                    'classification': 'Atomic Skill',
                    'provider': '',
                    'mcp_server': '',
                    'enabled': True,
                }
            ]
        return []

    with (
        patch.object(
            registry_api,
            '_require_catalog_authority',
            return_value=('t', 'p', ()),
        ),
        patch.object(registry_api, '_get_catalog_engine', return_value=object()),
        patch.object(registry_api, '_authorized_page', side_effect=_page),
    ):
        result = await api_extensions._read_fleet_catalog('servers', 'skills')

    assert result is not None, (
        'a single failed kind must not discard the whole multi-kind read'
    )
    assert result['servers'] is None
    assert result['skills'] is not None
    assert [row['name'] for row in result['skills']] == ['skill-1']


@pytest.mark.asyncio
async def test_read_fleet_catalog_respects_the_overall_wall_clock_budget():
    """A kind not yet reached once the overall budget
    (``_FLEET_CATALOG_TOTAL_DEADLINE_SECONDS``) is exhausted degrades to
    ``None`` rather than the walk continuing indefinitely -- `skills` alone
    can need ~9 paginated round trips, each independently deadline-bound at
    up to 10s, so without a total cap a 4-kind read had no upper bound at
    all."""
    from agent_utilities.gateway import registry_api

    def _page(kind, *, tenant, principal, grant_digests, query, after, limit, engine):
        if kind == 'servers':
            return [
                {
                    'id': 'srv:x',
                    'tenant_id': tenant,
                    'name': 'x-mcp',
                    'transport': 'http',
                    'url': '',
                    'enabled': True,
                }
            ]
        raise AssertionError(f'kind {kind!r} must not be reached: budget exhausted')

    with (
        patch.object(
            registry_api,
            '_require_catalog_authority',
            return_value=('t', 'p', ()),
        ),
        patch.object(registry_api, '_get_catalog_engine', return_value=object()),
        patch.object(registry_api, '_authorized_page', side_effect=_page),
        patch.object(api_extensions, '_FLEET_CATALOG_TOTAL_DEADLINE_SECONDS', 0.0),
    ):
        result = await api_extensions._read_fleet_catalog('servers', 'skills')

    assert result is not None
    # `servers` is attempted first with `remaining_total <= 0` already true,
    # so the budget check must trip BEFORE the first page fetch for it too.
    assert result['servers'] is None
    assert result['skills'] is None


@pytest.mark.asyncio
async def test_read_fleet_catalog_returns_the_kind_as_none_on_catalog_unavailable():
    from agent_utilities.gateway import registry_api

    with (
        patch.object(
            registry_api,
            '_require_catalog_authority',
            return_value=('t', 'p', ()),
        ),
        patch.object(registry_api, '_get_catalog_engine', return_value=object()),
        patch.object(
            registry_api,
            '_authorized_page',
            side_effect=registry_api.CatalogUnavailable('boom'),
        ),
    ):
        result = await api_extensions._read_fleet_catalog('servers')

    assert result == {'servers': None}
