"""Tests for LANE F: HTTP access logging, structured logs, correlation ids,
distinguishable authorization/authentication denial reasons, and error
capture (``agent_webui/observability.py`` + the middleware/handlers it feeds
in ``server.py``).

Motivating gap this closes: production ``kubectl logs`` showed ONLY WebSocket
protocol lines — no HTTP request was ever logged — and a generic
``websocket.close code=4403`` collapsed three different denial reasons
(bad origin, missing KG scope, insufficient WebUI role) into one
indistinguishable outcome. These tests pin: (1) every request gets one access
log line; (2) every deny branch states WHY; (3) an unhandled exception is
captured with a traceback server-side against an id the CLIENT response also
carries.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import pytest

# ---------------------------------------------------------------------------
# Shared test scaffolding
# ---------------------------------------------------------------------------


class _Recorder:
    """Minimal ASGI ``send`` collector, mirroring the sibling test modules."""

    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def __call__(self, message: dict) -> None:
        self.messages.append(message)

    @property
    def status(self) -> int | None:
        for message in self.messages:
            if message['type'] == 'http.response.start':
                return message['status']
        return None

    @property
    def headers(self) -> dict[bytes, bytes]:
        for message in self.messages:
            if message['type'] == 'http.response.start':
                return dict(message.get('headers') or [])
        return {}

    @property
    def json_body(self) -> Any:
        body = b''.join(
            m.get('body', b'')
            for m in self.messages
            if m['type'] == 'http.response.body'
        )
        return json.loads(body)

    @property
    def close_code(self) -> int | None:
        for message in self.messages:
            if message['type'] == 'websocket.close':
                return message.get('code')
        return None


async def _receive() -> dict:
    return {'type': 'http.request', 'body': b'', 'more_body': False}


def _http_scope(
    path: str = '/api/enhanced/info',
    *,
    method: str = 'GET',
    headers: list | None = None,
    scheme: str = 'http',
) -> dict:
    return {
        'type': 'http',
        'method': method,
        'path': path,
        'scheme': scheme,
        'headers': headers if headers is not None else [],
        'state': {},
    }


def _ws_scope(path: str = '/ws/dashboard', headers: list | None = None) -> dict:
    return {
        'type': 'websocket',
        'path': path,
        'scheme': 'ws',
        'headers': headers if headers is not None else [],
        'state': {},
    }


@pytest.fixture
def agent_webui_caplog(caplog: pytest.LogCaptureFixture):
    """Attach caplog's handler DIRECTLY to the ``agent_webui`` logger.

    ``configure_logging`` sets ``propagate = False`` on this logger on
    purpose (so agent-webui owns its own formatting and never double-prints
    through a root handler an embedder might add) — but that also means
    pytest's default caplog capture (which listens on the ROOT logger) never
    sees these records. Attaching directly, bypassing propagation, is the
    standard fix.
    """
    logger = logging.getLogger('agent_webui')
    previous_level = logger.level
    logger.addHandler(caplog.handler)
    logger.setLevel(logging.DEBUG)
    caplog.set_level(logging.DEBUG, logger='agent_webui')
    try:
        yield caplog
    finally:
        logger.removeHandler(caplog.handler)
        logger.setLevel(previous_level)


# ---------------------------------------------------------------------------
# StructuredLogFormatter
# ---------------------------------------------------------------------------


def _make_record(
    *, message: str = 'hello', extra: dict | None = None, exc_info: Any = None
) -> logging.LogRecord:
    record = logging.LogRecord(
        name='agent_webui.server',
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=(),
        exc_info=exc_info,
    )
    for key, value in (extra or {}).items():
        setattr(record, key, value)
    return record


def test_json_formatter_emits_one_valid_json_object_with_correlation_id() -> None:
    from agent_utilities.observability.correlation import bind_carrier
    from agent_webui.observability import StructuredLogFormatter

    formatter = StructuredLogFormatter(json_mode=True)
    with bind_carrier({'x-correlation-id': 'corr-abc'}) as correlation_id:
        rendered = formatter.format(
            _make_record(message='request handled', extra={'status': 200})
        )
    payload = json.loads(rendered)
    assert payload['message'] == 'request handled'
    assert payload['correlation_id'] == correlation_id == 'corr-abc'
    assert payload['status'] == 200
    assert payload['level'] == 'INFO'
    assert payload['logger'] == 'agent_webui.server'


def test_json_formatter_preserves_traceback_for_error_capture() -> None:
    from agent_webui.observability import StructuredLogFormatter

    formatter = StructuredLogFormatter(json_mode=True)
    try:
        raise RuntimeError('boom-value')
    except RuntimeError:
        import sys

        rendered = formatter.format(
            _make_record(message='unhandled', exc_info=sys.exc_info())
        )
    payload = json.loads(rendered)
    assert 'RuntimeError' in payload['exception']
    assert 'boom-value' in payload['exception']


def test_text_formatter_is_readable_and_never_raises_on_missing_correlation() -> None:
    from agent_webui.observability import StructuredLogFormatter

    formatter = StructuredLogFormatter(json_mode=False)
    line = formatter.format(_make_record(message='plain text line'))
    assert 'plain text line' in line
    assert 'INFO' in line
    assert 'correlation_id=' in line


def test_formatter_sanitizes_endpoint_shaped_text_only_in_tracebacks() -> None:
    """The scrubber must hit an exception traceback but MUST NOT touch the
    message/extras — an HTTP access-log line's whole purpose is to show the
    real request path, and log_privacy's filesystem-path heuristic cannot
    tell ``/api/dashboard/health`` apart from ``/etc/passwd``; running it
    over the message silently defeated item 1 until this was caught.
    """
    from agent_webui.observability import StructuredLogFormatter

    formatter = StructuredLogFormatter(json_mode=True)

    message_rendered = formatter.format(
        _make_record(
            message='GET /api/dashboard/health -> 200 (1.2ms)',
            extra={
                'path': '/api/dashboard/health',
                'host': 'internal.example.test:5432',
            },
        )
    )
    message_payload = json.loads(message_rendered)
    assert message_payload['message'] == 'GET /api/dashboard/health -> 200 (1.2ms)'
    assert message_payload['path'] == '/api/dashboard/health'
    assert message_payload['host'] == 'internal.example.test:5432'

    try:
        raise RuntimeError('failed calling https://internal.example.test:5432/x')
    except RuntimeError:
        import sys

        traceback_rendered = formatter.format(
            _make_record(message='unhandled', exc_info=sys.exc_info())
        )
    traceback_payload = json.loads(traceback_rendered)
    assert 'internal.example.test' not in traceback_payload['exception']
    assert '<endpoint>' in traceback_payload['exception']


# ---------------------------------------------------------------------------
# configure_logging
# ---------------------------------------------------------------------------


def test_configure_logging_level_is_driven_by_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agent_webui.observability import configure_logging

    monkeypatch.setenv('AGENT_WEBUI_LOG_LEVEL', 'DEBUG')
    configure_logging()
    assert logging.getLogger('agent_webui').level == logging.DEBUG

    monkeypatch.setenv('AGENT_WEBUI_LOG_LEVEL', 'WARNING')
    configure_logging()
    assert logging.getLogger('agent_webui').level == logging.WARNING

    monkeypatch.delenv('AGENT_WEBUI_LOG_LEVEL', raising=False)
    configure_logging()
    assert logging.getLogger('agent_webui').level == logging.INFO


def test_configure_logging_installs_exactly_one_handler() -> None:
    from agent_webui.observability import configure_logging

    configure_logging()
    configure_logging()
    configure_logging()
    package_logger = logging.getLogger('agent_webui')
    structured_handlers = [
        handler
        for handler in package_logger.handlers
        if getattr(handler, '_agent_webui_structured_handler', False)
    ]
    assert len(structured_handlers) == 1
    assert package_logger.propagate is False


# ---------------------------------------------------------------------------
# RequestObservabilityMiddleware — the core access-logging gap
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_http_request_gets_one_access_log_line_and_a_correlation_header(
    agent_webui_caplog: pytest.LogCaptureFixture,
) -> None:
    from agent_webui.server import RequestObservabilityMiddleware

    async def inner(_scope: dict, _receive: Any, send: Any) -> None:
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{"ok":true}'})

    send = _Recorder()
    await RequestObservabilityMiddleware(inner)(
        _http_scope('/api/enhanced/info'), _receive, send
    )

    assert send.status == 200
    assert b'x-correlation-id' in send.headers

    access_records = [
        r
        for r in agent_webui_caplog.records
        if getattr(r, 'event', None) == 'http_request'
    ]
    assert len(access_records) == 1
    record = access_records[0]
    assert record.method == 'GET'
    assert record.path == '/api/enhanced/info'
    assert record.status == 200
    assert isinstance(record.duration_ms, float)
    assert record.correlation_id == send.headers[b'x-correlation-id'].decode('ascii')


@pytest.mark.asyncio
async def test_inbound_correlation_id_is_reused_not_replaced(
    agent_webui_caplog: pytest.LogCaptureFixture,
) -> None:
    from agent_webui.server import RequestObservabilityMiddleware

    async def inner(_scope: dict, _receive: Any, send: Any) -> None:
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{}'})

    send = _Recorder()
    scope = _http_scope(headers=[(b'x-correlation-id', b'caller-minted-id')])
    await RequestObservabilityMiddleware(inner)(scope, _receive, send)

    assert send.headers[b'x-correlation-id'] == b'caller-minted-id'
    record = next(
        r
        for r in agent_webui_caplog.records
        if getattr(r, 'event', None) == 'http_request'
    )
    assert record.correlation_id == 'caller-minted-id'


@pytest.mark.asyncio
async def test_liveness_paths_log_at_debug_not_info(
    agent_webui_caplog: pytest.LogCaptureFixture,
) -> None:
    from agent_webui.server import RequestObservabilityMiddleware

    async def inner(_scope: dict, _receive: Any, send: Any) -> None:
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{"status":"ok"}'})

    send = _Recorder()
    await RequestObservabilityMiddleware(inner)(_http_scope('/health'), _receive, send)

    record = next(
        r
        for r in agent_webui_caplog.records
        if getattr(r, 'event', None) == 'http_request'
    )
    assert record.levelno == logging.DEBUG


@pytest.mark.asyncio
async def test_unhandled_exception_is_logged_with_traceback_and_reraised(
    agent_webui_caplog: pytest.LogCaptureFixture,
) -> None:
    from agent_webui.server import RequestObservabilityMiddleware

    async def inner(_scope: dict, _receive: Any, _send: Any) -> None:
        raise RuntimeError('inner blew up')

    send = _Recorder()
    with pytest.raises(RuntimeError, match='inner blew up'):
        await RequestObservabilityMiddleware(inner)(
            _http_scope('/api/enhanced/info'), _receive, send
        )

    record = next(
        r for r in agent_webui_caplog.records if getattr(r, 'status', None) == 'error'
    )
    assert record.levelno == logging.ERROR
    assert record.exc_info is not None


@pytest.mark.asyncio
async def test_websocket_connection_is_logged_with_close_code(
    agent_webui_caplog: pytest.LogCaptureFixture,
) -> None:
    from agent_webui.server import RequestObservabilityMiddleware

    async def inner(_scope: dict, _receive: Any, send: Any) -> None:
        await send({'type': 'websocket.accept'})
        await send({'type': 'websocket.close', 'code': 4403})

    send = _Recorder()
    await RequestObservabilityMiddleware(inner)(_ws_scope(), _receive, send)

    record = next(
        r
        for r in agent_webui_caplog.records
        if getattr(r, 'event', None) == 'websocket_connection'
    )
    assert record.status == 4403
    assert record.path == '/ws/dashboard'


# ---------------------------------------------------------------------------
# WebUIAuthorizationMiddleware — the three distinguishable deny reasons
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_origin_denial_states_reason_origin_not_allowed(
    agent_webui_caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agent_utilities.core.config import config
    from agent_webui.server import WebUIAuthorizationMiddleware

    monkeypatch.setattr(config, 'allowed_origins', '', raising=False)

    async def never_called(*_args: Any) -> None:
        raise AssertionError('must not reach the inner app')

    send = _Recorder()
    scope = _http_scope(
        method='POST',
        headers=[
            (b'host', b'webui.example.test'),
            (b'origin', b'https://attacker.example.test'),
        ],
    )
    await WebUIAuthorizationMiddleware(never_called)(scope, _receive, send)

    assert send.status == 403
    record = next(
        r
        for r in agent_webui_caplog.records
        if getattr(r, 'event', None) == 'authorization'
    )
    assert record.reason == 'origin_not_allowed'
    assert record.origin == 'https://attacker.example.test'
    assert record.host == 'webui.example.test'
    # Never a credential value in the denial log.
    assert 'bearer' not in agent_webui_caplog.text.lower()
    assert 'authorization:' not in agent_webui_caplog.text.lower()


@pytest.mark.asyncio
async def test_kg_scope_denial_states_reason_kg_scope_missing(
    agent_webui_caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agent_utilities.core.config import config
    from agent_utilities.knowledge_graph.core.session import (
        GraphSession,
        reset_session,
        set_session,
    )
    from agent_utilities.security.brain_context import ActorContext
    from agent_webui.server import WebUIAuthorizationMiddleware

    monkeypatch.setattr(config, 'allowed_origins', '', raising=False)
    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    monkeypatch.setattr(config, 'auth_jwt_issuer', 'https://idp.invalid', raising=False)
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui', raising=False)

    async def never_called(*_args: Any) -> None:
        raise AssertionError('must not reach the inner app')

    actor = ActorContext(
        actor_id='reader-1', tenant_id='homelab', roles=('kg:read',), authenticated=True
    )
    session = GraphSession(actor=actor, tenant='homelab', scopes=frozenset({'kg:read'}))
    token = set_session(session)
    try:
        send = _Recorder()
        # An admin route (kg:admin required) the session's kg:read scope
        # cannot satisfy; same-origin so the origin check passes first.
        scope = _http_scope(
            path='/api/fleet/x',
            method='GET',
            scheme='https',
            headers=[
                (b'host', b'testserver'),
                (b'origin', b'https://testserver'),
            ],
        )
        await WebUIAuthorizationMiddleware(never_called)(scope, _receive, send)
    finally:
        reset_session(token)

    assert send.status == 403
    record = next(
        r
        for r in agent_webui_caplog.records
        if getattr(r, 'event', None) == 'authorization'
    )
    assert record.reason == 'kg_scope_missing'
    assert record.required_scope == 'kg:admin'
    assert record.resolved_scopes == ['kg:read']
    assert record.session_resolved is True


@pytest.mark.asyncio
async def test_webui_role_denial_states_reason_and_both_roles(
    agent_webui_caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agent_utilities.core.config import config
    from agent_utilities.knowledge_graph.core.session import (
        GraphSession,
        reset_session,
        set_session,
    )
    from agent_utilities.security.brain_context import ActorContext
    from agent_webui.server import WebUIAuthorizationMiddleware

    monkeypatch.setattr(config, 'allowed_origins', '', raising=False)
    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    monkeypatch.setattr(config, 'auth_jwt_issuer', 'https://idp.invalid', raising=False)
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui', raising=False)

    served: list[str] = []

    async def inner(_scope: dict, _receive: Any, send: Any) -> None:
        served.append('reached')
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{}'})

    # kg:admin scope satisfies the graph-authority check, but no explicit
    # webui:* realm role and no other kg:* role means resolve_webui_role
    # falls back to 'reader' -- below the 'admin' the ladder then requires.
    actor = ActorContext(
        actor_id='scoped-service-account',
        tenant_id='homelab',
        roles=(),
        authenticated=True,
    )
    session = GraphSession(
        actor=actor, tenant='homelab', scopes=frozenset({'kg:admin'})
    )
    token = set_session(session)
    try:
        send = _Recorder()
        scope = _http_scope(
            path='/api/fleet/x',
            method='GET',
            scheme='https',
            headers=[
                (b'host', b'testserver'),
                (b'origin', b'https://testserver'),
            ],
        )
        await WebUIAuthorizationMiddleware(inner)(scope, _receive, send)
    finally:
        reset_session(token)

    assert not served, 'a role-insufficient caller must never reach the route'
    assert send.status == 403
    record = next(
        r
        for r in agent_webui_caplog.records
        if getattr(r, 'event', None) == 'authorization'
    )
    assert record.reason == 'webui_role_insufficient'
    assert record.webui_role_required == 'admin'
    assert record.webui_role_resolved == 'reader'


# ---------------------------------------------------------------------------
# WebUIActorIdentityMiddleware — authentication denial reasons
# ---------------------------------------------------------------------------


def _identity_middleware(inner: Any, minter: Any) -> Any:
    from agent_webui.server import _ensure_actor_identity_middleware

    class _AppStub:
        def __init__(self) -> None:
            self.user_middleware: list[Any] = []
            self.installed: Any = None

        def add_middleware(self, cls: Any, **_kwargs: Any) -> None:
            self.installed = cls
            self.user_middleware.append(type('_Entry', (), {'cls': cls})())

    app = _AppStub()
    _ensure_actor_identity_middleware(app, mint_graph_session=minter)
    return app.installed(inner)


@pytest.mark.asyncio
async def test_malformed_authorization_header_logs_its_reason(
    agent_webui_caplog: pytest.LogCaptureFixture,
) -> None:
    async def never_called(*_args: Any) -> None:
        raise AssertionError('must not reach the inner app')

    send = _Recorder()
    scope = _http_scope(headers=[(b'authorization', b'Basic abc')])
    await _identity_middleware(never_called, lambda _actor: None)(scope, _receive, send)

    assert send.status == 401
    record = next(
        r
        for r in agent_webui_caplog.records
        if getattr(r, 'event', None) == 'authentication'
    )
    assert record.reason == 'malformed_or_multiple_authorization_header'


@pytest.mark.asyncio
async def test_websocket_missing_credential_when_enforced_logs_its_reason(
    agent_webui_caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agent_utilities.core.config import config

    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    monkeypatch.setattr(config, 'auth_jwt_issuer', 'https://idp.invalid', raising=False)
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui', raising=False)

    async def never_called(*_args: Any) -> None:
        raise AssertionError('must not reach the inner app')

    send = _Recorder()
    await _identity_middleware(never_called, lambda _actor: None)(
        _ws_scope(), _receive, send
    )

    assert send.close_code == 4401
    record = next(
        r
        for r in agent_webui_caplog.records
        if getattr(r, 'event', None) == 'authentication'
    )
    assert record.reason == 'credential_required_none_presented'


@pytest.mark.asyncio
async def test_session_expired_minter_logs_its_reason(
    agent_webui_caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agent_utilities.core.config import config
    from agent_utilities.knowledge_graph.core.session import SessionExpiredError
    from agent_utilities.security import request_identity as shared
    from agent_utilities.security.brain_context import ActorContext

    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    actor = ActorContext(
        actor_id='u', tenant_id='homelab', roles=(), authenticated=True
    )

    async def fake_actor_from_bearer_token(_token: str) -> ActorContext:
        return actor

    monkeypatch.setattr(shared, 'actor_from_bearer_token', fake_actor_from_bearer_token)

    def expired_minter(_actor: Any) -> Any:
        raise SessionExpiredError('expired')

    async def never_called(*_args: Any) -> None:
        raise AssertionError('must not reach the inner app')

    send = _Recorder()
    scope = _http_scope(headers=[(b'authorization', b'Bearer a-valid-looking-token')])
    await _identity_middleware(never_called, expired_minter)(scope, _receive, send)

    assert send.status == 401
    record = next(
        r
        for r in agent_webui_caplog.records
        if getattr(r, 'event', None) == 'authentication'
    )
    assert record.reason == 'session_expired'


# ---------------------------------------------------------------------------
# Unhandled-exception capture (item 4): traceback logged, stable error id
# returned to the client
# ---------------------------------------------------------------------------


def test_unhandled_exception_handler_returns_an_error_id_and_logs_traceback(
    agent_webui_caplog: pytest.LogCaptureFixture,
) -> None:
    from agent_webui.server import create_agent_web_app
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    app = create_agent_web_app(Agent(TestModel()), {'get_path': lambda x: x})
    handler = app.exception_handlers[Exception]

    response = asyncio.run(handler(None, RuntimeError('a real failure')))

    assert response.status_code == 500
    body = json.loads(bytes(response.body))
    assert body['detail'] == 'Internal request failed'
    assert 'RuntimeError' not in body['detail']
    assert 'a real failure' not in json.dumps(body)
    error_id = body['error_id']
    assert error_id

    record = next(
        r
        for r in agent_webui_caplog.records
        if getattr(r, 'event', None) == 'unhandled_exception'
    )
    assert record.error_id == error_id
    assert record.exc_info is not None
    assert record.error_type == 'RuntimeError'
