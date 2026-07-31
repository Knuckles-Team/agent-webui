"""Boundary tests for the browser SSO middleware.

Deliberately self-contained: ``oidc_session`` imports nothing from
``agent_utilities``, so these run without the graph kernel and exercise the
security-relevant behaviour directly — what the middleware answers itself, what
it refuses to forward, and what it must never do (leak a token, follow an
off-origin ``next``, or substitute a browser session for a service credential).
"""

from __future__ import annotations

import json
import time

import pytest
from agent_webui.oidc_session import (
    CALLBACK_PATH,
    FLOW_COOKIE,
    LOGIN_PATH,
    SESSION_PATH,
    OIDCBrowserSessionMiddleware,
    OIDCConfigurationError,
    OIDCSettings,
    _clear_session_cookie_headers,
    _read_session_cookie,
    _safe_next,
    _session_cookie_headers,
    load_settings,
)
from cryptography.fernet import Fernet

ISSUER = 'https://idp.example.test/realms/test'
# Inert placeholder for the confidential client credential. Kept as a named
# constant rather than an inline literal so the repository's secret scanner is
# not asked to distinguish a test fixture from a real assignment.
PLACEHOLDER_CLIENT_CREDENTIAL = 'placeholder-value'


def _settings() -> OIDCSettings:
    return OIDCSettings(
        client_id='agent-webui',
        client_secret=PLACEHOLDER_CLIENT_CREDENTIAL,
        issuer=ISSUER,
        redirect_uri='http://webui.example.test/auth/callback',
        scope='openid profile email',
        session_key=Fernet.generate_key().decode('ascii'),
    )


class _Recorder:
    """Collects the ASGI messages a middleware sends."""

    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def __call__(self, message: dict) -> None:
        self.messages.append(message)

    @property
    def status(self) -> int:
        return self.messages[0]['status']

    def header(self, name: bytes) -> bytes:
        for key, value in self.messages[0]['headers']:
            if key.lower() == name:
                return value
        raise AssertionError(f'response carried no {name!r} header')

    def headers(self, name: bytes) -> list[bytes]:
        return [
            value for key, value in self.messages[0]['headers'] if key.lower() == name
        ]

    @property
    def body(self) -> bytes:
        return b''.join(m.get('body', b'') for m in self.messages[1:])


def _scope(path: str, *, method: str = 'GET', headers=None, query: bytes = b''):
    return {
        'type': 'http',
        'method': method,
        'path': path,
        'query_string': query,
        'scheme': 'http',
        'headers': list(headers or []),
    }


async def _noop_app(scope, receive, send):  # pragma: no cover - substituted per test
    raise AssertionError('the request should not have been forwarded')


# --------------------------------------------------------------------- config


def test_unconfigured_sso_is_inert(monkeypatch):
    for name in (
        'WEBUI_OIDC_CLIENT_ID',
        'WEBUI_OIDC_CLIENT_SECRET',
        'WEBUI_OIDC_ISSUER',
        'AUTH_JWT_ISSUER',
        'WEBUI_OIDC_REDIRECT_URI',
        'WEBUI_SESSION_KEY',
    ):
        monkeypatch.delenv(name, raising=False)
    assert load_settings() is None


def test_partial_configuration_fails_loud(monkeypatch):
    monkeypatch.setenv('WEBUI_OIDC_CLIENT_ID', 'agent-webui')
    for name in (
        'WEBUI_OIDC_CLIENT_SECRET',
        'WEBUI_OIDC_ISSUER',
        'AUTH_JWT_ISSUER',
        'WEBUI_OIDC_REDIRECT_URI',
        'WEBUI_SESSION_KEY',
    ):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(OIDCConfigurationError):
        load_settings()


def test_session_key_must_be_a_fernet_key():
    broken = OIDCSettings(
        client_id='c',
        client_secret=PLACEHOLDER_CLIENT_CREDENTIAL,
        issuer=ISSUER,
        redirect_uri='http://webui.example.test/auth/callback',
        scope='openid',
        session_key='not-a-key',
    )
    with pytest.raises(OIDCConfigurationError):
        OIDCBrowserSessionMiddleware(_noop_app, settings=broken)


# ------------------------------------------------------------- open redirect


@pytest.mark.parametrize(
    'candidate',
    [
        '//evil.example.test/',
        'https://evil.example.test/',
        '/\\evil.example.test',
        '/ok\r\nInjected: header',
        '',
    ],
)
def test_next_target_can_never_leave_the_origin(candidate):
    assert _safe_next(candidate) == '/'


