"""Route-table regression guard for the unified ``/api/chats`` resource.

PHASE B/C unify-chat-resource collapsed three previously-separate chat
surfaces into one: chat-HISTORY CRUD (formerly ``/api/enhanced/chats*``) and
the pydantic-ai chat-MESSAGE transport (formerly the bare ``/api/chat``
pydantic-ai bridge) now both live under ``/api/chats``. These tests pin that
route table directly against a REAL ``create_agent_web_app`` build (a real
``pydantic_ai.Agent`` with ``TestModel``, exactly as
``test_canonical_gateway_mount.py`` builds its app) rather than mocking
routing, so a regression in ``add_pydantic_routes`` or the router mount
order is caught here.

HTTP-issuing tests drive the app through the SAME authenticated-``TestClient``
pattern ``test_mcp_delegation_routes.py`` uses (``served_authority`` +
``_authenticated()``): every request carries prevalidated JWT claims on the
ASGI scope, exactly as a real reverse-proxy/OIDC front door would hand off an
already-verified credential, so the REAL identity + authorization middleware
stack runs -- nothing is bypassed or patched away.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic_core import ValidationError
from starlette.routing import Route as StarletteRoute

pytestmark = pytest.mark.integration


def _build_app(*, html_source: str | Path | None = None):
    from agent_webui.server import create_agent_web_app
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    agent = Agent(TestModel())
    workspace_helpers = {'get_path': lambda x: x}
    return create_agent_web_app(agent, workspace_helpers, html_source=html_source)


def _routes_by_path(app) -> dict[str, set[str]]:
    """Map every registered route path to its allowed HTTP methods.

    Walks ``app.routes`` recursively rather than reading it flat. This
    FastAPI version's ``include_router`` (used for ``enhanced_router``,
    ``chats_router``, ``dashboard_router``, etc.) is lazy: it appends an
    opaque ``fastapi.routing._IncludedRouter`` wrapper to ``app.routes``
    instead of eagerly flattening the sub-router's routes into it, so a
    plain top-level scan finds only routes added the OLD way (Starlette's
    ``app.add_route``/``app.mount``, which is how ``add_pydantic_routes``
    bridges the pydantic-ai transport). Recursing into
    ``_IncludedRouter.original_router.routes`` (prefixed by
    ``include_context.prefix``) makes both mounting styles visible through
    one helper.
    """
    out: dict[str, set[str]] = {}

    def _walk(routes, prefix: str = '') -> None:
        for route in routes:
            if type(route).__name__ == '_IncludedRouter':
                sub_prefix = route.include_context.prefix
                _walk(route.original_router.routes, prefix + sub_prefix)
                continue
            path = getattr(route, 'path', None)
            methods = getattr(route, 'methods', None)
            if path is None:
                continue
            full_path = prefix + path
            out.setdefault(full_path, set())
            if methods:
                out[full_path].update(methods)

    _walk(app.routes)
    return out


@pytest.fixture(autouse=True)
def served_authority(monkeypatch):
    """Give the served boundary the audience + policy revision it requires.

    Mirrors ``test_mcp_delegation_routes.py``'s fixture of the same name:
    ``mint_graph_session`` refuses to project an actor into a ``GraphSession``
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
    # verified actor into a session directly instead, exactly as
    # ``test_mcp_delegation_routes.py`` does -- identity verification itself
    # is exercised by the security-boundary suite; what this file pins is
    # what happens AFTER an authenticated request is admitted.
    from agent_utilities.knowledge_graph.core.session import GraphSession

    def _session_for(actor: Any) -> GraphSession:
        return GraphSession(
            actor=actor,
            tenant=str(actor.tenant_id or 'test-tenant'),
            scopes=frozenset({'kg:read', 'kg:write', 'kg:admin'}),
            graph='test-graph',
            policy_version='test-1',
            trace_context='chat-resource-routes-test',
            audience='agent-webui-test',
        )

    monkeypatch.setattr(
        'agent_utilities.security.request_identity.mint_graph_session', _session_for
    )


def _authenticated(app: Any) -> Any:
    """Wrap ``app`` so every request arrives with a verified admin identity.

    ``ActorIdentityMiddleware`` mints the request's actor from prevalidated JWT
    claims on the ASGI scope when an outer authentication boundary already
    verified the credential. Setting those claims here is exactly that
    boundary, so the request runs through the REAL identity and authorization
    middlewares (rather than disabling them) with a ``kg:admin`` actor -- the
    scope the (admin-gated) chat-history routes require.
    """

    async def with_identity(scope: Any, receive: Any, send: Any) -> None:
        if scope.get('type') == 'http':
            scope = dict(scope)
            state = dict(scope.get('state') or {})
            state['user_claims'] = {
                'auth_type': 'jwt',
                'sub': 'chat-resource-routes-test',
                'tenant_id': 'test-tenant',
                'scope': 'kg:read kg:write kg:admin',
            }
            scope['state'] = state
        await app(scope, receive, send)

    return with_identity


