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
from agent_webui.server import create_agent_web_app
from fastapi.testclient import TestClient

fastmcp = pytest.importorskip('fastmcp')

APP_URI = 'ui://graph-os/task-progress.html'
APP_HTML = '<html><head></head><body><div id="jobId">-</div></body></html>'


def _build_server() -> Any:
    """A faithful stand-in for graph-os: one tool + one ui:// app resource."""
    server = fastmcp.FastMCP('graph-os-test')

    @server.tool(name='graph_jobs')
    async def graph_jobs(action: str, job_id: str = '') -> dict[str, Any]:
        return {'action': action, 'jobId': job_id, 'status': 'working'}

    @server.resource(uri=APP_URI, name='Task Progress', mime_type='text/html')
    async def task_progress() -> str:
        return APP_HTML

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

    return {
        'call_mcp_tool': call_mcp_tool,
        'read_mcp_resource': read_mcp_resource,
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
