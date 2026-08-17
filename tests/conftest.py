"""Test configuration and fixtures for agent-webui backend tests."""

import os
import shutil
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

# Create test directory structure
TEST_DIR = Path(__file__).parent
FIXTURES_DIR = TEST_DIR / 'fixtures'


@pytest.fixture
def temp_db():
    """Create a temporary database for testing."""
    db_dir = tempfile.mkdtemp()
    db_path = os.path.join(db_dir, 'test.db')
    yield db_path
    shutil.rmtree(db_dir)


@pytest.fixture
def mock_graph_engine(monkeypatch):
    """Mock intelligence graph engine.

    ``GraphComputeEngine.__init__`` -> ``resolve_routing_graph`` now requires
    a verified actor context (``agent_utilities.security.brain_context
    .current_actor()``) since the verified-identity-carrier contract landed
    (docs/architecture/verified-identity-carrier-contract.md) -- without one,
    construction raises ``IdentityRequiredError`` and EVERY test in this file
    that depends on this fixture errors at setup, before its own body ever
    runs (confirmed live: ``TestGraphNodesEndpoint`` et al. broke the same
    way). Scope a synthetic, clearly-fake test actor to fixture construction
    only, mirroring the pattern ``agent-utilities``' own ``tests/conftest.py``
    already uses for the same requirement -- this is a test fixture,
    not a request path, so it never reaches ``validate_carrier_claims()``.

    That resolved the actor-context gate, but exposed a second, deeper gap:
    a bare ``GraphComputeEngine()`` is not a test double at all -- its real
    ``__init__`` (agent_utilities/knowledge_graph/core/graph_compute.py)
    calls ``resolve_engine()`` and then
    ``SyncEpistemicGraphClient.connect(**connect_kwargs)``, i.e. it opens a
    real UDS/TCP socket to a live epistemic-graph coordinator. With no engine
    running and autostart disabled that is ``ConnectionRefusedError``; without
    the optional native ``epistemic_graph`` client package installed at all
    (this repo does not depend on it) it is ``ModuleNotFoundError`` on the
    ``from epistemic_graph.client import SyncEpistemicGraphClient`` import a
    few lines into the same constructor. Either way, a fixture named "mock"
    was constructing a live client.

    ``agent-utilities``' own suite hits the mirror-image problem -- a REAL
    engine must never leak identity/state across tests -- and solves it by
    monkeypatching ``GraphComputeEngine.__init__``/``get_or_create`` *before*
    construction rather than trusting the constructor to behave
    (``agent-utilities`` ``tests/conftest.py::isolate_graph_compute_engine``'s
    ``_isolated_init``/``_isolated_get_or_create``, tests/conftest.py:618-687
    there). Port that same technique -- intercept the constructor at the
    class level via ``monkeypatch.setattr`` rather than calling the real one
    -- but push it all the way to a genuine double instead of an
    isolated-namespace real engine: the replacement ``__init__`` never calls
    ``resolve_engine()``, never imports ``epistemic_graph``, and never opens a
    socket. It only sets the plain attributes this codebase's consumers
    actually read off ``GraphComputeEngine`` instances (``graph_name``,
    ``endpoint``, the private transport bookkeeping fields ``close()``
    checks). The instance is still a real ``GraphComputeEngine`` (built via
    the real class, just with a stubbed ``__init__``), so
    ``isinstance(engine.graph, GraphComputeEngine)`` -- which is exactly what
    ``PipelineContext`` (agent_utilities/knowledge_graph/pipeline/types.py,
    ``graph: GraphComputeEngine`` under Pydantic
    ``arbitrary_types_allowed=True``) validates -- still passes.
    """
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine

    engine = MagicMock(spec=IntelligenceGraphEngine)
    engine.query_cypher.return_value = []
    engine.search_hybrid.return_value = []
    engine.add_memory_node.return_value = None
    engine.update_memory_node.return_value = None
    engine.delete_memory_node.return_value = None
    engine.link_nodes.return_value = None
    engine.query_impact.return_value = []
    engine.retrieve_orthogonal_context.return_value = []
    engine.list_callable_resources.return_value = []
    engine.spawn_specialized_agent.return_value = MagicMock()
    from agent_utilities.knowledge_graph.backends.base import GraphBackend

    engine.backend = MagicMock(spec=GraphBackend)
    # Production engines expose ``graph`` as the GraphComputeEngine facade
    # (IntelligenceGraphEngine.__init__ sets graph = graph_compute), and
    # consumers like PipelineContext validate that exact type — a bare
    # networkx graph here makes the mock diverge from the real contract.
    from agent_utilities.knowledge_graph.core.graph_compute import (
        GraphComputeEngine,
    )
    from agent_utilities.models.company_brain import ActorType
    from agent_utilities.security.brain_context import ActorContext, use_actor

    def _double_init(self, graph_name: str | None = None, **_kwargs) -> None:
        """No-network stand-in for ``GraphComputeEngine.__init__``.

        Sets only what a constructed instance is actually read for in this
        surface (isinstance checks, ``graph_name``/``endpoint`` display,
        ``close()``'s idempotency guard) -- never resolves an engine
        coordinator, never imports ``epistemic_graph``, never touches a
        socket.
        """
        self.graph = {}
        self.graph_name = graph_name or 'test-graph'
        self.endpoint = 'test://mock-graph-engine-fixture'
        self._process_root = self
        self._client = MagicMock(name='GraphComputeEngine._client (test double)')
        self._transport_client = None
        self._transport_closed = True
        self._event_bridge_stop = None
        self._event_bridge_thread = None
        self._event_bridge_loop = None
        self._event_bridge_async_stop = None
        self._server_ops = None
        self._mode = 'test-double'

    monkeypatch.setattr(GraphComputeEngine, '__init__', _double_init)

    test_actor = ActorContext(
        actor_id='test:agent-webui-fixture',
        actor_type=ActorType.AUTOMATED_SERVICE,
        roles=('test',),
        tenant_id='test-tenant',
        authenticated=True,
    )
    with use_actor(test_actor):
        engine.graph = GraphComputeEngine()

    return engine


