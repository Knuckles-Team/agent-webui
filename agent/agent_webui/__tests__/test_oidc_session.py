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
from dataclasses import replace
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from agent_webui.oidc_session import (
    ATTENDED_ARM_COOKIE,
    ATTENDED_ARM_FINALIZE_PATH,
    ATTENDED_ARM_PATH,
    CALLBACK_PATH,
    FLOW_COOKIE,
    LOGIN_PATH,
    RECENT_AUTH_COOKIE,
    SESSION_COOKIE,
    SESSION_PATH,
    OIDCBrowserSessionMiddleware,
    OIDCConfigurationError,
    OIDCSettings,
    _browser_login_session_ref,
    _clear_session_cookie_headers,
    _read_session_cookie,
    _request_scheme_redirect_uri,
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


def _arm_settings() -> OIDCSettings:
    return replace(_settings(), attended_acr=('urn:example:acr:mfa',))


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


def _scope(
    path: str,
    *,
    method: str = 'GET',
    headers=None,
    query: bytes = b'',
    scheme: str = 'http',
):
    return {
        'type': 'http',
        'method': method,
        'path': path,
        'query_string': query,
        'scheme': scheme,
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
        'WEBUI_OIDC_ATTENDED_ACR_VALUES',
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
        'WEBUI_OIDC_ATTENDED_ACR_VALUES',
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
    assert _safe_next('/graph/explore?q=secret') == '/graph/explore'


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


def test_redirect_uri_scheme_matches_the_request_not_the_static_config():
    """D-WUI-31: a fixed-scheme WEBUI_OIDC_REDIRECT_URI broke login over
    https once the ingress also started serving TLS (D-WA-5) — the pre-login
    flow cookie became `Secure` (correctly) but Keycloak bounced back to the
    still-http configured callback, so the browser dropped the cookie and
    the callback's CSRF state check had nothing to compare against, failing
    every https login closed with "Sign-in could not be verified" even with
    a perfectly valid credential. Host and path must stay exactly as
    configured (never derived from a request-controlled Host header)."""
    configured = 'http://webui.example.test/auth/callback'
    assert (
        _request_scheme_redirect_uri(configured, _scope(LOGIN_PATH, scheme='http'))
        == configured
    )
    assert (
        _request_scheme_redirect_uri(configured, _scope(LOGIN_PATH, scheme='https'))
        == 'https://webui.example.test/auth/callback'
    )
    # X-Forwarded-Proto (the ingress' forwarded scheme) must also be honored —
    # the same signal _is_secure already trusts for the Secure cookie flag.
    forwarded = _scope(
        LOGIN_PATH, scheme='http', headers=[(b'x-forwarded-proto', b'https')]
    )
    assert (
        _request_scheme_redirect_uri(configured, forwarded)
        == 'https://webui.example.test/auth/callback'
    )


@pytest.mark.anyio
async def test_login_and_callback_use_the_requests_own_scheme_for_redirect_uri(
    monkeypatch,
):
    """End-to-end: /auth/login sent over https must advertise the https
    callback to the provider, and /auth/callback landing over https must
    exchange the code with that same https redirect_uri (OAuth2 requires
    the two to byte-match) — never the statically configured http one."""
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_settings())

    async def _endpoints():
        return {'authorization_endpoint': f'{ISSUER}/protocol/openid-connect/auth'}

    monkeypatch.setattr(middleware, '_endpoints', _endpoints)
    send = _Recorder()
    await middleware(
        _scope(LOGIN_PATH, query=b'next=%2Fgraph', scheme='https'), None, send
    )
    location = send.header(b'location').decode('latin-1')
    assert 'redirect_uri=https%3A%2F%2Fwebui.example.test%2Fauth%2Fcallback' in location

    seen_redirect_uri = {}

    async def _record_token_request(form):
        seen_redirect_uri['value'] = form['redirect_uri']
        return None  # short-circuits with 401, which this test doesn't care about

    monkeypatch.setattr(middleware, '_token_request', _record_token_request)
    flow = middleware._seal({'state': 's', 'verifier': 'v', 'nonce': 'n', 'next': '/'})
    callback_send = _Recorder()
    await middleware(
        _scope(
            CALLBACK_PATH,
            query=b'code=abc&state=s',
            scheme='https',
            headers=[(b'cookie', f'{FLOW_COOKIE}={flow}'.encode())],
        ),
        None,
        callback_send,
    )
    assert seen_redirect_uri['value'] == 'https://webui.example.test/auth/callback'


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
async def test_callback_with_a_provider_error_param_is_refused_before_any_exchange():
    """The IdP redirecting back with ``?error=...`` (e.g. the user denied
    consent) must be refused immediately, WITHOUT ever attempting a code/state
    check or a token exchange (WD10-C-MISC characterization, pre-refactor of
    _handle_callback)."""
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_settings())

    async def _fail(_form):  # pragma: no cover - must never be reached
        raise AssertionError('the code must not be exchanged after a provider error')

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(middleware, '_token_request', _fail)
    try:
        send = _Recorder()
        await middleware(
            _scope(CALLBACK_PATH, query=b'error=access_denied'), None, send
        )
        assert send.status == 401
        assert b'was not completed' in send.body
    finally:
        monkeypatch.undo()


