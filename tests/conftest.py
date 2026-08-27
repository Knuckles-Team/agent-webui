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
    # FIX LANE (union-read-backend-view): production `for_graph(graph_name)`
    # returns a NEW graph-scoped view engine (`IntelligenceGraphEngine
    # .for_graph`, `knowledge_graph/core/engine.py`) -- the api_extensions.py
    # union-read helpers call it to obtain a backend actually bound to each
    # accessible graph. This generic fixture is used by many tests that
    # don't care about per-graph distinction, so `for_graph` is a passthrough
    # returning THIS SAME mock (identity, mirroring the real class's own
    # `for_graph(same_graph_name) -> self` no-op) -- every `query_cypher`/
    # `sql` (BUG-PE-058: `QueryMixin.sql`, not `graph_compute.sql_exec`)
    # stub a test sets up keeps applying regardless
    # of which graph a union read targets. `test_union_read.py` exercises the
    # REAL per-graph-pinning behavior with its own dedicated test double
    # (`_PinnedGraphEngine`) rather than this shared fixture.
    engine.for_graph.return_value = engine
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
    # KBIngestionEngine's list method is `list_knowledge_bases` (see
    # agent_utilities/knowledge_graph/kb/ingestion.py); it was renamed from
    # `list_bases` and this fixture (plus api_extensions.py's own call sites,
    # fixed alongside this) had drifted from the real class -- see this
    # lane's report for the full defect writeup.
    engine.list_knowledge_bases.return_value = []
    # `search`, unlike `list_knowledge_bases`, is not a real KBIngestionEngine
    # attribute at all (the real method is `search_knowledge_base`) -- assigned
    # directly (like `ingest`/`health_check`/`update` immediately below) rather
    # than set via `.search.return_value =`, since the latter requires `search`
    # to already exist on the `spec=KBIngestionEngine` mock's real class and
    # raises `AttributeError` at fixture-construction time otherwise (the same
    # failure `list_bases` had). See this lane's report: `ingest`/`search`/
    # `health_check`/`update` are ALL stale names api_extensions.py calls that
    # do not exist on the real class (`ingest_directory`/`ingest_url`/
    # `ingest_skill_graph`, `search_knowledge_base`, `run_health_check`,
    # `update_kb`) -- a genuine, pre-existing defect in api_extensions.py this
    # lane did not fix (it requires a real design decision about which
    # `ingest_*` variant + argument mapping the generic `/kb/ingest` route
    # should use, out of scope for a test-client auth fix).
    engine.search = MagicMock(return_value=[])
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
    # `get_all_tasks()`'s REAL contract is `list[Tasks]` -- a bare list of
    # pydantic models, not a single object with its own `.model_dump()`
    # (only `get_tasks()`, above, returns a single `Tasks | None`). This
    # used to be mocked as `MagicMock(tasks=[])`, which auto-satisfies
    # `hasattr(..., 'model_dump')` and never exercised the real shape --
    # masking a bug where the API route's raw `list[Tasks]` reached
    # `_public_external_result` unconverted and raised on any non-empty
    # result (see agent-webui's `test_bound_sweep_regressions.py`
    # ::TestGetAllTasksHandlesTheListOfPydanticModelsShape).
    manager.get_all_tasks.return_value = []
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


@pytest.fixture
def served_identity_config(monkeypatch):
    """Configure the WebUI's identity/authorization boundary the way a real
    deployment would.

    ``create_agent_web_app`` installs ``WebUIActorIdentityMiddleware`` (server.py
    ~1287) unconditionally -- every ``/api/*`` request now needs a verified actor
    or it is rejected 401 (``agent_utilities.security.request_identity
    .ActorIdentityMiddleware.__call__``, the ``actor is None`` branch, which is
    NOT gated on any config -- see D-WA-1/verified-identity-carrier-contract).
    Two further pieces of config are required *before* a verified actor can be
    projected into a servable ``GraphSession`` at all:
    ``agent_webui.graph_identity.mint_frontend_graph_session`` raises
    ``PermissionError`` without both ``auth_jwt_audience`` and
    ``kg_policy_version`` set. Also setting ``auth_jwt_jwks_uri`` /
    ``auth_jwt_issuer`` makes ``_identity_enforced()`` True, which is what
    turns on ``WebUIAuthorizationMiddleware``'s per-route role check -- so a
    test built on this fixture exercises the REAL role gate, not a bypass of
    it (mirrors ``test_security_boundaries.py``'s ``_drive_http``/``_drive_ws``
    helpers and ``test_mcp_delegation_routes.py``'s ``served_authority``
    fixture, both of which set the identical four fields for the identical
    reason).
    """
    from agent_utilities.core.config import config

    monkeypatch.setattr(
        config,
        'auth_jwt_jwks_uri',
        'https://idp.test/.well-known/jwks.json',
        raising=False,
    )
    monkeypatch.setattr(config, 'auth_jwt_issuer', 'https://idp.test/', raising=False)
    monkeypatch.setattr(
        config, 'auth_jwt_audience', 'agent-webui-test', raising=False
    )
    monkeypatch.setattr(config, 'kg_policy_version', 'test-1', raising=False)
    return config