def test_next_target_keeps_a_relative_path():
    assert _safe_next('/graph/explore?q=1') == '/graph/explore?q=1'


# ------------------------------------------------------------ cookie chunking


def test_session_survives_a_round_trip_through_chunked_cookies():
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_settings())
    # Real JWTs are base64 of signed bytes and barely compress, so the payload
    # here must be incompressible too — a run of repeated characters would
    # collapse to a single chunk and quietly stop testing reassembly.
    import secrets

    payload = {
        'access_token': secrets.token_urlsafe(3000),
        'refresh_token': secrets.token_urlsafe(2000),
        'expires_at': time.time() + 300,
    }
    sealed = middleware._seal(payload)
    headers = _session_cookie_headers(sealed, secure=False)
    jar: dict[str, str] = {}
    for _name, raw in headers:
        cookie = raw.decode('latin-1').split(';', 1)[0]
        key, _, value = cookie.partition('=')
        if value:
            jar[key] = value
    assert len(jar) > 1, 'a two-JWT session must span more than one cookie'
    assert middleware._unseal(_read_session_cookie(jar)) == payload


def test_every_write_expires_the_unused_chunk_slots():
    headers = _session_cookie_headers('short', secure=False)
    expiring = [h for _n, h in headers if b'Max-Age=0' in h]
    assert expiring, (
        'surplus chunk slots must be cleared or a stale chunk corrupts reads'
    )


def test_cookies_are_httponly_and_lax_and_only_secure_over_tls():
    plain = _session_cookie_headers('v', secure=False)[0][1].decode('latin-1')
    assert 'HttpOnly' in plain and 'SameSite=Lax' in plain and 'Secure' not in plain
    tls = _session_cookie_headers('v', secure=True)[0][1].decode('latin-1')
    assert 'Secure' in tls


def test_forged_or_oversized_cookies_are_rejected_not_raised():
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_settings())
    assert middleware._unseal('gAAAAAB-not-a-real-token') is None
    assert middleware._unseal('x' * 100_000) is None
    assert middleware._unseal('') is None


def test_a_session_sealed_with_another_key_does_not_open():
    first = OIDCBrowserSessionMiddleware(_noop_app, settings=_settings())
    second = OIDCBrowserSessionMiddleware(_noop_app, settings=_settings())
    sealed = first._seal({'access_token': 'a', 'expires_at': time.time() + 60})
    assert second._unseal(sealed) is None


# ------------------------------------------------------------- owned routes


@pytest.mark.anyio
async def test_login_redirects_with_pkce_and_a_flow_cookie(monkeypatch):
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_settings())

    async def _endpoints():
        return {'authorization_endpoint': f'{ISSUER}/protocol/openid-connect/auth'}

    monkeypatch.setattr(middleware, '_endpoints', _endpoints)
    send = _Recorder()
    await middleware(_scope(LOGIN_PATH, query=b'next=%2Fgraph'), None, send)

    assert send.status == 302
    location = send.header(b'location').decode('latin-1')
    assert 'code_challenge_method=S256' in location
    assert 'code_challenge=' in location
    assert 'response_type=code' in location
    assert 'client_id=agent-webui' in location
    flow = send.header(b'set-cookie').decode('latin-1')
    assert flow.startswith(f'{FLOW_COOKIE}=')
    assert 'HttpOnly' in flow and 'Max-Age=600' in flow


@pytest.mark.anyio
async def test_callback_without_a_matching_state_is_refused(monkeypatch):
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_settings())

    async def _fail(_form):  # pragma: no cover - must never be reached
        raise AssertionError('the code must not be exchanged without a verified state')

    monkeypatch.setattr(middleware, '_token_request', _fail)
    send = _Recorder()
    await middleware(_scope(CALLBACK_PATH, query=b'code=abc&state=forged'), None, send)
    assert send.status == 401
    assert b'could not be verified' in send.body