@pytest.mark.anyio
async def test_callback_with_a_verified_state_and_real_tokens_sets_the_session_cookie():
    """The success path: a verified state + a token exchange that actually
    returns tokens must seal a session cookie and redirect to the flow's
    ``next`` target (WD10-C-MISC characterization, pre-refactor of
    _handle_callback -- every other existing callback test short-circuits with
    ``tokens is None``, so this is the only test exercising the full
    happy path end-to-end)."""
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_settings())

    async def _issue_tokens(_form):
        return {'access_token': 'AT', 'refresh_token': 'RT', 'expires_in': 300}

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(middleware, '_token_request', _issue_tokens)
    try:
        flow = middleware._seal(
            {'state': 's', 'verifier': 'v', 'nonce': 'n', 'next': '/graph'}
        )
        send = _Recorder()
        await middleware(
            _scope(
                CALLBACK_PATH,
                query=b'code=abc&state=s',
                headers=[(b'cookie', f'{FLOW_COOKIE}={flow}'.encode())],
            ),
            None,
            send,
        )
        assert send.status == 302
        assert send.header(b'location') == b'/graph'
        session_cookies = send.headers(b'set-cookie')
        assert any(
            cookie.decode('latin-1').startswith(f'{FLOW_COOKIE}=;')
            for cookie in session_cookies
        ), 'the flow cookie must be cleared on success'
        assert any(
            cookie.decode('latin-1').startswith(f'{SESSION_COOKIE}0=')
            for cookie in session_cookies
        ), 'a session cookie must be set on a successful callback'
    finally:
        monkeypatch.undo()


