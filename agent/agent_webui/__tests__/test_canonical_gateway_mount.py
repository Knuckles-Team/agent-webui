"""Drift guard: the webui app must serve the canonical KG REST surface.

``server.create_agent_web_app`` mounts the canonical gateway route table
(``agent_utilities.gateway.graph_api.register_graph_routes`` →
``agent_utilities.mcp.kg_server._mount_rest_routes``) under ``/api`` so the
SAME route code serves webui clients and gateway clients. These tests pin that
wiring: if the mount is dropped (or the canonical table moves), they fail.
"""

from __future__ import annotations

from unittest.mock import patch

import networkx as nx
import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


@pytest.fixture
def app():
    """The real FastAPI app, exactly as production builds it."""
    from agent_webui.server import create_agent_web_app
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    return create_agent_web_app(Agent(TestModel()), {'get_path': lambda x: x})


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture
def patched_engine():
    """A real in-memory engine patched in as the active singleton.

    Patches the class attribute, so both ``api_extensions.get_engine`` and the
    canonical ``kg_server._get_engine`` resolve the same engine — exactly the
    production invariant (one engine, two route surfaces).
    """
    from agent_utilities.knowledge_graph.backends import create_backend
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine

    backend = create_backend(backend_type='memory')
    engine = IntelligenceGraphEngine(graph=nx.MultiDiGraph(), backend=backend)
    with patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=engine,
    ):
        yield engine


def _app_paths(app) -> set[str]:
    return {getattr(route, 'path', '') for route in app.routes}


def test_every_canonical_action_route_is_mounted(app):
    """Each MCP⇄REST parity route from the canonical table is served at /api.

    ``ACTION_TOOL_ROUTES`` is the gateway's single source of truth for the
    action-routed tool twins (graph_*, ontology_*, object_*); the webui app
    must expose every one of them, mounted from the canonical registrar.
    """
    from agent_utilities.mcp.kg_server import ACTION_TOOL_ROUTES

    paths = _app_paths(app)
    missing = [
        f'/api{route_path}'
        for route_path in ACTION_TOOL_ROUTES.values()
        if f'/api{route_path}' not in paths
    ]
    assert not missing, (
        'Canonical gateway routes missing from the webui app (the '
        f'register_graph_routes mount in server.py regressed): {missing}'
    )


def test_canonical_sessions_goals_tools_routes_are_mounted(app):
    """The canonical non-tool routes (sessions/goals/tools) are also served."""
    paths = _app_paths(app)
    for path in ('/api/sessions', '/api/goals', '/api/tools', '/api/graph/query'):
        assert path in paths, f'canonical route {path} not mounted'


def test_canonical_ontology_route_serves_live_requests(client, patched_engine):
    """POST /api/ontology/property-types answers through the canonical handler.

    The canonical action-routed twins envelope results as
    ``{status, result}`` — assert that exact gateway contract end-to-end.
    """
    resp = client.post('/api/ontology/property-types', json={'action': 'list'})
    assert resp.status_code == 200
    body = resp.json()
    assert body['status'] == 'success'
    assert 'string' in body['result']['property_types']


def test_canonical_object_set_route_serves_live_requests(client, patched_engine):
    """POST /api/object/set reaches the canonical object_set tool."""
    patched_engine.backend.execute(
        "CREATE (n:Memory {id: 'canon-1', name: 'One', type: 'Memory'})"
    )
    resp = client.post(
        '/api/object/set', json={'action': 'from_ids', 'ids_json': '["canon-1"]'}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body['status'] == 'success'
    assert body['result']['count'] == 1
