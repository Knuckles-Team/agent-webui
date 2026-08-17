from __future__ import annotations

"""Test API endpoints for agent-webui backend."""

import asyncio
from unittest.mock import MagicMock, patch

import agent_webui.api_extensions as api_extensions
import pytest
from agent_webui.server import create_agent_web_app
from fastapi import HTTPException
from fastapi.testclient import TestClient


@pytest.fixture
def client(mock_agent, mock_workspace_helpers):
    """Create test client."""
    app = create_agent_web_app(mock_agent, mock_workspace_helpers)
    return TestClient(app, raise_server_exceptions=False)


class TestGraphStatsEndpoint:
    """Test graph statistics endpoint."""

    def test_get_graph_stats_success(self, client, mock_graph_engine):
        """Test successful graph stats retrieval."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.side_effect = [
                [{'count': 100}],  # total nodes
                [{'count': 200}],  # total relationships
                [{'count': 50}],  # Memory type
                [{'count': 30}],  # Article type
            ]

            response = client.get('/api/enhanced/graph/stats')
            assert response.status_code == 200
            data = response.json()
            assert data['total_nodes'] == 100
            assert data['total_relationships'] == 200
            assert 'by_type' in data

    def test_get_graph_stats_no_engine(self, client):
        """Test graph stats when engine not initialized."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=None,
        ):
            response = client.get('/api/enhanced/graph/stats')
            assert response.status_code == 200
            data = response.json()
            assert data['total_nodes'] == 0
            assert data['total_relationships'] == 0


class TestGraphNodesEndpoint:
    """Test graph nodes endpoint."""

    def test_get_graph_nodes_success(
        self, client, mock_graph_engine, sample_graph_data
    ):
        """Test successful graph nodes retrieval."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.return_value = [
                {'n': sample_graph_data['nodes'][0]},
                {'n': sample_graph_data['nodes'][1]},
            ]

            response = client.get('/api/enhanced/graph/nodes')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 2

    def test_get_graph_nodes_with_filter(
        self, client, mock_graph_engine, sample_graph_data
    ):
        """Test graph nodes with type filter."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.return_value = [
                {'n': sample_graph_data['nodes'][0]}
            ]

            response = client.get('/api/enhanced/graph/nodes?node_type=Memory')
            assert response.status_code == 200

    def test_get_graph_nodes_no_engine(self, client):
        """Test graph nodes when engine not initialized."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=None,
        ):
            response = client.get('/api/enhanced/graph/nodes')
            assert response.status_code == 200
            data = response.json()
            assert data == []


class TestGraphRelationshipsEndpoint:
    """Test graph relationships endpoint."""

    def test_get_graph_relationships_success(
        self, client, mock_graph_engine, sample_graph_data
    ):
        """Test successful graph relationships retrieval."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.return_value = [
                sample_graph_data['relationships'][0]
            ]

            response = client.get('/api/enhanced/graph/relationships')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 1
            assert data[0]['type'] == 'REFERENCES'

    def test_get_graph_relationships_no_engine(self, client):
        """Test graph relationships when engine not initialized."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=None,
        ):
            response = client.get('/api/enhanced/graph/relationships')
            assert response.status_code == 200
            data = response.json()
            assert data == []


class TestMemoryCRUDEndpoints:
    """Test memory CRUD endpoints."""

    def test_add_memory_success(self, client, mock_graph_engine, sample_memory_data):
        """Test successful memory creation."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            response = client.post(
                '/api/enhanced/graph/memory', json=sample_memory_data
            )
            assert response.status_code == 200
            data = response.json()
            assert data['status'] == 'success'
            assert 'id' in data
            mock_graph_engine.add_memory_node.assert_called_once()

    def test_add_memory_no_engine(self, client, sample_memory_data):
        """Test memory creation when engine not initialized."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=None,
        ):
            response = client.post(
                '/api/enhanced/graph/memory', json=sample_memory_data
            )
            assert response.status_code == 501

    def test_get_memory_success(self, client, mock_graph_engine, sample_memory_data):
        """Test successful memory retrieval."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_memory = MagicMock()
            mock_memory.id = sample_memory_data['id']
            mock_memory.model_dump.return_value = sample_memory_data
            mock_graph_engine.get_memory_node.return_value = mock_memory

            response = client.get(
                f'/api/enhanced/graph/memory/{sample_memory_data["id"]}'
            )
            assert response.status_code == 200
            data = response.json()
            assert data['id'] == sample_memory_data['id']

    def test_get_memory_not_found(self, client, mock_graph_engine):
        """Test memory retrieval when not found."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.get_memory_node.return_value = None

            response = client.get('/api/enhanced/graph/memory/nonexistent')
            assert response.status_code == 404

    def test_update_memory_success(self, client, mock_graph_engine, sample_memory_data):
        """Test successful memory update."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            updated_data = {**sample_memory_data, 'content': 'Updated content'}
            response = client.put(
                f'/api/enhanced/graph/memory/{sample_memory_data["id"]}',
                json=updated_data,
            )
            assert response.status_code == 200
            mock_graph_engine.update_memory_node.assert_called_once()

    def test_delete_memory_success(self, client, mock_graph_engine, sample_memory_data):
        """Test successful memory deletion."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            response = client.delete(
                f'/api/enhanced/graph/memory/{sample_memory_data["id"]}'
            )
            assert response.status_code == 200
            mock_graph_engine.delete_memory_node.assert_called_once()


class TestGraphLinkEndpoint:
    """Test graph link endpoint."""

    def test_link_nodes_success(self, client, mock_graph_engine):
        """Test successful node linking."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            link_data = {
                'source': 'node1',
                'target': 'node2',
                'relationship_type': 'RELATED_TO',
                'properties': {'strength': 0.8},
            }
            response = client.post('/api/enhanced/graph/link', json=link_data)
            assert response.status_code == 200
            mock_graph_engine.link_nodes.assert_called_once()


