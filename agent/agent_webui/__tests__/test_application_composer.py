"""Application-composition boundary between agent-webui and Graph OS."""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

import pytest
from agent_utilities.knowledge_graph.core.session import current_session
from agent_webui.server import create_agent_web_app
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.routing import Mount

pytestmark = pytest.mark.integration


def _paths(app: FastAPI) -> set[str]:
    return set(app.openapi()['paths']) | {
        getattr(route, 'path', '') for route in app.routes
    }


def test_standalone_webui_does_not_mount_graph_os_gateway(
    mock_agent: Any,
    mock_workspace_helpers: dict[str, Any],
) -> None:
    app = create_agent_web_app(mock_agent, mock_workspace_helpers)

    assert '/api/chats' in _paths(app)
    assert '/api/enhanced/info' in _paths(app)
    assert '/health' in _paths(app)
    assert '/api/graph/query' not in _paths(app)
    assert '/api/dashboard/full' not in _paths(app)
    assert '/api/enhanced/tools' not in _paths(app)
    assert '/api/enhanced/skills' not in _paths(app)
    assert '/api/enhanced/workflows/capabilities' not in _paths(app)


def test_host_composer_runs_after_webui_routes_and_before_spa_mount(
    mock_agent: Any,
    mock_workspace_helpers: dict[str, Any],
    authenticated_client_factory: Any,
) -> None:
    observed_paths: set[str] = set()

    def compose(app: FastAPI) -> None:
        observed_paths.update(_paths(app))

        @app.get('/api/composed/probe')
        async def _probe() -> dict[str, bool]:
            return {'composed': True}

    app = create_agent_web_app(
        mock_agent,
        mock_workspace_helpers,
        application_composer=compose,
    )

    assert '/api/chats' in observed_paths
    assert '/api/enhanced/info' in observed_paths
    assert '/api/composed/probe' in _paths(app)
    route_paths = [getattr(route, 'path', '') for route in app.routes]
    spa_mounts = [
        index
        for index, route in enumerate(app.routes)
        if isinstance(route, Mount) and getattr(route, 'path', '') == ''
    ]
    if spa_mounts:
        assert route_paths.index('/api/composed/probe') < spa_mounts[0]

    client = authenticated_client_factory(app)
    response = client.get('/api/composed/probe')
    assert response.status_code == 200
    assert response.json() == {'composed': True}


def test_injected_routes_retain_webui_fail_closed_identity_boundary(
    mock_agent: Any,
    mock_workspace_helpers: dict[str, Any],
) -> None:
    def compose(app: FastAPI) -> None:
        @app.get('/api/composed/private')
        async def _private() -> dict[str, bool]:
            return {'should_not_be_visible': True}

    app = create_agent_web_app(
        mock_agent,
        mock_workspace_helpers,
        application_composer=compose,
    )

    response = TestClient(app).get('/api/composed/private')
    assert response.status_code == 401
    assert response.json() == {'error': 'Verified Bearer identity required'}


def test_injected_routes_receive_verified_graph_session(
    mock_agent: Any,
    mock_workspace_helpers: dict[str, Any],
    authenticated_client_factory: Any,
) -> None:
    def compose(app: FastAPI) -> None:
        @app.get('/api/composed/session')
        async def _session() -> dict[str, object]:
            session = current_session()
            assert session is not None
            return {
                'actor_id': session.actor.actor_id,
                'tenant': session.tenant,
                'scopes': sorted(session.scopes),
            }

    app = create_agent_web_app(
        mock_agent,
        mock_workspace_helpers,
        application_composer=compose,
    )

    client = authenticated_client_factory(app, scope='kg:read')
    response = client.get('/api/composed/session')

    assert response.status_code == 200
    assert response.json() == {
        'actor_id': 'test-suite',
        'tenant': 'test-tenant',
        'scopes': ['kg:read'],
    }
    assert current_session() is None, 'the ambient session must be reset'


def test_composer_failure_refuses_partial_application(
    mock_agent: Any,
    mock_workspace_helpers: dict[str, Any],
) -> None:
    def compose(_app: FastAPI) -> None:
        raise RuntimeError('synthetic Graph OS composition failure')

    with pytest.raises(RuntimeError, match='synthetic Graph OS composition failure'):
        create_agent_web_app(
            mock_agent,
            mock_workspace_helpers,
            application_composer=compose,
        )


def _imported_modules(node: ast.AST) -> tuple[str, ...]:
    if isinstance(node, ast.ImportFrom):
        return (node.module or '',)
    if isinstance(node, ast.Import):
        return tuple(alias.name for alias in node.names)
    return ()


