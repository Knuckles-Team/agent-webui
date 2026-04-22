"""Integration tests for agent-webui API and component interactions."""

from unittest.mock import MagicMock, patch

import pytest
from agent_webui.server import create_agent_web_app
from fastapi.testclient import TestClient


@pytest.fixture
def client(mock_agent, mock_workspace_helpers):
    """Create test client."""
    app = create_agent_web_app(mock_agent, mock_workspace_helpers)
    return TestClient(app)


class TestGraphWorkflowIntegration:
    """Test end-to-end graph workflow."""

    def test_complete_graph_workflow(self, client, mock_graph_engine):
        """Test complete workflow: stats → nodes → relationships → search."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            # Step 1: Get graph stats
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.side_effect = [
                [{'count': 100}],  # total nodes
                [{'count': 200}],  # total relationships
                [{'count': 50}],  # Memory type
            ]

            stats_response = client.get('/api/enhanced/graph/stats')
            assert stats_response.status_code == 200
            stats_data = stats_response.json()
            assert stats_data['total_nodes'] == 100

            # Step 2: Get nodes
            mock_graph_engine.backend.execute.return_value = [
                {
                    'n': {
                        'id': 'node1',
                        'labels': ['Memory'],
                        'properties': {'content': 'Test'},
                    }
                }
            ]

            nodes_response = client.get('/api/enhanced/graph/nodes')
            assert nodes_response.status_code == 200
            nodes_data = nodes_response.json()
            assert len(nodes_data) > 0

            # Step 3: Create memory
            memory_data = {
                'content': 'Integration test memory',
                'importance': 0.9,
                'tags': ['integration', 'test'],
            }

            mock_graph_engine.add_memory_node.return_value = MagicMock(
                id='mem_integration'
            )
            memory_response = client.post(
                '/api/enhanced/graph/memory', json=memory_data
            )
            assert memory_response.status_code == 200

            # Step 4: Search for the memory
            mock_graph_engine.search_hybrid.return_value = [
                {'id': 'mem_integration', 'content': 'Integration test memory'}
            ]

            search_response = client.get('/api/enhanced/graph/search?query=integration')
            assert search_response.status_code == 200
            search_data = search_response.json()
            assert len(search_data) > 0


class TestKnowledgeBaseWorkflowIntegration:
    """Test end-to-end knowledge base workflow."""

    def test_complete_kb_workflow(self, client, mock_kb_engine, mock_graph_engine):
        """Test complete workflow: ingest → list → search → health check."""
        with patch(
            'agent_webui.api_extensions.KBIngestionEngine', return_value=mock_kb_engine
        ):
            # Step 1: Ingest knowledge base
            kb_data = {
                'kb_id': 'integration_kb',
                'source': '/test/integration',
                'name': 'Integration Test KB',
                'options': {'chunk_size': 1024},
            }

            ingest_response = client.post('/api/enhanced/kb/ingest', json=kb_data)
            assert ingest_response.status_code in [200, 202]

            # Step 2: List knowledge bases
            with patch(
                'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
                return_value=mock_graph_engine,
            ):
                mock_graph_engine.backend = MagicMock()
                mock_graph_engine.backend.execute.return_value = [
                    {'kb': {'id': 'integration_kb', 'name': 'Integration Test KB'}}
                ]

                list_response = client.get('/api/enhanced/kb/list')
                assert list_response.status_code == 200

            # Step 3: Search knowledge base
            mock_kb_engine.search.return_value = [
                {'id': 'article1', 'title': 'Integration Article'}
            ]

            search_response = client.get(
                '/api/enhanced/kb/search?query=integration&kb_id=integration_kb'
            )
            assert search_response.status_code == 200

            # Step 4: Health check
            mock_kb_engine.health_check.return_value = {
                'health_status': 'healthy',
                'issues': [],
            }

            health_response = client.post(
                '/api/enhanced/kb/health', json={'kb_id': 'integration_kb'}
            )
            assert health_response.status_code == 200
            health_data = health_response.json()
            assert health_data['health_status'] == 'healthy'


class TestSDDWorkflowIntegration:
    """Test end-to-end SDD lifecycle workflow."""

    def test_complete_sdd_workflow(self, client, mock_sdd_manager):
        """Test complete workflow: constitution → spec → plan → tasks → sync."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            # Step 1: Create constitution
            constitution_data = {
                'governance_rules': ['Integration rule 1'],
                'tech_stack': {'language': 'Python'},
                'quality_gates': ['Gate 1'],
            }

            const_response = client.post(
                '/api/enhanced/sdd/constitution', json=constitution_data
            )
            assert const_response.status_code == 200

            # Step 2: Create spec
            spec_data = {
                'title': 'Integration Feature',
                'description': 'Integration test feature',
                'user_stories': ['As a user, I want integration testing'],
                'acceptance_criteria': ['Given integration test, when run, then pass'],
            }

            mock_spec = MagicMock()
            mock_spec.id = 'integration_spec'
            mock_spec.model_dump.return_value = {**spec_data, 'id': 'integration_spec'}
            mock_sdd_manager.create_spec.return_value = mock_spec

            spec_response = client.post('/api/enhanced/sdd/spec', json=spec_data)
            assert spec_response.status_code == 200

            # Step 3: Create plan
            plan_data = {
                'spec_id': 'integration_spec',
                'technical_approach': 'Integration technical approach',
            }

            mock_plan = MagicMock()
            mock_plan.id = 'integration_plan'
            mock_plan.model_dump.return_value = {**plan_data, 'id': 'integration_plan'}
            mock_sdd_manager.create_plan.return_value = mock_plan

            plan_response = client.post('/api/enhanced/sdd/plan', json=plan_data)
            assert plan_response.status_code == 200

            # Step 4: Get tasks
            mock_tasks = MagicMock()
            mock_tasks.tasks = [
                {
                    'id': 'task1',
                    'title': 'Integration Task',
                    'status': 'pending',
                    'parallel': False,
                    'dependencies': [],
                }
            ]
            mock_tasks.model_dump.return_value = {'tasks': mock_tasks.tasks}
            mock_sdd_manager.get_tasks.return_value = mock_tasks

            tasks_response = client.get(
                '/api/enhanced/sdd/tasks?plan_id=integration_plan'
            )
            assert tasks_response.status_code == 200

            # Step 5: Sync to memory
            with patch(
                'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
                return_value=MagicMock(),
            ):
                sync_response = client.post(
                    '/api/enhanced/sdd/sync', json={'plan_id': 'integration_plan'}
                )
                assert sync_response.status_code == 200