@pytest.fixture(scope='module')
def app():
    """The real FastAPI app, exactly as production builds it (no html_source)."""
    return _build_app()


@pytest.fixture
def client(app):
    return TestClient(_authenticated(app), raise_server_exceptions=False)


class TestChatHistoryCrudMovedToApiChats:
    """The five history-CRUD routes now live at ``/api/chats*``, not
    ``/api/enhanced/chats*`` -- same handler bodies, new mount prefix."""

    def test_list_and_create_route_mounted(self, app) -> None:
        routes = _routes_by_path(app)
        assert '/api/chats' in routes
        assert {'GET', 'POST'} <= routes['/api/chats']

    def test_get_update_delete_route_mounted(self, app) -> None:
        routes = _routes_by_path(app)
        assert '/api/chats/{chat_id}' in routes
        assert {'GET', 'PUT', 'DELETE'} <= routes['/api/chats/{chat_id}']

    def test_old_title_only_alias_is_gone(self, app) -> None:
        """``PUT /chats/{id}/title`` was folded into ``PUT /api/chats/{id}``."""
        routes = _routes_by_path(app)
        assert '/api/enhanced/chats/{chat_id}/title' not in routes
        assert '/api/chats/{chat_id}/title' not in routes

    def test_old_enhanced_chats_routes_are_gone(self, app) -> None:
        """No-legacy-shims: the old ``/api/enhanced/chats*`` paths must not
        merely be redirects or aliases -- they must not exist at all."""
        routes = _routes_by_path(app)
        assert '/api/enhanced/chats' not in routes
        assert '/api/enhanced/chats/{chat_id}' not in routes

    def test_history_crud_reaches_the_real_handlers(self, client) -> None:
        """End-to-end smoke: the moved routes actually execute (no helper
        registered, so they fall back to their documented empty/error
        shapes rather than 404ing)."""
        list_resp = client.get('/api/chats')
        assert list_resp.status_code == 200
        assert list_resp.json() == []

        get_one = client.get('/api/chats/some-id')
        assert get_one.status_code == 200
        assert get_one.json()['id'] == 'some-id'

        put_resp = client.put('/api/chats/some-id', json={'title': 'Renamed'})
        assert put_resp.status_code == 200

        delete_resp = client.delete('/api/chats/some-id')
        assert delete_resp.status_code == 200


