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
def mock_graph_engine():
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine

    engine = MagicMock(spec=IntelligenceGraphEngine)
    engine.backend = MagicMock()
    engine.graph = MagicMock()
    return engine


def test_delete_memory_success(client, mock_graph_engine):
    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=mock_graph_engine,
    ):
        response = client.delete('/api/enhanced/graph/memory/mem1')
        assert response.status_code == 200
        mock_graph_engine.delete_memory_node.assert_called_once_with('mem1')


def test_link_nodes_success(client, mock_graph_engine):
    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=mock_graph_engine,
    ):
        link_data = {
            'source': 'node1',
            'target': 'node2',
            'relationship_type': 'RELATED_TO',
        }
        response = client.post('/api/enhanced/graph/link', json=link_data)
        assert response.status_code == 200
        mock_graph_engine.link_nodes.assert_called_once()


def test_list_resources_success(client, mock_graph_engine):
    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=mock_graph_engine,
    ):
        # `list_resources` now reads through `_read_union_cypher`, which
        # falls back to `engine.query_cypher` (not `engine.backend.execute`)
        # when there is no ambient `GraphSession` -- the case here, matching
        # every other union-read endpoint's tests in this file.
        mock_graph_engine.query_cypher.return_value = [
            {'r': {'id': 'res1', 'name': 'Resource 1'}}
        ]
        response = client.get('/api/enhanced/resources')
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1


def test_get_kb_article_not_found(client, mock_graph_engine):
    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=mock_graph_engine,
    ):
        mock_graph_engine.backend.execute.return_value = []
        response = client.get('/api/enhanced/kb/article/nonexistent')
        assert response.status_code == 404


def test_get_kb_article_error(client, mock_graph_engine):
    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=mock_graph_engine,
    ):
        mock_graph_engine.backend.execute.side_effect = Exception('DB error')
        response = client.get('/api/enhanced/kb/article/art1')
        assert response.status_code == 500


def test_get_memory_not_found(client, mock_graph_engine):
    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=mock_graph_engine,
    ):
        mock_graph_engine.get_memory_node.return_value = None
        response = client.get('/api/enhanced/graph/memory/nonexistent')
        assert response.status_code == 404


def test_execute_cypher_error(client, mock_graph_engine):
    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=mock_graph_engine,
    ):
        mock_graph_engine.query_cypher.side_effect = Exception('Query failed')
        response = client.post(
            '/api/enhanced/graph/query', json={'query': 'MATCH (n) RETURN n'}
        )
        assert response.status_code == 500


def test_kb_health_check_error(client, mock_graph_engine):
    from agent_utilities.knowledge_graph.kb.ingestion import KBIngestionEngine

    mock_kb_engine = MagicMock(spec=KBIngestionEngine)
    mock_kb_engine.health_check = AsyncMock(
        side_effect=Exception('Health check failed')
    )

    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=mock_graph_engine,
    ):
        with patch(
            'agent_webui.api_extensions.KBIngestionEngine', return_value=mock_kb_engine
        ):
            response = client.post('/api/enhanced/kb/health', json={'kb_id': 'test_kb'})
            assert response.status_code == 200  # It returns error in body
            data = response.json()
            assert data['health_status'] == 'error'


def test_get_tasks_success(client):
    """`SDDManager.get_all_tasks()` returns `list[Tasks]` -- a bare Python
    list of pydantic models, not a single object with its own
    `.model_dump()`. A prior version of this mock (a single `MagicMock`
    standing in for the whole return value) didn't reflect that real
    contract and masked a bug where the raw list of pydantic objects
    reached `_public_external_result` unconverted and raised on any
    non-empty result (see `test_bound_sweep_regressions.py`
    ::TestGetAllTasksHandlesTheListOfPydanticModelsShape for the full
    regression coverage); this mock now matches the real shape."""
    from agent_utilities.sdd import SDDManager

    mock_manager = MagicMock(spec=SDDManager)
    mock_task_group = MagicMock()
    mock_task_group.model_dump.return_value = {'feature_id': 'f1', 'tasks': []}
    mock_manager.get_all_tasks.return_value = [mock_task_group]

    with patch('agent_webui.api_extensions.SDDManager', return_value=mock_manager):
        response = client.get('/api/enhanced/sdd/tasks')
        assert response.status_code == 200
        data = response.json()
        assert data == [{'feature_id': 'f1', 'tasks': []}]


def test_get_tasks_with_plan_id(client):
    from agent_utilities.sdd import SDDManager

    mock_manager = MagicMock(spec=SDDManager)
    mock_tasks = MagicMock()
    mock_tasks.model_dump.return_value = {'tasks': []}
    mock_manager.get_tasks.return_value = mock_tasks

    with patch('agent_webui.api_extensions.SDDManager', return_value=mock_manager):
        response = client.get('/api/enhanced/sdd/tasks?plan_id=plan1')
        assert response.status_code == 200
        mock_manager.get_tasks.assert_called_once_with('plan1')