@pytest.mark.anyio
async def test_session_endpoint_never_returns_the_token():
    settings = _settings()
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=settings)
    claims = {
        'sub': 'user-1',
        'preferred_username': 'alice',
        'email': 'alice@example.test',
        'name': 'Alice Example',
        'picture': 'https://idp.example.test/avatars/alice.png',
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
    assert body['roles'] == ['kg:read'], 'only graph/webui capabilities are reported'
    assert body['webui_role'] == 'user', (
        'kg:read falls back to the WebUI user role (R9)'
    )
    assert body['name'] == 'Alice Example', (
        'the profile surface reads the name claim verbatim'
    )
    assert body['picture'] == 'https://idp.example.test/avatars/alice.png'
    assert token not in send.body.decode('utf-8')


@pytest.mark.anyio
async def test_session_endpoint_omits_name_and_picture_when_absent():
    """Neither claim is mandatory in OIDC -- absence must round-trip as null,
    not raise, so the profile surface can fall back cleanly."""

    settings = _settings()
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=settings)
    claims = {
        'sub': 'user-3',
        'preferred_username': 'bob',
        'realm_access': {'roles': ['kg:read']},
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
    assert body['name'] is None
    assert body['picture'] is None


@pytest.mark.anyio
async def test_session_endpoint_reports_an_explicit_webui_role():
    """An explicit `webui:*` realm role wins over the kg:* scope fallback."""

    settings = _settings()
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=settings)
    claims = {
        'sub': 'user-2',
        'realm_access': {'roles': ['kg:read', 'webui:maintainer']},
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
    assert sorted(body['roles']) == ['kg:read', 'webui:maintainer']
    assert body['webui_role'] == 'maintainer'


# ------------------------------------------------------------------ forwarding


@pytest.mark.anyio
async def test_a_caller_with_its_own_bearer_is_never_given_a_browser_session():
    seen: dict = {}

    async def app(scope, _receive, _send):
        seen['headers'] = scope['headers']
        seen['state'] = scope.get('state') or {}

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
    assert 'browser_login_session_ref' not in seen['state']


@pytest.mark.anyio
async def test_a_valid_session_is_forwarded_as_the_users_own_bearer():
    seen: dict = {}

    async def app(scope, _receive, _send):
        seen['headers'] = scope['headers']
        seen['state'] = scope.get('state') or {}

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
    login_ref = seen['state']['browser_login_session_ref']
    assert login_ref.startswith('login_')
    assert len(login_ref) == 70
    assert 'users-own-token' not in login_ref


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


@pytest.mark.anyio
async def test_an_expired_session_with_a_refresh_token_is_silently_renewed():
    """The refresh-token branch of __call__: an expired access token WITH a
    refresh token must transparently mint a new session (forwarded with the
    NEW access token, and a fresh session cookie set), not fall through to a
    login redirect (WD10-C-MISC characterization, pre-refactor of __call__ --
    no existing test drove this specific branch)."""
    seen: dict = {}

    async def app(scope, _receive, send):
        seen['headers'] = scope['headers']
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{}'})

    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_settings())
    middleware.app = app

    async def _refresh(form):
        assert form['grant_type'] == 'refresh_token'
        assert form['refresh_token'] == 'stale-refresh'
        return {
            'access_token': 'fresh-token',
            'refresh_token': 'new-refresh',
            'expires_in': 300,
        }

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(middleware, '_token_request', _refresh)
    try:
        sealed = middleware._seal(
            {
                'access_token': 'stale',
                'refresh_token': 'stale-refresh',
                'expires_at': time.time() - 1,
            }
        )
        cookie = '; '.join(
            raw.decode('latin-1').split(';', 1)[0]
            for _n, raw in _session_cookie_headers(sealed, secure=False)
        )
        send = _Recorder()
        await middleware(
            _scope('/api/graph/stats', headers=[(b'cookie', cookie.encode())]),
            None,
            send,
        )
        authorization = [v for k, v in seen['headers'] if k.lower() == b'authorization']
        assert authorization == [b'Bearer fresh-token'], (
            'the refreshed access token must be forwarded, not the stale one'
        )
        # _forward injects the refreshed session cookie into the response.
        set_cookie_names = {
            raw.decode('latin-1').split('=', 1)[0]
            for raw in send.headers(b'set-cookie')
        }
        assert any(name.startswith(SESSION_COOKIE) for name in set_cookie_names), (
            'a refreshed session cookie must be set on the forwarded response'
        )
    finally:
        monkeypatch.undo()


# ----------------------------------------------------- attended browser control


def _configure_arm_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    from agent_utilities.core.config import config

    monkeypatch.setattr(config, 'allowed_origins', 'https://webui.example.test')
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui')
    monkeypatch.setattr(config, 'auth_jwt_jwks_uri', 'https://idp.example.test/jwks')


def _arm_headers(middleware: OIDCBrowserSessionMiddleware, token: str) -> list:
    sealed = middleware._seal(
        {
            'access_token': token,
            'refresh_token': '',
            'expires_at': time.time() + 600,
        }
    )
    cookie = '; '.join(
        raw.decode('latin-1').split(';', 1)[0]
        for _name, raw in _session_cookie_headers(sealed, secure=True)
    )
    return [
        (b'host', b'webui.example.test'),
        (b'origin', b'https://webui.example.test'),
        (b'cookie', cookie.encode('latin-1')),
    ]


def _arm_body() -> dict:
    return {
        'route_id': 'knowledge.graph',
        'next': '/graph?private=discarded',
    }


def _finalize_body() -> dict:
    return {
        'route_id': 'knowledge.graph',
        'registration_generation': 7,
        'catalog_digest': f'sha256:{"b" * 64}',
        'tools': [
            {
                'tool_id': 'webui.page.context',
                'schema_digest': f'sha256:{"a" * 64}',
            }
        ],
    }


def _json_receiver(document: dict):
    async def receive():
        return {
            'type': 'http.request',
            'body': json.dumps(document).encode('utf-8'),
            'more_body': False,
        }

    return receive