@pytest.fixture
def mock_kb_engine():
    """Mock knowledge base engine."""
    from agent_utilities.knowledge_graph.kb.ingestion import KBIngestionEngine

    engine = MagicMock(spec=KBIngestionEngine)
    engine.ingest = AsyncMock(return_value={'status': 'success', 'job_id': 'test_job'})
    engine.list_bases.return_value = []
    engine.search.return_value = []
    engine.get_article.return_value = None
    engine.health_check = AsyncMock(
        return_value={'health_status': 'healthy', 'issues': []}
    )
    engine.update = AsyncMock(return_value=None)
    import networkx as nx

    engine.graph = nx.MultiDiGraph()

    return engine


@pytest.fixture
def mock_sdd_manager():
    """Mock SDD manager."""
    from agent_utilities.sdd import SDDManager

    manager = MagicMock(spec=SDDManager)
    manager.get_constitution.return_value = None
    manager.save_constitution.return_value = None
    manager.list_specs.return_value = []
    manager.create_spec.return_value = MagicMock(id='spec1')
    manager.list_plans.return_value = []
    manager.get_tasks.return_value = MagicMock(tasks=[])
    manager.get_all_tasks.return_value = MagicMock(tasks=[])
    manager.sync_to_memory.return_value = None

    return manager


@pytest.fixture
def mock_maintainer():
    """Mock graph maintainer."""
    from agent_utilities.knowledge_graph.core.maintainer import GraphMaintainer

    maintainer = MagicMock(spec=GraphMaintainer)
    maintainer.get_status.return_value = {
        'status': 'idle',
        'operations': {
            'embedding_enrichment': 'idle',
            'cron_log_pruning': 'idle',
            'chat_summarization': 'idle',
        },
    }
    maintainer.trigger_operation.return_value = {'status': 'success'}

    return maintainer


@pytest.fixture
def mock_pipeline_runner():
    """Mock pipeline runner."""
    from agent_utilities.knowledge_graph.pipeline.runner import PipelineRunner

    runner = MagicMock(spec=PipelineRunner)
    runner.get_status.return_value = {
        'status': 'idle',
        'phases': {'memory': 'complete', 'scan': 'complete', 'parse': 'complete'},
    }
    runner.run = AsyncMock(return_value={'status': 'success'})

    return runner


@pytest.fixture
def sample_graph_data():
    """Sample graph data for testing."""
    return {
        'nodes': [
            {
                'id': 'node1',
                'labels': ['Memory'],
                'properties': {'content': 'Test memory', 'importance': 0.8},
            },
            {
                'id': 'node2',
                'labels': ['Article'],
                'properties': {'title': 'Test Article', 'content': 'Article content'},
            },
        ],
        'relationships': [{'source': 'node1', 'type': 'REFERENCES', 'target': 'node2'}],
    }


@pytest.fixture
def sample_memory_data():
    """Sample memory data for testing."""
    return {
        'id': 'mem1',
        'content': 'Test memory content',
        'importance': 0.8,
        'tags': ['test', 'memory'],
        'created_at': '2024-01-01T00:00:00Z',
        'updated_at': '2024-01-01T00:00:00Z',
    }


@pytest.fixture
def sample_kb_data():
    """Sample knowledge base data for testing."""
    return {
        'kb_id': 'test_kb',
        'source': 'test/path',
        'name': 'Test Knowledge Base',
        'options': {'chunk_size': 1024, 'extract_model': None},
    }


@pytest.fixture
def sample_spec_data():
    """Sample specification data for testing."""
    return {
        'title': 'Test Feature',
        'description': 'Test feature description',
        'user_stories': ['As a user, I want...'],
        'acceptance_criteria': ['Given... When... Then...'],
    }


@pytest.fixture
def sample_plan_data():
    """Sample implementation plan data for testing."""
    return {'spec_id': 'spec1', 'technical_approach': 'Test technical approach'}