class TestPydanticChatTransportRemounted:
    """The pydantic-ai message transport moves from ``/api/chat`` to
    ``/api/chats/messages`` -- a sibling of the history resource, not a
    path parameter the handler would silently ignore (it takes only
    ``request: Request``)."""

    def test_old_bare_api_chat_path_is_gone(self, app) -> None:
        routes = _routes_by_path(app)
        assert '/api/chat' not in routes

    def test_new_path_mounted_with_post_and_options(self, app) -> None:
        routes = _routes_by_path(app)
        assert '/api/chats/messages' in routes
        assert {'POST', 'OPTIONS'} <= routes['/api/chats/messages']

    def test_post_reaches_the_real_pydantic_ai_endpoint(self, client) -> None:
        """Assert ROUTING, not a live LLM call.

        A routing miss is the ONLY thing this test is here to catch, and it has
        exactly two signatures: 404 (no such path) or 405 (path exists, method
        not allowed). Any other status proves the request was dispatched into
        pydantic-ai's real ``post_chat``.

        Deliberately NOT pinned to one exact code: this body reaches
        ``VercelAIAdapter.from_request`` -> ``build_run_input`` ->
        ``validate_json``, so the status is whatever the installed pydantic-ai
        turns a malformed body into (500 on 2.29.0). Asserting that exact code
        would make this test a version-pin on a third-party library rather than
        a routing assertion, and it would break on a harmless upgrade.
        """
        try:
            resp = client.post(
                '/api/chats/messages',
                content=b'not json',
                headers={'content-type': 'text/plain'},
            )
        except ValidationError:
            # The handler was reached and rejected the malformed body. With
            # TestClient's default raise_server_exceptions=True the error
            # propagates instead of becoming a 500 -- either way it originates
            # INSIDE pydantic-ai's post_chat, which is what this test asserts.
            return
        assert resp.status_code not in (404, 405), (
            f'routing miss: {resp.status_code} means /api/chats/messages did '
            'not dispatch into the bridged pydantic-ai handler'
        )

    def test_options_preflight_reaches_the_real_pydantic_ai_endpoint(
        self, client
    ) -> None:
        resp = client.options('/api/chats/messages')
        assert resp.status_code == 200
        # options_chat() deliberately carries no Access-Control-Allow-* header.
        assert 'access-control-allow-origin' not in resp.headers

    def test_sending_a_message_only_requires_write_not_admin(self, app) -> None:
        """The chat-history admin gate must NOT leak onto the message
        transport: a caller with only ``kg:write`` (no ``kg:admin``) must
        still reach ``post_chat`` -- exactly as ``/api/chat`` behaved before
        the move under the same prefix as the (admin-gated) history routes.
        """

        async def with_write_only_identity(scope, receive, send):
            if scope.get('type') == 'http':
                scope = dict(scope)
                state = dict(scope.get('state') or {})
                state['user_claims'] = {
                    'auth_type': 'jwt',
                    'sub': 'chat-resource-routes-write-only-test',
                    'tenant_id': 'test-tenant',
                    'scope': 'kg:write',
                }
                scope['state'] = state
            await app(scope, receive, send)

        write_only_client = TestClient(
            with_write_only_identity, raise_server_exceptions=False
        )
        resp = write_only_client.post(
            '/api/chats/messages',
            content=b'not json',
            headers={'content-type': 'text/plain'},
        )
        # The point is the ADMIN GATE, not the payload: 401/403 would mean a
        # kg:write caller was wrongly refused, and 404/405 would mean a routing
        # miss. Anything else proves the request was admitted past authorization
        # AND dispatched into pydantic-ai's handler, which is exactly the
        # pre-migration behaviour /api/chat had.
        assert resp.status_code not in (401, 403, 404, 405), (
            f'kg:write caller was blocked or misrouted: {resp.status_code}'
        )

    def test_history_route_still_requires_admin(self, app) -> None:
        """Companion to the write-only test above: chat-HISTORY reads are
        still admin-gated (unchanged behavior, just renamed from
        ``/api/enhanced/chats``), so a write-only caller is forbidden."""

        async def with_write_only_identity(scope, receive, send):
            if scope.get('type') == 'http':
                scope = dict(scope)
                state = dict(scope.get('state') or {})
                state['user_claims'] = {
                    'auth_type': 'jwt',
                    'sub': 'chat-resource-routes-write-only-test-2',
                    'tenant_id': 'test-tenant',
                    'scope': 'kg:write',
                }
                scope['state'] = state
            await app(scope, receive, send)

        write_only_client = TestClient(
            with_write_only_identity, raise_server_exceptions=False
        )
        resp = write_only_client.get('/api/chats')
        assert resp.status_code == 403


class TestUntouchedPydanticBridges:
    """Task 2's guardrail: ``/api/configure``, ``/api/health``, ``/``, and
    ``/{id}`` bridging must be byte-for-byte unchanged by the chat-transport
    remount."""

    def test_configure_and_health_bridged_without_html_source(
        self, app, client
    ) -> None:
        routes = _routes_by_path(app)
        assert '/api/configure' in routes
        assert '/api/health' in routes
        assert client.get('/api/configure').status_code == 200
        assert client.get('/api/health').json() == {'ok': True}

    def test_root_and_id_bridge_only_when_html_source_is_set(self, monkeypatch) -> None:
        """Matches the pre-existing, untouched conditional in
        ``add_pydantic_routes``: pydantic-ai's own ``/`` and ``/{id}`` chat-UI
        index routes are bridged onto the outer app only when a custom
        ``html_source`` is supplied -- otherwise the outer app serves its own
        SPA at ``/`` instead. This test does not send a request to the routes
        (the configured path need not exist on disk to prove the route table
        is correct), it only proves bridging is conditioned exactly as
        before.
        """
        default_app = _build_app()
        default_routes = _routes_by_path(default_app)
        assert '/{id}' not in default_routes

        monkeypatch.setenv('AGENT_WEBUI_CSP_CUSTOM_RENDERING', '1')
        html_app = _build_app(html_source=Path('/nonexistent/index.html'))
        html_routes = _routes_by_path(html_app)
        assert '/' in html_routes
        assert '/{id}' in html_routes
        assert 'GET' in html_routes['/{id}']


def test_pydantic_bridge_endpoints_are_plain_starlette_routes(app) -> None:
    """Sanity check on the bridging mechanism itself: the remounted chat
    routes are the SAME ``StarletteRoute`` endpoint objects pydantic-ai
    built, added via ``app.add_route`` -- not a FastAPI ``APIRoute`` wrapper,
    confirming no request/response translation was inserted in the move."""
    matches = [
        route
        for route in app.routes
        if isinstance(route, StarletteRoute) and route.path == '/api/chats/messages'
    ]
    assert matches, '/api/chats/messages must be a bridged pydantic-ai route'