class TestGraphSearchEndpoint:
    """Test graph search endpoint."""

    def test_hybrid_search_success(self, client, mock_graph_engine):
        """Test successful hybrid search."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.search_hybrid.return_value = [
                {'id': 'node1', 'content': 'Test content'}
            ]

            response = client.get('/api/enhanced/graph/search?query=test&top_k=10')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            mock_graph_engine.search_hybrid.assert_called_with('test', top_k=10)

    def test_hybrid_search_no_engine(self, client):
        """Test hybrid search when engine not initialized."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=None,
        ):
            response = client.get('/api/enhanced/graph/search?query=test')
            assert response.status_code == 200
            data = response.json()
            assert data == []


class TestGraphImpactEndpoint:
    """Test graph impact endpoint."""

    def test_get_impact_success(self, client, mock_graph_engine):
        """Test successful impact analysis."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.query_impact.return_value = [
                {'id': 'affected_node', 'severity': 'high'}
            ]

            response = client.get('/api/enhanced/graph/impact/test_symbol')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)


class TestGraphQueryEndpoint:
    """Test Cypher query endpoint."""

    def test_execute_cypher_success(self, client, mock_graph_engine):
        """Test successful Cypher query execution."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.return_value = [{'result': 'test_data'}]

            query_data = {'query': 'MATCH (n) RETURN n LIMIT 10', 'params': {}}
            response = client.post('/api/enhanced/graph/query', json=query_data)
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)

    def test_execute_cypher_dangerous_query(self, client):
        """Test dangerous query rejection."""
        dangerous_queries = [
            {'query': 'DELETE n', 'params': {}},
            {'query': 'DROP GRAPH', 'params': {}},
            {'query': 'REMOVE n', 'params': {}},
        ]

        for query_data in dangerous_queries:
            response = client.post('/api/enhanced/graph/query', json=query_data)
            assert response.status_code == 400


