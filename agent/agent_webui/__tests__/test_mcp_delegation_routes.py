from __future__ import annotations

"""Wiring tests for the governed MCP delegation routes.

CONCEPT:AU-ECO.mcp.webui-governed-mcp-delegation

These do not assert that a route function exists — they stand up a **real
FastMCP server** (a tool plus a ``ui://`` MCP App resource) and delegate to it
over FastMCP's in-memory client transport, i.e. a genuine MCP ``tools/call`` /
``resources/read`` round trip. What is faked is only the network hop; the
protocol, the argument marshalling, and the result decoding are the real ones.

They also pin the two things that must NOT happen: with no host-injected
delegation the routes refuse (501) instead of inventing a client of their own,
and the resource route only ever reads the MCP Apps ``ui://`` scheme.
"""

from typing import Any

import pytest
from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine
from agent_webui.server import create_agent_web_app
from fastapi.testclient import TestClient

fastmcp = pytest.importorskip('fastmcp')

APP_URI = 'ui://graph-os/task-progress.html'
APP_HTML = '<html><head></head><body><div id="jobId">-</div></body></html>'


def _build_server() -> Any:
    """A faithful stand-in for graph-os: a plain tool, one ui:// app resource,
    and an MCP Apps ENTRY-POINT tool declaring that resource via `app=`
    (mirrors `graph_task_progress_app` in
    `agent_utilities/mcp/tools/mcp_apps.py`, BUG-071)."""
    server = fastmcp.FastMCP('graph-os-test')

    @server.tool(name='graph_jobs')
    async def graph_jobs(action: str, job_id: str = '') -> dict[str, Any]:
        return {'action': action, 'jobId': job_id, 'status': 'working'}

    @server.resource(uri=APP_URI, name='Task Progress', mime_type='text/html')
    async def task_progress() -> str:
        return APP_HTML

    from fastmcp.apps.config import AppConfig

    @server.tool(
        name='graph_task_progress_app',
        app=AppConfig(resource_uri=APP_URI, visibility=['model']),
    )
    async def graph_task_progress_app(job_id: str = '') -> dict[str, Any]:
        return {'jobId': job_id}

    return server


@pytest.fixture
def mcp_helpers() -> dict[str, Any]:
    """The host-injected governed delegation, backed by a real MCP server."""
    server = _build_server()

    async def call_mcp_tool(
        *,
        server_name: str,
        tool_name: str,
        arguments: dict[str, Any],
        timeout: float = 30.0,
    ) -> Any:
        assert server_name == 'graph-os'
        async with fastmcp.Client(server) as client:
            result = await client.call_tool(tool_name, arguments)
        return result.data

    async def read_mcp_resource(*, server_name: str, uri: str) -> dict[str, Any]:
        assert server_name == 'graph-os'
        async with fastmcp.Client(server) as client:
            contents = await client.read_resource(uri)
        first = contents[0]
        return {
            'text': getattr(first, 'text', ''),
            'mimeType': getattr(first, 'mimeType', 'text/html'),
        }

    async def list_mcp_server_tools(*, server_name: str) -> list[dict[str, Any]]:
        """Mirrors `agent_utilities.server.webui_mcp_delegation._list_mcp_server_tools`'s
        shape: `{name, description, input_schema, meta}`, `meta` omitted when
        the tool declares none -- a real `tools/list` round trip, not a stub
        that invents the shape."""
        assert server_name == 'graph-os'
        async with fastmcp.Client(server) as client:
            tools = await client.list_tools()
        out: list[dict[str, Any]] = []
        for tool in tools:
            entry: dict[str, Any] = {
                'name': tool.name,
                'description': tool.description or '',
                'input_schema': tool.input_schema or {},
            }
            meta = getattr(tool, 'meta', None)
            if meta:
                entry['meta'] = meta
            out.append(entry)
        return out

    return {
        'call_mcp_tool': call_mcp_tool,
        'read_mcp_resource': read_mcp_resource,
        'list_mcp_server_tools': list_mcp_server_tools,
    }


