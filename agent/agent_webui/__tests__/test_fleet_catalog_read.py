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
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from agent_webui import api_extensions


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

    def _fake_authorized_rows(kind, *, tenant, principal, grant_digests, engine):
        calls.append(f'rows:{kind}')
        assert tenant == 'tenant-1'
        assert principal == 'principal-1'
        assert grant_digests == ('grant-a',)
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
        return []

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
            registry_api, '_authorized_rows', side_effect=_fake_authorized_rows
        ),
    ):
        result = await api_extensions._read_fleet_catalog('servers', 'skills')

    assert calls == ['auth', 'engine', 'rows:servers', 'rows:skills']
    assert result is not None
    assert [row['name'] for row in result['servers']] == ['x-mcp']
    assert result['skills'] == []


@pytest.mark.asyncio
async def test_read_fleet_catalog_returns_none_on_denied_authority():
    from agent_utilities.gateway import registry_api

    def _deny(*, require_discovery_binding: bool):
        raise PermissionError('registry authority is unavailable')

    with patch.object(registry_api, '_require_catalog_authority', side_effect=_deny):
        result = await api_extensions._read_fleet_catalog('servers')

    assert result is None


@pytest.mark.asyncio
async def test_read_fleet_catalog_returns_none_on_catalog_unavailable():
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
            '_authorized_rows',
            side_effect=registry_api.CatalogUnavailable('boom'),
        ),
    ):
        result = await api_extensions._read_fleet_catalog('servers')

    assert result is None
