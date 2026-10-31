"""Tests for LANE F: HTTP access logging, structured logs, correlation ids,
distinguishable authorization/authentication denial reasons, and error
capture (``overstory/observability.py`` + the middleware/handlers it feeds
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
def overstory_caplog(caplog: pytest.LogCaptureFixture):
    """Attach caplog's handler DIRECTLY to the ``overstory`` logger.

    ``configure_logging`` sets ``propagate = False`` on this logger on
    purpose (so overstory owns its own formatting and never double-prints
    through a root handler an embedder might add) — but that also means
    pytest's default caplog capture (which listens on the ROOT logger) never
    sees these records. Attaching directly, bypassing propagation, is the
    standard fix.
    """
    logger = logging.getLogger('overstory')
    previous_level = logger.level
    logger.addHandler(caplog.handler)
    logger.setLevel(logging.DEBUG)
    caplog.set_level(logging.DEBUG, logger='overstory')
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
        name='overstory.server',
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


def test_json_formatter_preserves_traceback_for_error_capture() -> None:
    from overstory.observability import StructuredLogFormatter

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
    from overstory.observability import StructuredLogFormatter

    formatter = StructuredLogFormatter(json_mode=False)
    line = formatter.format(_make_record(message='plain text line'))
    assert 'plain text line' in line
    assert 'INFO' in line
    assert 'correlation_id=' in line


# ---------------------------------------------------------------------------
# configure_logging
# ---------------------------------------------------------------------------


def test_configure_logging_level_is_driven_by_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from overstory.observability import configure_logging

    monkeypatch.setenv('OVERSTORY_LOG_LEVEL', 'DEBUG')
    configure_logging()
    assert logging.getLogger('overstory').level == logging.DEBUG

    monkeypatch.setenv('OVERSTORY_LOG_LEVEL', 'WARNING')
    configure_logging()
    assert logging.getLogger('overstory').level == logging.WARNING

    monkeypatch.delenv('OVERSTORY_LOG_LEVEL', raising=False)
    configure_logging()
    assert logging.getLogger('overstory').level == logging.INFO


def test_configure_logging_installs_exactly_one_handler() -> None:
    from overstory.observability import configure_logging

    configure_logging()
    configure_logging()
    configure_logging()
    package_logger = logging.getLogger('overstory')
    structured_handlers = [
        handler
        for handler in package_logger.handlers
        if getattr(handler, '_overstory_structured_handler', False)
    ]
    assert len(structured_handlers) == 1
    assert package_logger.propagate is False


# ---------------------------------------------------------------------------
# RequestObservabilityMiddleware — the core access-logging gap
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_http_request_gets_one_access_log_line_and_a_correlation_header(
    overstory_caplog: pytest.LogCaptureFixture,
) -> None:
    from overstory.server import RequestObservabilityMiddleware

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
        for r in overstory_caplog.records
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
    overstory_caplog: pytest.LogCaptureFixture,
) -> None:
    from overstory.server import RequestObservabilityMiddleware

    async def inner(_scope: dict, _receive: Any, send: Any) -> None:
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{}'})

    send = _Recorder()
    scope = _http_scope(headers=[(b'x-correlation-id', b'caller-minted-id')])
    await RequestObservabilityMiddleware(inner)(scope, _receive, send)

    assert send.headers[b'x-correlation-id'] == b'caller-minted-id'
    record = next(
        r
        for r in overstory_caplog.records
        if getattr(r, 'event', None) == 'http_request'
    )
    assert record.correlation_id == 'caller-minted-id'


@pytest.mark.asyncio
async def test_liveness_paths_log_at_debug_not_info(
    overstory_caplog: pytest.LogCaptureFixture,
) -> None:
    from overstory.server import RequestObservabilityMiddleware

    async def inner(_scope: dict, _receive: Any, send: Any) -> None:
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{"status":"ok"}'})

    send = _Recorder()
    await RequestObservabilityMiddleware(inner)(_http_scope('/health'), _receive, send)

    record = next(
        r
        for r in overstory_caplog.records
        if getattr(r, 'event', None) == 'http_request'
    )
    assert record.levelno == logging.DEBUG


@pytest.mark.asyncio
async def test_unhandled_exception_is_logged_with_traceback_and_reraised(
    overstory_caplog: pytest.LogCaptureFixture,
) -> None:
    from overstory.server import RequestObservabilityMiddleware

    async def inner(_scope: dict, _receive: Any, _send: Any) -> None:
        raise RuntimeError('inner blew up')

    send = _Recorder()
    with pytest.raises(RuntimeError, match='inner blew up'):
        await RequestObservabilityMiddleware(inner)(
            _http_scope('/api/enhanced/info'), _receive, send
        )

    record = next(
        r for r in overstory_caplog.records if getattr(r, 'status', None) == 'error'
    )
    assert record.levelno == logging.ERROR
    assert record.exc_info is not None


@pytest.mark.asyncio
async def test_websocket_connection_is_logged_with_close_code(
    overstory_caplog: pytest.LogCaptureFixture,
) -> None:
    from overstory.server import RequestObservabilityMiddleware

    async def inner(_scope: dict, _receive: Any, send: Any) -> None:
        await send({'type': 'websocket.accept'})
        await send({'type': 'websocket.close', 'code': 4403})

    send = _Recorder()
    await RequestObservabilityMiddleware(inner)(_ws_scope(), _receive, send)

    record = next(
        r
        for r in overstory_caplog.records
        if getattr(r, 'event', None) == 'websocket_connection'
    )
    assert record.status == 4403
    assert record.path == '/ws/dashboard'


# ---------------------------------------------------------------------------
# WebUIAuthorizationMiddleware — the three distinguishable deny reasons
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_origin_denial_states_reason_origin_not_allowed(
    overstory_caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    from overstory.host import config
    from overstory.server import WebUIAuthorizationMiddleware

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
        for r in overstory_caplog.records
        if getattr(r, 'event', None) == 'authorization'
    )
    assert record.reason == 'origin_not_allowed'
    assert record.origin == 'https://attacker.example.test'
    assert record.host == 'webui.example.test'
    # Never a credential value in the denial log.
    assert 'bearer' not in overstory_caplog.text.lower()
    assert 'authorization:' not in overstory_caplog.text.lower()


# ---------------------------------------------------------------------------
# WebUIActorIdentityMiddleware — authentication denial reasons
# ---------------------------------------------------------------------------


def _identity_middleware(inner: Any, minter: Any) -> Any:
    from overstory.server import _ensure_actor_identity_middleware

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
    overstory_caplog: pytest.LogCaptureFixture,
) -> None:
    async def never_called(*_args: Any) -> None:
        raise AssertionError('must not reach the inner app')

    send = _Recorder()
    scope = _http_scope(headers=[(b'authorization', b'Basic abc')])
    await _identity_middleware(never_called, lambda _actor: None)(scope, _receive, send)

    assert send.status == 401
    record = next(
        r
        for r in overstory_caplog.records
        if getattr(r, 'event', None) == 'authentication'
    )
    assert record.reason == 'malformed_or_multiple_authorization_header'


@pytest.mark.asyncio
async def test_websocket_missing_credential_when_enforced_logs_its_reason(
    overstory_caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    from overstory.host import config

    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    monkeypatch.setattr(config, 'auth_jwt_issuer', 'https://idp.invalid', raising=False)
    monkeypatch.setattr(config, 'auth_jwt_audience', 'overstory', raising=False)

    async def never_called(*_args: Any) -> None:
        raise AssertionError('must not reach the inner app')

    send = _Recorder()
    await _identity_middleware(never_called, lambda _actor: None)(
        _ws_scope(), _receive, send
    )

    assert send.close_code == 4401
    # This websocket branch logs through `_log_ws_denial` (the W-18 taxonomy
    # that is deployed and was what PROVED `/ws/dashboard` never reached any
    # denial branch at all), not the structured `event=authentication` record
    # used on the HTTP paths. Two denial loggers coexist deliberately; assert
    # against the one this branch actually calls.
    messages = [r.getMessage() for r in overstory_caplog.records]
    assert any(
        'overstory.ws_denied' in m and 'reason=no-credential-resolved' in m
        for m in messages
    ), f'expected a ws_denied no-credential-resolved line, got: {messages}'


# ---------------------------------------------------------------------------
# Unhandled-exception capture (item 4): traceback logged, stable error id
# returned to the client
# ---------------------------------------------------------------------------


def test_unhandled_exception_handler_returns_an_error_id_and_logs_traceback(
    overstory_caplog: pytest.LogCaptureFixture,
) -> None:
    from overstory.server import create_agent_web_app
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
        for r in overstory_caplog.records
        if getattr(r, 'event', None) == 'unhandled_exception'
    )
    assert record.error_id == error_id
    assert record.exc_info is not None
    assert record.error_type == 'RuntimeError'