class TestMAGMAWorkflowIntegration:
    """Test end-to-end MAGMA orthogonal view workflow."""

    def test_magma_retrieval_workflow(self, client, mock_graph_engine):
        """Test MAGMA context retrieval across different views."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            # Test semantic view
            magma_data = {
                'query': 'test query',
                'view_type': 'semantic',
                'policy': {'max_results': 10, 'min_confidence': 0.5},
            }

            mock_graph_engine.retrieve_orthogonal_context.return_value = [
                {'id': 'result1', 'content': 'Semantic result'}
            ]

            semantic_response = client.post(
                '/api/enhanced/graph/magma', json=magma_data
            )
            assert semantic_response.status_code == 200
            semantic_data = semantic_response.json()
            assert len(semantic_data) > 0

            # Test temporal view
            magma_data['view_type'] = 'temporal'
            mock_graph_engine.retrieve_orthogonal_context.return_value = [
                {'id': 'result2', 'content': 'Temporal result'}
            ]

            temporal_response = client.post(
                '/api/enhanced/graph/magma', json=magma_data
            )
            assert temporal_response.status_code == 200

            # Test causal view
            magma_data['view_type'] = 'causal'
            mock_graph_engine.retrieve_orthogonal_context.return_value = [
                {'id': 'result3', 'content': 'Causal result'}
            ]

            causal_response = client.post('/api/enhanced/graph/magma', json=magma_data)
            assert causal_response.status_code == 200

            # Test entity view
            magma_data['view_type'] = 'entity'
            mock_graph_engine.retrieve_orthogonal_context.return_value = [
                {'id': 'result4', 'content': 'Entity result'}
            ]

            entity_response = client.post('/api/enhanced/graph/magma', json=magma_data)
            assert entity_response.status_code == 200


class TestResourceManagementWorkflowIntegration:
    """Test end-to-end resource management workflow."""

    def test_resource_workflow(self, client, mock_graph_engine):
        """Test resource listing and agent spawning."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            # Step 1: List resources
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.return_value = [
                {'r': {'id': 'resource1', 'type': 'MCP_TOOL', 'name': 'Test Tool'}}
            ]

            resources_response = client.get('/api/enhanced/resources')
            assert resources_response.status_code == 200
            resources_data = resources_response.json()
            assert len(resources_data) > 0

            # Step 2: Spawn specialized agent
            spawn_data = {
                'name': 'integration_agent',
                'description': 'Integration test agent',
                'toolset': ['tool1', 'tool2'],
                'capabilities': ['capability1'],
            }

            mock_agent = MagicMock()
            mock_agent.id = 'spawned_agent1'
            mock_agent.model_dump.return_value = {**spawn_data, 'id': 'spawned_agent1'}
            mock_graph_engine.spawn_specialized_agent.return_value = mock_agent

            spawn_response = client.post(
                '/api/enhanced/resources/spawn', json=spawn_data
            )
            assert spawn_response.status_code == 200
            spawn_data_response = spawn_response.json()
            assert spawn_data_response['id'] == 'spawned_agent1'


