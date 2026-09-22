"""Application-composition boundary between agent-webui and Graph OS."""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

import pytest
from agent_utilities.knowledge_graph.core.session import current_session
from agent_webui.server import create_agent_web_app
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.routing import Mount

pytestmark = pytest.mark.integration


def _paths(app: FastAPI) -> set[str]:
    return {getattr(route, 'path', '') for route in app.routes}


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