def _forbidden_imports(source_path: Path, package_root: Path) -> list[str]:
    tree = ast.parse(source_path.read_text(encoding='utf-8'))
    forbidden_prefixes = ('agent_utilities.gateway', 'graph_os')
    return [
        f'{source_path.relative_to(package_root)}:{getattr(node, "lineno", 0)}:{module}'
        for node in ast.walk(tree)
        for module in _imported_modules(node)
        if module.startswith(forbidden_prefixes)
    ]


def test_webui_production_has_no_gateway_or_graph_os_import() -> None:
    """Production WebUI consumes ports, never either host implementation."""

    package_root = Path(__file__).parents[1]
    production_sources = [
        path for path in package_root.rglob('*.py') if '__tests__' not in path.parts
    ]
    forbidden = [
        finding
        for source_path in production_sources
        for finding in _forbidden_imports(source_path, package_root)
    ]

    assert not forbidden, f'private gateway/Graph OS imports found: {forbidden}'


# spec: APIUI-06.1
def test_injected_apps_isolate_engine_helpers_and_borrowed_lifecycle(
    mock_agent, authenticated_client_factory, monkeypatch
) -> None:
    from concurrent.futures import ThreadPoolExecutor
    from functools import partial
    from threading import Barrier
    from types import SimpleNamespace
    from unittest.mock import Mock

    from agent_webui import api_extensions as api
    from agent_webui.app_composition import current_app_composition

    singleton = Mock(side_effect=AssertionError('injected app acquired singleton'))
    monkeypatch.setattr(api.IntelligenceGraphEngine, 'get_active', singleton)
    monkeypatch.setattr(api.IntelligenceGraphEngine, 'get_or_create', singleton)
    original_helpers = api.workspace_helpers
    agent_close = Mock()
    monkeypatch.setattr(mock_agent, 'close', agent_close, raising=False)
    barrier = Barrier(2)

    def identity(name):
        # This runs in the existing bounded executor, not the request thread.
        barrier.wait(timeout=5)
        return {'name': name + '/' + api.get_helper('label')}

    engines = [
        SimpleNamespace(get_agent_identity=partial(identity, name), close=Mock())
        for name in ('engine-one', 'engine-two')
    ]
    engines[0].backend = SimpleNamespace()
    engines[1].backend = object()
    engines[0].finance = SimpleNamespace(market=lambda: None)
    first_helpers = {'label': 'first', 'agent_emoji': 'one'}
    first_app = create_agent_web_app(
        mock_agent, first_helpers, engine_provider=lambda: engines[0]
    )
    second_app = create_agent_web_app(
        mock_agent,
        {'label': 'second', 'agent_emoji': 'two'},
        engine_provider=lambda: engines[1],
    )
    first_helpers['label'] = 'mutated after factory'
    assert api.workspace_helpers is original_helpers
    assert current_app_composition() is None

    with authenticated_client_factory(first_app) as first:
        with authenticated_client_factory(second_app) as second:
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(
                    pool.map(
                        lambda client: client.get('/api/enhanced/info'), [first, second]
                    )
                )
            assert [response.status_code for response in responses] == [200, 200]
            assert [response.json()['name'] for response in responses] == [
                'engine-one/first',
                'engine-two/second',
            ]
            assert [response.json()['emoji'] for response in responses] == [
                'one',
                'two',
            ]
            assert first.get('/api/apps').json()['apps'][0]['available'] is True
            assert second.get('/api/apps').json()['apps'][0]['available'] is False
            assert (
                first.get('/api/enhanced/config/backend').json()['backend_type']
                == 'SimpleNamespace'
            )
            assert (
                second.get('/api/enhanced/config/backend').json()['backend_type']
                == 'object'
            )
    singleton.assert_not_called()
    agent_close.assert_not_called()
    for engine in engines:
        engine.close.assert_not_called()
    assert current_app_composition() is None
    assert api.workspace_helpers is original_helpers


@pytest.mark.parametrize('fails', [False, True])
def test_injected_engine_refuses_absence_without_global_fallback(
    mock_agent, authenticated_client_factory, monkeypatch, fails
) -> None:
    from unittest.mock import Mock

    from agent_webui import api_extensions as api
    from agent_webui.app_composition import current_app_composition

    singleton = Mock(side_effect=AssertionError('unexpected singleton fallback'))
    monkeypatch.setattr(api.IntelligenceGraphEngine, 'get_active', singleton)
    monkeypatch.setattr(api.IntelligenceGraphEngine, 'get_or_create', singleton)

    def provider():
        if fails:
            raise RuntimeError('synthetic unavailable host')
        return None

    app = create_agent_web_app(
        mock_agent, {'agent_name': 'must not fall back'}, engine_provider=provider
    )
    with authenticated_client_factory(app) as client:
        response = client.get('/api/enhanced/info')
        assert response.status_code == 503
    singleton.assert_not_called()
    assert current_app_composition() is None


