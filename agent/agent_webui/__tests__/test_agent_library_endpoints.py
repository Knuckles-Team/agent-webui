"""Tests for the Agent Library endpoints (compose/list/archive local agents,
register external A2A agents, derive suggestions, and surface a curated
AgentConfig model-registry summary).

These call the route handler functions directly (``agent_webui.api_extensions
.list_library_agents(...)`` etc.) rather than driving them through
``TestClient`` + the full app. That is a deliberate choice, not a shortcut:
every ``/api/enhanced/*`` request in this environment currently 401s at the
identity/authorization middleware because the deployment has no configured
``WEBUI_OIDC_*`` verifier (see the lane brief; confirmed independently here by
running the pre-existing, untouched ``test_workflow_endpoints.py`` in this
same environment — it now fails 6/6 with the identical shape). That gate is
owned by a sibling lane; these tests exercise the new route logic this lane
owns (engine resolution, Cypher shape, node/edge writes, validation,
degrade-to-empty behavior) without re-deriving or working around the identity
boundary that isn't this lane's to fix. ``test_identity_middleware_boundary.py``
already pins that boundary's own behavior.
"""

import asyncio
from unittest.mock import MagicMock, patch

import pytest


def _patched_engine(engine):
    return patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=engine,
    )


@pytest.fixture
def mock_engine():
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine

    engine = MagicMock(spec=IntelligenceGraphEngine)
    engine.backend = MagicMock()
    engine.add_node = MagicMock()
    engine.link_nodes = MagicMock()
    engine.ingest_a2a_agent_card = MagicMock()
    engine.ingest_agent_toolkit = MagicMock()
    return engine


def run(coro):
    return asyncio.run(coro)


def test_list_library_agents_returns_local_and_a2a(mock_engine):
    from agent_webui.api_extensions import list_library_agents

    mock_engine.backend.execute.return_value = [
        {
            'r': {
                'id': 'resource:skill:demo',
                'name': 'demo',
                'description': 'A demo agent',
                'resource_type': 'AGENT_SKILL',
                'provider_ref': 'provider://agent-webui-library',
                'runnable_bound': True,
            }
        },
        {
            'r': {
                'id': 'agent:outside',
                'name': 'outside',
                'description': 'External',
                'resource_type': 'A2A_AGENT',
                'endpoint': 'ref://opaque',
            }
        },
    ]
    with _patched_engine(mock_engine):
        data = run(list_library_agents())
    assert len(data) == 2
    assert {d['kind'] for d in data} == {'local', 'a2a'}


def test_list_library_agents_excludes_archived(mock_engine):
    from agent_webui.api_extensions import list_library_agents

    mock_engine.backend.execute.return_value = [
        {
            'r': {
                'id': 'resource:skill:demo',
                'name': 'demo',
                'resource_type': 'AGENT_SKILL',
                'provider_ref': 'provider://agent-webui-library',
                'status': 'ARCHIVED',
            }
        },
    ]
    with _patched_engine(mock_engine):
        assert run(list_library_agents()) == []


def test_list_library_agents_degrades_to_empty_on_backend_failure(mock_engine):
    from agent_webui.api_extensions import list_library_agents

    mock_engine.backend.execute.side_effect = Exception('DB down')
    with _patched_engine(mock_engine):
        assert run(list_library_agents()) == []


def test_create_library_agent_requires_name_and_instructions(mock_engine):
    from agent_webui.api_extensions import create_library_agent
    from fastapi import HTTPException

    with _patched_engine(mock_engine), pytest.raises(HTTPException) as exc:
        run(create_library_agent({'name': '', 'instructions': ''}))
    assert exc.value.status_code == 422


