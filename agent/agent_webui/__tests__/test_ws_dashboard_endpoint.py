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
    monkeypatch.setattr(config, 'allowed_origins', 'https://au.example', raising=False)


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
            assert snapshot['type'] == 'snapshot'
            assert snapshot['data'] == expected_data
            assert isinstance(snapshot['stream_id'], str) and snapshot['stream_id']
            assert snapshot['sequence'] == 1

            update = ws.receive_json()
            assert update['type'] == 'update'
            assert update['data'] == expected_data
            # GOC-29: same connection -> same stream_id, monotonically
            # incrementing sequence. A client uses this pair to detect a
            # duplicate/out-of-order delivery within one connection.
            assert update['stream_id'] == snapshot['stream_id']
            assert update['sequence'] == 2


def test_ws_dashboard_mints_a_new_stream_id_per_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """GOC-29 (closing BUG-019's deferred backend half): this endpoint has no
    durable backlog to resume from -- every reconnect is necessarily a fresh
    full poll, not a delta continuation. Two independent connections (as a
    reconnect after a forced disconnect produces) must mint two DIFFERENT
    `stream_id`s and both must restart `sequence` at 1, so a client that
    tracks the `stream_id` it last saw can positively detect "this is a new
    stream; anything that happened between my last message and now was never
    delivered" instead of silently treating the fresh snapshot as an
    in-sequence continuation of the old one.

    Known-bad proof: before this change the wire carried no `stream_id`/
    `sequence` at all, so a client had no signal to distinguish a genuine
    reconnect-after-gap from an ordinary periodic `update` -- this is exactly
    the "message gap after reconnect must be detected, not silently skipped"
    failure mode.
    """

    import agent_webui.server as server_module

    monkeypatch.setattr(server_module, '_DASHBOARD_WS_PUSH_INTERVAL_SECONDS', 5.0)

    sample = _sample_dashboard_response()
    with patch(
        'agent_utilities.gateway.api.get_full_dashboard',
        new=AsyncMock(return_value=sample),
    ):
        app = _build_app()
        client = TestClient(app)

        with client.websocket_connect('/ws/dashboard') as first_ws:
            first_snapshot = first_ws.receive_json()

        with client.websocket_connect('/ws/dashboard') as second_ws:
            second_snapshot = second_ws.receive_json()

        assert first_snapshot['sequence'] == 1
        assert second_snapshot['sequence'] == 1
        assert first_snapshot['stream_id'] != second_snapshot['stream_id']


def _two_widget_dashboard_response():
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
            ),
            'pihole': WidgetData(
                fields={'queries_today': 5},
                status='ok',
                error=None,
                timestamp='2026-08-08T00:00:00Z',
            ),
        },
    )


