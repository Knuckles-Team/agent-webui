"""Focused regressions for the WebUI's application-security boundaries."""

from __future__ import annotations

import asyncio
import contextvars
import re
import sqlite3
import sys
import threading
import types
from pathlib import Path
from unittest.mock import MagicMock

import agent_webui.api_extensions as api_extensions
import pytest
from agent_webui.api_extensions import (
    _BoundedSyncWorkExecutor,
    _redact_inline_secrets,
    _validate_read_only_cypher,
    _workspace_ingestion_source,
    get_engine_bounded,
    get_toggle_state,
    invoke_governed_helper,
    process_ontology_document,
    set_workspace_helpers,
)
from agent_webui.server import (
    RequestBodyLimitMiddleware,
    SecurityHeadersMiddleware,
    WebUIAuthorizationMiddleware,
    _content_security_policy,
    _resolve_access_log_policy,
    _validated_bearer_header,
    create_agent_web_app,
)
from fastapi import FastAPI
from fastapi import HTTPException as FastAPIHTTPException
from fastapi.testclient import TestClient


def test_governed_host_helpers_are_public_api() -> None:
    assert callable(get_engine_bounded)
    assert callable(invoke_governed_helper)
    assert not hasattr(api_extensions, '_get_engine_bounded')
    assert not hasattr(api_extensions, '_invoke_governed_helper')


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
    from agent_webui.host import config

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


def _run_html_document(body_chunks: list[bytes], policy: str | None = None) -> list:
    async def app(_scope, _receive, send) -> None:
        await send(
            {
                'type': 'http.response.start',
                'status': 200,
                'headers': [
                    (b'content-type', b'text/html; charset=utf-8'),
                    (b'content-length', str(sum(map(len, body_chunks))).encode()),
                    (b'etag', b'"static"'),
                ],
            }
        )
        for index, chunk in enumerate(body_chunks):
            more = index < len(body_chunks) - 1
            await send({'type': 'http.response.body', 'body': chunk, 'more_body': more})

    messages: list[dict] = []

    async def receive() -> dict:
        return {'type': 'http.disconnect'}

    async def send(message: dict) -> None:
        messages.append(message)

    middleware = (
        SecurityHeadersMiddleware(app)
        if policy is None
        else SecurityHeadersMiddleware(app, content_security_policy=policy)
    )
    asyncio.run(middleware({'type': 'http', 'path': '/'}, receive, send))
    return messages


@pytest.mark.spec('WEBUI-DESIGN-R009')
def test_html_documents_carry_a_fresh_style_nonce() -> None:
    chunks = [b'<meta property="csp-nonce" nonce="AGENT_WEBUI_', b'CSP_NONCE">']
    first = _run_html_document(chunks)
    second = _run_html_document(chunks)

    nonces = []
    for messages in (first, second):
        assert len(messages) == 2
        headers = dict(messages[0]['headers'])
        body = messages[1]['body']
        match = re.search(rb'nonce="([^"]+)"', body)
        assert match is not None
        nonce = match.group(1)
        assert nonce != b'AGENT_WEBUI_CSP_NONCE'
        policy = headers[b'content-security-policy']
        assert b"style-src-elem 'self' 'nonce-" + nonce + b"'" in policy
        assert b"style-src 'self' 'nonce-" + nonce + b"'" in policy
        assert b'nonce-' not in policy.split(b'script-src ', 1)[1].split(b';')[0]
        assert (
            b"'unsafe-inline'"
            not in policy.split(b'style-src-elem', 1)[1].split(b';')[0]
        )
        assert headers[b'content-length'] == str(len(body)).encode()
        assert headers[b'cache-control'] == b'no-store'
        assert b'etag' not in headers
        nonces.append(nonce)
    assert nonces[0] != nonces[1]


def test_html_without_placeholder_keeps_the_static_policy() -> None:
    messages = _run_html_document([b'<p>plain</p>'])
    headers = dict(messages[0]['headers'])
    assert messages[1]['body'] == b'<p>plain</p>'
    assert b'nonce-' not in headers[b'content-security-policy']


def test_style_nonce_does_not_mask_an_acknowledged_unsafe_inline() -> None:
    policy = (
        "default-src 'none'; style-src 'self' 'unsafe-inline'; style-src-elem 'self'"
    )
    messages = _run_html_document([b'AGENT_WEBUI_CSP_NONCE'], policy)
    csp = dict(messages[0]['headers'])[b'content-security-policy']
    assert b"style-src 'self' 'unsafe-inline';" in csp
    assert b"style-src-elem 'self' 'nonce-" in csp


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
            await invoke_governed_helper(blocking_backend, deadline=0.1)
        assert timeout_error.value.status_code == 503
        assert started.is_set()
        assert executor.status()['timed_out_in_flight'] == 1

        with pytest.raises(FastAPIHTTPException) as capacity_error:
            await invoke_governed_helper(lambda: 'unreachable', deadline=0.1)
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
            asyncio.run(invoke_governed_helper(actor_marker.get, deadline=1.0))
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

    monkeypatch.setattr(api_extensions, 'get_engine_bounded', exhausted_engine)

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