def test_create_library_agent_writes_skill_and_resource_nodes(mock_engine):
    from agent_webui.api_extensions import create_library_agent

    mock_engine.backend.execute.return_value = []
    with _patched_engine(mock_engine):
        data = run(
            create_library_agent(
                {
                    'name': 'my-agent',
                    'description': 'does things',
                    'instructions': 'You are a specialist.',
                    'tool_ids': ['tool:demo'],
                }
            )
        )
    assert data['kind'] == 'local'
    assert data['id'].startswith('resource:skill:')

    add_node_labels = [call.args[1] for call in mock_engine.add_node.call_args_list]
    assert 'Skill' in add_node_labels
    assert 'CallableResource' in add_node_labels
    link_rel_types = [call.args[2] for call in mock_engine.link_nodes.call_args_list]
    assert 'BINDS_RUNNABLE' in link_rel_types
    assert 'USES_TOOL' in link_rel_types

    resource_call = next(
        c
        for c in mock_engine.add_node.call_args_list
        if c.args[1] == 'CallableResource'
    )
    props = resource_call.args[2]
    assert props['resource_type'] == 'AGENT_SKILL'
    assert props['source_ref'].startswith('skill://')
    assert props['provider_ref'] == 'provider://agent-webui-library'
    assert props['system_prompt'] == 'You are a specialist.'

    # The digest contract `_hydrate_skill_runnable` (agent_runner.py) checks at
    # dispatch time: instruction_digest must equal runnable_skill_digest(body).
    from agent_utilities.knowledge_graph.ingestion.skill_workflow_ingest import (
        runnable_skill_digest,
    )

    assert props['instruction_digest'] == runnable_skill_digest('You are a specialist.')


def test_create_library_agent_expands_bind_server_to_its_tools(mock_engine):
    from agent_webui.api_extensions import create_library_agent

    def execute(query, _params=None):
        if 'MATCH (t:Tool) WHERE t.mcp_server' in query:
            return [{'id': 'tool:a'}, {'id': 'tool:b'}]
        return []

    mock_engine.backend.execute.side_effect = execute
    with _patched_engine(mock_engine):
        data = run(
            create_library_agent(
                {
                    'name': 'server-agent',
                    'instructions': 'Drive this server.',
                    'bind_server': 'demo-mcp',
                }
            )
        )
    assert sorted(data['tools']) == ['tool:a', 'tool:b']


def test_archive_library_agent_rejects_non_library_resource(mock_engine):
    from agent_webui.api_extensions import archive_library_agent
    from fastapi import HTTPException

    mock_engine.backend.execute.return_value = [
        {'rtype': 'AGENT_SKILL', 'provider_ref': 'provider://mcp:some-fleet-skill'}
    ]
    with _patched_engine(mock_engine), pytest.raises(HTTPException) as exc:
        run(archive_library_agent('resource:skill:fleet-thing'))
    assert exc.value.status_code == 403


def test_archive_library_agent_archives_a_library_entry(mock_engine):
    from agent_webui.api_extensions import archive_library_agent

    calls = []

    def execute(query, params=None):
        calls.append((query, params))
        if 'RETURN r.resource_type' in query:
            return [
                {
                    'rtype': 'AGENT_SKILL',
                    'provider_ref': 'provider://agent-webui-library',
                }
            ]
        return []

    mock_engine.backend.execute.side_effect = execute
    with _patched_engine(mock_engine):
        data = run(archive_library_agent('resource:skill:my-agent'))
    assert data['archived'] is True
    assert any("SET r.status = 'ARCHIVED'" in q for q, _ in calls)


def test_archive_library_agent_missing_returns_404(mock_engine):
    from agent_webui.api_extensions import archive_library_agent
    from fastapi import HTTPException

    mock_engine.backend.execute.return_value = []
    with _patched_engine(mock_engine), pytest.raises(HTTPException) as exc:
        run(archive_library_agent('resource:skill:nope'))
    assert exc.value.status_code == 404


def test_update_library_agent_requires_name_and_instructions(mock_engine):
    from agent_webui.api_extensions import update_library_agent
    from fastapi import HTTPException

    with _patched_engine(mock_engine), pytest.raises(HTTPException) as exc:
        run(
            update_library_agent(
                'resource:skill:demo', {'name': '', 'instructions': ''}
            )
        )
    assert exc.value.status_code == 422