@pytest.mark.anyio
async def test_attended_arm_is_unavailable_without_configured_accepted_acr(
    monkeypatch,
):
    _configure_arm_origin(monkeypatch)
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_settings())
    send = _Recorder()
    await middleware(
        _scope(
            ATTENDED_ARM_PATH,
            method='POST',
            scheme='https',
            headers=_arm_headers(middleware, 'existing-token'),
        ),
        _json_receiver(_arm_body()),
        send,
    )
    assert send.status == 503


@pytest.mark.anyio
async def test_attended_arm_forces_interactive_exact_acr_step_up(monkeypatch):
    _configure_arm_origin(monkeypatch)
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_arm_settings())

    async def endpoints():
        return {'authorization_endpoint': f'{ISSUER}/protocol/openid-connect/auth'}

    async def verified(_token, *, audience):
        assert audience == 'agent-webui'
        return {
            'sub': 'user-1',
            'tenant_id': 'homelab',
            'exp': time.time() + 600,
        }

    monkeypatch.setattr(middleware, '_endpoints', endpoints)
    monkeypatch.setattr(middleware, '_verified_jwt_claims', verified)
    send = _Recorder()
    await middleware(
        _scope(
            ATTENDED_ARM_PATH,
            method='POST',
            scheme='https',
            headers=_arm_headers(middleware, 'existing-token'),
        ),
        _json_receiver(_arm_body()),
        send,
    )

    assert send.status == 200
    query = parse_qs(urlsplit(json.loads(send.body)['authorization_url']).query)
    assert query['prompt'] == ['login']
    assert query['max_age'] == ['0']
    assert query['acr_values'] == ['urn:example:acr:mfa']
    assert query['code_challenge_method'] == ['S256']
    flow_cookie = next(
        item.decode('latin-1')
        for item in send.headers(b'set-cookie')
        if item.decode('latin-1').startswith(f'{FLOW_COOKIE}=')
    )
    assert 'HttpOnly' in flow_cookie and 'Secure' in flow_cookie
    opened_flow = middleware._unseal(flow_cookie.split(';', 1)[0].split('=', 1)[1])
    assert opened_flow is not None
    assert opened_flow['next'] == '/graph'
    assert 'registration_generation' not in opened_flow
    assert 'catalog_digest' not in opened_flow


@pytest.mark.anyio
async def test_attended_arm_rejects_nonfinite_current_token_expiry(monkeypatch):
    _configure_arm_origin(monkeypatch)
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_arm_settings())

    async def verified(_token, *, audience):
        assert audience == 'agent-webui'
        return {'sub': 'user-1', 'tenant_id': 'homelab', 'exp': float('inf')}

    monkeypatch.setattr(middleware, '_verified_jwt_claims', verified)
    send = _Recorder()
    await middleware(
        _scope(
            ATTENDED_ARM_PATH,
            method='POST',
            scheme='https',
            headers=_arm_headers(middleware, 'existing-token'),
        ),
        _json_receiver(_arm_body()),
        send,
    )

    assert send.status == 401


def test_session_token_lifetime_rejects_nonfinite_provider_value() -> None:
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_arm_settings())
    before = time.time()
    session = middleware._session_from_tokens(
        {'access_token': 'access', 'expires_in': float('inf')}
    )

    assert before + 299 <= session['expires_at'] <= time.time() + 301


def _attended_flow(now: float) -> dict:
    return {
        'kind': 'browser_control_attended_arm_v1',
        'state': 'state-1',
        'verifier': 'verifier-1',
        'nonce': 'nonce-1',
        'started_at': now,
        'origin': 'https://webui.example.test',
        'subject': 'user-1',
        'tenant': 'homelab',
        'document_ref': f'document_{"d" * 64}',
        **_arm_body(),
    }


async def _attended_callback(
    middleware: OIDCBrowserSessionMiddleware, flow: dict
) -> _Recorder:
    send = _Recorder()
    sealed_flow = middleware._seal(flow)
    await middleware(
        _scope(
            CALLBACK_PATH,
            scheme='https',
            query=b'code=code-1&state=state-1',
            headers=[
                (b'host', b'webui.example.test'),
                (b'cookie', f'{FLOW_COOKIE}={sealed_flow}'.encode()),
            ],
        ),
        None,
        send,
    )
    return send