@pytest.fixture(autouse=True)
def served_authority(monkeypatch):
    """Give the served boundary the audience + policy revision it requires.

    ``mint_graph_session`` refuses to project an actor into a GraphSession
    without both, which a bare test process has neither of. Setting them is
    part of standing the boundary up, not of weakening it.
    """
    from agent_utilities.core.config import config

    monkeypatch.setattr(
        config,
        'auth_jwt_jwks_uri',
        'https://idp.test/.well-known/jwks.json',
        raising=False,
    )
    monkeypatch.setattr(config, 'auth_jwt_issuer', 'https://idp.test/', raising=False)
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui-test', raising=False)
    monkeypatch.setattr(config, 'kg_policy_version', 'test-1', raising=False)

    # Minting a real GraphSession performs a placement read against a live
    # engine/coordinator, which a unit test process has none of. Project the
    # verified actor into a session directly instead; identity verification
    # itself is exercised by the security-boundary suite, and what these tests
    # pin is what happens AFTER an authenticated request is admitted.
    from agent_utilities.knowledge_graph.core.session import GraphSession

    def _session_for(actor: Any) -> GraphSession:
        return GraphSession(
            actor=actor,
            tenant=str(actor.tenant_id or 'test-tenant'),
            scopes=frozenset({'kg:read', 'kg:write', 'kg:admin'}),
            graph='test-graph',
            policy_version='test-1',
            trace_context='mcp-delegation-test',
            audience='agent-webui-test',
        )

    monkeypatch.setattr(
        'agent_utilities.security.request_identity.mint_graph_session', _session_for
    )
    return config


def _authenticated(app: Any) -> Any:
    """Wrap ``app`` so every request arrives with a verified admin identity.

    ``ActorIdentityMiddleware`` mints the request's actor from prevalidated JWT
    claims on the ASGI scope when an outer authentication boundary already
    verified the credential. Setting those claims here is exactly that
    boundary, so the request runs through the REAL identity and authorization
    middlewares (rather than disabling them) with a ``kg:admin`` actor — the
    scope these POST routes require.
    """

    async def with_identity(scope: Any, receive: Any, send: Any) -> None:
        if scope.get('type') == 'http':
            scope = dict(scope)
            state = dict(scope.get('state') or {})
            state['user_claims'] = {
                'auth_type': 'jwt',
                'sub': 'mcp-delegation-test',
                'tenant_id': 'test-tenant',
                'scope': 'kg:read kg:write kg:admin',
            }
            scope['state'] = state
        await app(scope, receive, send)

    return with_identity


@pytest.fixture
def client(mock_agent, mcp_helpers):
    app = create_agent_web_app(mock_agent, mcp_helpers)
    return TestClient(_authenticated(app), raise_server_exceptions=False)


@pytest.fixture
def unwired_client(mock_agent):
    """The app with NO governed delegation injected by its host."""
    app = create_agent_web_app(mock_agent, {})
    return TestClient(_authenticated(app), raise_server_exceptions=False)