def test_update_library_agent_rejects_non_library_resource(mock_engine):
    from agent_webui.api_extensions import update_library_agent
    from fastapi import HTTPException

    mock_engine.backend.execute.return_value = [
        {
            'rtype': 'AGENT_SKILL',
            'provider_ref': 'provider://mcp:some-fleet-skill',
            'source_ref': 'skill://fleet-thing',
        }
    ]
    with _patched_engine(mock_engine), pytest.raises(HTTPException) as exc:
        run(
            update_library_agent(
                'resource:skill:fleet-thing',
                {'name': 'x', 'instructions': 'y'},
            )
        )
    assert exc.value.status_code == 403


def test_update_library_agent_missing_returns_404(mock_engine):
    from agent_webui.api_extensions import update_library_agent
    from fastapi import HTTPException

    mock_engine.backend.execute.return_value = []
    with _patched_engine(mock_engine), pytest.raises(HTTPException) as exc:
        run(
            update_library_agent(
                'resource:skill:nope', {'name': 'x', 'instructions': 'y'}
            )
        )
    assert exc.value.status_code == 404


def test_update_library_agent_edits_fields_and_resyncs_tools(mock_engine):
    from agent_webui.api_extensions import update_library_agent

    queries = []

    def execute(query, params=None):
        queries.append((query, params))
        if 'RETURN r.resource_type AS rtype' in query:
            return [
                {
                    'rtype': 'AGENT_SKILL',
                    'provider_ref': 'provider://agent-webui-library',
                    'source_ref': 'skill://my-agent',
                }
            ]
        return []

    mock_engine.backend.execute.side_effect = execute
    with _patched_engine(mock_engine):
        data = run(
            update_library_agent(
                'resource:skill:my-agent',
                {
                    'name': 'my-agent',
                    'description': 'now does more things',
                    'instructions': 'You are an updated specialist.',
                    'tool_ids': ['tool:new'],
                },
            )
        )
    assert data['id'] == 'resource:skill:my-agent'
    assert data['description'] == 'now does more things'
    assert data['tools'] == ['tool:new']

    # Skill + CallableResource nodes were both updated in place.
    assert any('SET s.name' in q for q, _ in queries)
    assert any('SET r.name' in q for q, _ in queries)
    # Old USES_TOOL edges were dropped before the new set was linked --
    # full-replace, not merge.
    assert any('DELETE e' in q for q, _ in queries)
    link_calls = [call.args for call in mock_engine.link_nodes.call_args_list]
    assert ('resource:skill:my-agent', 'tool:new', 'USES_TOOL') in link_calls


def test_register_a2a_agent_requires_valid_url(mock_engine):
    from agent_webui.api_extensions import register_a2a_agent
    from fastapi import HTTPException

    with _patched_engine(mock_engine), pytest.raises(HTTPException) as exc:
        run(register_a2a_agent({'url': 'not-a-url'}))
    assert exc.value.status_code == 422


def test_register_a2a_agent_with_pasted_card_calls_ingest_a2a_agent_card(mock_engine):
    from agent_webui.api_extensions import register_a2a_agent

    with _patched_engine(mock_engine):
        data = run(
            register_a2a_agent(
                {
                    'url': 'https://agent.example.com',
                    'agent_card': {
                        'name': 'outside-agent',
                        'description': 'An outside agent',
                    },
                }
            )
        )
    assert data['name'] == 'outside-agent'
    mock_engine.ingest_a2a_agent_card.assert_called_once()
    args = mock_engine.ingest_a2a_agent_card.call_args.args
    assert args[0] == 'https://agent.example.com'
    assert args[1]['name'] == 'outside-agent'