@pytest.fixture
def sample_magma_data():
    """Sample MAGMA retrieval data for testing."""
    return {
        'query': 'test query',
        'view_type': 'semantic',
        'policy': {'max_results': 10, 'min_confidence': 0.5},
    }


@pytest.fixture
def sample_resource_data():
    """Sample resource spawning data for testing."""
    return {
        'name': 'test_agent',
        'description': 'Test agent description',
        'toolset': ['tool1', 'tool2'],
        'capabilities': ['capability1'],
    }


@pytest.fixture
def sample_cypher_query():
    """Sample Cypher query data for testing."""
    return {'query': 'MATCH (n) RETURN n LIMIT 10', 'params': {}}


@pytest.fixture
def sample_maintenance_operation():
    """Sample maintenance operation data for testing."""
    return {
        'operation': 'embedding_enrichment',
        'options': {'force': True, 'batch_size': 100},
    }


@pytest.fixture
def sample_pipeline_phase():
    """Sample pipeline phase data for testing."""
    return {'phase': 'memory', 'options': {'force': False}}


@pytest.fixture
def sample_backend_config():
    """Sample backend configuration data for testing."""
    return {
        'backend_type': 'ladybug',
        'db_path': '/test/path/test.db',
        'host': 'localhost',
        'port': 5432,
    }


@pytest.fixture
def mock_knowledge_base():
    """Mock knowledge base object."""
    kb = MagicMock()
    kb.id = 'kb1'
    kb.name = 'Test KB'
    kb.namespace = 'kb:test'
    kb.article_count = 10
    kb.model_dump.return_value = {
        'id': 'kb1',
        'name': 'Test KB',
        'namespace': 'kb:test',
        'article_count': 10,
    }
    return kb


@pytest.fixture
def mock_article():
    """Mock article object."""
    article = MagicMock()
    article.id = 'article1'
    article.title = 'Test Article'
    article.content = '# Test Article\n\nThis is test content.'
    article.namespace = 'kb:test'
    article.model_dump.return_value = {
        'id': 'article1',
        'title': 'Test Article',
        'content': '# Test Article\n\nThis is test content.',
        'namespace': 'kb:test',
    }
    return article


@pytest.fixture
def mock_spec():
    """Mock specification object."""
    spec = MagicMock()
    spec.id = 'spec1'
    spec.title = 'Test Spec'
    spec.description = 'Test description'
    spec.user_stories = ['As a user, I want...']
    spec.acceptance_criteria = ['Given... When... Then...']
    spec.model_dump.return_value = {
        'id': 'spec1',
        'title': 'Test Spec',
        'description': 'Test description',
        'user_stories': ['As a user, I want...'],
        'acceptance_criteria': ['Given... When... Then...'],
    }
    return spec


@pytest.fixture
def mock_plan():
    """Mock implementation plan object."""
    plan = MagicMock()
    plan.id = 'plan1'
    plan.spec_id = 'spec1'
    plan.technical_approach = 'Test technical approach'
    plan.model_dump.return_value = {
        'id': 'plan1',
        'spec_id': 'spec1',
        'technical_approach': 'Test technical approach',
    }
    return plan


@pytest.fixture
def mock_task():
    """Mock task object."""
    task = MagicMock()
    task.id = 'task1'
    task.title = 'Test Task'
    task.description = 'Test task description'
    task.status = 'pending'
    task.parallel = False
    task.dependencies = []
    task.model_dump.return_value = {
        'id': 'task1',
        'title': 'Test Task',
        'description': 'Test task description',
        'status': 'pending',
        'parallel': False,
        'dependencies': [],
    }
    return task


@pytest.fixture
def patch_graph_engine(monkeypatch):
    """Patch graph engine for testing."""

    def patch_get_active(engine_mock):
        monkeypatch.setattr(
            'agent_utilities.knowledge_graph.core.engine.IntelligenceGraphEngine.get_active',
            lambda: engine_mock,
        )
        return engine_mock

    return patch_get_active


@pytest.fixture
def patch_kb_engine(monkeypatch):
    """Patch KB engine for testing."""

    def patch_kb_ingestion(engine_mock):
        monkeypatch.setattr(
            'agent_utilities.knowledge_graph.kb.ingestion.KBIngestionEngine',
            lambda *args, **_kwargs: engine_mock,
        )
        return engine_mock

    return patch_kb_ingestion


@pytest.fixture
def patch_sdd_manager(monkeypatch):
    """Patch SDD manager for testing."""

    def patch_sdd(manager_mock):
        monkeypatch.setattr(
            'agent_utilities.sdd.SDDManager', lambda *args, **_kwargs: manager_mock
        )
        return manager_mock

    return patch_sdd


@pytest.fixture
def mock_agent():
    """Mock Pydantic AI agent for testing."""
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    return Agent(TestModel())


@pytest.fixture
def mock_workspace_helpers():
    """Mock workspace helpers for testing."""
    return {
        'workspace_path': '/test/workspace',
        'workspace_name': 'test_workspace',
        'tools': [],
        'metadata': {},
    }