class TestMaintenanceWorkflowIntegration:
    """Test end-to-end maintenance workflow."""

    def test_maintenance_workflow(self, client, mock_maintainer):
        """Test maintenance status and operation triggering."""
        with patch(
            'agent_webui.api_extensions.GraphMaintainer', return_value=mock_maintainer
        ):
            # Step 1: Get maintenance status
            status_response = client.get('/api/enhanced/maintenance/status')
            assert status_response.status_code == 200
            status_data = status_response.json()
            assert 'status' in status_data
            assert 'operations' in status_data

            # Step 2: Trigger maintenance operation
            operation_data = {
                'operation': 'embedding_enrichment',
                'options': {'force': True, 'batch_size': 100},
            }

            mock_maintainer.trigger_operation.return_value = {'status': 'success'}

            trigger_response = client.post(
                '/api/enhanced/maintenance/trigger', json=operation_data
            )
            assert trigger_response.status_code == 200
            trigger_data = trigger_response.json()
            assert trigger_data['status'] == 'success'


class TestErrorHandlingIntegration:
    """Test error handling across integrated workflows."""

    def test_graph_not_initialized_handling(self, client):
        """Test handling when graph engine is not initialized."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=None,
        ):
            # All endpoints should return gracefully
            stats_response = client.get('/api/enhanced/graph/stats')
            assert stats_response.status_code == 200
            assert stats_response.json()['total_nodes'] == 0

            nodes_response = client.get('/api/enhanced/graph/nodes')
            assert nodes_response.status_code == 200
            assert nodes_response.json() == []

            memory_response = client.post(
                '/api/enhanced/graph/memory', json={'content': 'test'}
            )
            assert memory_response.status_code == 501


class TestPerformanceIntegration:
    """Test performance characteristics of integrated workflows."""

    def test_concurrent_requests_handling(self, client, mock_graph_engine):
        """Test that the API handles concurrent requests gracefully."""
        import concurrent.futures

        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.return_value = [{'count': 100}]

            def make_request():
                return client.get('/api/enhanced/graph/stats')

            # Make 10 concurrent requests
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                futures = [executor.submit(make_request) for _ in range(10)]
                results = [
                    future.result()
                    for future in concurrent.futures.as_completed(futures)
                ]

            # All requests should succeed
            assert all(response.status_code == 200 for response in results)