class TestKnowledgeBaseEndpoints:
    """Test knowledge base endpoints."""

    def test_ingest_kb_success(
        self, client, mock_kb_engine, mock_graph_engine, sample_kb_data
    ):
        """Test successful KB ingestion."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.KBIngestionEngine',
                return_value=mock_kb_engine,
            ):
                response = client.post('/api/enhanced/kb/ingest', json=sample_kb_data)
                assert response.status_code in [200, 202]
                data = response.json()
                assert data['status'] == 'success'

    def test_list_kbs_success(self, client, mock_kb_engine, mock_knowledge_base):
        """Test successful KB listing."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=MagicMock(),
        ):
            with patch(
                'agent_webui.api_extensions.IntelligenceGraphEngine.get_active'
            ) as mock_get_engine:
                mock_get_engine.return_value.backend = MagicMock()
                mock_get_engine.return_value.backend.execute.return_value = [
                    {'kb': mock_knowledge_base}
                ]

                response = client.get('/api/enhanced/kb/list')
                assert response.status_code == 200
                data = response.json()
                assert isinstance(data, list)

    def test_search_kb_success(self, client, mock_kb_engine):
        """Test successful KB search."""
        with patch(
            'agent_webui.api_extensions.KBIngestionEngine', return_value=mock_kb_engine
        ):
            mock_kb_engine.search.return_value = [
                {'id': 'article1', 'title': 'Test Article'}
            ]

            response = client.get('/api/enhanced/kb/search?query=test&kb_id=test_kb')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)

    def test_get_kb_article_success(self, client, mock_kb_engine, mock_article):
        """Test successful article retrieval."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=MagicMock(),
        ):
            with patch(
                'agent_webui.api_extensions.IntelligenceGraphEngine.get_active'
            ) as mock_get_engine:
                mock_get_engine.return_value.backend = MagicMock()
                mock_get_engine.return_value.backend.execute.return_value = [
                    {'a': mock_article}
                ]

                response = client.get('/api/enhanced/kb/article/article1')
                assert response.status_code == 200

    def test_kb_health_check_success(self, client, mock_kb_engine, mock_graph_engine):
        """Test successful KB health check."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.KBIngestionEngine',
                return_value=mock_kb_engine,
            ):
                mock_kb_engine.health_check.return_value = {
                    'health_status': 'healthy',
                    'issues': [],
                }

                response = client.post(
                    '/api/enhanced/kb/health', json={'kb_id': 'test_kb'}
                )
                assert response.status_code == 200
                data = response.json()
                assert data['health_status'] == 'healthy'


class TestSDDEndpoints:
    """Test SDD lifecycle endpoints."""

    def test_get_constitution_success(self, client, mock_sdd_manager):
        """Test successful constitution retrieval."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_sdd_manager.get_constitution.return_value = {
                'governance_rules': ['Rule 1', 'Rule 2'],
                'tech_stack': {'language': 'Python'},
                'quality_gates': ['Gate 1'],
            }

            response = client.get('/api/enhanced/sdd/constitution')
            assert response.status_code == 200
            data = response.json()
            assert 'governance_rules' in data

    def test_save_constitution_success(self, client, mock_sdd_manager):
        """Test successful constitution save."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            constitution_data = {
                'governance_rules': ['Rule 1'],
                'tech_stack': {'language': 'Python'},
            }

            response = client.post(
                '/api/enhanced/sdd/constitution', json=constitution_data
            )
            assert response.status_code == 200
            mock_sdd_manager.save_constitution.assert_called_once()

    def test_list_specs_success(self, client, mock_sdd_manager, mock_spec):
        """Test successful specs listing."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_sdd_manager.list_specs.return_value = [mock_spec]

            response = client.get('/api/enhanced/sdd/specs')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 1

    def test_create_spec_success(self, client, mock_sdd_manager, sample_spec_data):
        """Test successful spec creation."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_spec = MagicMock()
            mock_spec.id = 'spec1'
            mock_spec.model_dump.return_value = {**sample_spec_data, 'id': 'spec1'}
            mock_sdd_manager.create_spec.return_value = mock_spec

            response = client.post('/api/enhanced/sdd/spec', json=sample_spec_data)
            assert response.status_code == 200
            data = response.json()
            assert data['id'] == 'spec1'

    def test_list_plans_success(self, client, mock_sdd_manager, mock_plan):
        """Test successful plans listing."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_sdd_manager.list_plans.return_value = [mock_plan]

            response = client.get('/api/enhanced/sdd/plans')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)

    def test_get_tasks_success(self, client, mock_sdd_manager, mock_task):
        """Test successful tasks retrieval."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_tasks = MagicMock()
            mock_tasks.tasks = [mock_task]
            mock_tasks.model_dump.return_value = {'tasks': [mock_task]}
            mock_sdd_manager.get_tasks.return_value = mock_tasks

            response = client.get('/api/enhanced/sdd/tasks?plan_id=plan1')
            assert response.status_code == 200
            data = response.json()
            assert 'tasks' in data

    def test_sync_sdd_to_memory_success(
        self, client, mock_graph_engine, mock_sdd_manager
    ):
        """Test successful SDD to memory sync."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            with patch(
                'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
                return_value=mock_graph_engine,
            ):
                response = client.post(
                    '/api/enhanced/sdd/sync', json={'plan_id': 'plan1'}
                )
                assert response.status_code == 200
                mock_sdd_manager.sync_to_memory.assert_called_once()


class TestMAGMAEndpoint:
    """Test MAGMA orthogonal view endpoint."""

    def test_magma_retrieve_success(self, client, mock_graph_engine, sample_magma_data):
        """Test successful MAGMA context retrieval."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.retrieve_orthogonal_context.return_value = [
                {'id': 'result1', 'content': 'Test result'}
            ]

            response = client.post('/api/enhanced/graph/magma', json=sample_magma_data)
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)


