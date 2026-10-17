from __future__ import annotations

"""Test API endpoints for agent-webui backend."""

from unittest.mock import MagicMock, patch

import pytest
from agent_webui.server import create_agent_web_app
from fastapi.testclient import TestClient


@pytest.fixture
def client(mock_agent, mock_workspace_helpers, authenticated_client_factory):
    """Create test client.

    ``create_agent_web_app`` installs ``WebUIActorIdentityMiddleware``
    unconditionally, so every ``/api/*`` request now requires a verified
    actor or is rejected 401 -- an unauthenticated ``TestClient`` no longer
    reflects a real caller. ``authenticated_client_factory`` (tests/conftest
    .py) presents a legitimate, fully verified admin credential through the
    REAL identity + authorization middleware stack -- see its docstring and
    ``authenticated_asgi_app`` for why this is not a bypass. Individual tests
    that need to prove the gate itself (unauthenticated -> 401, an
    under-privileged role -> 403) build their own client directly instead of
    using this fixture -- see ``TestAuthenticationGateIsNotWeakened`` below.
    """
    app = create_agent_web_app(mock_agent, mock_workspace_helpers)
    return authenticated_client_factory(app, raise_server_exceptions=False)


class TestAuthenticationGateIsNotWeakened:
    """Known-bad proof: the ``client`` fixture above now presents a
    legitimate credential, but the gate it goes through must still reject
    what it should. A gate never demonstrated against a known-bad input is
    not evidence -- these drive the exact same real middleware stack through
    a real ``TestClient``/ASGI request, not the fixture's happy-path
    credential.
    """

    def test_unauthenticated_request_is_still_rejected(
        self, mock_agent, mock_workspace_helpers
    ):
        """No credential at all -> 401, even though this file's default
        ``client`` fixture now attaches one. Proves the fixture fix did not
        weaken ``WebUIActorIdentityMiddleware``."""
        app = create_agent_web_app(mock_agent, mock_workspace_helpers)
        bare_client = TestClient(app, raise_server_exceptions=False)

        response = bare_client.get('/api/enhanced/graph/stats')

        assert response.status_code == 401
        scope_response = bare_client.get('/api/enhanced/graph/graph3d/scope')
        assert scope_response.status_code == 401

    def test_underprivileged_role_is_still_refused_on_an_admin_route(
        self, mock_agent, mock_workspace_helpers, authenticated_client_factory
    ):
        """A verified ``kg:read``-only caller must still be refused the
        admin-only ``/api/enhanced/graph/query`` route (arbitrary Cypher
        execution) -- the same boundary
        ``test_security_boundaries.py::test_role_matrix_graph_query_post_stays_admin_only``
        pins at the middleware-unit level; this proves it end to end through
        a real ``TestClient`` request instead."""
        app = create_agent_web_app(mock_agent, mock_workspace_helpers)
        reader_client = authenticated_client_factory(
            app, scope='kg:read', raise_server_exceptions=False
        )

        response = reader_client.post(
            '/api/enhanced/graph/query', json={'query': 'MATCH (n) RETURN n'}
        )

        assert response.status_code == 403


class TestGraphQueryEndpoint:
    """Test Cypher query endpoint."""

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


class TestCoverageExpansion:
    """Additional tests for coverage expansion."""

    def test_toggle_skill_success(self, client):
        mock_toggle = MagicMock(return_value={'status': 'enabled'})
        with patch('agent_webui.api_extensions.get_helper', return_value=mock_toggle):
            response = client.post('/api/enhanced/skills/skill1/toggle')
            assert response.status_code == 200
            assert response.json()['status'] == 'enabled'


class TestServerIntegration:
    """Test server-level features."""

    def test_spa_fallback(self, client):
        response = client.get('/some-random-route')
        assert response.status_code in [200, 404]
