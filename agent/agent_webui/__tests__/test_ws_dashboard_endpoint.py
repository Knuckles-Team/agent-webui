"""W-19: implement `/ws/dashboard` (`reports/webui-graphos-defects-2026-08-08.md`).

W-18's root cause, proven live against the running pod, was that the backend
registered **zero** websocket routes — `/ws/dashboard` existed only as a string
in `_ADMIN_ROUTE_PREFIXES` (`server.py:106`). Starlette closed the unmatched
handshake and uvicorn logged that close as a bare `"WebSocket /ws/dashboard"
403`, which read for hours like an authorization bug even though no denial
branch ever ran (all 10 instrumented `websocket.close` sites stayed silent).

These tests pin the fix from three angles, matching the sign-off criteria in
the W-19 tasking:

* ``test_ws_dashboard_route_is_registered`` — the literal regression guard for
  "WebSocketRoutes registered: 0".
* ``test_ws_dashboard_streams_snapshot_then_update_from_the_full_dashboard_handler``
  — proves the socket REUSES ``agent_utilities.gateway.api.get_full_dashboard``
  (the exact function backing ``GET /api/dashboard/full``) instead of
  re-deriving widget data of its own: patching that one function changes what
  the socket sends.
* ``test_full_app_admits_a_valid_kg_admin_bearer_session`` /
  ``test_full_app_denies_a_kg_write_only_bearer_session`` — extend
  `test_ws_dashboard_denial_diagnostics.py`'s proof (a stub inner app behind a
  manually-assembled middleware chain) to the REAL app built by
  ``create_agent_web_app``, so admission is proven against the actual
  implemented endpoint, not a stand-in.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from starlette.routing import WebSocketRoute

pytestmark = pytest.mark.integration


def _build_app():
    from agent_webui.server import create_agent_web_app
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    return create_agent_web_app(Agent(TestModel()), {'get_path': lambda x: x})


def _sample_dashboard_response():
    from agent_utilities.gateway.api import DashboardResponse
    from agent_utilities.gateway.models import DashboardLayout, WidgetData

    return DashboardResponse(
        layout=DashboardLayout(),
        data={
            'jellyfin': WidgetData(
                fields={'active_streams': 2},
                status='ok',
                error=None,
                timestamp='2026-08-08T00:00:00Z',
            )
        },
    )


def _fake_actor(monkeypatch: pytest.MonkeyPatch, *, roles: frozenset[str]) -> None:
    """Mirrors ``test_ws_dashboard_denial_diagnostics.py``'s helper of the same
    name: stands in for real JWT/JWKS verification with a deterministic
    ``ActorContext`` so the test proves the AUTHORIZATION wiring, not a real
    identity provider round-trip."""

    import agent_utilities.security.request_identity as _shared
    from agent_utilities.security.brain_context import ActorContext

    actor = ActorContext(
        actor_id='subject-1', tenant_id='homelab', roles=roles, authenticated=True
    )

    async def _fake_actor_from_bearer_token(_token: str) -> ActorContext:
        return actor

    monkeypatch.setattr(
        _shared, 'actor_from_bearer_token', _fake_actor_from_bearer_token
    )


def _configure_jwt_verifier(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make ``_identity_enforced()`` True so the real middleware chain gates
    the websocket handshake exactly as it does in production, instead of the
    permissive default the rest of this suite (and ``AGENT_UTILITIES_TESTING
    =true``) otherwise leaves in place."""

    from agent_utilities.core.config import config

    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    monkeypatch.setattr(
        config, 'auth_jwt_issuer', 'https://idp.invalid/', raising=False
    )
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui', raising=False)
    monkeypatch.setattr(config, 'kg_policy_version', '1', raising=False)
    monkeypatch.setattr(config, 'allowed_origins', 'https://au.arpa', raising=False)


def test_ws_dashboard_route_is_registered() -> None:
    """Direct regression guard for the proven live defect: before this change,
    counting ``WebSocketRoute`` instances on the real app returned 0."""

    app = _build_app()
    ws_paths = {route.path for route in app.routes if isinstance(route, WebSocketRoute)}
    assert '/ws/dashboard' in ws_paths