@pytest.mark.anyio
@pytest.mark.parametrize(
    'bad_evidence', ['acr', 'auth_time', 'nonfinite_auth_time', 'nonfinite_exp']
)
async def test_attended_callback_rejects_invalid_stepup_evidence(
    monkeypatch, bad_evidence
):
    _configure_arm_origin(monkeypatch)
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_arm_settings())
    now = time.time()

    async def tokens(_form):
        return {
            'access_token': 'new-access',
            'id_token': 'new-id',
            'expires_in': 600,
        }

    async def verified(token, *, audience):
        if token == 'new-access':
            return {
                'sub': 'user-1',
                'tenant_id': 'homelab',
                'exp': float('inf') if bad_evidence == 'nonfinite_exp' else now + 600,
            }
        assert audience == 'agent-webui'
        return {
            'sub': 'user-1',
            'nonce': 'nonce-1',
            'acr': 'urn:example:acr:weak'
            if bad_evidence == 'acr'
            else 'urn:example:acr:mfa',
            'auth_time': (
                float('nan')
                if bad_evidence == 'nonfinite_auth_time'
                else now - 600
                if bad_evidence == 'auth_time'
                else now
            ),
            'exp': now + 600,
        }

    monkeypatch.setattr(middleware, '_token_request', tokens)
    monkeypatch.setattr(middleware, '_verified_jwt_claims', verified)
    send = await _attended_callback(middleware, _attended_flow(now))
    assert send.status == 401
    assert not any(
        item.decode('latin-1').startswith(f'{RECENT_AUTH_COOKIE}=g')
        for item in send.headers(b'set-cookie')
    )


@pytest.mark.anyio
async def test_attended_callback_binds_recent_auth_to_new_login_and_token_expiry(
    monkeypatch,
):
    _configure_arm_origin(monkeypatch)
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_arm_settings())
    now = time.time()

    async def tokens(_form):
        return {
            'access_token': 'new-access',
            'id_token': 'new-id',
            'refresh_token': 'new-refresh',
            'expires_in': 600,
        }

    async def verified(token, *, audience):
        if token == 'new-access':
            return {
                'sub': 'user-1',
                'tenant_id': 'homelab',
                'exp': now + 240,
            }
        assert audience == 'agent-webui'
        return {
            'sub': 'user-1',
            'nonce': 'nonce-1',
            'acr': 'urn:example:acr:mfa',
            'auth_time': now,
            'exp': now + 600,
        }

    monkeypatch.setattr(middleware, '_token_request', tokens)
    monkeypatch.setattr(middleware, '_verified_jwt_claims', verified)
    send = await _attended_callback(middleware, _attended_flow(now))

    assert send.status == 302
    grant_cookie = next(
        item.decode('latin-1')
        for item in send.headers(b'set-cookie')
        if item.decode('latin-1').startswith(f'{RECENT_AUTH_COOKIE}=')
    )
    opened = middleware._unseal(grant_cookie.split(';', 1)[0].split('=', 1)[1])
    assert opened is not None
    assert opened['kind'] == 'browser_control_recent_auth_v1'
    assert opened['route_id'] == _arm_body()['route_id']
    assert 'catalog_digest' not in opened
    assert 'registration_generation' not in opened
    assert opened['expires_at'] <= opened['access_token_expires_at'] == now + 240
    assert opened['login_session_ref'].startswith('login_')


@pytest.mark.anyio
async def test_refreshed_session_never_reuses_an_attended_arm_receipt(monkeypatch):
    _configure_arm_origin(monkeypatch)
    captured: dict = {}
    sent: list[dict] = []

    async def app(scope, _receive, send):
        captured.update(scope.get('state') or {})
        await send({'type': 'websocket.accept'})

    async def record(message):
        sent.append(message)

    middleware = OIDCBrowserSessionMiddleware(app, settings=_arm_settings())
    stale = middleware._seal(
        {
            'access_token': 'stale-access',
            'refresh_token': 'refresh',
            'expires_at': time.time() - 1,
        }
    )
    receipt = middleware._seal(
        {'kind': 'browser_control_attended_arm_v1', 'login_session_ref': 'login_stale'}
    )

    async def refresh(_form):
        return {
            'access_token': 'fresh-access',
            'refresh_token': 'fresh-refresh',
            'expires_in': 600,
        }

    monkeypatch.setattr(middleware, '_token_request', refresh)
    scope = {
        'type': 'websocket',
        'path': '/ws/browser-control',
        'scheme': 'wss',
        'headers': [
            (b'host', b'webui.example.test'),
            (b'origin', b'https://webui.example.test'),
            (
                b'cookie',
                f'au_session0={stale}; {ATTENDED_ARM_COOKIE}={receipt}'.encode(),
            ),
        ],
    }
    await middleware(scope, None, record)
    assert captured['browser_login_session_ref'].startswith('login_')
    assert 'browser_attended_arm_ref' not in captured
    assert any(
        name == b'set-cookie' and value.startswith(b'au_session0=')
        for name, value in sent[0]['headers']
    )