@pytest.fixture(autouse=True)
def _default_engine_admission_succeeds(monkeypatch):
    """Default the engine-side tenant RBAC admission gate to a silent no-op.

    ``agent_webui.graph_admission.ensure_tenant_admission`` runs a REAL
    engine round trip (an RBAC-role read plus, on a brand-new principal, a
    signed ``register_identity`` RPC) immediately after a session is minted
    -- see that module's docstring. No unit test has a real epistemic-graph
    engine or a seeded ``engine-admission/provisioner`` secret, the same
    reason ``mock_graph_engine`` stands in for the graph engine itself
    elsewhere in this suite. This is a genuinely separate boundary from
    identity/authorization, so it does not weaken ``served_identity_config``'s
    "the real role gate, not a bypass of it" guarantee -- ``ensure_tenant_
    admission`` runs strictly after both the identity middleware and
    ``WebUIAuthorizationMiddleware`` have already made their real decisions.

    A test that wants to exercise admission success/failure behavior itself
    overrides this within its own body -- a ``monkeypatch.setattr`` call
    inside a test function runs after fixture setup, so it wins. See
    ``agent_webui/__tests__/test_graph_admission.py`` and the "Engine-side
    tenant admission" section of ``test_identity_middleware_boundary.py``.
    """
    try:
        from agent_webui import graph_admission
    except ImportError:
        return

    async def _noop(_actor, _session):
        return None

    monkeypatch.setattr(graph_admission, 'ensure_tenant_admission', _noop)


def authenticated_asgi_app(
    app,
    *,
    scope: str = 'kg:read kg:write kg:admin',
    sub: str = 'test-suite',
    tenant: str = 'test-tenant',
):
    """Wrap ``app`` so every HTTP request arrives with a verified identity.

    This is NOT a second, weaker auth path: it projects prevalidated JWT
    claims onto ``scope['state']['user_claims']``, which is exactly the "an
    outer HTTP authentication boundary already verified this credential" leg
    ``WebUIActorIdentityMiddleware._authenticated_http_actor`` (server.py
    ~1242) and the shared ``ActorIdentityMiddleware.__call__`` (agent_utilities
    /security/request_identity.py ~663) both document and branch on
    explicitly -- the same mechanism a real reverse-proxy/OIDC front door uses
    to hand off an already-verified credential. From that point on, every real
    check still runs: ``actor_from_claims`` parses the claims into an
    ``ActorContext``, ``mint_frontend_graph_session`` mints a real
    ``GraphSession`` with real scopes, and ``WebUIAuthorizationMiddleware``
    evaluates the real per-route role ladder against those scopes. Nothing
    about ``WebUIAuthorizationMiddleware`` or ``ActorIdentityMiddleware`` is
    patched, monkeypatched, or skipped.

    This is the same technique ``test_mcp_delegation_routes.py``'s private
    ``_authenticated()`` helper already uses and that suite already passes
    with -- promoted here to a shared helper so every WebUI ``TestClient``
    fixture can present a legitimate credential instead of none at all.

    Args:
        app: The ASGI app (e.g. from ``create_agent_web_app``) to wrap.
        scope: Space-separated KG scopes the synthetic credential carries.
            Defaults to full admin (read+write+admin) so functional/business
            -logic tests are not incidentally blocked by the role ladder;
            pass a narrower value to exercise the role ladder itself.
        sub: The credential's subject claim.
        tenant: The credential's tenant claim.
    """

    async def with_identity(asgi_scope, receive, send):
        if asgi_scope.get('type') == 'http':
            asgi_scope = dict(asgi_scope)
            state = dict(asgi_scope.get('state') or {})
            state['user_claims'] = {
                'auth_type': 'jwt',
                'sub': sub,
                'tenant_id': tenant,
                'scope': scope,
            }
            asgi_scope['state'] = state
        await app(asgi_scope, receive, send)

    return with_identity


@pytest.fixture
def authenticated_client_factory(served_identity_config):
    """Factory for a ``TestClient`` carrying a verified, real credential.

    Built on :func:`authenticated_asgi_app` + :func:`served_identity_config`
    -- see both for why this drives the real identity/authorization
    middleware stack rather than replacing it.
    """
    # Depended on for its side effect (configuring `config` before any
    # request is made), not its return value -- referenced here so it
    # is not flagged as an unused fixture parameter.
    _ = served_identity_config

    def _make(app, *, scope: str = 'kg:read kg:write kg:admin', **kwargs):
        from fastapi.testclient import TestClient

        return TestClient(authenticated_asgi_app(app, scope=scope), **kwargs)

    return _make