class TestResourceManagementEndpoints:
    """Test resource management endpoints."""

    def test_list_resources_success(self, client, mock_graph_engine):
        """Test successful resource listing."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.return_value = [
                {'r': {'id': 'resource1', 'type': 'MCP_TOOL'}}
            ]

            response = client.get('/api/enhanced/resources')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)

    def test_spawn_agent_success(self, client, mock_graph_engine, sample_resource_data):
        """Test successful agent spawning."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_agent = MagicMock()
            mock_agent.id = 'spawned_agent1'
            mock_agent.model_dump.return_value = {
                **sample_resource_data,
                'id': 'spawned_agent1',
            }
            mock_graph_engine.spawn_specialized_agent.return_value = mock_agent

            response = client.post(
                '/api/enhanced/resources/spawn', json=sample_resource_data
            )
            assert response.status_code == 200
            data = response.json()
            assert data['id'] == 'spawned_agent1'


class TestMaintenanceEndpoints:
    """Test maintenance operation endpoints."""

    def test_get_maintenance_status_success(self, client, mock_maintainer):
        """Test successful maintenance status retrieval."""
        with patch(
            'agent_webui.api_extensions.GraphMaintainer', return_value=mock_maintainer
        ):
            response = client.get('/api/enhanced/maintenance/status')
            assert response.status_code == 200
            data = response.json()
            assert 'status' in data
            assert 'operations' in data

    def test_trigger_maintenance_success(
        self, client, mock_maintainer, mock_graph_engine, sample_maintenance_operation
    ):
        """Test successful maintenance trigger."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.GraphMaintainer',
                return_value=mock_maintainer,
            ):
                response = client.post(
                    '/api/enhanced/maintenance/trigger',
                    json=sample_maintenance_operation,
                )
                assert response.status_code == 200
                data = response.json()
                assert data['status'] == 'success'


class TestPipelineEndpoints:
    """Test pipeline monitoring endpoints."""

    def test_get_pipeline_status_success(
        self, client, mock_pipeline_runner, mock_graph_engine
    ):
        """Test successful pipeline status retrieval."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.PipelineRunner',
                return_value=mock_pipeline_runner,
            ):
                response = client.get('/api/enhanced/pipeline/status')
                assert response.status_code == 200
                data = response.json()
                assert 'status' in data
                assert 'phases' in data

    def test_trigger_pipeline_success(
        self, client, mock_pipeline_runner, mock_graph_engine, sample_pipeline_phase
    ):
        """Test successful pipeline trigger."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.PipelineRunner',
                return_value=mock_pipeline_runner,
            ):
                response = client.post(
                    '/api/enhanced/pipeline/trigger', json=sample_pipeline_phase
                )
                assert response.status_code == 200
                data = response.json()
                assert data['status'] == 'success'


class TestExtendedEndpoints:
    """Test various extended endpoints for coverage."""

    def test_update_kb_success(self, client, mock_kb_engine, mock_graph_engine):
        """Test successful KB update."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.KBIngestionEngine',
                return_value=mock_kb_engine,
            ):
                response = client.post(
                    '/api/enhanced/kb/update', json={'kb_id': 'test_kb'}
                )
                assert response.status_code == 200
                data = response.json()
                assert data['status'] == 'success'

    def test_update_kb_error(self, client, mock_kb_engine):
        """Test KB update error."""
        with patch(
            'agent_webui.api_extensions.KBIngestionEngine', return_value=mock_kb_engine
        ):
            mock_kb_engine.update.side_effect = Exception('Update failed')
            response = client.post('/api/enhanced/kb/update', json={'kb_id': 'test_kb'})
            assert response.status_code == 500

    def test_sync_sdd_to_memory_success(
        self, client, mock_sdd_manager, mock_graph_engine
    ):
        """Test successful SDD sync to memory."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
            ):
                response = client.post(
                    '/api/enhanced/sdd/sync', json={'plan_id': 'plan1'}
                )
                assert response.status_code == 200
                data = response.json()
                assert data['status'] == 'success'

    def test_spawn_agent_success(self, client, mock_graph_engine):
        """Test successful agent spawning."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_agent = MagicMock()
            mock_agent.model_dump.return_value = {'id': 'agent1', 'name': 'Test Agent'}
            mock_graph_engine.spawn_specialized_agent.return_value = mock_agent

            spawn_data = {'agent_type': 'specialist', 'task': 'test task'}
            response = client.post('/api/enhanced/resources/spawn', json=spawn_data)
            assert response.status_code == 200
            data = response.json()
            assert data['id'] == 'agent1'

    def test_get_backend_config_success(self, client):
        """Test successful backend config retrieval."""
        response = client.get('/api/enhanced/config/backend')
        assert response.status_code == 200
        data = response.json()
        assert 'backend_type' in data or 'status' in data

    def test_update_backend_config_never_fabricates_success(
        self, sample_backend_config
    ):
        """GOC-28 (BUG-008-class fabrication): `PUT /api/enhanced/config/backend`
        used to accept ANY payload and unconditionally return
        `{"status": "success", ...}` without writing an environment variable,
        config file, or anything else -- a mocked response standing in for a
        backend that did nothing, regardless of what the caller sent or
        whether the write was even possible. This calls the real handler
        function directly (not the fabricated response, not a stub) against
        three known-bad inputs -- an ordinary-looking config payload, an
        adversarial payload attempting to smuggle unrelated keys, and an
        empty payload -- and proves every one of them now gets the honest
        "no config-write path is wired" failure instead of a fake success.
        """
        for payload in (
            sample_backend_config,
            {'GRAPH_DB_PATH': '/etc/passwd', '__proto__': {'admin': True}},
            {},
        ):
            with pytest.raises(HTTPException) as excinfo:
                asyncio.run(api_extensions.update_backend_config(payload))
            assert excinfo.value.status_code == 501
            assert 'success' not in excinfo.value.detail.lower()