@pytest.mark.anyio
async def test_service_bearer_cannot_request_an_attended_browser_arm(monkeypatch):
    _configure_arm_origin(monkeypatch)
    middleware = OIDCBrowserSessionMiddleware(_noop_app, settings=_arm_settings())
    send = _Recorder()
    await middleware(
        _scope(
            ATTENDED_ARM_PATH,
            method='POST',
            scheme='https',
            headers=[
                (b'host', b'webui.example.test'),
                (b'origin', b'https://webui.example.test'),
                (b'authorization', b'Bearer service-token'),
            ],
        ),
        _json_receiver(_arm_body()),
        send,
    )
    assert send.status == 403


@pytest.mark.anyio
@pytest.mark.parametrize(
    ('request_origin', 'expiry_delta', 'receipt_forwarded'),
    [
        ('https://webui.example.test', 240, True),
        ('https://other.example.test', 240, False),
        ('https://webui.example.test', -1, False),
    ],
)
async def test_attended_receipt_is_forwarded_only_for_its_exact_request_origin(
    monkeypatch, request_origin, expiry_delta, receipt_forwarded
):
    _configure_arm_origin(monkeypatch)
    captured: dict = {}
    sent: list[dict] = []

    async def app(scope, _receive, send):
        captured.update(scope.get('state') or {})
        await send({'type': 'websocket.accept'})

    async def send(message):
        sent.append(message)

    middleware = OIDCBrowserSessionMiddleware(app, settings=_arm_settings())
    now = time.time()
    token = 'verified-access'
    session = middleware._seal(
        {
            'access_token': token,
            'refresh_token': '',
            'expires_at': now + 600,
        }
    )
    receipt = middleware._seal(
        {
            'kind': 'browser_control_attended_arm_v1',
            'attended_arm_ref': f'attended_{"a" * 64}',
            'login_session_ref': _browser_login_session_ref(middleware.settings, token),
            'subject': 'user-1',
            'tenant': 'homelab',
            'origin': 'https://webui.example.test',
            'document_ref': f'document_{"d" * 64}',
            'route_id': 'knowledge.graph',
            'registration_generation': 7,
            'catalog_digest': f'sha256:{"b" * 64}',
            'tool_scope_digest': f'sha256:{"c" * 64}',
            'issued_at': now,
            'expires_at': now + expiry_delta,
            'access_token_expires_at': now + 300,
            'auth_time': now - 1,
            'acr': 'urn:example:acr:mfa',
            'issuer': ISSUER,
        }
    )
    await middleware(
        {
            'type': 'websocket',
            'path': '/ws/browser-control',
            'scheme': 'wss',
            'headers': [
                (b'host', b'webui.example.test'),
                (b'origin', request_origin.encode()),
                (
                    b'cookie',
                    f'au_session0={session}; {ATTENDED_ARM_COOKIE}={receipt}'.encode(),
                ),
            ],
        },
        None,
        send,
    )
    assert ('browser_attended_arm_ref' in captured) is receipt_forwarded
    response_headers = sent[0].get('headers') or []
    rotated = [
        value.decode()
        for name, value in response_headers
        if name == b'set-cookie'
        and value.startswith(f'{ATTENDED_ARM_COOKIE}=g'.encode())
    ]
    assert bool(rotated) is receipt_forwarded
    if receipt_forwarded:
        rotated_value = rotated[0].split(';', 1)[0].split('=', 1)[1]
        revoke_receipt = middleware._unseal(rotated_value)
        assert revoke_receipt['kind'] == 'browser_control_attended_revoke_v1'
        revoke_scope = _scope(
            ATTENDED_ARM_PATH,
            method='DELETE',
            scheme='https',
            headers=[
                (b'host', b'webui.example.test'),
                (b'origin', b'https://webui.example.test'),
                (b'cookie', f'{ATTENDED_ARM_COOKIE}={rotated_value}'.encode()),
            ],
        )
        assert middleware._attended_receipt(revoke_scope, token=token) is None
        assert (
            middleware._attended_receipt(
                revoke_scope, token=token, allow_revoke_only=True
            )
            is not None
        )
        seen: dict = {}

        async def introspect(_credential, **claims):
            seen.update(claims)
            return True

        monkeypatch.setattr(middleware, '_introspect_access_token', introspect)
        assert await captured['browser_session_revalidator']() is True
        assert seen['subject'] == 'user-1'
        assert seen['tenant'] == 'homelab'


