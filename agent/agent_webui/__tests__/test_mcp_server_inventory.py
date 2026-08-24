"""Fleet-catalog-backed tests for the MCP-servers inventory (`GET
/api/enhanced/tools`, ``list_all_tools`` in ``api_extensions.py``).

Historically ``mcp_tools`` was sourced from a live ``shared_multiplexer``
probe (GOC-60-W03/W04a), with a filesystem ``SKILL.md`` scan for skills and a
separate KG ``CallableResource``/``WorkflowDefinition`` cross-reference for
classification -- THREE different sources for one response. The SQL fleet
catalog (``agent_utilities.knowledge_graph.core.fleet_catalog_tables`` /
``agent_utilities.gateway.registry_api``, CONCEPT:AU-KG.ingest.fleet-catalog-relational-tables)
is now the single source of truth for all three, read in-process via
``api_extensions._read_fleet_catalog``. These tests replace the old
multiplexer-sourced suite; the invariant they still enforce -- a missing or
failed data source is an ERROR/DEGRADED state, never a silent, indistinguishable
``[]`` -- carries over unchanged, translated onto the new source.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine
from agent_webui import api_extensions


@pytest.fixture
def stub_engine():
    """A minimal ``spec``-bound engine double for ``get_toggle_state``'s
    ``query_cypher`` call only -- see the equivalent fixture this replaces
    for why this is not the shared ``mock_graph_engine`` fixture."""
    engine = MagicMock(spec=IntelligenceGraphEngine)
    engine.query_cypher.return_value = []
    return engine


@pytest.fixture
def bounded_engine(stub_engine):
    async def _get_engine():
        return stub_engine

    return _get_engine


def _patch_catalog(rows: Mapping[str, list[dict[str, Any]] | None] | None):
    return patch(
        'agent_webui.api_extensions._read_fleet_catalog',
        AsyncMock(return_value=rows),
    )


def _server_row(
    *, id: str, name: str, enabled: bool = True, transport: str = 'http', url: str = ''
) -> dict[str, Any]:
    return {
        'id': id,
        'name': name,
        'transport': transport,
        'url': url,
        'enabled': enabled,
    }


def _discovery_row(
    *,
    server_id: str,
    server_name: str,
    reachable: bool,
    tool_count: int = 0,
    last_error: str = '',
    observed_at: str = '2026-08-22T00:00:00Z',
) -> dict[str, Any]:
    return {
        'id': f'disc:{server_id}:{observed_at}',
        'server_id': server_id,
        'server_name': server_name,
        'reachable': reachable,
        'last_error': last_error,
        'tool_count': tool_count,
        'skill_count': 0,
        'prompt_count': 0,
        'resource_count': 0,
        'observed_at': observed_at,
    }


@pytest.mark.asyncio
async def test_list_all_tools_sources_mcp_servers_from_the_sql_catalog(
    monkeypatch, bounded_engine
) -> None:
    """``mcp_tools`` is read from the SQL `servers`/`discoveries` tables,
    never the shared multiplexer."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    catalog = {
        'servers': [
            _server_row(id='srv:github-api', name='github-api'),
            _server_row(id='srv:servicenow-secops', name='servicenow-secops'),
        ],
        'discoveries': [
            _discovery_row(
                server_id='srv:github-api',
                server_name='github-api',
                reachable=True,
                tool_count=12,
            ),
            _discovery_row(
                server_id='srv:servicenow-secops',
                server_name='servicenow-secops',
                reachable=True,
                tool_count=6,
            ),
        ],
        'skills': [],
        'prompts': [],
    }

    with _patch_catalog(catalog):
        result = await api_extensions.list_all_tools()

    names = {row['name'] for row in result['mcp_tools']}
    assert names == {'github-api', 'servicenow-secops'}
    assert result['mcp_status']['source'] == 'sql_catalog'
    assert result['mcp_status']['error'] is None
    by_name = {row['name']: row for row in result['mcp_tools']}
    assert by_name['github-api']['tool_count'] == 12
    assert by_name['github-api']['status'] == 'active'


