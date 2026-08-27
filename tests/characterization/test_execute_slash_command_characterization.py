"""Characterization tests for ``execute_slash_command`` (CX-WEB-01).

Pins the OBSERVED behaviour of ``api_extensions.execute_slash_command`` --
including its one known bug (see the ``quit``/``exit`` alias test below) --
before CX-WEB-01's CCN-144 -> data-driven-dispatch refactor. This function
had NO prior test coverage at all; these tests are the only evidence that
the refactor is behaviour-preserving.

Written and proven GREEN against the unmodified function (commit 1 of the
CX-WEB-01 two-commit discipline: characterize, then refactor). Must remain
byte-identical and green through commit 2.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from agent_webui import api_extensions


def make_request(**state: object) -> SimpleNamespace:
    """A minimal ``Request``-shaped double: only ``request.app.state.*`` is read."""
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(**state)))


class _FakeNodeView:
    """Networkx-``NodeView``-shaped double: supports both ``len(...)`` and
    calling ``nodes(data=True)``."""

    def __init__(self, items: list[tuple[str, dict]]):
        self._items = items

    def __len__(self) -> int:
        return len(self._items)

    def __call__(self, data: bool = False):
        if data:
            return list(self._items)
        return [i for i, _ in self._items]


class _FakeGraph:
    def __init__(self, nodes: list[tuple[str, dict]], edge_count: int = 0):
        self.nodes = _FakeNodeView(nodes)
        self.edges = list(range(edge_count))


def make_engine(nodes=(), edge_count=0, query_impact=None) -> MagicMock:
    engine = MagicMock()
    engine.graph = _FakeGraph(list(nodes), edge_count)
    engine.query_impact = query_impact or AsyncMock(return_value=[])
    return engine


# --------------------------------------------------------------------------
# Top-level parsing
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_non_string_command_is_rejected_with_400() -> None:
    with pytest.raises(Exception) as exc_info:
        await api_extensions.execute_slash_command({'command': 123}, make_request())
    assert getattr(exc_info.value, 'status_code', None) == 400


@pytest.mark.asyncio
async def test_oversized_command_is_rejected_with_400() -> None:
    payload = {'command': '/' + ('a' * 9000)}
    with pytest.raises(Exception) as exc_info:
        await api_extensions.execute_slash_command(payload, make_request())
    assert getattr(exc_info.value, 'status_code', None) == 400


@pytest.mark.asyncio
async def test_command_missing_leading_slash_is_a_soft_error() -> None:
    result = await api_extensions.execute_slash_command(
        {'command': 'help'}, make_request()
    )
    assert result == {
        'response_markdown': 'Error: Command must start with a slash `/`.',
        'client_actions': [],
    }


@pytest.mark.asyncio
async def test_unknown_top_level_command_names_itself_in_the_message() -> None:
    result = await api_extensions.execute_slash_command(
        {'command': '/frobnicate'}, make_request()
    )
    assert result['client_actions'] == []
    assert result['response_markdown'] == (
        'Unknown slash command: `/frobnicate`. Type `/help` for a list of '
        'available commands.'
    )


@pytest.mark.asyncio
async def test_command_name_is_case_insensitive() -> None:
    result = await api_extensions.execute_slash_command(
        {'command': '/HELP'}, make_request()
    )
    assert '### Available Commands' in result['response_markdown']


@pytest.mark.asyncio
async def test_quit_is_aliased_to_exit_which_has_no_handler_bug() -> None:
    """BUG (pinned, not fixed -- see lane report): ``cmd_name`` is rewritten
    ``quit`` -> ``exit`` before dispatch, but no branch ever matches
    ``'exit'``, so ``/quit`` (and literal ``/exit``) ALWAYS falls through to
    the "Unknown slash command" branch rather than doing anything quit-like."""
    result = await api_extensions.execute_slash_command(
        {'command': '/quit'}, make_request()
    )
    assert result['response_markdown'] == (
        'Unknown slash command: `/exit`. Type `/help` for a list of available commands.'
    )
    result2 = await api_extensions.execute_slash_command(
        {'command': '/exit'}, make_request()
    )
    assert result2 == result


# --------------------------------------------------------------------------
# /help, /clear
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_help_lists_every_command_and_returns_no_client_actions() -> None:
    result = await api_extensions.execute_slash_command(
        {'command': '/help'}, make_request()
    )
    assert result['client_actions'] == []
    for needle in (
        '`/help`',
        '`/clear`',
        '`/model [model_id]`',
        '`/tools`',
        '`/skills`',
        '`/graph stats`',
        '`/kb list`',
        '`/sdd specs`',
        '`/cron calendar`',
        '`/resources`',
    ):
        assert needle in result['response_markdown']


@pytest.mark.asyncio
async def test_clear_returns_the_clear_chat_client_action() -> None:
    result = await api_extensions.execute_slash_command(
        {'command': '/clear'}, make_request()
    )
    assert result == {
        'response_markdown': 'Chat session cleared.',
        'client_actions': [{'action': 'clear_chat'}],
    }


# --------------------------------------------------------------------------
# /model
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_model_with_no_args_and_no_registry_reports_unknown() -> None:
    result = await api_extensions.execute_slash_command(
        {'command': '/model'}, make_request()
    )
    assert result['client_actions'] == []
    assert 'Current active model: `unknown`.' in result['response_markdown']


@pytest.mark.asyncio
async def test_model_with_no_args_reports_the_registry_default() -> None:
    registry = MagicMock()
    registry.get_default.return_value = SimpleNamespace(id='claude-opus')
    result = await api_extensions.execute_slash_command(
        {'command': '/model'}, make_request(model_registry=registry)
    )
    assert 'Current active model: `claude-opus`.' in result['response_markdown']


@pytest.mark.asyncio
async def test_model_with_an_arg_switches_and_emits_set_model_action() -> None:
    result = await api_extensions.execute_slash_command(
        {'command': '/model claude-haiku'}, make_request()
    )
    assert result == {
        'response_markdown': 'Switched model to `claude-haiku`.',
        'client_actions': [{'action': 'set_model', 'value': 'claude-haiku'}],
    }


# --------------------------------------------------------------------------
# /tools
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tools_reports_none_registered_when_empty() -> None:
    result = await api_extensions.execute_slash_command(
        {'command': '/tools'}, make_request()
    )
    assert result == {
        'response_markdown': 'No tools currently registered.',
        'client_actions': [],
    }


@pytest.mark.asyncio
async def test_tools_lists_agent_tools_and_mcp_toolset_tools() -> None:
    agent = SimpleNamespace(
        _tools=[SimpleNamespace(name='search', description='Search the web')]
    )
    toolset = SimpleNamespace(
        name='github-api',
        tools=[SimpleNamespace(name='list_prs', description='List pull requests')],
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/tools'},
        make_request(agent=agent, mcp_toolsets=[toolset]),
    )
    assert '- `search`: Search the web' in result['response_markdown']
    assert (
        '- `[github-api] list_prs`: List pull requests' in result['response_markdown']
    )


# --------------------------------------------------------------------------
# /skills
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_skills_reports_none_active_when_no_helper_registered(
    monkeypatch,
) -> None:
    monkeypatch.setattr(api_extensions, 'get_helper', lambda name: None)
    result = await api_extensions.execute_slash_command(
        {'command': '/skills'}, make_request()
    )
    assert result == {
        'response_markdown': 'No custom skills currently active.',
        'client_actions': [],
    }


@pytest.mark.asyncio
async def test_skills_lists_skills_from_the_registered_helper(monkeypatch) -> None:
    async def _list_skills():
        return [{'name': 'code-review', 'id': 'skill-1', 'description': 'Review code'}]

    monkeypatch.setattr(
        api_extensions,
        'get_helper',
        lambda name: _list_skills if name == 'list_skills' else None,
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/skills'}, make_request()
    )
    assert '- **code-review** (`skill-1`): Review code' in result['response_markdown']


@pytest.mark.asyncio
async def test_skills_helper_exception_is_reported_inline(monkeypatch) -> None:
    async def _list_skills():
        raise RuntimeError('boom')

    monkeypatch.setattr(
        api_extensions,
        'get_helper',
        lambda name: _list_skills if name == 'list_skills' else None,
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/skills'}, make_request()
    )
    assert 'Error fetching skills: RuntimeError' in result['response_markdown']


# --------------------------------------------------------------------------
# /graph
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_graph_reports_engine_unavailable(monkeypatch) -> None:
    async def _raise():
        raise RuntimeError('no engine')

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _raise)
    result = await api_extensions.execute_slash_command(
        {'command': '/graph stats'}, make_request()
    )
    assert result['client_actions'] == []
    assert 'Error: Graph engine not active: RuntimeError' in result['response_markdown']


@pytest.mark.asyncio
async def test_graph_with_no_subcommand_defaults_to_stats(monkeypatch) -> None:
    engine = make_engine(edge_count=3)

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/graph'}, make_request()
    )
    assert '### Knowledge Graph Statistics' in result['response_markdown']
    assert '**Total Nodes**: 0' in result['response_markdown']
    assert '**Total Relationships**: 3' in result['response_markdown']


@pytest.mark.asyncio
async def test_graph_nodes_filters_by_type(monkeypatch) -> None:
    engine = make_engine(
        nodes=[
            ('n1', {'type': 'Agent', 'description': 'An agent'}),
            ('n2', {'type': 'Skill', 'description': 'A skill'}),
        ]
    )

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/graph nodes Skill'}, make_request()
    )
    assert '`n2` (Skill)' in result['response_markdown']
    assert 'n1' not in result['response_markdown']


@pytest.mark.asyncio
async def test_graph_search_with_no_query_shows_usage(monkeypatch) -> None:
    engine = make_engine()

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/graph search'}, make_request()
    )
    assert result['response_markdown'] == 'Usage: `/graph search <query>`'


@pytest.mark.asyncio
async def test_graph_search_reports_no_results(monkeypatch) -> None:
    engine = make_engine(nodes=[('n1', {'type': 'Node', 'description': 'unrelated'})])

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/graph search zzz-no-match'}, make_request()
    )
    assert result['response_markdown'] == 'No search results for query `zzz-no-match`.'


@pytest.mark.asyncio
async def test_graph_search_matches_id_or_description(monkeypatch) -> None:
    engine = make_engine(
        nodes=[
            ('kg-loop', {'type': 'Node', 'description': 'runs the evolution loop'}),
        ]
    )

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/graph search loop'}, make_request()
    )
    assert '**kg-loop**' in result['response_markdown']


@pytest.mark.asyncio
async def test_graph_impact_with_no_symbol_shows_usage(monkeypatch) -> None:
    engine = make_engine()

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/graph impact'}, make_request()
    )
    assert result['response_markdown'] == 'Usage: `/graph impact <symbol>`'


@pytest.mark.asyncio
async def test_graph_impact_reports_affected_items(monkeypatch) -> None:
    engine = make_engine(
        query_impact=AsyncMock(
            return_value=[{'id': 'callers.py', 'severity': 'high'}, 'raw-item']
        )
    )

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/graph impact my_func'}, make_request()
    )
    assert '**2 item(s) affected:**' in result['response_markdown']
    assert '- `callers.py` (high)' in result['response_markdown']
    assert '- `raw-item`' in result['response_markdown']


@pytest.mark.asyncio
async def test_graph_impact_with_no_results(monkeypatch) -> None:
    engine = make_engine(query_impact=AsyncMock(return_value=[]))

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/graph impact nothing'}, make_request()
    )
    assert 'No impacted nodes found' in result['response_markdown']


@pytest.mark.asyncio
async def test_graph_unknown_subcommand(monkeypatch) -> None:
    engine = make_engine()

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/graph bogus'}, make_request()
    )
    assert result['response_markdown'] == 'Unknown `/graph` subcommand: `bogus`'


# --------------------------------------------------------------------------
# /kb
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_kb_backend_unavailable_when_engine_raises(monkeypatch) -> None:
    async def _raise():
        raise RuntimeError('no engine')

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _raise)
    result = await api_extensions.execute_slash_command(
        {'command': '/kb list'}, make_request()
    )
    assert 'KB backend not available: RuntimeError' in result['response_markdown']


@pytest.mark.asyncio
async def test_kb_list_reports_none_found(monkeypatch) -> None:
    engine = MagicMock()

    async def _get_engine():
        return engine

    kb_engine = MagicMock()
    kb_engine.list_knowledge_bases = AsyncMock(return_value=[])
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    monkeypatch.setattr(
        api_extensions, 'KBIngestionEngine', lambda graph, backend: kb_engine
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/kb list'}, make_request()
    )
    assert result['response_markdown'] == 'No knowledge bases found.'


@pytest.mark.asyncio
async def test_kb_list_renders_bases_with_article_counts(monkeypatch) -> None:
    engine = MagicMock()

    async def _get_engine():
        return engine

    kb_engine = MagicMock()
    kb_engine.list_knowledge_bases = AsyncMock(
        return_value=[
            {'id': 'workspace-docs', 'description': 'Docs', 'article_count': 42}
        ]
    )
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    monkeypatch.setattr(
        api_extensions, 'KBIngestionEngine', lambda graph, backend: kb_engine
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/kb list'}, make_request()
    )
    assert '- `workspace-docs` Docs (42 articles)' in result['response_markdown']


@pytest.mark.asyncio
async def test_kb_search_with_no_query_shows_usage(monkeypatch) -> None:
    engine = MagicMock()

    async def _get_engine():
        return engine

    kb_engine = MagicMock()
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    monkeypatch.setattr(
        api_extensions, 'KBIngestionEngine', lambda graph, backend: kb_engine
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/kb search'}, make_request()
    )
    assert result['response_markdown'] == 'Usage: `/kb search <query>`'


@pytest.mark.asyncio
async def test_kb_search_renders_hits_with_snippets(monkeypatch) -> None:
    engine = MagicMock()

    async def _get_engine():
        return engine

    kb_engine = MagicMock()
    kb_engine.search = AsyncMock(
        return_value=[
            {'title': 'Setup Guide', 'score': 0.91, 'content': 'Install steps...'}
        ]
    )
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    monkeypatch.setattr(
        api_extensions, 'KBIngestionEngine', lambda graph, backend: kb_engine
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/kb search setup'}, make_request()
    )
    assert '**Setup Guide** (score: 0.91)' in result['response_markdown']
    assert '> Install steps...' in result['response_markdown']


@pytest.mark.asyncio
async def test_kb_ingest_with_no_path_shows_usage(monkeypatch) -> None:
    engine = MagicMock()

    async def _get_engine():
        return engine

    kb_engine = MagicMock()
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    monkeypatch.setattr(
        api_extensions, 'KBIngestionEngine', lambda graph, backend: kb_engine
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/kb ingest'}, make_request()
    )
    assert result['response_markdown'] == 'Usage: `/kb ingest <url_or_path>`'


@pytest.mark.asyncio
async def test_kb_ingest_reports_job_id_when_present(monkeypatch) -> None:
    engine = MagicMock()

    async def _get_engine():
        return engine

    kb_engine = MagicMock()
    kb_engine.ingest = AsyncMock(return_value={'job_id': 'job-42'})
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    monkeypatch.setattr(
        api_extensions, 'KBIngestionEngine', lambda graph, backend: kb_engine
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/kb ingest docs/notes'}, make_request()
    )
    assert result['response_markdown'] == (
        'Started KB ingestion of `docs/notes` into `workspace-docs` (job `job-42`).'
    )


@pytest.mark.asyncio
async def test_kb_ingest_without_a_job_id_omits_the_job_suffix(monkeypatch) -> None:
    engine = MagicMock()

    async def _get_engine():
        return engine

    kb_engine = MagicMock()
    kb_engine.ingest = AsyncMock(return_value={})
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    monkeypatch.setattr(
        api_extensions, 'KBIngestionEngine', lambda graph, backend: kb_engine
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/kb ingest docs/notes'}, make_request()
    )
    assert result['response_markdown'] == (
        'Started KB ingestion of `docs/notes` into `workspace-docs`.'
    )


@pytest.mark.asyncio
async def test_kb_unknown_subcommand(monkeypatch) -> None:
    engine = MagicMock()

    async def _get_engine():
        return engine

    kb_engine = MagicMock()
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    monkeypatch.setattr(
        api_extensions, 'KBIngestionEngine', lambda graph, backend: kb_engine
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/kb bogus'}, make_request()
    )
    assert result['response_markdown'] == 'Unknown `/kb` subcommand: `bogus`'


# --------------------------------------------------------------------------
# /sdd
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sdd_backend_unavailable_when_manager_construction_raises(
    monkeypatch,
) -> None:
    def _raise(_dir):
        raise RuntimeError('no .specify')

    monkeypatch.setattr(api_extensions, 'SDDManager', _raise)
    result = await api_extensions.execute_slash_command(
        {'command': '/sdd specs'}, make_request()
    )
    assert 'SDD backend not available: RuntimeError' in result['response_markdown']


@pytest.mark.asyncio
async def test_sdd_specs_lists_specs(monkeypatch) -> None:
    manager = MagicMock()
    manager.list_specs.return_value = [
        SimpleNamespace(
            model_dump=lambda: {
                'id': 'spec-1',
                'title': 'Onboarding',
                'status': 'draft',
            }
        )
    ]
    monkeypatch.setattr(api_extensions, 'SDDManager', lambda _dir: manager)
    result = await api_extensions.execute_slash_command(
        {'command': '/sdd specs'}, make_request()
    )
    assert '**spec-1**: Onboarding (Status: `draft`)' in result['response_markdown']


@pytest.mark.asyncio
async def test_sdd_specs_empty(monkeypatch) -> None:
    manager = MagicMock()
    manager.list_specs.return_value = []
    monkeypatch.setattr(api_extensions, 'SDDManager', lambda _dir: manager)
    result = await api_extensions.execute_slash_command(
        {'command': '/sdd specs'}, make_request()
    )
    assert (
        result['response_markdown'] == 'No specifications found under `.specify/specs`.'
    )


@pytest.mark.asyncio
async def test_sdd_constitution_as_dict(monkeypatch) -> None:
    manager = MagicMock()
    manager.get_constitution.return_value = {'content': 'Rule one.'}
    monkeypatch.setattr(api_extensions, 'SDDManager', lambda _dir: manager)
    result = await api_extensions.execute_slash_command(
        {'command': '/sdd constitution'}, make_request()
    )
    assert result['response_markdown'] == '### Project Constitution\n\nRule one.'


@pytest.mark.asyncio
async def test_sdd_constitution_missing(monkeypatch) -> None:
    manager = MagicMock()
    manager.get_constitution.return_value = None
    monkeypatch.setattr(api_extensions, 'SDDManager', lambda _dir: manager)
    result = await api_extensions.execute_slash_command(
        {'command': '/sdd constitution'}, make_request()
    )
    assert result['response_markdown'] == (
        'No constitution found at `.specify/memory/constitution.md`.'
    )


@pytest.mark.asyncio
async def test_sdd_sync_success(monkeypatch) -> None:
    engine = MagicMock()

    async def _get_engine():
        return engine

    manager = MagicMock()
    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    monkeypatch.setattr(api_extensions, 'SDDManager', lambda _dir: manager)
    result = await api_extensions.execute_slash_command(
        {'command': '/sdd sync'}, make_request()
    )
    assert result['response_markdown'] == (
        'Synchronized local specifications with the Knowledge Graph.'
    )
    manager.sync_to_memory.assert_called_once_with(engine)


@pytest.mark.asyncio
async def test_sdd_unknown_subcommand(monkeypatch) -> None:
    monkeypatch.setattr(api_extensions, 'SDDManager', lambda _dir: MagicMock())
    result = await api_extensions.execute_slash_command(
        {'command': '/sdd bogus'}, make_request()
    )
    assert result['response_markdown'] == 'Unknown `/sdd` subcommand: `bogus`'


# --------------------------------------------------------------------------
# /cron
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cron_calendar_reports_none_scheduled(monkeypatch) -> None:
    monkeypatch.setattr(
        'agent_utilities.core.scheduler.get_cron_tasks',
        lambda: SimpleNamespace(tasks=[]),
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/cron calendar'}, make_request()
    )
    assert result['response_markdown'] == 'No scheduled background tasks registered.'


@pytest.mark.asyncio
async def test_cron_calendar_lists_tasks(monkeypatch) -> None:
    task = SimpleNamespace(
        name='nightly-sync', id='t1', interval_minutes=60, last_run=None
    )
    monkeypatch.setattr(
        'agent_utilities.core.scheduler.get_cron_tasks',
        lambda: SimpleNamespace(tasks=[task]),
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/cron calendar'}, make_request()
    )
    assert (
        '`nightly-sync`: every 60 min (last run: never)' in result['response_markdown']
    )


@pytest.mark.asyncio
async def test_cron_calendar_scheduler_unavailable(monkeypatch) -> None:
    def _raise():
        raise ImportError('no scheduler')

    monkeypatch.setattr('agent_utilities.core.scheduler.get_cron_tasks', _raise)
    result = await api_extensions.execute_slash_command(
        {'command': '/cron calendar'}, make_request()
    )
    assert 'Cron scheduler not available: ImportError' in result['response_markdown']


@pytest.mark.asyncio
async def test_cron_logs_reports_none_recorded(monkeypatch) -> None:
    monkeypatch.setattr(
        'agent_utilities.core.scheduler.get_cron_logs',
        lambda: SimpleNamespace(entries=[]),
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/cron logs'}, make_request()
    )
    assert result['response_markdown'] == 'No cron execution logs recorded yet.'


@pytest.mark.asyncio
async def test_cron_logs_lists_recent_entries(monkeypatch) -> None:
    entry = SimpleNamespace(
        timestamp='2026-08-27T00:00:00',
        task_name='nightly-sync',
        task_id='t1',
        status='ok',
        message='completed',
    )
    monkeypatch.setattr(
        'agent_utilities.core.scheduler.get_cron_logs',
        lambda: SimpleNamespace(entries=[entry]),
    )
    result = await api_extensions.execute_slash_command(
        {'command': '/cron logs'}, make_request()
    )
    assert '`nightly-sync` - ok: completed' in result['response_markdown']


@pytest.mark.asyncio
async def test_cron_unknown_subcommand() -> None:
    result = await api_extensions.execute_slash_command(
        {'command': '/cron bogus'}, make_request()
    )
    assert result['response_markdown'] == 'Unknown `/cron` subcommand: `bogus`'


# --------------------------------------------------------------------------
# /resources
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resources_backend_unavailable(monkeypatch) -> None:
    async def _raise():
        raise RuntimeError('no engine')

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _raise)
    result = await api_extensions.execute_slash_command(
        {'command': '/resources'}, make_request()
    )
    assert 'Resource backend not available: RuntimeError' in result['response_markdown']


@pytest.mark.asyncio
async def test_resources_list_reports_none_active(monkeypatch) -> None:
    engine = MagicMock()
    engine.backend.execute = AsyncMock(return_value=[])

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/resources'}, make_request()
    )
    assert result['response_markdown'] == 'No active subagents or callable resources.'


@pytest.mark.asyncio
async def test_resources_list_renders_rows(monkeypatch) -> None:
    engine = MagicMock()
    engine.backend.execute = AsyncMock(
        return_value=[{'r': {'id': 'agent-1', 'type': 'subagent', 'status': 'running'}}]
    )

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/resources list'}, make_request()
    )
    assert (
        '**`agent-1`** - Type: `subagent` - Status: `running`'
        in result['response_markdown']
    )


@pytest.mark.asyncio
async def test_resources_spawn_with_no_name_shows_usage(monkeypatch) -> None:
    engine = MagicMock()

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/resources spawn'}, make_request()
    )
    assert result['response_markdown'] == 'Usage: `/resources spawn <name>`'


@pytest.mark.asyncio
async def test_resources_spawn_reports_the_spawned_id(monkeypatch) -> None:
    engine = MagicMock()
    engine.spawn_specialized_agent = AsyncMock(
        return_value=SimpleNamespace(
            model_dump=lambda: {'id': 'sub-9', 'name': 'reviewer'}
        )
    )

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/resources spawn reviewer'}, make_request()
    )
    assert result['response_markdown'] == 'Spawned subagent **`sub-9`**.'


@pytest.mark.asyncio
async def test_resources_unknown_subcommand(monkeypatch) -> None:
    engine = MagicMock()

    async def _get_engine():
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    result = await api_extensions.execute_slash_command(
        {'command': '/resources bogus'}, make_request()
    )
    assert result['response_markdown'] == 'Unknown `/resources` subcommand: `bogus`'