def test_ws_dashboard_streams_snapshot_then_update_from_the_full_dashboard_handler(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The socket's `data` payload comes from `get_full_dashboard()` — the
    same function `GET /api/dashboard/full` is built from — not a duplicated
    aggregation path. Patching only that function changes both messages."""

    import agent_webui.server as server_module

    monkeypatch.setattr(server_module, '_DASHBOARD_WS_PUSH_INTERVAL_SECONDS', 0.01)

    sample = _sample_dashboard_response()
    expected_data = {
        'jellyfin': {
            'fields': {'active_streams': 2},
            'status': 'ok',
            'error': None,
            'timestamp': '2026-08-08T00:00:00Z',
            'raw': None,
        }
    }

    with patch(
        'agent_utilities.gateway.api.get_full_dashboard',
        new=AsyncMock(return_value=sample),
    ):
        app = _build_app()
        client = TestClient(app)
        with client.websocket_connect('/ws/dashboard') as ws:
            snapshot = ws.receive_json()
            assert snapshot == {'type': 'snapshot', 'data': expected_data}

            update = ws.receive_json()
            assert update == {'type': 'update', 'data': expected_data}


def test_ws_dashboard_closes_cleanly_on_client_disconnect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No leaked task, no server-side exception, when the client hangs up
    right after the first message — the common case given the frontend's
    aggressive 5s reconnect loop (`DashboardView.tsx`)."""

    import agent_webui.server as server_module

    monkeypatch.setattr(server_module, '_DASHBOARD_WS_PUSH_INTERVAL_SECONDS', 5.0)

    sample = _sample_dashboard_response()
    with patch(
        'agent_utilities.gateway.api.get_full_dashboard',
        new=AsyncMock(return_value=sample),
    ):
        app = _build_app()
        client = TestClient(app)
        with client.websocket_connect('/ws/dashboard') as ws:
            ws.receive_json()
        # Exiting the `with` block closes the client side; the server's
        # `receive_text()` wait must raise WebSocketDisconnect (caught inside
        # the handler) rather than hang the test or raise past TestClient.


def test_full_app_admits_a_valid_kg_admin_bearer_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """End-to-end extension of `test_ws_dashboard_denial_diagnostics.py`'s
    admission proof: that file drove the middleware chain against a STUB
    inner app (proving the chain itself is correct); this drives it against
    the REAL app built by `create_agent_web_app`, so a valid `kg:admin`
    bearer session is proven to reach the ACTUAL implemented handler and
    receive real (patched) dashboard data — not merely "some inner app"."""

    _configure_jwt_verifier(monkeypatch)
    _fake_actor(monkeypatch, roles=frozenset({'kg:admin'}))

    import agent_webui.server as server_module

    monkeypatch.setattr(server_module, '_DASHBOARD_WS_PUSH_INTERVAL_SECONDS', 5.0)

    sample = _sample_dashboard_response()
    with patch(
        'agent_utilities.gateway.api.get_full_dashboard',
        new=AsyncMock(return_value=sample),
    ):
        app = _build_app()
        client = TestClient(app)
        with client.websocket_connect(
            '/ws/dashboard',
            headers={
                'Authorization': 'Bearer placeholder-users-own-credential',
                'Origin': 'https://au.arpa',
                'Host': 'testserver',
            },
        ) as ws:
            snapshot = ws.receive_json()
            assert snapshot['type'] == 'snapshot'
            assert snapshot['data']['jellyfin']['status'] == 'ok'


def test_full_app_denies_a_kg_write_only_bearer_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A caller with `kg:write` but not `kg:admin` must still be refused —
    the new route must not have widened `_ADMIN_ROUTE_PREFIXES`' `kg:admin`
    requirement for `/ws/dashboard`."""

    from starlette.websockets import WebSocketDisconnect

    _configure_jwt_verifier(monkeypatch)
    _fake_actor(monkeypatch, roles=frozenset({'kg:write'}))

    with patch(
        'agent_utilities.gateway.api.get_full_dashboard',
        new=AsyncMock(side_effect=AssertionError('must not be reached')),
    ):
        app = _build_app()
        client = TestClient(app)
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(
                '/ws/dashboard',
                headers={
                    'Authorization': 'Bearer placeholder-users-own-credential',
                    'Origin': 'https://au.arpa',
                    'Host': 'testserver',
                },
            ) as ws:
                ws.receive_json()

        assert exc_info.value.code == 4403
