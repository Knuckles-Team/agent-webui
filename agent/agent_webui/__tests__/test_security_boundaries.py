"""Focused regressions for the WebUI's application-security boundaries."""

from __future__ import annotations

import asyncio
import contextvars
import threading
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import agent_webui.api_extensions as api_extensions
import pytest
from agent_webui.api_extensions import (
    _actor_context,
    _actor_id_from_request,
    _BoundedSyncWorkExecutor,
    _invoke_governed_helper,
    _redact_inline_secrets,
    _validate_read_only_cypher,
    _workspace_ingestion_source,
    get_toggle_state,
    process_ontology_document,
    set_workspace_helpers,
)
from agent_webui.server import (
    RequestBodyLimitMiddleware,
    SecurityHeadersMiddleware,
    WebUIAuthorizationMiddleware,
    _content_security_policy,
    _require_graph_session_minter,
    _resolve_access_log_policy,
    _validated_bearer_header,
    create_agent_web_app,
)
from fastapi import FastAPI
from fastapi import HTTPException as FastAPIHTTPException


@pytest.mark.parametrize(
    'query',
    [
        'MATCH (n) CREATE (m) RETURN n',
        'MATCH (n) CALL db.labels() RETURN n',
        'LOAD CSV FROM "https://example.test/data" AS row RETURN row',
        'MATCH (n) RETURN n; MATCH (m) RETURN m',
        'SHOW DATABASES',
        "RETURN apoc.cypher.runFirstColumnSingle('CREATE (n)', {})",
        "RETURN `apoc`.`cypher`.`runFirstColumnSingle`('CREATE (n)', {})",
        'PROFILE MATCH (n) RETURN n',
    ],
)
def test_raw_graph_query_rejects_mutations_procedures_and_stacked_statements(
    query: str,
) -> None:
    with pytest.raises(FastAPIHTTPException) as exc_info:
        _validate_read_only_cypher(query)
    assert exc_info.value.status_code == 400


def test_raw_graph_query_ignores_keywords_inside_literals_and_comments() -> None:
    query = "MATCH (n {note: 'CREATE is documentation'}) // DELETE is a word\nRETURN n"
    assert _validate_read_only_cypher(query) == query


def test_toggle_lookup_uses_a_parameter_not_cypher_interpolation() -> None:
    engine = MagicMock()
    engine.query_cypher.return_value = [{'value': 'enabled'}]
    hostile_id = "tool' RETURN 1 AS value //"

    assert asyncio.run(get_toggle_state(engine, 'tool', hostile_id)) is True
    query, params = engine.query_cypher.call_args.args
    assert hostile_id not in query
    assert params == {'pref_id': f'preference:toggle:tool:{hostile_id}'}


def test_config_redaction_covers_provider_tokens_and_preserves_references() -> None:
    redacted = _redact_inline_secrets(
        {
            'github_token': 'secret-value',
            'refresh_token': 'refresh-value',
            'github_token_ref': 'secret://github/token',
        }
    )
    assert redacted['github_token'] == ''
    assert redacted['refresh_token'] == ''
    assert redacted['github_token_ref'] == 'secret://github/token'


def test_kb_source_is_workspace_confined_and_rejects_network_targets(
    tmp_path: Path,
) -> None:
    set_workspace_helpers({'get_workspace_path': lambda value='': tmp_path / value})
    try:
        assert _workspace_ingestion_source('docs') == str((tmp_path / 'docs').resolve())
        for unsafe in (
            'https://example.test/docs',
            'file:///etc/passwd',
            '../outside',
            str(tmp_path / 'absolute'),
        ):
            with pytest.raises(FastAPIHTTPException) as exc_info:
                _workspace_ingestion_source(unsafe)
            assert exc_info.value.status_code == 400
    finally:
        set_workspace_helpers({})


def test_kb_source_tree_rejects_symbolic_link_entries(tmp_path: Path) -> None:
    source = tmp_path / 'docs'
    source.mkdir()
    outside = tmp_path.parent / 'outside-kb-source.txt'
    outside.write_text('private', encoding='utf-8')
    link = source / 'linked.txt'
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip('symbolic links are unavailable on this platform')

    set_workspace_helpers({'get_workspace_path': lambda value='': tmp_path / value})
    try:
        with pytest.raises(FastAPIHTTPException) as exc_info:
            _workspace_ingestion_source('docs')
        assert exc_info.value.status_code == 400
    finally:
        set_workspace_helpers({})
        outside.unlink(missing_ok=True)


