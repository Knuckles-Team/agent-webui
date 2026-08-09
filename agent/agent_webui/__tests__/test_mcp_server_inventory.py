"""Failing-first + regression tests for the MCP-servers inventory (GOC-60-W04a).

CONCEPT:AU-ECO.mcp.webui-mcp-server-inventory

GOC-60 lane evidence E2 (break 1): ``api_extensions.list_all_tools`` called
``engine.get_all_mcp_servers()`` -- at the time the lane was written,
``RegistryMixin`` (``agent_utilities/core/registry/kg_adapter.py``) never
defined that method (it only ever exposed ``get_all_prompts``/
``get_skills``/``get_tools``), so every call raised ``AttributeError``,
silently swallowed by a bare ``except Exception``, leaving ``mcp_tools``
permanently ``[]`` -- "No MCP servers registered" was the EXPECTED
steady-state output of ``GET /api/enhanced/tools``, not a transient outage.
Reproduced live during this lane's RED capture (see the failing-first commit
message for the exact ``error_type=AttributeError`` log line).

NOTE ON A CONCURRENT LANDING: a separate, concurrent worker independently
added a KG-node-sourced ``get_all_mcp_servers()`` to ``RegistryMixin``
(``agent-utilities`` commit ``a1a9f173``, "placement catalog + engine-surface
tools") while this lane was in flight, so the method now exists on current
``main`` -- an AttributeError-pinning test against the live class would be
stale and is intentionally NOT kept here. This lane's fix does not call that
method either way: it sources ``mcp_tools`` from
``agent_utilities.mcp.shared_multiplexer`` (GOC-60-W03), which the lane's own
evidence (E5) identifies as the more accurate source -- LIVE, per-session
dispatchable truth derived from the same predicate the real dispatch gate
enforces, vs. the KG method's periodically-ingested ``:MCPServer`` nodes.
``test_list_all_tools_sources_mcp_servers_from_the_shared_multiplexer`` below
is the RED/GREEN test: it failed against the pre-fix code (which never even
attempted to read the shared multiplexer) and passes once ``list_all_tools``
is wired to it (GOC-60-W03/W04a).
"""

from __future__ import annotations

import sys
import types
from collections.abc import Callable
from typing import Any

import pytest
from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine
from agent_webui import api_extensions


@pytest.fixture
def install_shared_multiplexer(monkeypatch) -> Callable[[Callable[[], Any]], None]:
    """Install a fake ``agent_utilities.mcp.shared_multiplexer`` module.

    GOC-60-W03 (this lane) adds ``agent_utilities/mcp/shared_multiplexer.py``
    in a SEPARATE worktree/branch of the ``agent-utilities`` repository (per
    the program's per-repo worktree isolation rule -- these two repos are
    developed and merged independently). This test suite must not depend on
    that branch already being merged into the ``agent_utilities`` checkout
    this environment resolves imports against, so the module is injected via
    ``sys.modules`` rather than assumed to exist on disk. The injected
    module's ``get_shared_multiplexer`` shape matches the real one built by
    this lane 1:1 (see ``agent_utilities/tests/unit/server/test_mcp_catalog_routes.py``
    and ``test_webui_mcp_delegation.py`` in the ``agent-utilities`` worktree
    for the source-of-truth contract test).
    """

    def _install(get_shared_multiplexer: Callable[[], Any]) -> None:
        fake_module = types.ModuleType('agent_utilities.mcp.shared_multiplexer')
        fake_module.get_shared_multiplexer = get_shared_multiplexer  # type: ignore[attr-defined]
        monkeypatch.setitem(
            sys.modules, 'agent_utilities.mcp.shared_multiplexer', fake_module
        )

    return _install


class _StubMultiplexer:
    """Deterministic stand-in for ``agent_utilities.mcp.shared_multiplexer``'s
    shared instance -- only the ``list_catalog`` surface ``list_all_tools``
    consumes."""

    def __init__(
        self, servers: list[dict[str, Any]] | None = None, *, boom: bool = False
    ):
        self._servers = servers or []
        self._boom = boom

    async def list_catalog(self, server: str = '', include_tools: bool = True) -> dict:
        if self._boom:
            raise RuntimeError('catalog probe exploded')
        assert server == ''  # the servers panel always does a fleet-wide browse
        assert (
            include_tools is False
        )  # metadata-only: no whole-fleet probe from a list endpoint
        return {
            'total_servers': len(self._servers),
            'total_tools': sum(s.get('tool_count', 0) for s in self._servers),
            'servers_running': [],
            'unavailable': [
                s['server'] for s in self._servers if s.get('available') is False
            ],
            'servers': self._servers,
        }


