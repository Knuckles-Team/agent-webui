"""Focused regressions for the WebUI's application-security boundaries."""

from __future__ import annotations

import asyncio
import contextvars
import threading
from pathlib import Path
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
    assert WebUIAuthorizationMiddleware._is_admin_route('/ws/dashboard')
    assert not WebUIAuthorizationMiddleware._is_admin_route('/api/graph/write')