def test_ontology_document_path_rejects_network_and_absolute_sources(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ontology = MagicMock()
    monkeypatch.setattr(
        'agent_webui.api_extensions.get_ontology_kg',
        lambda: (MagicMock(), ontology),
    )
    set_workspace_helpers({'get_workspace_path': lambda value='': tmp_path / value})
    try:
        for unsafe in ('https://example.test/private', '/etc/passwd'):
            with pytest.raises(FastAPIHTTPException) as exc_info:
                asyncio.run(process_ontology_document({'path': unsafe}))
            assert exc_info.value.status_code == 400
        ontology.process_document.assert_not_called()
    finally:
        set_workspace_helpers({})


def test_same_origin_check_rejects_scheme_confusion_and_malformed_origins(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agent_utilities.core.config import config

    monkeypatch.setattr(config, 'allowed_origins', '')

    def scope(origin: bytes | None, *, scheme: str = 'https') -> dict:
        headers = [(b'host', b'webui.example.test')]
        if origin is not None:
            headers.append((b'origin', origin))
        return {'type': 'http', 'scheme': scheme, 'headers': headers}

    assert WebUIAuthorizationMiddleware._origin_allowed(
        scope(b'https://webui.example.test')
    )
    assert not WebUIAuthorizationMiddleware._origin_allowed(
        scope(b'http://webui.example.test')
    )
    assert not WebUIAuthorizationMiddleware._origin_allowed(
        scope(b'https://webui.example.test/not-an-origin')
    )
    assert not WebUIAuthorizationMiddleware._origin_allowed(
        scope(b'https://user@webui.example.test')
    )
    cross_site = scope(None)
    cross_site['headers'].append((b'sec-fetch-site', b'cross-site'))
    assert not WebUIAuthorizationMiddleware._origin_allowed(cross_site)


def test_bearer_boundary_rejects_duplicate_malformed_and_oversized_headers() -> None:
    assert _validated_bearer_header({'headers': []}) == (None, True)
    assert _validated_bearer_header(
        {'headers': [(b'authorization', b'Bearer valid-token')]}
    ) == ('valid-token', True)
    for headers in (
        [(b'authorization', b'Basic credentials')],
        [(b'authorization', b'Bearer ')],
        [
            (b'authorization', b'Bearer first'),
            (b'authorization', b'Bearer second'),
        ],
        [(b'authorization', b'Bearer ' + b'x' * (16 * 1024 + 1))],
    ):
        assert _validated_bearer_header({'headers': headers}) == (None, False)


def test_ontology_identity_ignores_caller_supplied_actor_headers() -> None:
    from agent_utilities.security.brain_context import ActorContext

    verified = ActorContext(
        actor_id='verified-user',
        roles=('kg:admin',),
        authenticated=True,
    )
    request = MagicMock()
    request.headers = {'X-Actor-Id': 'forged-admin'}
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            'agent_utilities.security.brain_context.current_actor',
            lambda: verified,
        )
        actor = _actor_context(request)
        assert actor.actor_id == verified.actor_id
        assert {'admin', 'kg:admin', 'kg_write'}.issubset(actor.roles)
        assert _actor_id_from_request(request) == _actor_id_from_request(None)
        assert _actor_id_from_request(request) != 'forged-admin'


def test_security_headers_cover_api_responses() -> None:
    async def app(_scope, _receive, send) -> None:
        await send(
            {
                'type': 'http.response.start',
                'status': 200,
                'headers': [(b'content-security-policy', b'default-src *')],
            }
        )
        await send({'type': 'http.response.body', 'body': b'{}'})

    messages: list[dict] = []

    async def receive() -> dict:
        return {'type': 'http.disconnect'}

    async def send(message: dict) -> None:
        messages.append(message)

    asyncio.run(
        SecurityHeadersMiddleware(app)(
            {'type': 'http', 'path': '/api/enhanced/info'}, receive, send
        )
    )
    headers = dict(messages[0]['headers'])
    assert headers[b'cache-control'] == b'no-store'
    assert headers[b'x-content-type-options'] == b'nosniff'
    assert b"default-src 'none'" in headers[b'content-security-policy']
    assert b"script-src 'self'" in headers[b'content-security-policy']
    assert b"script-src-attr 'none'" in headers[b'content-security-policy']
    assert b"frame-src 'none'" in headers[b'content-security-policy']
    assert b'default-src *' not in headers[b'content-security-policy']
    assert b'frame-ancestors' in headers[b'content-security-policy']


def test_sync_deadline_keeps_capacity_charged_until_worker_exits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = _BoundedSyncWorkExecutor(max_workers=1, max_pending=1)
    started = threading.Event()
    release = threading.Event()

    def blocking_backend() -> str:
        started.set()
        release.wait(timeout=5)
        return 'finished'

    monkeypatch.setattr(api_extensions, '_SYNC_WORK_EXECUTOR', executor)

    async def exercise() -> None:
        with pytest.raises(FastAPIHTTPException) as timeout_error:
            await _invoke_governed_helper(blocking_backend, deadline=0.1)
        assert timeout_error.value.status_code == 503
        assert started.is_set()
        assert executor.status()['timed_out_in_flight'] == 1

        with pytest.raises(FastAPIHTTPException) as capacity_error:
            await _invoke_governed_helper(lambda: 'unreachable', deadline=0.1)
        assert capacity_error.value.status_code == 503
        assert executor.status()['rejections_total'] == 1

    try:
        asyncio.run(exercise())
    finally:
        release.set()
        executor.shutdown()
    assert executor.status()['in_flight'] == 0


def test_sync_worker_preserves_the_request_identity_context() -> None:
    actor_marker: contextvars.ContextVar[str] = contextvars.ContextVar(
        'actor_marker', default='missing'
    )
    token = actor_marker.set('verified-actor')
    try:
        assert (
            asyncio.run(_invoke_governed_helper(actor_marker.get, deadline=1.0))
            == 'verified-actor'
        )
    finally:
        actor_marker.reset(token)


def test_csp_defaults_to_deny_and_requires_explicit_custom_rendering(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in (
        'AGENT_WEBUI_CSP_CUSTOM_RENDERING',
        'AGENT_WEBUI_CSP_SCRIPT_SOURCES',
        'AGENT_WEBUI_CSP_STYLE_SOURCES',
        'AGENT_WEBUI_CSP_IMAGE_SOURCES',
        'AGENT_WEBUI_CSP_FONT_SOURCES',
        'AGENT_WEBUI_CSP_CONNECT_SOURCES',
        'AGENT_WEBUI_CSP_MEDIA_SOURCES',
        'AGENT_WEBUI_CSP_WORKER_SOURCES',
        'AGENT_WEBUI_CSP_FRAME_SOURCES',
    ):
        monkeypatch.delenv(name, raising=False)

    policy, summary = _content_security_policy(custom_rendering=False)
    assert "default-src 'none'" in policy
    assert "frame-src 'none'" in policy
    assert summary['mode'] == 'built-in-strict'
    with pytest.raises(RuntimeError, match='CUSTOM_RENDERING'):
        _content_security_policy(custom_rendering=True)

    monkeypatch.setenv('AGENT_WEBUI_CSP_CUSTOM_RENDERING', '1')
    monkeypatch.setenv('AGENT_WEBUI_CSP_FRAME_SOURCES', 'https://preview.example.test')
    monkeypatch.setenv('AGENT_WEBUI_CSP_SCRIPT_SOURCES', "'unsafe-inline'")
    policy, summary = _content_security_policy(custom_rendering=True)
    assert 'frame-src https://preview.example.test' in policy
    assert "script-src 'self' 'unsafe-inline'" in policy
    assert summary['mode'] == 'custom-explicit'
    assert len(summary['configured_relaxations']) == 2


def test_csp_style_sources_apply_to_fallback_and_element_directives(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in (
        'AGENT_WEBUI_CSP_SCRIPT_SOURCES',
        'AGENT_WEBUI_CSP_IMAGE_SOURCES',
        'AGENT_WEBUI_CSP_FONT_SOURCES',
        'AGENT_WEBUI_CSP_CONNECT_SOURCES',
        'AGENT_WEBUI_CSP_MEDIA_SOURCES',
        'AGENT_WEBUI_CSP_WORKER_SOURCES',
        'AGENT_WEBUI_CSP_FRAME_SOURCES',
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('AGENT_WEBUI_CSP_CUSTOM_RENDERING', '1')
    monkeypatch.setenv(
        'AGENT_WEBUI_CSP_STYLE_SOURCES',
        "https://styles.example.test 'unsafe-inline'",
    )

    policy, summary = _content_security_policy(custom_rendering=True)

    expected_sources = "'self' https://styles.example.test 'unsafe-inline'"
    assert f'style-src {expected_sources}' in policy
    assert f'style-src-elem {expected_sources}' in policy
    assert {
        (entry['directive'], entry['source'])
        for entry in summary['configured_relaxations']
    } == {
        ('style-src', 'https://styles.example.test'),
        ('style-src', "'unsafe-inline'"),
        ('style-src-elem', 'https://styles.example.test'),
        ('style-src-elem', "'unsafe-inline'"),
    }


def test_best_effort_graph_read_does_not_mask_sync_capacity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def exhausted_engine():
        raise api_extensions.HTTPException(
            status_code=503,
            detail='Synchronous backend capacity is exhausted',
        )

    monkeypatch.setattr(api_extensions, '_get_engine_bounded', exhausted_engine)

    with pytest.raises(FastAPIHTTPException) as exc_info:
        asyncio.run(api_extensions.list_resources())
    assert exc_info.value.status_code == 503


def test_csp_rejects_wildcard_and_directive_injection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        'AGENT_WEBUI_CSP_FRAME_SOURCES',
        "https://*.example.test; script-src 'unsafe-inline'",
    )
    with pytest.raises(RuntimeError, match='exact origins'):
        _content_security_policy(custom_rendering=False)


def test_app_factory_rejects_unacknowledged_custom_html(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv('AGENT_WEBUI_CSP_CUSTOM_RENDERING', raising=False)
    agent = MagicMock()
    with pytest.raises(RuntimeError, match='CUSTOM_RENDERING'):
        create_agent_web_app(
            agent,
            workspace_helpers={},
            html_source='custom-dashboard.html',
            listener_host='127.0.0.1',
        )
    agent.to_web.assert_not_called()


def test_access_log_contract_is_explicit_for_remote_listeners(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv('AGENT_WEBUI_ACCESS_LOG_POLICY', raising=False)
    assert _resolve_access_log_policy('127.0.0.1') == 'loopback-only'
    with pytest.raises(RuntimeError, match='ACCESS_LOG_POLICY'):
        _resolve_access_log_policy('0.0.0.0')

    monkeypatch.setenv('AGENT_WEBUI_ACCESS_LOG_POLICY', 'redacted')
    assert _resolve_access_log_policy('0.0.0.0') == 'redacted'


def test_graph_session_minting_is_a_required_startup_capability(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import agent_utilities.security.request_identity as request_identity

    assert callable(_require_graph_session_minter())
    monkeypatch.setattr(request_identity, 'mint_graph_session', None)
    with pytest.raises(RuntimeError, match='mint_graph_session'):
        _require_graph_session_minter()


def test_security_doctor_exposes_the_active_contract_without_secrets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv('AGENT_WEBUI_ACCESS_LOG_POLICY', raising=False)
    agent = MagicMock()
    agent.to_web.return_value = FastAPI()
    app = create_agent_web_app(agent, workspace_helpers={}, listener_host='127.0.0.1')
    doctor_route = next(
        route
        for route in app.routes
        if getattr(route, 'path', '') == '/api/enhanced/security/doctor'
    )

    result = asyncio.run(doctor_route.endpoint())
    assert result['status'] == 'ok'
    assert result['graph_session_minting'] == 'available'
    assert result['access_log_policy'] == 'loopback-only'
    assert result['synchronous_work']['max_workers'] == 4
    assert result['synchronous_work_contract']['native_timeout_required'] is True
    assert 'token' not in result
    assert WebUIAuthorizationMiddleware._is_admin_route('/api/enhanced/security/doctor')


def test_websocket_transport_bounds_outbound_messages() -> None:
    async def app(_scope, _receive, send) -> None:
        await send({'type': 'websocket.send', 'text': 'x' * (1024 * 1024 + 1)})

    messages: list[dict] = []

    async def receive() -> dict:
        return {'type': 'websocket.receive', 'text': ''}

    async def send(message: dict) -> None:
        messages.append(message)

    middleware = WebUIAuthorizationMiddleware(app)
    asyncio.run(
        middleware._call_with_transport_bounds({'type': 'websocket'}, receive, send)
    )
    assert messages == [{'type': 'websocket.close', 'code': 1009}]


def test_structured_request_body_has_a_lower_limit_than_uploads() -> None:
    app_called = False

    async def app(_scope, _receive, _send) -> None:
        nonlocal app_called
        app_called = True

    async def receive() -> dict:
        return {'type': 'http.request', 'body': b'', 'more_body': False}

    messages: list[dict] = []

    async def send(message: dict) -> None:
        messages.append(message)

    scope = {
        'type': 'http',
        'headers': [
            (b'content-type', b'application/json'),
            (b'content-length', str(3 * 1024 * 1024).encode('ascii')),
        ],
    }
    middleware = RequestBodyLimitMiddleware(app, max_bytes=50 * 1024 * 1024)
    asyncio.run(middleware(scope, receive, send))

    assert app_called is False
    assert messages[0]['status'] == 413


def test_skill_and_tool_mutations_require_the_admin_route_classification() -> None:
    assert WebUIAuthorizationMiddleware._is_admin_mutation_route(
        '/api/enhanced/skills/demo/toggle'
    )
    assert WebUIAuthorizationMiddleware._is_admin_mutation_route(
        '/api/enhanced/tools/graph/demo/toggle'
    )


def test_supervisory_routes_require_admin_scope() -> None:
    assert WebUIAuthorizationMiddleware._is_admin_route('/api/fleet/kill')
    assert WebUIAuthorizationMiddleware._is_admin_route('/api/tools/toggle')
    assert WebUIAuthorizationMiddleware._is_admin_route('/api/enhanced/graph/query')
    assert WebUIAuthorizationMiddleware._is_admin_route('/api/enhanced/kb/ingest')
    assert WebUIAuthorizationMiddleware._is_admin_route(
        '/api/enhanced/ontology/object-set/action'
    )
    assert not WebUIAuthorizationMiddleware._is_admin_route('/api/graph/write')


# ------------------------------------------------- GOC-60-W05: E1b/E6 nav/policy drift
#
# `observability.dashboard` (nav `minRole: 'reader'`, the DEFAULT LANDING ROUTE),
# `integrations.ecosystem` (nav `minRole: 'maintainer'`), and `knowledge.graph` (nav
# `minRole: 'reader'`) all previously 403'd for every non-admin caller because
# `_is_admin_route` forced `kg:admin` for every method on their prefixes, including a
# bare GET. These tests pin the corrected classification: the prefixes below are no
# longer admin-for-every-method (an ordinary read now needs only `kg:read`, matching
# nav), while the genuinely admin-only operations that used to hide inside the same
# prefixes (arbitrary Cypher execution, the dashboard hydration daemon) keep their
# `kg:admin` floor explicitly and narrowly.
#
# Before this fix (see `git show main:agent/agent_webui/server.py` at the commit prior
# to this change), every one of the `not WebUIAuthorizationMiddleware._is_admin_route`
# assertions below was the opposite (`_is_admin_route(...)` was `True`) and the role
# matrix' reader/user/maintainer GET/websocket cases were all denied 403 — this is the
# failing-first evidence for E1b/E6.


def test_dashboard_route_is_no_longer_a_blanket_admin_route() -> None:
    """`/api/dashboard` (E1b/E6): ordinary reads (layout/data/full/widgets/health/
    discover/daemon-status/hydration-status) must not force `kg:admin` any more —
    `observability.dashboard` is the default landing route at nav `minRole: 'reader'`."""

    assert not WebUIAuthorizationMiddleware._is_admin_route('/api/dashboard')
    assert not WebUIAuthorizationMiddleware._is_admin_route('/api/dashboard/full')
    assert not WebUIAuthorizationMiddleware._is_admin_route('/api/dashboard/health')
    assert not WebUIAuthorizationMiddleware._is_admin_route('/ws/dashboard')
    # But the operational triggers under the same prefix keep their admin floor —
    # via the mutation-only bucket, so only their non-GET methods are gated.
    assert WebUIAuthorizationMiddleware._is_admin_mutation_route(
        '/api/dashboard/daemon/start'
    )
    assert WebUIAuthorizationMiddleware._is_admin_mutation_route(
        '/api/dashboard/hydrate'
    )
    assert WebUIAuthorizationMiddleware._is_admin_mutation_route(
        '/api/dashboard/hydrate/some-source'
    )


def test_ecosystem_route_is_no_longer_a_blanket_admin_route() -> None:
    """`/api/enhanced/ecosystem` (E6): every route under this prefix is a GET-only
    third-party status read (no mutation exists), matching `integrations.ecosystem`'s
    nav `minRole: 'maintainer'` — a maintainer's `kg:write`-derived session already
    carries `kg:read`, so this must not force `kg:admin`."""

    assert not WebUIAuthorizationMiddleware._is_admin_route('/api/enhanced/ecosystem')
    assert not WebUIAuthorizationMiddleware._is_admin_route(
        '/api/enhanced/ecosystem/uptime/status'
    )
    assert not WebUIAuthorizationMiddleware._is_admin_route(
        '/api/enhanced/ecosystem/github/prs'
    )


def test_graph_route_admin_gate_is_narrowed_to_arbitrary_query_execution() -> None:
    """`/api/enhanced/graph` (E1b layer 3): the base prefix used to force `kg:admin`
    for every sub-route including the plain structured reads `GraphView.tsx` needs
    (`nodes`/`relationships`/`stats`/`search`/`impact`/`viz/capabilities`) and the
    ordinary per-user writes (`memory`, `link`). Only arbitrary Cypher execution
    (`/graph/query`) is still genuinely admin-only: a query can `MATCH`/`SET`/
    `CREATE`/`DELETE` in one call and bypasses every other route's object-level
    scoping, so it stays admin for every method."""

    assert WebUIAuthorizationMiddleware._is_admin_route('/api/enhanced/graph/query')
    for path in (
        '/api/enhanced/graph/nodes',
        '/api/enhanced/graph/relationships',
        '/api/enhanced/graph/stats',
        '/api/enhanced/graph/search',
        '/api/enhanced/graph/impact/some_symbol',
        '/api/enhanced/graph/viz/capabilities',
        '/api/enhanced/graph/memory',
        '/api/enhanced/graph/memory/mem-1',
        '/api/enhanced/graph/link',
        '/api/enhanced/graph/magma',
    ):
        assert not WebUIAuthorizationMiddleware._is_admin_route(path), path


def _webui_session(*, roles: tuple[str, ...], scopes: frozenset[str]):
    """Build a `GraphSession` the way a real mint would: `scopes` pre-expanded per
    the KG scope hierarchy (see `graph_identity.mint_frontend_graph_session` and
    `GraphSession.require_scope`'s docstring: admin implies write+read, write implies
    read). Hand-building an under-expanded scope set would test a shape no real
    session has, per the existing `_graph_session` helper's convention above."""

    return _graph_session(roles=frozenset(roles), scopes=scopes)


# One fixture per WebUI role, following `rbac.resolve_webui_role`'s documented
# mapping: an explicit `webui:*` realm role wins outright; otherwise the caller's
# highest KG scope decides. Every real session's `scopes` set is hierarchy-expanded
# (kg:admin -> +write+read, kg:write -> +read), so these mirror what
# `mint_frontend_graph_session` actually produces for each tier.
_ROLE_SESSIONS = {
    'reader': lambda: _webui_session(
        roles=('webui:reader', 'kg:read'), scopes=frozenset({'kg:read'})
    ),
    'user': lambda: _webui_session(roles=('kg:read',), scopes=frozenset({'kg:read'})),
    'maintainer': lambda: _webui_session(
        roles=('kg:write',), scopes=frozenset({'kg:read', 'kg:write'})
    ),
    'admin': lambda: _webui_session(
        roles=('kg:admin',), scopes=frozenset({'kg:read', 'kg:write', 'kg:admin'})
    ),
}


async def _drive_http(
    *, method: str, path: str, session: Any, monkeypatch: pytest.MonkeyPatch
) -> int:
    from agent_utilities.core.config import config
    from agent_utilities.knowledge_graph.core.session import use_session

    # All three must be set -- `_identity_enforced()` is an AND of all three, and
    # when it is False the middleware skips every check (see `__call__`'s
    # `if not _identity_enforced() ...: return`), which would silently admit
    # every role and defeat the negative-control (admin-only) assertions below.
    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    monkeypatch.setattr(
        config, 'auth_jwt_issuer', 'https://idp.invalid/', raising=False
    )
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui', raising=False)

    async def inner(_scope: dict, _receive: Any, send: Any) -> None:
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{}'})

    middleware = WebUIAuthorizationMiddleware(inner)
    scope = {'type': 'http', 'method': method, 'path': path, 'headers': []}
    send = _Recorder()

    async def receive() -> dict:
        return {'type': 'http.request'}

    with use_session(session):
        await middleware(scope, receive, send)
    return send.status


async def _drive_ws(
    *, path: str, session: Any, monkeypatch: pytest.MonkeyPatch
) -> bool:
    """Returns True if the websocket handshake was admitted (reached the inner app,
    never closed by the middleware)."""

    from agent_utilities.core.config import config
    from agent_utilities.knowledge_graph.core.session import use_session

    # All three must be set -- `_identity_enforced()` is an AND of all three, and
    # when it is False the middleware skips every check (see `__call__`'s
    # `if not _identity_enforced() ...: return`), which would silently admit
    # every role and defeat the negative-control (admin-only) assertions below.
    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    monkeypatch.setattr(
        config, 'auth_jwt_issuer', 'https://idp.invalid/', raising=False
    )
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui', raising=False)

    reached: list[bool] = []

    async def inner(_scope: dict, _receive: Any, send: Any) -> None:
        reached.append(True)
        await send({'type': 'websocket.accept'})

    middleware = WebUIAuthorizationMiddleware(inner)
    scope = {'type': 'websocket', 'path': path, 'headers': []}
    send = _Recorder()

    async def receive() -> dict:
        return {'type': 'websocket.connect'}

    with use_session(session):
        await middleware(scope, receive, send)
    return reached == [True]


@pytest.mark.parametrize('role', ['reader', 'user', 'maintainer', 'admin'])
def test_role_matrix_dashboard_get_agrees_with_reader_nav(
    role: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`observability.dashboard` nav `minRole: 'reader'`: every role, including
    `reader`, must be admitted to `GET /api/dashboard/full` — this is the default
    landing route (E1b/E6); it must not 403 for the majority role."""

    status = asyncio.run(
        _drive_http(
            method='GET',
            path='/api/dashboard/full',
            session=_ROLE_SESSIONS[role](),
            monkeypatch=monkeypatch,
        )
    )
    assert status == 200, f'role={role} expected 200, got {status}'


@pytest.mark.parametrize('role', ['reader', 'user', 'maintainer', 'admin'])
def test_role_matrix_dashboard_websocket_agrees_with_reader_nav(
    role: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Same surface, the websocket leg: `/ws/dashboard` is a receive-only stream
    (`DashboardView.tsx` never calls `.send`), so it now requires only `kg:read`,
    the same floor as the REST route above — every role is admitted."""

    admitted = asyncio.run(
        _drive_ws(
            path='/ws/dashboard',
            session=_ROLE_SESSIONS[role](),
            monkeypatch=monkeypatch,
        )
    )
    assert admitted, f'role={role} expected the /ws/dashboard handshake to be admitted'


@pytest.mark.parametrize(
    ('role', 'expected_status'),
    [('reader', 200), ('user', 200), ('maintainer', 200), ('admin', 200)],
)
def test_role_matrix_ecosystem_get_agrees_with_maintainer_nav(
    role: str, expected_status: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`integrations.ecosystem` nav `minRole: 'maintainer'`: a maintainer (and above)
    must be admitted to a `GET /api/enhanced/ecosystem/*` read. `reader`/`user` are
    also admitted at the ROUTE level (an ordinary `kg:read` gate, same precedent as
    `/api/enhanced/sessions`) — the nav sidebar, not this route, is what keeps the
    page out of a reader's view; navigation never grants a capability, but the
    inverse (a hidden page's API being reachable directly) is not a defect here."""

    status = asyncio.run(
        _drive_http(
            method='GET',
            path='/api/enhanced/ecosystem/uptime/status',
            session=_ROLE_SESSIONS[role](),
            monkeypatch=monkeypatch,
        )
    )
    assert status == expected_status, (
        f'role={role} expected {expected_status}, got {status}'
    )


@pytest.mark.parametrize('role', ['reader', 'user', 'maintainer', 'admin'])
def test_role_matrix_graph_stats_get_agrees_with_reader_nav(
    role: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`knowledge.graph` nav `minRole: 'reader'`: every role must be admitted to the
    structured, genuinely read-only `GET /api/enhanced/graph/stats` that
    `GraphView.tsx`'s `fetchData` depends on."""

    status = asyncio.run(
        _drive_http(
            method='GET',
            path='/api/enhanced/graph/stats',
            session=_ROLE_SESSIONS[role](),
            monkeypatch=monkeypatch,
        )
    )
    assert status == 200, f'role={role} expected 200, got {status}'


@pytest.mark.parametrize(
    ('role', 'expected_status'),
    [('reader', 403), ('user', 403), ('maintainer', 403), ('admin', 200)],
)
def test_role_matrix_graph_query_post_stays_admin_only(
    role: str, expected_status: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The narrowed admin gate (`/api/enhanced/graph/query`, arbitrary Cypher
    execution) must still reject everyone below `admin`, including `maintainer`
    (`kg:write` does not satisfy `kg:admin`) — this is the negative control proving
    the fix did not over-widen the boundary."""

    status = asyncio.run(
        _drive_http(
            method='POST',
            path='/api/enhanced/graph/query',
            session=_ROLE_SESSIONS[role](),
            monkeypatch=monkeypatch,
        )
    )
    assert status == expected_status, (
        f'role={role} expected {expected_status}, got {status}'
    )


@pytest.mark.parametrize(
    ('role', 'expected_status'),
    [('reader', 403), ('user', 403), ('maintainer', 403), ('admin', 200)],
)
def test_role_matrix_dashboard_hydrate_post_stays_admin_only(
    role: str, expected_status: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`POST /api/dashboard/hydrate` (an operational trigger, not an ordinary read)
    must still require `kg:admin` even though `GET /api/dashboard/*` no longer does —
    proves the mutation-only reclassification did not also loosen the mutation."""

    status = asyncio.run(
        _drive_http(
            method='POST',
            path='/api/dashboard/hydrate',
            session=_ROLE_SESSIONS[role](),
            monkeypatch=monkeypatch,
        )
    )
    assert status == expected_status, (
        f'role={role} expected {expected_status}, got {status}'
    )


@pytest.mark.parametrize(
    ('role', 'expected_status'),
    [('reader', 403), ('user', 403), ('maintainer', 403), ('admin', 200)],
)
def test_role_matrix_tunnel_manager_hosts_get_stays_admin_only(
    role: str, expected_status: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Negative control on a prefix this lane did NOT reclassify: SSH host
    inventory (`/api/enhanced/tunnel-manager/hosts`, reachable from the same
    `integrations.ecosystem` page) stays admin-for-every-method — proves the
    ecosystem-prefix fix did not accidentally widen a sibling prefix that is
    fetched from the same page but genuinely is infrastructure-sensitive."""

    status = asyncio.run(
        _drive_http(
            method='GET',
            path='/api/enhanced/tunnel-manager/hosts',
            session=_ROLE_SESSIONS[role](),
            monkeypatch=monkeypatch,
        )
    )
    assert status == expected_status, (
        f'role={role} expected {expected_status}, got {status}'
    )


def test_ws_dashboard_scope_missing_denies_a_caller_with_no_kg_scope_at_all(
    caplog: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression coverage for the scope-missing branch on `/ws/dashboard` at its
    NEW (lowered) floor: a session with no KG scope whatsoever is still correctly
    denied. Superseded by this test:
    `test_authorization_denies_and_logs_scope_missing_for_a_resolved_session` in
    `test_ws_dashboard_denial_diagnostics.py` used to prove the OLD `kg:admin` floor
    rejected a `kg:write`-scoped caller; that scenario is now a documented ADMIT
    (see `test_role_matrix_dashboard_websocket_agrees_with_reader_nav` above), so the
    true negative for this path is an entirely unscoped session, not a `kg:write` one.
    """

    import logging

    from agent_utilities.core.config import config
    from agent_utilities.knowledge_graph.core.session import use_session

    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    monkeypatch.setattr(
        config, 'auth_jwt_issuer', 'https://idp.invalid/', raising=False
    )
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui', raising=False)

    session = _graph_session(roles=frozenset(), scopes=frozenset())

    async def inner_never_called(_scope: dict, _receive: Any, _send: Any) -> None:
        raise AssertionError('a scope-less session must never reach /ws/dashboard')

    middleware = WebUIAuthorizationMiddleware(inner_never_called)
    scope = {'type': 'websocket', 'path': '/ws/dashboard', 'headers': []}
    send = _Recorder()

    async def receive() -> dict:
        return {'type': 'websocket.connect'}

    with (
        caplog.at_level(logging.WARNING, logger='agent_webui.server'),
        use_session(session),
    ):
        asyncio.run(middleware(scope, receive, send))

    close_codes = [m['code'] for m in send.messages if m['type'] == 'websocket.close']
    assert close_codes == [4403]
    denial_lines = [
        r.getMessage() for r in caplog.records if 'ws_denied' in r.getMessage()
    ]
    assert len(denial_lines) == 1
    assert 'reason=scope-missing' in denial_lines[0]
    assert 'required=kg:read' in denial_lines[0]


# ------------------------------------------------------------- R9: WebUI roles


class _Recorder:
    """Minimal ASGI `send` collector — records status + body for an assertion."""

    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def __call__(self, message: dict) -> None:
        self.messages.append(message)

    @property
    def status(self) -> int:
        return next(
            m['status'] for m in self.messages if m['type'] == 'http.response.start'
        )


def test_role_requirement_is_admin_whenever_the_kg_admin_scope_is_required() -> None:
    """Every route that already demands `kg:admin` additionally demands the
    WebUI `admin` role — a hidden nav item is not a permission, so the same
    ladder `src/lib/nav-registry.ts` declares is enforced here too."""

    assert (
        WebUIAuthorizationMiddleware._role_requirement(
            required_scope='kg:admin', method='GET', path='/api/enhanced/prompts'
        )
        == 'admin'
    )


def test_role_requirement_is_maintainer_for_a_non_admin_mutation_route() -> None:
    """A websocket write to a `_ADMIN_MUTATION_ROUTE_PREFIXES` path that is not
    also an `_ADMIN_ROUTE_PREFIXES` admin route only needs `kg:write` at the
    scope layer (websockets never consult `_is_admin_mutation_route` when
    computing `required`), so the role floor for it is `maintainer`, not
    `admin`."""

    assert (
        WebUIAuthorizationMiddleware._role_requirement(
            required_scope='kg:write',
            method='',
            path='/api/enhanced/skills/demo/toggle',
        )
        == 'maintainer'
    )


def test_role_requirement_is_none_for_an_ordinary_read() -> None:
    assert (
        WebUIAuthorizationMiddleware._role_requirement(
            required_scope='kg:read', method='GET', path='/api/graph/query'
        )
        is None
    )


def _graph_session(*, roles: frozenset[str], scopes: frozenset[str]):
    from agent_utilities.knowledge_graph.core.session import GraphSession
    from agent_utilities.security.brain_context import ActorContext

    actor = ActorContext(
        actor_id='subject-1',
        tenant_id='homelab',
        roles=tuple(roles),
        authenticated=True,
    )
    return GraphSession(actor=actor, tenant='homelab', scopes=scopes)


def test_admin_route_rejects_a_verified_kg_admin_caller_explicitly_demoted_to_reader(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The scope check alone (`kg:admin` in scopes) is not sufficient once an
    explicit `webui:reader` realm role has demoted this caller's WebUI reach —
    the additive role gate must still reject it."""

    from agent_utilities.core.config import config
    from agent_utilities.knowledge_graph.core.session import use_session

    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    monkeypatch.setattr(
        config, 'auth_jwt_issuer', 'https://idp.invalid/', raising=False
    )
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui', raising=False)

    session = _graph_session(
        roles=frozenset({'kg:admin', 'webui:reader'}), scopes=frozenset({'kg:admin'})
    )

    async def _inner(_scope, _receive, _send) -> None:  # pragma: no cover
        raise AssertionError('the demoted caller must never reach the inner app')

    middleware = WebUIAuthorizationMiddleware(_inner)
    scope = {
        'type': 'http',
        'method': 'GET',
        'path': '/api/enhanced/prompts',
        'headers': [],
    }
    send = _Recorder()

    async def receive() -> dict:
        return {'type': 'http.request'}

    with use_session(session):
        asyncio.run(middleware(scope, receive, send))

    assert send.status == 403


def test_admin_route_admits_a_verified_kg_admin_caller_with_no_webui_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """By default (no explicit `webui:*` claim) a `kg:admin` scope holder
    resolves to the WebUI `admin` role too, so nothing that worked before this
    ladder existed is newly rejected."""

    from agent_utilities.core.config import config
    from agent_utilities.knowledge_graph.core.session import use_session

    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    monkeypatch.setattr(
        config, 'auth_jwt_issuer', 'https://idp.invalid/', raising=False
    )
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui', raising=False)

    session = _graph_session(
        roles=frozenset({'kg:admin'}), scopes=frozenset({'kg:admin'})
    )

    reached: list[bool] = []

    async def _inner(_scope, _receive, send) -> None:
        reached.append(True)
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{}'})

    middleware = WebUIAuthorizationMiddleware(_inner)
    scope = {
        'type': 'http',
        'method': 'GET',
        'path': '/api/enhanced/prompts',
        'headers': [],
    }
    send = _Recorder()

    async def receive() -> dict:
        return {'type': 'http.request'}

    with use_session(session):
        asyncio.run(middleware(scope, receive, send))

    assert reached == [True]
    assert send.status == 200


# ------------------------------------------- D-WUI-33: session cross-user scope


def test_sessions_route_is_reachable_by_a_non_admin_user_not_a_blanket_admin_route() -> (
    None
):
    """`/api/enhanced/sessions` used to require `kg:admin` for every caller
    (D-WUI-27), contradicting `nav-registry.ts`'s `control-plane.sessions`
    `minRole: 'user'`. Row-level ownership (see the tests below) is now what
    keeps a non-admin from seeing someone else's sessions, so the route itself
    must NOT be in `_ADMIN_ROUTE_PREFIXES` any more."""

    assert not WebUIAuthorizationMiddleware._is_admin_route('/api/enhanced/sessions')
    assert not WebUIAuthorizationMiddleware._is_admin_route(
        '/api/enhanced/sessions/abc123'
    )


def _actor(*, roles: tuple[str, ...], actor_id: str = 'subject-1'):
    from agent_utilities.security.brain_context import ActorContext

    return ActorContext(actor_id=actor_id, roles=roles, authenticated=True)


def test_current_webui_is_admin_reflects_the_resolved_ladder_role() -> None:
    from agent_utilities.security.brain_context import reset_actor, set_actor

    token = set_actor(_actor(roles=('kg:admin',)))
    try:
        assert api_extensions._current_webui_is_admin() is True
    finally:
        reset_actor(token)

    token = set_actor(_actor(roles=('kg:read',)))
    try:
        assert api_extensions._current_webui_is_admin() is False
    finally:
        reset_actor(token)


def test_current_webui_is_admin_fails_closed_with_no_bound_actor() -> None:
    """No ambient identity at all (e.g. an unauthenticated dev-mode request)
    must resolve to "not admin", never raise past this helper into a 500 that
    could be mistaken for a broader failure."""

    assert api_extensions._current_webui_is_admin() is False


def test_get_all_sessions_scopes_rows_to_the_owner_unless_admin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The core of D-WUI-33: two users' sessions live in the same table: a
    non-admin caller sees only the session they own; the admin sees both."""

    import sqlite3
    import time

    from agent_utilities.security.brain_context import reset_actor, set_actor

    db_path = tmp_path / 'sessions.db'
    monkeypatch.setattr(api_extensions, '_get_db_path', lambda: db_path)
    monkeypatch.setattr(api_extensions, '_is_gateway_active', lambda: False)

    conn = sqlite3.connect(str(db_path))
    conn.execute(
        """
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY, title TEXT DEFAULT '', created_at REAL NOT NULL,
            updated_at REAL NOT NULL, model TEXT DEFAULT '', mode TEXT DEFAULT 'ask',
            workspace TEXT DEFAULT '', turn_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active', background INTEGER DEFAULT 0,
            needs_input INTEGER DEFAULT 0, last_response_preview TEXT DEFAULT '',
            goal_id TEXT DEFAULT '', metadata_json TEXT DEFAULT '{}', owner TEXT DEFAULT ''
        )
        """
    )
    owner_a = api_extensions._durable_actor_reference('user-a')
    owner_b = api_extensions._durable_actor_reference('user-b')
    now = time.time()
    conn.execute(
        'INSERT INTO sessions (id, created_at, updated_at, owner) VALUES (?, ?, ?, ?)',
        ('session-a', now, now, owner_a),
    )
    conn.execute(
        'INSERT INTO sessions (id, created_at, updated_at, owner) VALUES (?, ?, ?, ?)',
        ('session-b', now, now, owner_b),
    )
    conn.commit()
    conn.close()

    token = set_actor(_actor(roles=('kg:read',), actor_id='user-a'))
    try:
        rows = asyncio.run(api_extensions.get_all_sessions())
    finally:
        reset_actor(token)
    assert [r['id'] for r in rows] == ['session-a']

    token = set_actor(_actor(roles=('kg:admin',), actor_id='admin-user'))
    try:
        rows = asyncio.run(api_extensions.get_all_sessions())
    finally:
        reset_actor(token)
    assert {r['id'] for r in rows} == {'session-a', 'session-b'}


def test_get_session_details_404s_for_a_non_owner_instead_of_leaking_existence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import sqlite3
    import time

    from agent_utilities.security.brain_context import reset_actor, set_actor
    from fastapi import HTTPException

    db_path = tmp_path / 'sessions.db'
    monkeypatch.setattr(api_extensions, '_get_db_path', lambda: db_path)
    monkeypatch.setattr(api_extensions, '_is_gateway_active', lambda: False)

    conn = sqlite3.connect(str(db_path))
    conn.execute(
        """
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY, title TEXT DEFAULT '', created_at REAL NOT NULL,
            updated_at REAL NOT NULL, model TEXT DEFAULT '', mode TEXT DEFAULT 'ask',
            workspace TEXT DEFAULT '', turn_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active', background INTEGER DEFAULT 0,
            needs_input INTEGER DEFAULT 0, last_response_preview TEXT DEFAULT '',
            goal_id TEXT DEFAULT '', metadata_json TEXT DEFAULT '{}', owner TEXT DEFAULT ''
        )
        """
    )
    conn.execute(
        'CREATE TABLE turns (id TEXT PRIMARY KEY, session_id TEXT, turn_number INTEGER)'
    )
    now = time.time()
    conn.execute(
        'INSERT INTO sessions (id, created_at, updated_at, owner) VALUES (?, ?, ?, ?)',
        ('session-a', now, now, api_extensions._durable_actor_reference('user-a')),
    )
    conn.commit()
    conn.close()

    token = set_actor(_actor(roles=('kg:read',), actor_id='user-b'))
    try:
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(api_extensions.get_session_details('session-a'))
        assert exc_info.value.status_code == 404
    finally:
        reset_actor(token)

    token = set_actor(_actor(roles=('kg:read',), actor_id='user-a'))
    try:
        detail = asyncio.run(api_extensions.get_session_details('session-a'))
        assert detail['id'] == 'session-a'
    finally:
        reset_actor(token)


# --------------------------------------- D-AOBS-3: grouped AgentConfig surface


def test_config_field_groups_derives_real_sections_from_config_py() -> None:
    """`agent_utilities/core/config.py` is ~7000 lines with 200+ typed settings
    fields, organised under `# --- Section ---` comments — the only grouping
    that already exists. `_config_field_groups` must read that real structure
    (not invent a second taxonomy), so a handful of well-known fields must
    resolve to the sections they actually live under."""

    api_extensions._config_field_groups_cache = None
    groups = api_extensions._config_field_groups()

    assert len(groups) > 50, 'expected the parser to find most AgentConfig fields'
    assert groups.get('openai_api_key', '').startswith('Provider API Keys')
    assert groups.get('oidc_client_id', '').startswith('OIDC / OAuth 2.0 Delegation')
    # A field declared before the first `# --- ... ---` marker in the class body
    # still gets a group rather than being silently dropped.
    assert 'tls_profile' in groups


def test_config_field_groups_endpoint_returns_metadata_only_never_values() -> None:
    """The `/config/groups` response is field-name -> section-title metadata —
    it must never carry a configuration VALUE (that's what `/config` is for)."""

    api_extensions._config_field_groups_cache = None
    result = asyncio.run(api_extensions.get_config_field_groups())
    assert isinstance(result['fields'], dict)
    assert result['field_count'] == len(result['fields'])
    for key, value in result['fields'].items():
        assert isinstance(key, str)
        assert isinstance(value, str)


def test_config_field_groups_degrades_to_empty_map_on_parse_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A source-introspection failure (package relocated, source unreadable,
    …) must degrade to an empty map — the frontend's `?? 'Other'` fallback
    already handles that — never raise past this helper into a 500 that would
    take the whole Global Settings page down with it."""

    api_extensions._config_field_groups_cache = None
    monkeypatch.setattr(
        'agent_utilities.core.config.AgentConfig', object(), raising=False
    )

    def _boom(_obj: object) -> str:
        raise RuntimeError('source not found')

    monkeypatch.setattr('inspect.getsourcefile', _boom)
    assert api_extensions._config_field_groups() == {}
    api_extensions._config_field_groups_cache = None


# --------------------------------------- D-AOBS-4: LLM template model listing


def test_list_llm_models_reads_the_live_chat_models_registry_and_excludes_secrets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The LLM template composer's model picker must reflect the SAME
    `AgentConfig.chat_models` registry `create_model` resolves against (no
    second, independently-drifting model list), and must never surface a
    model's `api_key_ref`/`oauth2`/`headers_ref` wiring detail."""

    from agent_utilities.core.config import ChatModelConfig, config

    model = ChatModelConfig(
        id='test-model',
        provider='openai',
        intelligence_level='high',
        vision=True,
        reasoning=True,
        tools_enabled=True,
        context_window=131072,
        can_route=True,
        can_kg=False,
        api_key_ref='secret://provider/test-model-key',
    )
    monkeypatch.setattr(config, 'chat_models', [model])

    result = asyncio.run(api_extensions.list_llm_models())

    assert result == [
        {
            'id': 'test-model',
            'provider': 'openai',
            'intelligence_level': 'high',
            'vision': True,
            'reasoning': True,
            'tools_enabled': True,
            'context_window': 131072,
            'can_route': True,
            'can_kg': False,
        }
    ]
    serialized = str(result)
    assert 'secret://provider/test-model-key' not in serialized
    assert 'api_key_ref' not in serialized


def test_list_llm_models_degrades_to_empty_list_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agent_utilities.core.config import config

    class _ExplodingList:
        def __iter__(self):
            raise RuntimeError('registry unavailable')

    monkeypatch.setattr(config, 'chat_models', _ExplodingList())
    assert asyncio.run(api_extensions.list_llm_models()) == []


# --------------------------------------- BUG-260: schema-derived model create/edit


def test_llm_model_schema_is_derived_from_agentconfig_not_hand_maintained() -> None:
    """`/llm/model-schema` must reflect `ChatModelConfig`/`EmbeddingModelConfig`
    directly (`model_json_schema()`), so a field AgentConfig adds/removes shows
    up here automatically -- the whole point of BUG-260."""

    from agent_utilities.core.config import ChatModelConfig, EmbeddingModelConfig

    result = asyncio.run(api_extensions.get_llm_model_schema())

    chat_fields = set(result['chat']['properties'])
    assert chat_fields == set(ChatModelConfig.model_fields)
    assert set(result['chat']['required']) == {'id', 'provider'}

    # EmbeddingModelConfig is self-referencing (`fallback`), which pydantic
    # renders as a root `$ref` -- `_flatten_model_schema` must resolve it into
    # a flat `properties`/`required` shape identical in kind to the chat one.
    embedding_fields = set(result['embedding']['properties'])
    assert embedding_fields == set(EmbeddingModelConfig.model_fields)
    assert '$ref' not in result['embedding']
    assert set(result['embedding']['required']) == {'id', 'provider'}


def test_llm_model_schema_updates_when_agentconfig_gains_a_field(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The generated-not-hand-maintained guarantee, proven directly: a NEW
    field added to `ChatModelConfig` appears in `/llm/model-schema` with no
    change to this route's own code."""

    from agent_utilities.core import config as config_module
    from pydantic import BaseModel, ConfigDict

    class _ChatModelConfigWithExtraField(BaseModel):
        id: str
        provider: str
        brand_new_field: str = 'default-value'
        model_config = ConfigDict(extra='forbid')

    # `get_llm_model_schema` does `from agent_utilities.core.config import
    # ChatModelConfig` INSIDE the function body, so patching the attribute on
    # the source module is picked up at call time -- no route code changes.
    monkeypatch.setattr(
        config_module, 'ChatModelConfig', _ChatModelConfigWithExtraField
    )
    result = asyncio.run(api_extensions.get_llm_model_schema())
    assert 'brand_new_field' in result['chat']['properties']


def _config_json_path(tmp_path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(api_extensions, 'config_dir', lambda: tmp_path)
    return tmp_path / 'config.json'


def test_update_llm_models_validates_and_persists_a_new_chat_model(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The write path (BUG-260's "create a template/model" ask): a valid
    model is validated against `ChatModelConfig`, merged into the persisted
    document under `chat_models`, and the WHOLE resulting AgentConfig
    document is re-validated before the atomic write."""

    import json

    config_path = _config_json_path(tmp_path, monkeypatch)

    result = asyncio.run(
        api_extensions.update_llm_models(
            {
                'models': [
                    {
                        'id': 'new-model',
                        'provider': 'openai',
                        'intelligence_level': 'high',
                        'vision': True,
                    }
                ]
            }
        )
    )
    assert result == {'status': 'success'}

    written = json.loads(config_path.read_text())
    assert len(written['chat_models']) == 1
    saved = written['chat_models'][0]
    assert saved['id'] == 'new-model'
    assert saved['vision'] is True
    # Every ChatModelConfig field is present with its schema default --
    # nothing was silently dropped by a hand-picked write shape either.
    assert saved['tools_enabled'] is False
    assert saved['reasoning_effort'] == 'inherit'


def test_update_llm_models_rejects_a_field_agentconfig_does_not_permit(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`ChatModelConfig`'s `extra='forbid'` must reject an unknown field --
    the create/edit form cannot smuggle in something AgentConfig disallows."""

    config_path = _config_json_path(tmp_path, monkeypatch)

    with pytest.raises(FastAPIHTTPException) as exc_info:
        asyncio.run(
            api_extensions.update_llm_models(
                {'models': [{'id': 'bad', 'provider': 'openai', 'not_a_real_field': 1}]}
            )
        )
    assert exc_info.value.status_code == 422
    assert not config_path.exists()


def test_update_llm_models_rejects_a_model_missing_a_required_field(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = _config_json_path(tmp_path, monkeypatch)

    with pytest.raises(FastAPIHTTPException) as exc_info:
        asyncio.run(
            api_extensions.update_llm_models({'models': [{'id': 'no-provider'}]})
        )
    assert exc_info.value.status_code == 422
    assert not config_path.exists()


def test_update_embedding_models_validates_and_persists_without_touching_chat_models(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """BUG-260: BOTH kinds are editable, and each write touches ONLY its own
    registry key -- an embedding-model save must never clobber chat_models."""

    import json

    config_path = _config_json_path(tmp_path, monkeypatch)
    config_path.write_text(
        json.dumps(
            {
                'chat_models': [{'id': 'keep-me', 'provider': 'openai'}],
                'embedding_models': [],
            }
        )
    )

    result = asyncio.run(
        api_extensions.update_embedding_models(
            {'models': [{'id': 'bge-m3', 'provider': 'openai', 'chunk_size': 512}]}
        )
    )
    assert result == {'status': 'success'}

    written = json.loads(config_path.read_text())
    assert written['chat_models'] == [{'id': 'keep-me', 'provider': 'openai'}]
    assert written['embedding_models'][0]['id'] == 'bge-m3'
    assert written['embedding_models'][0]['chunk_size'] == 512


def test_get_llm_model_detail_returns_full_fields_including_secret_refs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Unlike `/llm/models` (which deliberately excludes secret REFERENCES
    from the browse list), `/llm/model-detail` is the edit-form fetch and
    must return every field so an existing model's auth wiring is editable."""

    from agent_utilities.core.config import ChatModelConfig, config

    model = ChatModelConfig(
        id='qwen/qwen3', provider='openai', api_key_ref='secret://provider/key'
    )
    monkeypatch.setattr(config, 'chat_models', [model])

    detail = asyncio.run(
        api_extensions.get_llm_model_detail(kind='chat', model_id='qwen/qwen3')
    )
    assert detail['id'] == 'qwen/qwen3'
    assert detail['api_key_ref'] == 'secret://provider/key'


def test_get_llm_model_detail_404s_for_an_unknown_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agent_utilities.core.config import config

    monkeypatch.setattr(config, 'chat_models', [])

    with pytest.raises(FastAPIHTTPException) as exc_info:
        asyncio.run(
            api_extensions.get_llm_model_detail(kind='chat', model_id='does-not-exist')
        )
    assert exc_info.value.status_code == 404