class TestToolCallRoute:
    def test_call_reaches_the_mcp_server_and_returns_its_result(self, client):
        response = client.post(
            '/api/enhanced/mcp/tools/call',
            json={
                'server': 'graph-os',
                'tool': 'graph_jobs',
                'arguments': {'action': 'status', 'job_id': 'orch-1'},
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body['status'] == 'success'
        # The payload came back through a real tools/call, so the tool's own
        # arguments are reflected in it.
        assert body['result'] == {
            'action': 'status',
            'jobId': 'orch-1',
            'status': 'working',
        }

    def test_unknown_tool_is_a_bad_gateway_not_a_silent_empty_result(self, client):
        response = client.post(
            '/api/enhanced/mcp/tools/call',
            json={'server': 'graph-os', 'tool': 'no_such_tool', 'arguments': {}},
        )
        assert response.status_code == 502

    def test_malformed_names_are_rejected_before_any_delegation(self, client):
        response = client.post(
            '/api/enhanced/mcp/tools/call',
            json={'server': 'graph os', 'tool': 'graph_jobs', 'arguments': {}},
        )
        assert response.status_code == 400

    def test_without_host_injection_the_route_refuses(self, unwired_client):
        response = unwired_client.post(
            '/api/enhanced/mcp/tools/call',
            json={'server': 'graph-os', 'tool': 'graph_jobs', 'arguments': {}},
        )
        # 501, not a fabricated success and not a client of the WebUI's own.
        # (The served boundary rewrites 5xx bodies to a generic detail, so the
        # status is the contract here.)
        assert response.status_code == 501


class TestAppResourceRoute:
    def test_reads_the_ui_resource_over_a_real_resources_read(self, client):
        response = client.post(
            '/api/enhanced/mcp/apps/resource',
            json={'server': 'graph-os', 'uri': APP_URI},
        )
        assert response.status_code == 200, response.text
        result = response.json()['result']
        assert result['uri'] == APP_URI
        assert result['html'] == APP_HTML
        assert result['mimeType'] == 'text/html'

    @pytest.mark.parametrize(
        'uri',
        [
            'file:///etc/passwd',
            'http://169.254.169.254/latest/meta-data',
            'ui:/../../etc/passwd',
            '',
        ],
    )
    def test_only_the_ui_scheme_is_readable(self, client, uri):
        response = client.post(
            '/api/enhanced/mcp/apps/resource',
            json={'server': 'graph-os', 'uri': uri},
        )
        assert response.status_code == 400

    def test_without_host_injection_the_route_refuses(self, unwired_client):
        response = unwired_client.post(
            '/api/enhanced/mcp/apps/resource',
            json={'server': 'graph-os', 'uri': APP_URI},
        )
        assert response.status_code == 501


@pytest.fixture
def bounded_engine(monkeypatch):
    """Stub the engine ``list_mcp_server_tools`` needs only for
    ``get_toggle_state``'s ``query_cypher`` call -- not a real KG, matching
    ``test_mcp_server_inventory.py``'s ``stub_engine``/``bounded_engine``
    pair."""
    from unittest.mock import MagicMock

    from agent_webui import api_extensions

    engine = MagicMock(spec=IntelligenceGraphEngine)
    engine.query_cypher.return_value = []

    async def _get_engine() -> Any:
        return engine

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', _get_engine)
    return engine


class TestServerToolsRoute:
    """GOC-26-W04: the tool-inventory route ``McpAppsView`` reads to discover
    launchable MCP Apps. Proves BUG-071's forwarded ``meta.ui`` actually
    reaches the WebUI's OWN ``/api/enhanced/mcp/servers/{server}/tools``
    response, not just the ``agent-utilities`` catalog call sites."""

    def test_a_tool_with_a_ui_resource_reports_its_app_binding(
        self, client, bounded_engine
    ):
        response = client.get('/api/enhanced/mcp/servers/graph-os/tools')
        assert response.status_code == 200, response.text
        tools = {t['name']: t for t in response.json()}
        assert tools['graph_task_progress_app']['meta'] == {
            'ui': {'resourceUri': APP_URI, 'visibility': ['model']},
        }

    def test_a_tool_without_a_ui_resource_reports_no_app_binding(
        self, client, bounded_engine
    ):
        response = client.get('/api/enhanced/mcp/servers/graph-os/tools')
        assert response.status_code == 200, response.text
        tools = {t['name']: t for t in response.json()}
        assert 'meta' not in tools['graph_jobs']

    def test_without_host_injection_the_route_refuses(
        self, unwired_client, bounded_engine
    ):
        response = unwired_client.get('/api/enhanced/mcp/servers/graph-os/tools')
        assert response.status_code == 501


@pytest.fixture
def mcp_registry_path(tmp_path, monkeypatch):
    """Point the CRUD routes' catalog resolution at a throwaway file so a
    test never touches a real ``mcp_config.json``."""
    path = tmp_path / 'mcp_config.json'
    monkeypatch.setenv('MCP_CONFIG', str(path))
    return path


class TestMcpServerCrud:
    """Add / modify / delete MCP servers in the fleet catalog file -- the
    SAME file the live multiplexer reloads from (CONCEPT:AU-ECO.mcp.webui-governed-mcp-delegation)."""

    def test_schema_exposes_command_and_url(self, client):
        response = client.get('/api/enhanced/mcp/server-schema')
        assert response.status_code == 200, response.text
        schema = response.json()
        assert {'command', 'url'} <= set(schema['properties'])

    def test_create_writes_the_real_catalog_file_and_is_readable_back(
        self, client, mcp_registry_path
    ):
        response = client.post(
            '/api/enhanced/mcp/servers',
            json={
                'name': 'ansible-tower-mcp',
                'config': {'url': 'https://ansible-tower-mcp.example/mcp'},
            },
        )
        assert response.status_code == 200, response.text
        import json

        on_disk = json.loads(mcp_registry_path.read_text())
        assert on_disk['mcpServers']['ansible-tower-mcp']['url'] == (
            'https://ansible-tower-mcp.example/mcp'
        )

    def test_create_rejects_a_shape_with_neither_command_nor_url(
        self, client, mcp_registry_path
    ):
        response = client.post(
            '/api/enhanced/mcp/servers',
            json={'name': 'broken-mcp', 'config': {}},
        )
        assert response.status_code == 422

    def test_create_rejects_duplicate_name(self, client, mcp_registry_path):
        body = {
            'name': 'dup-mcp',
            'config': {'url': 'https://dup-mcp.example/mcp'},
        }
        first = client.post('/api/enhanced/mcp/servers', json=body)
        assert first.status_code == 200, first.text
        second = client.post('/api/enhanced/mcp/servers', json=body)
        assert second.status_code == 409

    def test_create_refuses_stdio_when_deployment_prohibits_it(
        self, client, mcp_registry_path, monkeypatch
    ):
        """The Task-1 stdio guard is consulted at CRUD time too -- an add
        attempt is refused (400) rather than silently written to the catalog
        and only failing at the next spawn. Like every other validation
        error in this app, the browser-facing body is the app-wide generic
        per-status string (``server.py``'s ``_privacy_safe_http_error`` never
        reflects an exception's ``detail=`` to the client, by design); the
        precise reason is logged server-side (``_log_failure``) and --
        unaffected by that generalization, since it is DATA not an exception
        -- is exactly what the catalog/probe surface
        (``/api/enhanced/tools`` -> per-server ``error``) reports to the
        operator when the server is next probed."""
        from agent_utilities.core.config import config

        monkeypatch.setattr(config, 'mcp_stdio_prohibited', True)
        response = client.post(
            '/api/enhanced/mcp/servers',
            json={
                'name': 'ansible-tower-mcp',
                'config': {'command': 'ansible-tower-mcp', 'args': []},
            },
        )
        assert response.status_code == 400
        import json

        assert 'ansible-tower-mcp' not in json.loads(
            mcp_registry_path.read_text() if mcp_registry_path.exists() else '{}'
        ).get('mcpServers', {})

    def test_update_edits_an_existing_entry(self, client, mcp_registry_path):
        create = client.post(
            '/api/enhanced/mcp/servers',
            json={
                'name': 'edit-mcp',
                'config': {'url': 'https://edit-mcp.example/mcp'},
            },
        )
        assert create.status_code == 200, create.text
        update = client.put(
            '/api/enhanced/mcp/servers/edit-mcp',
            json={'config': {'url': 'https://edit-mcp.example/mcp/v2'}},
        )
        assert update.status_code == 200, update.text
        assert update.json()['config']['url'] == 'https://edit-mcp.example/mcp/v2'

    def test_update_unknown_server_is_404(self, client, mcp_registry_path):
        response = client.put(
            '/api/enhanced/mcp/servers/nope-mcp',
            json={'config': {'url': 'https://nope.example/mcp'}},
        )
        assert response.status_code == 404

    def test_delete_defaults_to_reversible_soft_disable(
        self, client, mcp_registry_path
    ):
        client.post(
            '/api/enhanced/mcp/servers',
            json={
                'name': 'soft-delete-mcp',
                'config': {'url': 'https://soft-delete-mcp.example/mcp'},
            },
        )
        response = client.delete('/api/enhanced/mcp/servers/soft-delete-mcp')
        assert response.status_code == 200, response.text
        assert response.json()['hard_deleted'] is False
        import json

        on_disk = json.loads(mcp_registry_path.read_text())
        # Reversible: the entry still exists, merely disabled.
        assert on_disk['mcpServers']['soft-delete-mcp']['disabled'] is True

    def test_delete_hard_actually_removes_the_entry(self, client, mcp_registry_path):
        client.post(
            '/api/enhanced/mcp/servers',
            json={
                'name': 'hard-delete-mcp',
                'config': {'url': 'https://hard-delete-mcp.example/mcp'},
            },
        )
        response = client.delete('/api/enhanced/mcp/servers/hard-delete-mcp?hard=true')
        assert response.status_code == 200, response.text
        assert response.json()['hard_deleted'] is True
        import json

        on_disk = json.loads(mcp_registry_path.read_text())
        assert 'hard-delete-mcp' not in on_disk['mcpServers']

    def test_delete_unknown_server_is_404(self, client, mcp_registry_path):
        response = client.delete('/api/enhanced/mcp/servers/nope-mcp')
        assert response.status_code == 404

    def test_without_host_injection_crud_still_works(
        self, unwired_client, mcp_registry_path
    ):
        """Unlike tool-call delegation, CRUD needs no host-injected helper --
        it writes the catalog file directly, so it must work even when the
        host has wired NO delegation helpers at all."""
        response = unwired_client.post(
            '/api/enhanced/mcp/servers',
            json={
                'name': 'no-helper-mcp',
                'config': {'url': 'https://no-helper-mcp.example/mcp'},
            },
        )
        assert response.status_code == 200, response.text