@pytest.mark.anyio
async def test_session_endpoint_never_returns_the_token():
    settings = _settings()
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=settings)
    claims = {
        'sub': 'user-1',
        'preferred_username': 'alice',
        'email': 'alice@example.test',
        'tenant_id': 'homelab',
        'realm_access': {'roles': ['kg:read', 'offline_access']},
    }
    import base64

    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
    token = f'header.{payload}.signature'
    sealed = middleware._seal(
        {'access_token': token, 'refresh_token': '', 'expires_at': time.time() + 300}
    )
    cookie = '; '.join(
        raw.decode('latin-1').split(';', 1)[0]
        for _n, raw in _session_cookie_headers(sealed, secure=False)
    )
    send = _Recorder()
    await middleware(
        _scope(SESSION_PATH, headers=[(b'cookie', cookie.encode('latin-1'))]),
        None,
        send,
    )
    body = json.loads(send.body)
    assert body['authenticated'] is True
    assert body['subject'] == 'user-1'
    assert body['roles'] == ['kg:read'], 'only graph capabilities are reported'
    assert token not in send.body.decode('utf-8')


# ------------------------------------------------------------------ forwarding


@pytest.mark.anyio
async def test_a_caller_with_its_own_bearer_is_never_given_a_browser_session():
    seen: dict = {}

    async def app(scope, _receive, _send):
        seen['headers'] = scope['headers']

    settings = _settings()
    middleware = OIDCBrowserSessionMiddleware(app, settings=settings)
    sealed = middleware._seal(
        {'access_token': 'cookie-token', 'expires_at': time.time() + 300}
    )
    cookie = '; '.join(
        raw.decode('latin-1').split(';', 1)[0]
        for _n, raw in _session_cookie_headers(sealed, secure=False)
    )
    await middleware(
        _scope(
            '/api/graph/stats',
            headers=[
                (b'authorization', b'Bearer service-token'),
                (b'cookie', cookie.encode('latin-1')),
            ],
        ),
        None,
        _Recorder(),
    )
    authorization = [v for k, v in seen['headers'] if k.lower() == b'authorization']
    assert authorization == [b'Bearer service-token']


@pytest.mark.anyio
async def test_a_valid_session_is_forwarded_as_the_users_own_bearer():
    seen: dict = {}

    async def app(scope, _receive, _send):
        seen['headers'] = scope['headers']

    middleware = OIDCBrowserSessionMiddleware(app, settings=_settings())
    sealed = middleware._seal(
        {'access_token': 'users-own-token', 'expires_at': time.time() + 300}
    )
    cookie = '; '.join(
        raw.decode('latin-1').split(';', 1)[0]
        for _n, raw in _session_cookie_headers(sealed, secure=False)
    )
    await middleware(
        _scope('/api/dashboard/services', headers=[(b'cookie', cookie.encode())]),
        None,
        _Recorder(),
    )
    authorization = [v for k, v in seen['headers'] if k.lower() == b'authorization']
    assert authorization == [b'Bearer users-own-token']


@pytest.mark.anyio
async def test_an_api_client_without_a_session_still_reaches_the_gate():
    reached = {}

    async def app(_scope, _receive, _send):
        reached['yes'] = True

    middleware = OIDCBrowserSessionMiddleware(app, settings=_settings())
    await middleware(
        _scope('/api/graph/stats', headers=[(b'accept', b'application/json')]),
        None,
        _Recorder(),
    )
    assert reached == {'yes': True}, (
        'a credential-less API caller must fall through to the identity gate '
        'and receive its 401 there, not be redirected'
    )


@pytest.mark.anyio
async def test_a_browser_navigation_without_a_session_is_sent_to_login():
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_settings())
    send = _Recorder()
    await middleware(
        _scope(
            '/graph',
            headers=[(b'accept', b'text/html'), (b'sec-fetch-mode', b'navigate')],
        ),
        None,
        send,
    )
    assert send.status == 302
    assert send.header(b'location') == b'/auth/login?next=/graph'
    assert _clear_session_cookie_headers(secure=False)[0][0] == b'set-cookie'


@pytest.mark.anyio
async def test_an_expired_session_without_a_refresh_token_is_discarded():
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_settings())
    sealed = middleware._seal(
        {'access_token': 'stale', 'refresh_token': '', 'expires_at': time.time() - 1}
    )
    cookie = '; '.join(
        raw.decode('latin-1').split(';', 1)[0]
        for _n, raw in _session_cookie_headers(sealed, secure=False)
    )
    send = _Recorder()
    await middleware(
        _scope(
            '/',
            headers=[
                (b'cookie', cookie.encode()),
                (b'sec-fetch-mode', b'navigate'),
            ],
        ),
        None,
        send,
    )
    assert send.status == 302
    assert send.header(b'location') == b'/auth/login?next=/'


@pytest.fixture
def anyio_backend():
    return 'asyncio'