def test_register_a2a_agent_without_card_fetches_via_toolkit(mock_engine):
    from agent_webui.api_extensions import register_a2a_agent

    mock_engine.ingest_agent_toolkit.return_value = {'a2a_agents': 1, 'errors': []}
    with _patched_engine(mock_engine):
        data = run(register_a2a_agent({'url': 'https://agent.example.com'}))
    assert data['status'] == 'success'
    mock_engine.ingest_agent_toolkit.assert_called_once_with(
        ['https://agent.example.com']
    )


def test_register_a2a_agent_reports_fetch_failure(mock_engine):
    from agent_webui.api_extensions import register_a2a_agent
    from fastapi import HTTPException

    mock_engine.ingest_agent_toolkit.return_value = {
        'a2a_agents': 0,
        'errors': ['no card found'],
    }
    with _patched_engine(mock_engine), pytest.raises(HTTPException) as exc:
        run(register_a2a_agent({'url': 'https://agent.example.com'}))
    assert exc.value.status_code == 502


def test_suggest_library_agents_excludes_bound_servers(mock_engine):
    from agent_webui.api_extensions import suggest_library_agents

    def execute(query, _params=None):
        if 'MATCH (t:Tool) WHERE t.mcp_server IS NOT NULL' in query:
            return [
                {'server': 'unbound-mcp', 'name': 'tool_one'},
                {'server': 'unbound-mcp', 'name': 'tool_two'},
                {'server': 'bound-mcp', 'name': 'tool_three'},
            ]
        if 'DISTINCT r.mcp_server' in query:
            return [{'server': 'bound-mcp'}]
        return []

    mock_engine.backend.execute.side_effect = execute
    with _patched_engine(mock_engine):
        data = run(suggest_library_agents())
    assert len(data) == 1
    assert data[0]['mcp_server'] == 'unbound-mcp'
    assert data[0]['tool_count'] == 2


def test_list_library_tools_filters_by_server(mock_engine):
    from agent_webui.api_extensions import list_library_tools

    mock_engine.backend.execute.return_value = [
        {'id': 'tool:a', 'name': 'a', 'mcp_server': 'demo-mcp', 'tags': []},
    ]
    with _patched_engine(mock_engine):
        data = run(list_library_tools(mcp_server='demo-mcp'))
    assert data[0]['id'] == 'tool:a'


def test_list_library_tools_rejects_unsafe_server_filter(mock_engine):
    from agent_webui.api_extensions import list_library_tools
    from fastapi import HTTPException

    with _patched_engine(mock_engine), pytest.raises(HTTPException) as exc:
        run(list_library_tools(mcp_server='x' * 5 + '$$bad'))
    assert exc.value.status_code == 400


def test_agent_config_summary_projects_model_registry():
    from agent_webui.api_extensions import agent_config_summary

    class _FakeModel:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    fake_cfg = MagicMock()
    fake_cfg.app_profile = 'dev'
    fake_cfg.deployment_profile = 'tiny'
    fake_cfg.chat_models = [
        _FakeModel(
            id='local-lite',
            provider='local',
            intelligence_level='normal',
            vision=False,
            reasoning=False,
            tools_enabled=True,
            can_route=True,
            can_kg=True,
            context_window=32000,
            api_key_ref='env://SHOULD_NOT_LEAK',
        )
    ]
    fake_cfg.embedding_models = [
        _FakeModel(
            id='local-embed', provider='local', chunk_size=768, context_window=8192
        )
    ]
    with patch('agent_utilities.core.config.AgentConfig', return_value=fake_cfg):
        data = run(agent_config_summary())
    assert data['app_profile'] == 'dev'
    assert data['chat_models'][0]['id'] == 'local-lite'
    assert 'api_key_ref' not in data['chat_models'][0]


def test_agent_config_summary_degrades_to_empty_on_failure():
    from agent_webui.api_extensions import agent_config_summary

    with patch(
        'agent_utilities.core.config.AgentConfig', side_effect=RuntimeError('boom')
    ):
        data = run(agent_config_summary())
    assert data == {
        'app_profile': '',
        'deployment_profile': '',
        'chat_models': [],
        'embedding_models': [],
    }