@pytest.mark.anyio
async def test_finalize_consumes_recent_auth_once_and_mints_exact_arm(monkeypatch):
    from agent_utilities.security import request_identity
    from agent_utilities.security.actor_identity import ActorType
    from agent_utilities.security.brain_context import ActorContext

    _configure_arm_origin(monkeypatch)
    consumed: set[str] = set()
    finalized: list = []
    revoked: list = []

    class Port:
        authority = 'graph-os'
        supports_durable_fences = True
        supports_durable_audit = True
        supports_attended_leases = True
        supports_live_revalidation = True
        supports_backchannel_revalidation = True
        supports_catalog_verification = True

        async def open_channel(self, _binding, _send):
            raise AssertionError('finalize must not open a channel')

        async def finalize_attended_arm(self, grant, binding):
            if grant.grant_ref in consumed:
                raise PermissionError('recent authentication already consumed')
            consumed.add(grant.grant_ref)
            finalized.append((grant, binding))
            return SimpleNamespace(
                status='active',
                attended_arm_ref=binding.attended_arm_ref,
                attended_arm_expires_at=binding.attended_arm_expires_at,
                catalog_digest=binding.catalog_digest,
                tool_scope_digest=binding.tool_scope_digest,
            )

        async def revoke_attended_arm(self, binding):
            revoked.append(binding)
            return SimpleNamespace(
                status='revoked',
                attended_arm_ref=binding.attended_arm_ref,
                attended_arm_expires_at=binding.attended_arm_expires_at,
                catalog_digest=binding.catalog_digest,
                tool_scope_digest=binding.tool_scope_digest,
            )

    actor = ActorContext(
        actor_id='user-1',
        actor_type=ActorType.HUMAN,
        tenant_id='homelab',
        roles=('kg:write',),
        authenticated=True,
        credential_expires_at=int(time.time() + 600),
    )

    async def verified_actor(_token):
        return actor

    monkeypatch.setattr(request_identity, 'actor_from_bearer_token', verified_actor)
    middleware = OIDCBrowserSessionMiddleware(
        _noop_app,
        settings=_arm_settings(),
        browser_control=Port(),
        mint_graph_session=lambda verified: SimpleNamespace(
            actor=verified, tenant=verified.tenant_id, policy_version='1'
        ),
    )
    now = time.time()
    signed_access_fixture = 'stepped-up-access'
    session = middleware._seal(
        {
            'access_token': signed_access_fixture,
            'refresh_token': '',
            'expires_at': now + 600,
        }
    )
    grant_payload = {
        'kind': 'browser_control_recent_auth_v1',
        'grant_ref': f'attended_{"e" * 64}',
        'login_session_ref': _browser_login_session_ref(
            middleware.settings, signed_access_fixture
        ),
        'subject': 'user-1',
        'tenant': 'homelab',
        'origin': 'https://webui.example.test',
        'route_id': 'knowledge.graph',
        'issued_at': now,
        'expires_at': now + 60,
        'access_token_expires_at': now + 600,
        'auth_time': now - 1,
        'acr': 'urn:example:acr:mfa',
        'issuer': ISSUER,
    }
    grant = middleware._seal(grant_payload)
    cookies = f'au_session0={session}; {RECENT_AUTH_COOKIE}={grant}'

    async def finalize_once(body: dict | None = None) -> _Recorder:
        send = _Recorder()
        await middleware(
            _scope(
                ATTENDED_ARM_FINALIZE_PATH,
                method='POST',
                scheme='https',
                headers=[
                    (b'host', b'webui.example.test'),
                    (b'origin', b'https://webui.example.test'),
                    (b'cookie', cookies.encode()),
                ],
            ),
            _json_receiver(body or _finalize_body()),
            send,
        )
        return send

    mismatch = await finalize_once({**_finalize_body(), 'route_id': 'other.route'})
    assert mismatch.status == 403
    assert not finalized

    first = await finalize_once()
    assert first.status == 200
    assert json.loads(first.body)['status'] == 'armed'
    assert len(finalized) == 1
    assert finalized[0][0].grant_issued_at == grant_payload['issued_at']
    assert finalized[0][1].registration_generation == 7
    assert any(
        item.decode().startswith(f'{ATTENDED_ARM_COOKIE}=g')
        for item in first.headers(b'set-cookie')
    )
    arm_cookie = next(
        item.decode().split(';', 1)[0].split('=', 1)[1]
        for item in first.headers(b'set-cookie')
        if item.decode().startswith(f'{ATTENDED_ARM_COOKIE}=g')
    )
    arm_payload = middleware._unseal(arm_cookie)
    assert arm_payload is not None
    arm_cookie = middleware._seal(
        {**arm_payload, 'kind': 'browser_control_attended_revoke_v1'}
    )
    revoke_send = _Recorder()
    await middleware(
        _scope(
            ATTENDED_ARM_PATH,
            method='DELETE',
            scheme='https',
            headers=[
                (b'host', b'webui.example.test'),
                (b'origin', b'https://webui.example.test'),
                (
                    b'cookie',
                    f'au_session0={session}; {ATTENDED_ARM_COOKIE}={arm_cookie}'.encode(),
                ),
            ],
        ),
        None,
        revoke_send,
    )
    assert revoke_send.status == 204
    assert len(revoked) == 1
    assert revoked[0].attended_arm_ref == grant_payload['grant_ref']

    async def failed_revoke(_binding):
        raise RuntimeError('durable authority unavailable')

    successful_revoke = middleware.browser_control.revoke_attended_arm
    middleware.browser_control.revoke_attended_arm = failed_revoke
    failed_revoke_send = _Recorder()
    await middleware(
        _scope(
            ATTENDED_ARM_PATH,
            method='DELETE',
            scheme='https',
            headers=[
                (b'host', b'webui.example.test'),
                (b'origin', b'https://webui.example.test'),
                (
                    b'cookie',
                    f'au_session0={session}; {ATTENDED_ARM_COOKIE}={arm_cookie}'.encode(),
                ),
            ],
        ),
        None,
        failed_revoke_send,
    )
    assert failed_revoke_send.status == 503
    assert not any(
        value.startswith(f'{ATTENDED_ARM_COOKIE}='.encode())
        for value in failed_revoke_send.headers(b'set-cookie')
    )
    assert any(
        value.startswith(f'{RECENT_AUTH_COOKIE}=;'.encode()) and b'Max-Age=0' in value
        for value in failed_revoke_send.headers(b'set-cookie')
    )
    middleware.browser_control.revoke_attended_arm = successful_revoke
    retry_send = _Recorder()
    await middleware(
        _scope(
            ATTENDED_ARM_PATH,
            method='DELETE',
            scheme='https',
            headers=[
                (b'host', b'webui.example.test'),
                (b'origin', b'https://webui.example.test'),
                (
                    b'cookie',
                    f'au_session0={session}; {ATTENDED_ARM_COOKIE}={arm_cookie}'.encode(),
                ),
            ],
        ),
        None,
        retry_send,
    )
    assert retry_send.status == 204
    assert len(revoked) == 2
    second = await finalize_once()
    assert second.status == 403
    assert len(finalized) == 1
    expired = middleware._seal(
        {**grant_payload, 'issued_at': now - 120, 'expires_at': now - 60}
    )
    cookies = f'au_session0={session}; {RECENT_AUTH_COOKIE}={expired}'
    stale = await finalize_once()
    assert stale.status == 403
    assert len(finalized) == 1
    future = middleware._seal(
        {**grant_payload, 'issued_at': now + 10, 'expires_at': now + 60}
    )
    cookies = f'au_session0={session}; {RECENT_AUTH_COOKIE}={future}'
    premature = await finalize_once()
    assert premature.status == 403
    assert len(finalized) == 1


@pytest.fixture
def anyio_backend():
    return 'asyncio'