class TestCoverageExpansion:
    """Additional tests for coverage expansion."""

    def test_list_agents_error(self, client):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            side_effect=Exception('List agents failed'),
        ):
            response = client.get('/api/enhanced/agents')
            assert response.status_code == 200
            assert response.json() == []

    def test_add_memory_error(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.add_memory_node.side_effect = Exception('Add failed')
            response = client.post(
                '/api/enhanced/graph/memory', json={'content': 'test'}
            )
            assert response.status_code == 500

    def test_update_memory_error(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.update_memory_node.side_effect = Exception(
                'Update failed'
            )
            response = client.put(
                '/api/enhanced/graph/memory/mem1', json={'content': 'test'}
            )
            assert response.status_code == 500

    def test_delete_memory_error(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.delete_memory_node.side_effect = Exception(
                'Delete failed'
            )
            response = client.delete('/api/enhanced/graph/memory/mem1')
            assert response.status_code == 500

    def test_link_nodes_error(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.link_nodes.side_effect = Exception('Link failed')
            response = client.post(
                '/api/enhanced/graph/link',
                json={'source': 'a', 'target': 'b', 'relationship_type': 'c'},
            )
            assert response.status_code == 500

    def test_hybrid_search_error(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.search_hybrid.side_effect = Exception('Search failed')
            response = client.get('/api/enhanced/graph/search?query=test')
            assert response.status_code == 200
            assert response.json() == []

    def test_ingest_kb_error(self, client, mock_kb_engine, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.KBIngestionEngine',
                return_value=mock_kb_engine,
            ):
                mock_kb_engine.ingest.side_effect = Exception('Ingest failed')
                response = client.post(
                    '/api/enhanced/kb/ingest', json={'kb_id': 'test', 'source': 'test'}
                )
                assert response.status_code == 500

    def test_get_tasks_error(self, client):
        with patch(
            'agent_webui.api_extensions.SDDManager', side_effect=Exception('SDD error')
        ):
            response = client.get('/api/enhanced/sdd/tasks')
            assert response.status_code == 200
            assert response.json() == {}

    def test_list_skills_success(self, client):
        with patch('agent_webui.api_extensions.get_helper', return_value=lambda: []):
            response = client.get('/api/enhanced/skills')
            assert response.status_code == 200
            assert response.json() == []

    def test_list_skills_not_init(self, client):
        with patch('agent_webui.api_extensions.get_helper', return_value=None):
            response = client.get('/api/enhanced/skills')
            assert response.status_code == 501

    def test_toggle_skill_success(self, client):
        mock_toggle = MagicMock(return_value={'status': 'enabled'})
        with patch('agent_webui.api_extensions.get_helper', return_value=mock_toggle):
            response = client.post('/api/enhanced/skills/skill1/toggle')
            assert response.status_code == 200
            assert response.json()['status'] == 'enabled'

    def test_spawn_agent_success(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_agent = MagicMock()
            mock_agent.model_dump.return_value = {'id': 'agent1'}
            mock_graph_engine.spawn_specialized_agent.return_value = mock_agent
            response = client.post(
                '/api/enhanced/resources/spawn', json={'agent_id': 'test'}
            )
            assert response.status_code == 200
            assert response.json()['id'] == 'agent1'

    def test_get_graph_stats_error(self, client):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            side_effect=Exception('Stats failed'),
        ):
            response = client.get('/api/enhanced/graph/stats')
            assert response.status_code == 200
            assert response.json()['total_nodes'] == 0

    def test_list_kbs_success(self, client, mock_graph_engine, mock_kb_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.KBIngestionEngine',
                return_value=mock_kb_engine,
            ):
                mock_kb_engine.list_bases.return_value = [{'id': 'kb1'}]
                response = client.get('/api/enhanced/kb/list')
                assert response.status_code == 200
                assert len(response.json()) == 1

    def test_kb_health_check_success(self, client, mock_graph_engine, mock_kb_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.KBIngestionEngine',
                return_value=mock_kb_engine,
            ):
                response = client.post(
                    '/api/enhanced/kb/health', json={'kb_id': 'test'}
                )
                assert response.status_code == 200
                assert response.json()['health_status'] == 'healthy'

    def test_list_specs_success(self, client, mock_sdd_manager):
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_sdd_manager.list_specs.return_value = [{'id': 'spec1'}]
            response = client.get('/api/enhanced/sdd/specs')
            assert response.status_code == 200
            assert len(response.json()) == 1

    def test_create_spec_success(self, client, mock_sdd_manager):
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_sdd_manager.create_spec.return_value = MagicMock()
            mock_sdd_manager.create_spec.return_value.id = 'spec1'
            mock_sdd_manager.create_spec.return_value.model_dump.return_value = {
                'id': 'spec1'
            }
            # Use data that won't fail validation
            response = client.post(
                '/api/enhanced/sdd/spec', json={'name': 'test', 'description': 'test'}
            )
            assert response.status_code == 200

    def test_graph_impact_success(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.query_impact.return_value = [{'id': 'impact1'}]
            # Fix URL: /graph/impact/{symbol}
            response = client.get('/api/enhanced/graph/impact/test')
            assert response.status_code == 200
            assert len(response.json()) == 1

    def test_pipeline_status_error(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.PipelineRunner',
                side_effect=Exception('Status failed'),
            ):
                response = client.get('/api/enhanced/pipeline/status')
                assert response.status_code == 200
                # Matches return {'status': 'error'} in api_extensions.py
                assert response.json()['status'] == 'error'

    def test_list_plans_success(self, client, mock_sdd_manager):
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_sdd_manager.list_plans.return_value = [{'id': 'plan1'}]
            response = client.get('/api/enhanced/sdd/plans')
            assert response.status_code == 200
            assert len(response.json()) == 1

    def test_sync_sdd_success(self, client, mock_sdd_manager, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
            ):
                response = client.post(
                    '/api/enhanced/sdd/sync', json={'spec_id': 'test'}
                )
                assert response.status_code == 200
                assert response.json()['status'] == 'success'

    def test_graph_stats_success(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend.execute.return_value = [{'total': 10}]
            response = client.get('/api/enhanced/graph/stats')
            assert response.status_code == 200
            assert 'total_nodes' in response.json()

    def test_trigger_pipeline_success(
        self, client, mock_pipeline_runner, mock_graph_engine
    ):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.PipelineRunner',
                return_value=mock_pipeline_runner,
            ):
                response = client.post(
                    '/api/enhanced/pipeline/trigger', json={'phase': 'test'}
                )
                assert response.status_code == 200
                assert response.json()['status'] == 'success'


class TestInfraHandlersFailHonestly:
    """Infra handlers must surface real failures, never fabricate success.

    These previously returned hardcoded 'Simulated' success payloads on error —
    a dangerous facade for SSH/exec/process-kill operations. The fix raises the
    real error instead; these tests lock that in.
    """

    def test_add_host_failure_not_simulated(self, client):
        """A failed host registration reports the error, never 'added (Simulated)'."""
        with patch(
            'tunnel_manager.tunnel_manager.HostManager',
            side_effect=RuntimeError('store unwritable'),
        ):
            response = client.post(
                '/api/enhanced/tunnel-manager/hosts',
                json={
                    'alias': 'x',
                    'hostname': 'h',
                    'user': 'u',
                },
            )
        assert response.status_code >= 400
        assert 'Simulated' not in response.text


class TestWorkflowsEndpointFailsHonestly:
    """`GET /api/enhanced/workflows` must distinguish a real backend failure
    (D-W5WR-4: e.g. `PlacementAuthorityError`) from a genuinely empty
    Workflows list -- same class of fix `TestGraphNodesEndpoint` locks in for
    `/graph/nodes` (D-W6-10). Before this fix, a raised backend exception was
    swallowed into a bare `200 []`, indistinguishable from "no workflows
    saved yet".
    """

    def test_list_workflows_backend_error_is_not_silently_empty(
        self, client, mock_graph_engine
    ):
        """A backend failure raises 503, not a fabricated `200 []`."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.side_effect = RuntimeError(
                'PlacementAuthorityError: admin:cluster-read required'
            )

            response = client.get('/api/enhanced/workflows')

        assert response.status_code == 503
        assert response.json() != []

    def test_list_workflows_genuinely_empty_is_200(self, client, mock_graph_engine):
        """A real empty graph still returns `200 []` -- the fix must not
        turn a genuinely empty Workflows list into a false failure."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.return_value = []

            response = client.get('/api/enhanced/workflows')

        assert response.status_code == 200
        assert response.json() == []


class TestServerIntegration:
    """Test server-level features."""

    def test_spa_fallback(self, client):
        response = client.get('/some-random-route')
        assert response.status_code in [200, 404]
