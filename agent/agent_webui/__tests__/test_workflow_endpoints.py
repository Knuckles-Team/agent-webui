"""Tests for the D9 visual workflow editor backend endpoints."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    from agent_webui.server import create_agent_web_app
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    mock_agent = Agent(TestModel())
    mock_helpers = {'get_path': lambda x: x}
    app = create_agent_web_app(mock_agent, mock_helpers)
    return TestClient(app)


@pytest.fixture
def mock_engine():
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine

    engine = MagicMock(spec=IntelligenceGraphEngine)
    engine.backend = MagicMock()
    engine.add_node = MagicMock()
    engine.link_nodes = MagicMock()
    return engine


def test_list_workflows_returns_records(client, mock_engine):
    def execute(query):
        if 'MATCH (w:Workflow) RETURN w' in query:
            return [{'w': {'id': 'workflow:demo', 'name': 'Demo', 'steps': 'a,b'}}]
        if 'ORCHESTRATES' in query:
            return [{'t': {'id': 'agent:planner'}}]
        if 'WorkflowCanvas' in query:
            return []
        return []

    mock_engine.backend.execute.side_effect = execute
    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=mock_engine,
    ):
        res = client.get('/api/enhanced/workflows')
        assert res.status_code == 200
        data = res.json()
        assert len(data) == 1
        assert data[0]['name'] == 'Demo'
        assert data[0]['steps'] == ['a', 'b']
        assert data[0]['orchestrates'] == ['agent:planner']


def test_list_workflows_degrades_to_empty(client, mock_engine):
    mock_engine.backend.execute.side_effect = Exception('DB down')
    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=mock_engine,
    ):
        res = client.get('/api/enhanced/workflows')
        assert res.status_code == 200
        assert res.json() == []


def test_capabilities_returns_catalog(client, mock_engine):
    mock_engine.backend.execute.return_value = [
        {'a': {'id': 'agent:planner', 'name': 'Planner', 'system_prompt': 'Plan'}}
    ]
    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=mock_engine,
    ):
        res = client.get('/api/enhanced/workflows/capabilities')
        assert res.status_code == 200
        data = res.json()
        assert 'agents' in data and 'tools' in data and 'skills' in data
        assert data['agents'][0]['name'] == 'Planner'


def test_save_workflow_builds_spec_and_persists(client, mock_engine):
    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=mock_engine,
    ):
        payload = {
            'name': 'My Flow',
            'steps': ['plan', 'execute'],
            'orchestrates': ['agent:planner', 'tool:search'],
            'canvas': {'nodes': [], 'edges': []},
        }
        res = client.post('/api/enhanced/workflows', json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data['saved'] is True
        assert data['id'] == 'workflow:my-flow'
        # The canonical Workflow node was persisted via add_node.
        assert mock_engine.add_node.called
        node_types = [call.args[1] for call in mock_engine.add_node.call_args_list]
        assert 'Workflow' in node_types
        # ORCHESTRATES edges were created.
        rels = [call.args[2] for call in mock_engine.link_nodes.call_args_list]
        assert 'ORCHESTRATES' in rels


def test_run_workflow_returns_status(client, mock_engine):
    mock_engine.backend.execute.return_value = [
        {'w': {'id': 'workflow:my-flow', 'name': 'My Flow', 'steps': 'plan'}}
    ]
    fake_orch = MagicMock()
    fake_orch.dispatch = AsyncMock(
        return_value={'status': 'completed', 'summary': 'done'}
    )
    with (
        patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_engine,
        ),
        patch(
            'agent_utilities.orchestration.engine.AgentOrchestrationEngine',
            return_value=fake_orch,
        ),
    ):
        res = client.post('/api/enhanced/workflows/workflow:my-flow/run', json={})
        assert res.status_code == 200
        data = res.json()
        assert data['status'] == 'completed'
        assert 'run_id' in data
        fake_orch.dispatch.assert_awaited_once()


def test_run_workflow_error_returns_payload_not_500(client, mock_engine):
    mock_engine.backend.execute.return_value = [
        {'w': {'id': 'workflow:x', 'name': 'X', 'steps': ''}}
    ]
    fake_orch = MagicMock()
    fake_orch.dispatch = AsyncMock(side_effect=Exception('boom'))
    with (
        patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_engine,
        ),
        patch(
            'agent_utilities.orchestration.engine.AgentOrchestrationEngine',
            return_value=fake_orch,
        ),
    ):
        res = client.post('/api/enhanced/workflows/workflow:x/run', json={})
        assert res.status_code == 200
        data = res.json()
        assert data['status'] == 'error'
        assert 'boom' in data['error']