def test_injected_context_survives_websocket_stream_and_resets(
    mock_agent, authenticated_client_factory
) -> None:
    import asyncio
    from types import SimpleNamespace

    from agent_webui import api_extensions as api
    from agent_webui.app_composition import current_app_composition
    from fastapi.responses import StreamingResponse

    engine = SimpleNamespace(name='borrowed')

    def compose(app):
        @app.get('/api/composed/stream')
        async def stream():
            async def body():
                for _ in range(2):
                    await asyncio.sleep(0)
                    assert await api.get_engine_bounded() is engine
                    yield api.get_helper('label') + '\n'

            return StreamingResponse(body())

        @app.websocket('/api/composed/socket')
        async def socket(websocket: WebSocket):
            await websocket.accept()
            await websocket.receive_text()
            assert await api.get_engine_bounded() is engine
            await websocket.send_text(api.get_helper('label'))
            await websocket.close()

    app = create_agent_web_app(
        mock_agent,
        {'label': 'owned by app'},
        engine_provider=lambda: engine,
        application_composer=compose,
    )
    with authenticated_client_factory(app) as client:
        with client.stream('GET', '/api/composed/stream') as response:
            assert response.status_code == 200
            assert list(response.iter_lines()) == ['owned by app', 'owned by app']

    async def verified_websocket(scope, receive, send):
        # Same prevalidated host identity seam as the HTTP fixture, with the
        # explicit bearer carrier required by the real WebSocket boundary.
        if scope['type'] == 'websocket':
            scope = dict(scope)
            scope['state'] = {
                'user_claims': {
                    'auth_type': 'jwt',
                    'sub': 'test-suite',
                    'tenant_id': 'test-tenant',
                    'scope': 'kg:read kg:write kg:admin',
                }
            }
        await app(scope, receive, send)

    with TestClient(verified_websocket) as client:
        with client.websocket_connect(
            '/api/composed/socket',
            headers={'Authorization': 'Bearer synthetic-prevalidated-test'},
        ) as websocket:
            websocket.send_text('continue')
            assert websocket.receive_text() == 'owned by app'
    assert current_app_composition() is None


@pytest.mark.asyncio
@pytest.mark.parametrize('scope_type', ['http', 'websocket', 'lifespan'])
async def test_composition_resets_on_cancelled_asgi_call(scope_type) -> None:
    import asyncio

    from agent_webui.app_composition import (
        AppCompositionMiddleware,
        current_app_composition,
    )

    async def cancelled(scope, receive, send):
        assert current_app_composition() is not None
        raise asyncio.CancelledError

    middleware = AppCompositionMiddleware(cancelled, lambda: None, {})
    with pytest.raises(asyncio.CancelledError):
        await middleware({'type': scope_type}, None, None)
    assert current_app_composition() is None


def test_provider_does_not_grant_request_authority(mock_agent) -> None:
    from unittest.mock import Mock

    provider = Mock()
    app = create_agent_web_app(mock_agent, {}, engine_provider=provider)
    assert TestClient(app).get('/api/enhanced/info').status_code == 401
    provider.assert_not_called()


def test_standalone_factory_keeps_existing_engine_default(
    mock_agent, authenticated_client_factory, monkeypatch
) -> None:
    from types import SimpleNamespace

    from agent_webui import api_extensions as api

    engine = SimpleNamespace(get_agent_identity=lambda: {'name': 'standalone'})
    monkeypatch.setattr(api.IntelligenceGraphEngine, 'get_active', lambda: engine)
    app = create_agent_web_app(mock_agent, {'agent_emoji': 'default'})
    with authenticated_client_factory(app) as client:
        response = client.get('/api/enhanced/info')
        assert response.status_code == 200
        assert response.json()['name'] == 'standalone'
        assert response.json()['emoji'] == 'default'


def test_factory_rejects_async_engine_factory(mock_agent) -> None:
    async def provider():
        return None

    with pytest.raises(TypeError, match='synchronous borrowed-engine getter'):
        create_agent_web_app(mock_agent, {}, engine_provider=provider)


@pytest.mark.asyncio
async def test_standalone_scope_clears_and_restores_inherited_composition():
    from agent_webui.app_composition import (
        AppCompositionMiddleware,
        current_app_composition,
    )

    async def standalone(scope, receive, send):
        assert current_app_composition() is None

    async def injected(scope, receive, send):
        original = current_app_composition()
        assert original is not None
        await AppCompositionMiddleware(standalone, None, {})(scope, receive, send)
        assert current_app_composition() is original

    await AppCompositionMiddleware(injected, lambda: None, {})(
        {'type': 'http'}, None, None
    )
    assert current_app_composition() is None