@pytest.fixture
def stub_engine():
    """A minimal ``spec``-bound engine double for ``get_toggle_state``'s
    ``query_cypher`` call only.

    Deliberately NOT the shared ``mock_graph_engine`` fixture
    (``tests/conftest.py``): that fixture additionally constructs a real
    ``GraphComputeEngine()``, whose ``__init__`` resolves a tenant-scoped
    routing graph against ``current_actor()`` -- requiring a verified actor
    context this focused unit test has no reason to stand up. ``list_all_tools``
    only ever calls ``engine.query_cypher`` (via ``get_toggle_state``), so
    that is the only surface stubbed here.
    """
    from unittest.mock import MagicMock

    engine = MagicMock(spec=IntelligenceGraphEngine)
    engine.query_cypher.return_value = []
    return engine


@pytest.fixture
def bounded_engine(stub_engine):
    async def _get_engine():
        return stub_engine

    return _get_engine


@pytest.mark.asyncio
async def test_list_all_tools_sources_mcp_servers_from_the_shared_multiplexer(
    monkeypatch, bounded_engine, install_shared_multiplexer
) -> None:
    """RED before the GOC-60-W04a fix (mcp_tools stays [] because the code
    never reads the shared multiplexer at all); GREEN after."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    stub = _StubMultiplexer(
        [
            {
                'server': 'github-api',
                'tool_count': 12,
                'enabled_count': 12,
                'process_running': False,
                'probed': True,
                'available': True,
            },
            {
                'server': 'servicenow-secops',
                'tool_count': 6,
                'enabled_count': 4,
                'process_running': True,
                'probed': True,
                'available': True,
            },
        ]
    )

    async def _get_shared_multiplexer() -> Any:
        return stub

    install_shared_multiplexer(_get_shared_multiplexer)

    result = await api_extensions.list_all_tools()

    names = {row['name'] for row in result['mcp_tools']}
    assert names == {'github-api', 'servicenow-secops'}
    assert result['mcp_status'] == {'source': 'multiplexer', 'error': None}


@pytest.mark.asyncio
async def test_list_all_tools_never_renders_a_multiplexer_failure_as_a_silent_empty_list(
    monkeypatch, bounded_engine, tmp_path, install_shared_multiplexer
) -> None:
    """GOC-60 lane authority/invariant 1: a missing data source is an
    ERROR/DEGRADED state, never a silent ``[]``. With BOTH the multiplexer
    and the static-config fallback unavailable, ``mcp_tools`` is legitimately
    empty -- but ``mcp_status`` must say so explicitly.
    """
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    async def _boom() -> Any:
        raise RuntimeError('shared multiplexer failed to construct')

    install_shared_multiplexer(_boom)
    monkeypatch.setattr(api_extensions, '_mcp_inventory_path', lambda: None)

    result = await api_extensions.list_all_tools()

    assert result['mcp_tools'] == []
    assert result['mcp_status']['source'] == 'unavailable'
    assert 'RuntimeError' in (result['mcp_status']['error'] or '')


@pytest.mark.asyncio
async def test_list_all_tools_labels_the_static_fallback_as_degraded_not_equivalent(
    monkeypatch, bounded_engine, tmp_path, install_shared_multiplexer
) -> None:
    """When the multiplexer is down, the static ``mcp_config.json`` fallback
    must stay VISIBLE as a narrower, degraded source (GOC-60-W04a) -- not a
    silent equivalent substitute for the fleet-wide catalog."""
    import json

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    async def _boom() -> Any:
        raise RuntimeError('multiplexer down')

    install_shared_multiplexer(_boom)

    config_path = tmp_path / 'mcp_config.json'
    config_path.write_text(
        json.dumps({'mcpServers': {'legacy-fs': {'command': 'true'}}})
    )
    monkeypatch.setattr(api_extensions, '_mcp_inventory_path', lambda: config_path)

    result = await api_extensions.list_all_tools()

    assert [row['name'] for row in result['mcp_tools']] == ['legacy-fs']
    assert result['mcp_status']['source'] == 'static-config-degraded'
    # The underlying multiplexer failure stays visible even though the
    # degraded fallback produced usable data.
    assert 'RuntimeError' in (result['mcp_status']['error'] or '')