@pytest.mark.asyncio
async def test_list_all_tools_never_renders_a_catalog_failure_as_a_silent_empty_list(
    monkeypatch, bounded_engine
) -> None:
    """A failed/denied catalog read (``_read_fleet_catalog`` -> ``None``) is
    an ERROR/DEGRADED state, never a silent ``[]`` with ``error: null``."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    with _patch_catalog(None):
        result = await api_extensions.list_all_tools()

    assert result['mcp_tools'] == []
    assert result['mcp_status']['source'] == 'unavailable'
    assert result['mcp_status']['error']
    assert result['skill_classification']['kg_reachable'] is False


@pytest.mark.asyncio
async def test_list_all_tools_distinguishes_not_yet_synced_from_genuinely_empty(
    monkeypatch, bounded_engine
) -> None:
    """The catalog tables are populated by the hourly
    ``fleet-tool-schema-sync`` job -- a reachable catalog with zero rows and
    NO recorded discovery observation must say "not yet synced", never read
    identically to a real, healthy, empty fleet."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    with _patch_catalog(
        {'servers': [], 'discoveries': [], 'skills': [], 'prompts': []}
    ):
        result = await api_extensions.list_all_tools()

    assert result['mcp_tools'] == []
    assert result['mcp_status']['source'] == 'sql_catalog'
    assert result['mcp_status']['error'] is not None
    assert 'fleet-tool-schema-sync' in result['mcp_status']['error']
    assert result['mcp_status']['last_synced_at'] is None


@pytest.mark.asyncio
async def test_list_all_tools_reports_a_genuinely_empty_fleet_as_healthy(
    monkeypatch, bounded_engine
) -> None:
    """The complement of the test above: the catalog HAS been synced (a
    discovery observation is on record) and genuinely found zero servers --
    that is an honest, healthy answer, not a missing-sync warning."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    # A discovery row can outlive its server (append-only history), so its
    # presence alone is evidence a sync ran even though `servers` is empty.
    with _patch_catalog(
        {
            'servers': [],
            'discoveries': [
                _discovery_row(
                    server_id='srv:removed',
                    server_name='removed-server',
                    reachable=False,
                    observed_at='2026-08-22T01:00:00Z',
                )
            ],
            'skills': [],
            'prompts': [],
        }
    ):
        result = await api_extensions.list_all_tools()

    assert result['mcp_tools'] == []
    assert result['mcp_status']['source'] == 'sql_catalog'
    assert result['mcp_status']['last_synced_at'] == '2026-08-22T01:00:00Z'
    assert 'no servers registered' in result['mcp_status']['error']


@pytest.mark.asyncio
async def test_list_all_tools_marks_an_unreachable_server_from_its_latest_discovery(
    monkeypatch, bounded_engine
) -> None:
    """`status` reflects the MOST RECENT discovery row per server (the
    discovery table is append-only), not an arbitrary/first one."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    with _patch_catalog(
        {
            'servers': [_server_row(id='srv:flaky', name='flaky-mcp')],
            'discoveries': [
                _discovery_row(
                    server_id='srv:flaky',
                    server_name='flaky-mcp',
                    reachable=True,
                    observed_at='2026-08-22T00:00:00Z',
                ),
                _discovery_row(
                    server_id='srv:flaky',
                    server_name='flaky-mcp',
                    reachable=False,
                    last_error='unavailable',
                    observed_at='2026-08-22T02:00:00Z',
                ),
            ],
            'skills': [],
            'prompts': [],
        }
    ):
        result = await api_extensions.list_all_tools()

    row = result['mcp_tools'][0]
    assert row['status'] == 'unavailable'
    assert row['error'] == 'unavailable'