@pytest.mark.parametrize(
    'path',
    [
        '/api/v1/ops/fleet.status',
        '/api/v1/ops/fleet.catalog.list',
        '/api/graph/ask',
        '/api/graph/ask-data',
        '/api/graph/catalog',
        '/api/graph/code-nav',
        '/api/graph/federated-search',
        '/api/graph/projection',
        '/api/graph/query',
        '/api/graph/query/federated',
        '/api/graph/search',
        '/api/graph/search/analogy',
        '/api/graph/search/concept',
        '/api/graph/search/dci',
        '/api/graph/search/discover',
        '/api/graph/search/memory',
        '/api/graph/search-synthesis',
        '/api/graph/logs',
        '/api/graph/nl-query',
        '/api/graph/promql',
        '/api/graph/sql-schema',
        '/api/graph/traces',
        '/api/sparql',
    ],
)
def test_governed_read_posts_are_read_scope_routes(path: str) -> None:
    """Governed read/query bodies are reads even though transport is POST.

    The canonical handlers enforce read-only syntax, graph visibility, or
    query-only engine operations after this route-level gate. The WebUI must
    therefore admit a reader without granting the caller a write scope merely
    because the body is JSON.
    """

    assert (
        WebUIAuthorizationMiddleware._required_scope(
            scope_type='http', path=path, method='POST'
        )
        == 'kg:read'
    )


def test_unknown_post_route_keeps_the_write_floor() -> None:
    """An unreviewed POST is never implicitly classified as a read operation."""

    assert (
        WebUIAuthorizationMiddleware._required_scope(
            scope_type='http', path='/api/graph/future-query', method='POST'
        )
        == 'kg:write'
    )


@pytest.mark.parametrize(
    'path',
    [
        '/api/v1/ops/fleet.call',
        '/api/v1/ops/fleet.tools.load',
        '/api/v1/ops/fleet.tools.unload',
        '/api/v1/ops/fleet.status/mutation',
        '/api/v1/ops/fleet.catalog.list/mutation',
        '/api/graph/table',
        '/api/graph/document-tree',
        '/api/graph/write',
        '/api/graph/future-query',
        '/api/graph/query/mutation',
        '/api/graph/catalog/sync',
        '/api/graph/nl-query/write',
    ],
)
def test_mixed_or_unknown_posts_keep_the_write_floor(path: str) -> None:
    """Mixed action routes and unreviewed POSTs cannot inherit reader access."""

    assert (
        WebUIAuthorizationMiddleware._required_scope(
            scope_type='http', path=path, method='POST'
        )
        == 'kg:write'
    )


def test_query_and_admin_boundaries_remain_distinct() -> None:
    """Read queries stay reader-scoped while known admin actions stay admin-only."""

    assert (
        WebUIAuthorizationMiddleware._required_scope(
            scope_type='http', path='/api/graph/query', method='POST'
        )
        == 'kg:read'
    )
    assert (
        WebUIAuthorizationMiddleware._required_scope(
            scope_type='http', path='/api/enhanced/tunnel-manager/hosts', method='GET'
        )
        == 'kg:admin'
    )
    assert (
        WebUIAuthorizationMiddleware._required_scope(
            scope_type='http', path='/api/graph/write', method='POST'
        )
        == 'kg:write'
    )


@pytest.mark.parametrize('method', ['PUT', 'PATCH', 'DELETE'])
def test_governed_read_paths_do_not_lower_non_post_mutations(method: str) -> None:
    """The POST exception cannot be reused to admit a mutation method."""

    assert (
        WebUIAuthorizationMiddleware._required_scope(
            scope_type='http', path='/api/graph/query', method=method
        )
        == 'kg:write'
    )


# ------------------------------------------------------------- R9: WebUI roles


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
    from agent_webui.host import ActorContext

    return ActorContext(actor_id=actor_id, roles=roles, authenticated=True)


def test_current_webui_is_admin_reflects_the_resolved_ladder_role() -> None:
    from agent_webui.host import reset_actor, set_actor

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


