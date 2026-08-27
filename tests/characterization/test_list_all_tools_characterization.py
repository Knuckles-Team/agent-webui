"""Supplementary characterization tests for ``list_all_tools`` (CX-WEB-01).

``agent/agent_webui/__tests__/test_mcp_server_inventory.py`` already covers
``mcp_tools``/``mcp_status``/``skills``/``skill_classification``/``prompts``
extensively (13 tests, all still green against this lane's refactor -- see
the lane report). This file pins the two sections that suite does NOT touch
at all: the ``builtin_tools`` filesystem scan and the ``toggle_status``
degraded-read signal -- both extracted into their own helper functions
(``_build_builtin_tools_section``, ``_toggle_status_section``) by this
lane's refactor.

Written and proven GREEN against the unmodified function (commit 1 of the
CX-WEB-01 two-commit discipline: characterize, then refactor). Must remain
byte-identical and green through commit 2.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine
from agent_webui import api_extensions


@pytest.fixture(autouse=True)
def _reset_fleet_catalog_cache():
    """Clear the module-level fleet-catalog TTL cache before every test.

    ``agent/agent_webui/__tests__/conftest.py`` defines the same autouse
    fixture for tests colocated with the source, but pytest's conftest
    discovery does not reach across to this sibling ``tests/`` tree -- see
    that file's docstring for why the reset is required at all (a 60s TTL
    cache means an earlier test's catalog leaks into a later test's assertions
    otherwise).
    """
    from agent_webui import api_extensions as _ae

    _ae.reset_fleet_catalog_cache()
    yield
    _ae.reset_fleet_catalog_cache()


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


def _patch_catalog(rows: Mapping[str, list[dict[str, Any]] | None] | None):
    return patch(
        'agent_webui.api_extensions._read_fleet_catalog',
        AsyncMock(return_value=rows),
    )


_EMPTY_CATALOG: dict[str, list[dict[str, Any]]] = {
    'servers': [],
    'discoveries': [],
    'skills': [],
    'prompts': [],
}


@pytest.mark.asyncio
async def test_builtin_tools_lists_python_modules_skipping_underscore_prefixed(
    tmp_path, monkeypatch, bounded_engine
) -> None:
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)
    tools_dir = tmp_path / 'agent_utilities' / 'tools'
    tools_dir.mkdir(parents=True)
    (tools_dir / 'search_web.py').write_text('# tool')
    (tools_dir / 'read_file.py').write_text('# tool')
    (tools_dir / '_internal_helper.py').write_text('# not a tool')
    monkeypatch.setattr(
        api_extensions, 'get_agent_utilities_dir', lambda: tmp_path / 'agent_utilities'
    )

    with _patch_catalog(_EMPTY_CATALOG):
        result = await api_extensions.list_all_tools()

    names = {row['name'] for row in result['builtin_tools']}
    assert names == {'search_web', 'read_file'}
    by_name = {row['name']: row for row in result['builtin_tools']}
    assert by_name['search_web']['type'] == 'Built-in Tool'
    # `file_path` is blanket-redacted to `[REDACTED_LOCATION]` by
    # `_public_external_result` -> `sanitize_for_persistence`'s
    # `_LOCATION_FIELDS` set (agent_utilities/security/persistence_privacy.py),
    # which matches on the FIELD NAME `file_path` regardless of content --
    # see BUGS FOUND in the lane report (not in this lane's partition to fix).
    assert by_name['search_web']['file_path'] == '[REDACTED_LOCATION]'
    assert by_name['search_web']['status'] == 'enabled'
    assert by_name['search_web']['enabled'] is True


@pytest.mark.asyncio
async def test_builtin_tools_is_empty_when_the_tools_dir_does_not_exist(
    tmp_path, monkeypatch, bounded_engine
) -> None:
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)
    monkeypatch.setattr(
        api_extensions,
        'get_agent_utilities_dir',
        lambda: tmp_path / 'nonexistent_package',
    )

    with _patch_catalog(_EMPTY_CATALOG):
        result = await api_extensions.list_all_tools()

    assert result['builtin_tools'] == []


@pytest.mark.asyncio
async def test_builtin_tools_reflects_a_disabled_toggle(
    tmp_path, monkeypatch, stub_engine, bounded_engine
) -> None:
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)
    tools_dir = tmp_path / 'agent_utilities' / 'tools'
    tools_dir.mkdir(parents=True)
    (tools_dir / 'search_web.py').write_text('# tool')
    monkeypatch.setattr(
        api_extensions, 'get_agent_utilities_dir', lambda: tmp_path / 'agent_utilities'
    )

    async def _batch_toggle_states_many(engine, item_types_and_ids):
        out: dict[str, tuple[dict[str, bool], bool]] = {}
        for item_type, ids in item_types_and_ids.items():
            if item_type == 'builtin_tool':
                out[item_type] = ({i: False for i in ids}, True)
            else:
                out[item_type] = ({}, True)
        return out

    monkeypatch.setattr(
        api_extensions, '_batch_toggle_states_many', _batch_toggle_states_many
    )

    with _patch_catalog(_EMPTY_CATALOG):
        result = await api_extensions.list_all_tools()

    assert result['builtin_tools'] == [
        {
            'name': 'search_web',
            'type': 'Built-in Tool',
            'file_path': '[REDACTED_LOCATION]',
            'status': 'disabled',
            'enabled': False,
        }
    ]


@pytest.mark.asyncio
async def test_toggle_status_is_healthy_when_every_toggle_read_succeeds(
    monkeypatch, bounded_engine
) -> None:
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    with _patch_catalog(_EMPTY_CATALOG):
        result = await api_extensions.list_all_tools()

    assert result['toggle_status'] == {
        'source': 'sql_catalog',
        'error': None,
        'degraded_item_types': [],
    }


@pytest.mark.asyncio
async def test_toggle_status_names_the_degraded_item_types_on_a_failed_read(
    monkeypatch, bounded_engine
) -> None:
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)

    async def _batch_toggle_states_many(engine, item_types_and_ids):
        out: dict[str, tuple[dict[str, bool], bool]] = {}
        for item_type in item_types_and_ids:
            ok = item_type != 'mcp_server'
            out[item_type] = ({}, ok)
        return out

    monkeypatch.setattr(
        api_extensions, '_batch_toggle_states_many', _batch_toggle_states_many
    )

    catalog = dict(_EMPTY_CATALOG)
    catalog['servers'] = [
        {
            'id': 'srv:1',
            'name': 'server-1',
            'transport': 'http',
            'url': '',
        }
    ]

    with _patch_catalog(catalog):
        result = await api_extensions.list_all_tools()

    assert result['toggle_status']['degraded_item_types'] == ['mcp_server']
    assert result['toggle_status']['error'] is not None
    assert (
        'may not reflect the real persisted preference'
        in result['toggle_status']['error']
    )
    # A degraded toggle read still defaults every item to "enabled" rather
    # than hiding it -- pinned here since it is easy to accidentally change
    # while refactoring the per-item `.get(id, True)` fallback.
    assert result['mcp_tools'][0]['enabled'] is True


@pytest.mark.asyncio
async def test_result_is_bounded_through_public_external_result(
    monkeypatch, bounded_engine
) -> None:
    """``list_all_tools`` always returns a dict, even in the fallback branch."""
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', bounded_engine)
    with _patch_catalog(_EMPTY_CATALOG):
        result = await api_extensions.list_all_tools()
    assert isinstance(result, dict)
    assert set(result) >= {
        'mcp_tools',
        'mcp_status',
        'mcp_prompts',
        'mcp_prompts_status',
        'builtin_tools',
        'skills',
        'skill_graphs',
        'skill_workflows',
        'skill_status',
        'toggle_status',
        'skill_classification',
    }