def test_ws_dashboard_default_push_is_unfiltered_before_any_subscribe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Before a client ever sends a `subscribe` message, every pre-existing
    caller (and this suite's other tests) must keep seeing the full widget
    set -- subscription-scoping must be strictly opt-in."""

    import agent_webui.server as server_module

    monkeypatch.setattr(server_module, '_DASHBOARD_WS_PUSH_INTERVAL_SECONDS', 5.0)

    sample = _two_widget_dashboard_response()
    with patch(
        'agent_utilities.gateway.api.get_full_dashboard',
        new=AsyncMock(return_value=sample),
    ):
        app = _build_app()
        client = TestClient(app)
        with client.websocket_connect('/ws/dashboard') as ws:
            snapshot = ws.receive_json()
            assert set(snapshot['data']) == {'jellyfin', 'pihole'}


def test_ws_dashboard_subscribe_scopes_subsequent_pushes_to_the_named_widgets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """BUG-019 (GOC-29): `DashboardView.tsx` sends `{"type": "subscribe",
    "widget_ids": [...]}` naming exactly the widgets currently visible on
    screen (a collapsed group's widgets are excluded). Once received, the
    `data` field of every later push must contain ONLY the subscribed ids,
    AND an unsubscribed widget must never be computed at all -- this test
    proves both the wire scoping (the `data` field) and the fetch scoping
    (which function actually gets called) so a future regression back to
    "compute everything, filter after" is caught even though it would look
    identical on the wire.

    Known-bad proof: before this fix `subscribe` messages were silently
    discarded (the receive was only ever used to detect a dead socket), so
    every push always carried the full widget set regardless of what a
    client asked for -- this is the literal "fetches all widgets and filters
    after subscription" defect BUG-019 names. A second, subtler instance of
    the same defect survived an earlier partial fix: the wire payload was
    scoped, but `get_full_dashboard()` (a poll of EVERY configured widget)
    was still called for every push -- an unsubscribed/collapsed widget was
    still computed, just not sent. `fetch_dashboard_subset()` closes that:
    once subscribed, only the named widgets are fetched at all.
    """

    import agent_webui.server as server_module

    monkeypatch.setattr(server_module, '_DASHBOARD_WS_PUSH_INTERVAL_SECONDS', 5.0)

    sample = _two_widget_dashboard_response()
    full_dashboard_mock = AsyncMock(return_value=sample)

    async def _fake_fetch_subset(widget_ids: set[str]) -> dict:
        return {wid: widget for wid, widget in sample.data.items() if wid in widget_ids}

    fetch_subset_mock = AsyncMock(side_effect=_fake_fetch_subset)

    with (
        patch(
            'agent_utilities.gateway.api.get_full_dashboard', new=full_dashboard_mock
        ),
        patch(
            'agent_utilities.gateway.api.fetch_dashboard_subset', new=fetch_subset_mock
        ),
    ):
        app = _build_app()
        client = TestClient(app)
        with client.websocket_connect('/ws/dashboard') as ws:
            snapshot = ws.receive_json()
            assert set(snapshot['data']) == {'jellyfin', 'pihole'}
            assert full_dashboard_mock.call_count == 1
            assert fetch_subset_mock.call_count == 0

            ws.send_json({'type': 'subscribe', 'widget_ids': ['jellyfin']})

            update = ws.receive_json()
            assert set(update['data']) == {'jellyfin'}, (
                'a subscribed-to widget set must scope every later push; '
                f'got {set(update["data"])}'
            )
            # The stream/sequence contract is unaffected by subscribing.
            assert update['stream_id'] == snapshot['stream_id']
            assert update['sequence'] == 2
            # Fetch-side scoping: the post-subscribe push must go through
            # fetch_dashboard_subset({'jellyfin'}) and must NOT re-poll the
            # full dashboard (which would compute 'pihole' too, just to
            # discard it on the wire).
            assert fetch_subset_mock.call_count == 1
            assert fetch_subset_mock.call_args.args[0] == {'jellyfin'}
            assert full_dashboard_mock.call_count == 1

            # Re-subscribing to nothing must scope to nothing, not fall back
            # to "unfiltered" -- an explicit empty list is a real answer, not
            # a missing one.
            ws.send_json({'type': 'subscribe', 'widget_ids': []})
            empty_update = ws.receive_json()
            assert empty_update['data'] == {}
            assert fetch_subset_mock.call_count == 2
            assert fetch_subset_mock.call_args.args[0] == set()
            assert full_dashboard_mock.call_count == 1


def test_ws_dashboard_ignores_malformed_subscribe_payloads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A non-JSON, non-dict, or non-`subscribe` client message must never
    crash the stream or be treated as a subscription -- only well-formed
    `{"type": "subscribe", "widget_ids": [...]}` frames may narrow the push."""

    import agent_webui.server as server_module

    monkeypatch.setattr(server_module, '_DASHBOARD_WS_PUSH_INTERVAL_SECONDS', 5.0)

    sample = _two_widget_dashboard_response()
    with patch(
        'agent_utilities.gateway.api.get_full_dashboard',
        new=AsyncMock(return_value=sample),
    ):
        app = _build_app()
        client = TestClient(app)
        with client.websocket_connect('/ws/dashboard') as ws:
            ws.receive_json()

            ws.send_text('not json at all')
            update = ws.receive_json()
            assert set(update['data']) == {'jellyfin', 'pihole'}

            ws.send_json({'type': 'ping'})
            update2 = ws.receive_json()
            assert set(update2['data']) == {'jellyfin', 'pihole'}

            ws.send_json({'type': 'subscribe', 'widget_ids': 'jellyfin'})
            update3 = ws.receive_json()
            assert set(update3['data']) == {'jellyfin', 'pihole'}


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
                'Origin': 'https://au.example',
                'Host': 'testserver',
            },
        ) as ws:
            snapshot = ws.receive_json()
            assert snapshot['type'] == 'snapshot'
            assert snapshot['data']['jellyfin']['status'] == 'ok'


def test_full_app_admits_a_scopeless_bearer_session_via_the_default_read_floor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AUTHZ LANE B (`agent_webui.graph_identity.mint_frontend_graph_session`):
    a verified caller with NO `kg:*` claim at all is no longer refused
    end-to-end -- it now lands on the default `kg:read` floor (never zero
    access for a verified human; see that module's docstring, "Default scope
    + durable admin elevation"), which is sufficient for `/ws/dashboard`
    (`_WEBSOCKET_READ_ONLY_PATHS` requires only `kg:read`).

    This test used to be the negative control proving a scopeless session is
    denied; AUTHZ LANE B deliberately changes that premise, so this is now
    the positive proof of the SAME default-read floor
    `test_default_scope_for_verified_human_with_no_special_claims`
    (`test_graph_identity.py`) proves at the unit level -- through the REAL
    app `create_agent_web_app` builds, not a stub inner app. Genuine denial
    (no credential at all / an invalid token) is still covered by
    `test_ws_dashboard_denial_diagnostics.py`'s no-cookie/no-token tests,
    untouched by this lane."""

    _configure_jwt_verifier(monkeypatch)
    _fake_actor(monkeypatch, roles=frozenset())

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
                'Origin': 'https://au.example',
                'Host': 'testserver',
            },
        ) as ws:
            snapshot = ws.receive_json()
            assert snapshot['type'] == 'snapshot'
            status = snapshot['data']['jellyfin']['status']
            assert status == 'ok'