@pytest.mark.parametrize('terminal_ui_importable', [False, True])
def test_local_session_path_is_webui_owned_regardless_of_terminal_ui_installation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    terminal_ui_importable: bool,
) -> None:
    """A sibling frontend must not select WebUI's local persistence path."""

    webui_data_dir = tmp_path / 'webui'
    terminal_ui_path = tmp_path / 'terminal-ui' / 'sessions.db'
    monkeypatch.setattr(api_extensions, '_WEBUI_DATA_DIR', webui_data_dir)

    if terminal_ui_importable:
        terminal_ui = types.ModuleType('agent_terminal_ui')
        terminal_ui.__dict__['__path__'] = []
        session_manager = types.ModuleType('agent_terminal_ui.session_manager')
        session_manager.__dict__['DEFAULT_DB_PATH'] = terminal_ui_path
        monkeypatch.setitem(sys.modules, 'agent_terminal_ui', terminal_ui)
        monkeypatch.setitem(
            sys.modules, 'agent_terminal_ui.session_manager', session_manager
        )
    else:
        # ``None`` makes an attempted import fail even if terminal-ui happens
        # to be installed in the test environment.
        monkeypatch.setitem(sys.modules, 'agent_terminal_ui', None)
        monkeypatch.setitem(sys.modules, 'agent_terminal_ui.session_manager', None)

    assert api_extensions._resolved_session_db_path() == (
        webui_data_dir / 'agent_terminal_ui.db'
    )
    assert api_extensions._resolved_session_db_path() != terminal_ui_path


def test_local_session_path_still_refuses_a_symbolic_link(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    webui_data_dir = tmp_path / 'webui'
    webui_data_dir.mkdir()
    target = tmp_path / 'outside.db'
    target.touch()
    (webui_data_dir / 'agent_terminal_ui.db').symlink_to(target)
    monkeypatch.setattr(api_extensions, '_WEBUI_DATA_DIR', webui_data_dir)

    with pytest.raises(RuntimeError, match='symbolic-link session database'):
        api_extensions._resolved_session_db_path()


def test_webui_local_database_keeps_schema_and_privacy_migrations(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    webui_data_dir = tmp_path / 'webui'
    webui_data_dir.mkdir()
    db_path = webui_data_dir / 'agent_terminal_ui.db'
    monkeypatch.setattr(api_extensions, '_WEBUI_DATA_DIR', webui_data_dir)

    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY, title TEXT DEFAULT '', created_at REAL NOT NULL,
            updated_at REAL NOT NULL, model TEXT DEFAULT '', mode TEXT DEFAULT 'ask',
            workspace TEXT DEFAULT '', turn_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active', background INTEGER DEFAULT 0,
            needs_input INTEGER DEFAULT 0, last_response_preview TEXT DEFAULT '',
            goal_id TEXT DEFAULT '', metadata_json TEXT DEFAULT '{}'
        )
        """
    )
    conn.execute(
        'INSERT INTO sessions (id, created_at, updated_at, workspace) VALUES (?, ?, ?, ?)',
        ('legacy-session', 1.0, 1.0, '/private/workspace'),
    )
    conn.commit()
    conn.close()

    assert api_extensions._get_db_path() == db_path

    conn = sqlite3.connect(db_path)
    columns = {row[1] for row in conn.execute('PRAGMA table_info(sessions)')}
    privacy_version = conn.execute(
        "SELECT value FROM webui_schema_meta WHERE key = 'privacy_version'"
    ).fetchone()
    workspace = conn.execute(
        'SELECT workspace FROM sessions WHERE id = ?', ('legacy-session',)
    ).fetchone()
    conn.close()

    assert 'owner' in columns
    assert privacy_version == ('1',)
    assert workspace == ('workspace://active',)
    assert db_path.stat().st_mode & 0o777 == 0o600


# --------------------------------------- D-AOBS-3: grouped AgentConfig surface


# --------------------------------------- D-AOBS-4: LLM template model listing


# --------------------------------------- BUG-260: schema-derived model create/edit


# --------------------------------------- 1:1 AgentConfig form (GOC config-schema)


@pytest.mark.parametrize('operation', ['fleet.status', 'fleet.catalog.list'])
def test_fleet_discovery_host_entrypoint(
    mock_agent, authenticated_client_factory, operation
):
    """The real host admits readers without granting fleet effect authority."""
    app = create_agent_web_app(
        mock_agent, workspace_helpers={}, listener_host='127.0.0.1'
    )
    calls = []

    @app.post(f'/api/v1/ops/{operation}')
    async def discovery():
        calls.append(operation)
        return {'value': {}}

    with authenticated_client_factory(app, scope='kg:read mcp:discover') as client:
        response = client.post(f'/api/v1/ops/{operation}', json={})
    assert response.status_code == 200
    assert calls == [operation]
    assert TestClient(app).post(f'/api/v1/ops/{operation}', json={}).status_code == 401
    assert calls == [operation]


@pytest.mark.parametrize(
    'operation', ['fleet.call', 'fleet.tools.load', 'fleet.tools.unload']
)
def test_fleet_effect_host_entrypoint_refuses_reader(
    mock_agent, authenticated_client_factory, operation
):
    app = create_agent_web_app(
        mock_agent, workspace_helpers={}, listener_host='127.0.0.1'
    )
    calls = []

    @app.post(f'/api/v1/ops/{operation}')
    async def effect():
        calls.append(operation)
        return {'value': {}}

    with authenticated_client_factory(app, scope='kg:read mcp:discover') as client:
        response = client.post(f'/api/v1/ops/{operation}', json={})
    assert response.status_code == 403
    assert calls == []
