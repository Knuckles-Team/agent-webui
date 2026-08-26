"""Regression tests: the optional dashboard import and the mandatory
canonical KG REST surface must not share a failure domain.

Before this fix, ``create_agent_web_app`` wrapped BOTH the optional
``agent_utilities.gateway.api`` (dashboard) import AND, ~130 lines later,
the mandatory ``register_graph_routes(app, prefix='/api')`` call inside a
single ``try: ... except ImportError:`` block. Any ``ImportError`` raised
anywhere in that combined block -- including one confined entirely to the
dashboard-only import -- fell through to one ``except ImportError`` that
logged a single misleading INFO line ("agent-utilities gateway not
available") and silently skipped registering ``/api/graph/*``,
``/api/registry/*``, ``/api/ontology/*``, ``/api/research/*``, and
``/api/dashboard/*`` -- the entire canonical KG REST surface -- with no
error anywhere.

These tests force each import to fail independently and assert:

* a dashboard-only ``ImportError`` degrades quietly -- the canonical KG
  REST surface is still fully mounted (``TestDashboardFailureIsIsolated``);
* a canonical-KG-REST-surface failure (either the import, or the
  ``register_graph_routes(...)`` call itself) is loud --
  ``create_agent_web_app`` refuses to build the app at all, rather than
  silently serving a headless API (``TestCanonicalSurfaceFailureIsLoud``).
"""

from __future__ import annotations

import sys

import pytest
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

pytestmark = pytest.mark.integration


def _build_app():
    from agent_webui.server import create_agent_web_app

    return create_agent_web_app(Agent(TestModel()), {'get_path': lambda value: value})


def _app_paths(app) -> set[str]:
    """Raw ``Starlette``/``WebSocketRoute`` paths on ``app.routes``.

    Covers the canonical KG REST surface (mounted via ``app.add_route(...)``,
    see ``register_graph_routes``) and ``/ws/dashboard`` (a plain
    ``@app.websocket(...)`` route) -- both are real ``Route``/
    ``WebSocketRoute`` objects with a ``.path`` attribute.

    Does NOT reliably cover routers mounted via ``app.include_router(...)``
    (the dashboard API): current FastAPI represents those as an opaque
    ``fastapi.routing._IncludedRouter`` wrapper in ``app.routes`` with no
    ``.path`` attribute of its own -- use ``_openapi_paths`` for those.
    """
    return {getattr(route, 'path', '') for route in app.routes}


def _openapi_paths(app) -> set[str]:
    """Paths FastAPI's own ``app.openapi()`` resolves, including routers
    mounted via ``include_router(...)`` (e.g. the dashboard API), which
    ``_app_paths`` cannot see through the opaque ``_IncludedRouter`` wrapper.
    Does NOT cover the canonical KG REST surface's raw Starlette routes --
    they carry no request/response schema for FastAPI to introspect (see
    ``schemaless_routes()`` in agent-utilities' ``scripts/generate_openapi.py``)
    -- use ``_app_paths`` for those.
    """
    return set(app.openapi().get('paths', {}))


class TestDashboardFailureIsIsolated:
    """A broken/missing OPTIONAL dashboard dependency must not take the
    MANDATORY canonical KG REST surface down with it."""

    def test_dashboard_import_error_does_not_drop_the_canonical_surface(
        self, monkeypatch
    ):
        # Force exactly the failure the defect exploited: the dashboard's
        # own import (agent_utilities.gateway.api) raises ImportError.
        monkeypatch.setitem(sys.modules, 'agent_utilities.gateway.api', None)

        app = _build_app()  # must NOT raise -- this is the fail-soft path

        paths = _app_paths(app)

        # The mandatory canonical KG REST surface (register_graph_routes)
        # must be fully present regardless of the dashboard failure.
        for expected in (
            '/api/graph/query',
            '/api/sessions',
            '/api/goals',
            '/api/tools',
        ):
            assert expected in paths, (
                f'canonical route {expected} missing after a dashboard-only '
                'ImportError -- the two failure domains are not separated'
            )

        from agent_utilities.mcp.kg_server import ACTION_TOOL_ROUTES

        missing = [
            f'/api{route_path}'
            for route_path in ACTION_TOOL_ROUTES.values()
            if f'/api{route_path}' not in paths
        ]
        assert not missing, (
            'canonical action-routed tool twins missing after a dashboard-only '
            f'ImportError: {missing}'
        )

    def test_dashboard_import_error_disables_only_the_dashboard_surface(
        self, monkeypatch
    ):
        monkeypatch.setitem(sys.modules, 'agent_utilities.gateway.api', None)

        app = _build_app()

        # The optional dashboard surface is, correctly, absent -- this is
        # the quiet-degrade half of the contract.
        assert '/api/dashboard/full' not in _openapi_paths(app)
        assert not any(
            path.startswith('/ws/dashboard') for path in _app_paths(app) if path
        )

    def test_dashboard_available_still_mounts_both_surfaces(self):
        """Control: with nothing patched, both surfaces are present -- proves
        the isolation above is a real split, not an accidental always-off
        dashboard.
        """
        app = _build_app()
        assert '/api/dashboard/full' in _openapi_paths(app)
        assert '/ws/dashboard' in _app_paths(app)
        assert '/api/graph/query' in _app_paths(app)


class TestCanonicalSurfaceFailureIsLoud:
    """The MANDATORY canonical KG REST surface must fail loud: refuse to
    build the app rather than silently serve a headless API."""

    def test_graph_api_import_error_refuses_to_serve(self, monkeypatch):
        monkeypatch.setitem(sys.modules, 'agent_utilities.gateway.graph_api', None)

        with pytest.raises(RuntimeError, match='Canonical KG REST surface'):
            _build_app()

    def test_register_graph_routes_exception_refuses_to_serve(self, monkeypatch):
        import agent_utilities.gateway.graph_api as graph_api

        def _boom(*_args, **_kwargs):
            raise ValueError('synthetic registration failure')

        monkeypatch.setattr(graph_api, 'register_graph_routes', _boom)

        with pytest.raises(RuntimeError, match='Canonical KG REST surface'):
            _build_app()

    def test_canonical_surface_failure_does_not_partially_construct_the_app(
        self, monkeypatch
    ):
        """Belt-and-suspenders: prove the failure is a hard refusal (an
        exception out of ``create_agent_web_app``), not a return of a
        degraded-but-usable app object.
        """
        monkeypatch.setitem(sys.modules, 'agent_utilities.gateway.graph_api', None)

        with pytest.raises(RuntimeError):
            app = _build_app()
            # Should never reach here.
            assert app is None  # pragma: no cover - defensive