@pytest.mark.asyncio
async def test_list_all_tools_classifies_skills_from_the_sql_skill_type_column(
    monkeypatch, bounded_engine
) -> None:
    """Skills/graphs/workflows are bucketed directly from the catalog's own
    `skill_type` column (written by the sync job's `classify_skill_type`) --
    never a filesystem scan or a separate KG resource-type cross-reference."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    with _patch_catalog(
        {
            'servers': [],
            'discoveries': [],
            'skills': [
                {
                    'id': 'skill-a',
                    'name': 'skill-a',
                    'description': '',
                    'uri': '',
                    'skill_type': 'skill',
                    'classification': 'Atomic Skill',
                    'provider': '',
                    'mcp_server': '',
                    'enabled': True,
                },
                {
                    'id': 'workflow-a',
                    'name': 'workflow-a',
                    'description': '',
                    'uri': 'skill://workflow-a',
                    'skill_type': 'workflow',
                    'classification': 'Workflow',
                    'provider': '',
                    'mcp_server': '',
                    'enabled': True,
                },
                {
                    'id': 'graph-a',
                    'name': 'graph-a',
                    'description': '',
                    'uri': 'skill://graph-a',
                    'skill_type': 'graph',
                    'classification': 'Skill Graph',
                    'provider': '',
                    'mcp_server': '',
                    'enabled': True,
                },
            ],
            'prompts': [],
        }
    ):
        result = await api_extensions.list_all_tools()

    assert [s['id'] for s in result['skills']] == ['skill-a']
    assert result['skills'][0]['runnable'] is True
    assert result['skills'][0]['resource_type'] == 'AGENT_SKILL'
    assert [w['id'] for w in result['skill_workflows']] == ['workflow-a']
    assert result['skill_workflows'][0]['runnable'] is False
    assert result['skill_workflows'][0]['resource_type'] == 'WORKFLOW_DEFINITION'
    assert [g['id'] for g in result['skill_graphs']] == ['graph-a']
    assert result['skill_unclassified'] == []
    summary = result['skill_classification']
    assert summary['kg_reachable'] is True
    assert summary['runnable_count'] == 1
    assert summary['describe_only_count'] == 1
    assert summary['unclassified_count'] == 0


@pytest.mark.asyncio
async def test_list_all_tools_surfaces_the_sql_prompts_table(
    monkeypatch, bounded_engine
) -> None:
    """`mcp_prompts` -- previously never surfaced anywhere in this app --
    comes straight from the SQL catalog's `prompts` kind."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    with _patch_catalog(
        {
            'servers': [],
            'discoveries': [],
            'skills': [],
            'prompts': [
                {
                    'id': 'prompt:1',
                    'server_id': 'srv:a',
                    'server_name': 'server-a',
                    'name': 'greeting',
                    'description': 'A greeting prompt',
                    'uri': '',
                }
            ],
        }
    ):
        result = await api_extensions.list_all_tools()

    assert [p['name'] for p in result['mcp_prompts']] == ['greeting']


@pytest.mark.asyncio
async def test_list_all_tools_batches_toggle_state_reads_not_per_row(
    monkeypatch, bounded_engine, stub_engine
) -> None:
    """Root-cause regression test for the ``/api/enhanced/tools`` hang that
    never returned (measured live: >120s, timed out). ``list_all_tools``
    used to call ``get_toggle_state`` -- one ``engine.query_cypher`` round
    trip through ``_invoke_governed_helper``'s bounded synchronous executor
    -- once PER ROW across servers/builtin_tools/skills, up to ~1000
    sequential calls for a full catalog. ``_batch_toggle_states`` replaces
    that with ONE round trip per toggle ``item_type``. However many rows the
    catalog holds, the number of ``query_cypher`` calls must stay a small,
    FIXED constant -- never scale with the listing size."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    catalog = {
        'servers': [_server_row(id=f'srv:{i}', name=f'server-{i}') for i in range(300)],
        'discoveries': [],
        'skills': [
            {
                'id': f'skill-{i}',
                'name': f'skill-{i}',
                'description': '',
                'uri': '',
                'skill_type': 'skill',
                'classification': 'Atomic Skill',
                'provider': '',
                'mcp_server': '',
                'enabled': True,
            }
            for i in range(300)
        ],
        'prompts': [],
    }

    with _patch_catalog(catalog):
        result = await api_extensions.list_all_tools()

    # Bounded to the collection cap, not the 300 rows fed in -- proves the
    # route still returns a paged/bounded contract, not an ever-growing
    # response.
    assert len(result['mcp_tools']) == 256
    assert len(result['skills']) == 256
    # ONE `query_cypher` round trip per toggle item_type this route actually
    # uses (mcp_server, builtin_tool, skill, skill_workflow, skill_graph) --
    # never one per row, regardless of how many servers/skills the catalog
    # holds.
    assert stub_engine.query_cypher.call_count <= 5


# ---------------------------------------------------------------------------
# Defect A/B (FIX LANE 2): per-kind-independent catalog degradation, and an
# unambiguous, non-nested failure signal for `skills` matching `mcp_tools`'s
# existing `mcp_status.error`.
#
# Live root cause: `_read_fleet_catalog` fetched `servers`, `discoveries`,
# `skills`, `prompts` SEQUENTIALLY and returned `None` (discarding
# everything) the instant ANY one of them failed. `skills` was read third,
# so a `servers` hiccup alone produced THREE simultaneously-reported bugs
# from one cause: "No MCP servers registered", "The MCP fleet catalog could
# not be read", and an empty skills list -- skills was never even attempted.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_all_tools_a_failed_servers_kind_does_not_discard_a_healthy_skills_kind(
    monkeypatch, bounded_engine
) -> None:
    """Reproduces, then proves fixed, the exact live pattern: `servers`
    failed (`None`) while `skills` succeeded. Before the fix this was
    unreachable -- `_read_fleet_catalog` returned a single `None` for the
    whole four-kind read the moment `servers` failed, so `skills` was never
    read at all regardless of its own health."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    with _patch_catalog(
        {
            'servers': None,
            'discoveries': None,
            'skills': [
                {
                    'id': 'skill-a',
                    'name': 'skill-a',
                    'description': '',
                    'uri': '',
                    'skill_type': 'skill',
                    'classification': 'Atomic Skill',
                    'provider': '',
                    'mcp_server': '',
                    'enabled': True,
                }
            ],
            'prompts': [],
        }
    ):
        result = await api_extensions.list_all_tools()

    # The failed kind is reported as a genuine, unambiguous error...
    assert result['mcp_tools'] == []
    assert result['mcp_status']['source'] == 'unavailable'
    assert result['mcp_status']['error']
    # ...while the healthy kind, fetched independently, is NOT discarded.
    assert [s['id'] for s in result['skills']] == ['skill-a']
    assert result['skill_status']['source'] == 'sql_catalog'
    assert result['skill_status']['error'] is None
    assert result['skill_classification']['kg_reachable'] is True


@pytest.mark.asyncio
async def test_list_all_tools_skill_status_is_a_top_level_unambiguous_failure_signal(
    monkeypatch, bounded_engine
) -> None:
    """Defect B: `skills` previously had NO signal of its own for "the read
    failed" other than `skill_classification.kg_reachable`, three levels
    deep. `skill_status` now mirrors `mcp_status`'s shape at the SAME top
    level, so a caller can check `.error` the same way for either."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    with _patch_catalog(
        {'servers': [], 'discoveries': [], 'skills': None, 'prompts': []}
    ):
        failed = await api_extensions.list_all_tools()

    assert failed['skill_status']['source'] == 'unavailable'
    assert failed['skill_status']['error']
    assert failed['skill_classification']['kg_reachable'] is False
    assert failed['skills'] == []

    with _patch_catalog(
        {'servers': [], 'discoveries': [], 'skills': [], 'prompts': []}
    ):
        empty = await api_extensions.list_all_tools()

    # The complement: a reachable, genuinely empty skills catalog is healthy
    # -- distinguishable from the failure case above by `.error`, not by
    # `skills == []` (both cases have an empty list; only `skill_status`
    # tells them apart).
    assert empty['skill_status']['source'] == 'sql_catalog'
    assert empty['skill_status']['error'] is None
    assert empty['skill_classification']['kg_reachable'] is True
    assert empty['skills'] == []


@pytest.mark.asyncio
async def test_list_all_tools_prompts_kind_degrades_independently(
    monkeypatch, bounded_engine
) -> None:
    """`prompts` failing must not affect `servers`/`skills`, and vice versa
    -- each of the four requested kinds is independent."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    with _patch_catalog(
        {
            'servers': [_server_row(id='srv:a', name='server-a')],
            'discoveries': [],
            'skills': [],
            'prompts': None,
        }
    ):
        result = await api_extensions.list_all_tools()

    assert result['mcp_prompts'] == []
    assert result['mcp_prompts_status']['error']
    # Unaffected by the `prompts` failure.
    assert [t['name'] for t in result['mcp_tools']] == ['server-a']
    assert result['mcp_status']['error'] is None


@pytest.mark.asyncio
async def test_list_all_tools_discoveries_failure_is_noted_but_servers_still_list(
    monkeypatch, bounded_engine
) -> None:
    """`discoveries` failing independently of `servers` still lists the
    known servers (best-effort -- registration is still real data) but
    flags that their live health/reachability could not be read, rather
    than silently reporting them as healthy."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    with _patch_catalog(
        {
            'servers': [_server_row(id='srv:a', name='server-a')],
            'discoveries': None,
            'skills': [],
            'prompts': [],
        }
    ):
        result = await api_extensions.list_all_tools()

    assert [t['name'] for t in result['mcp_tools']] == ['server-a']
    assert result['mcp_status']['error']
    assert 'discovery' in result['mcp_status']['error'].lower()
