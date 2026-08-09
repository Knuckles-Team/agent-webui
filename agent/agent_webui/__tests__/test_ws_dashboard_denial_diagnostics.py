"""W-18: prove which branch rejects a `/ws/dashboard` handshake, with evidence.

`reports/webui-graphos-defects-2026-08-08.md` row W-18 records that uvicorn's
websocket protocol implementation logs **every** pre-accept
``websocket.close`` identically as ``"WebSocket /ws/dashboard" 403`` — the
ASGI ``code`` field (4400/4401/4403) is never consulted for that log line —
so origin, credential, scope, and role denials were indistinguishable from
the access log alone, and the leading hypothesis ("a websocket handshake
never resolves a session because the session middleware only populates
``scope['state']`` for HTTP") was unproven.

These tests drive the **real** middleware chain
(``OIDCBrowserSessionMiddleware`` -> ``WebUIActorIdentityMiddleware`` ->
``WebUIAuthorizationMiddleware``) exactly as ``server.py`` composes it, with
no mocking of the seam under test, and assert on the new
``agent_webui.ws_denied reason=...`` log line added to disambiguate the
branches. Findings pinned here:

* A websocket scope IS able to resolve a session: `OIDCBrowserSessionMiddleware`
  reads the session cookie directly from ``scope['headers']`` (websocket
  handshakes carry headers, including ``Cookie``) for BOTH ``'http'`` and
  ``'websocket'`` scope types, and forwards a derived
  ``Authorization: Bearer <token>`` header on a copy of the scope;
  `WebUIActorIdentityMiddleware`'s websocket leg reads that header directly
  from ``scope['headers']`` too — neither leg ever reads ``scope['state']``.
  See ``test_full_chain_admits_a_valid_kg_admin_browser_websocket_session``.
* So the specific "``scope['state']`` is HTTP-only" mechanism does NOT apply
  to this codebase — that hypothesis is disproven for this pipeline.
* What genuinely reproduces the customer-visible 403 with everything else
  correct (role granted, origin allowlisted) is the **absence of a usable
  session cookie on the websocket handshake** — no cookie at all, or one that
  fails to seal/refresh. See
  ``test_full_chain_denies_and_logs_no_credential_resolved_without_a_cookie``.
* A *resolved* session with an insufficient scope also 403s, distinctly
  logged as ``scope-missing`` (not the same branch as the missing-credential
  case above) — the literal "403 for a websocket with a valid session" case.
  See ``test_authorization_denies_and_logs_scope_missing_for_a_resolved_session``.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import pytest
from agent_webui.oidc_session import (
    OIDCBrowserSessionMiddleware,
    OIDCSettings,
    _session_cookie_headers,
)
from agent_webui.server import (
    WebUIAuthorizationMiddleware,
    _ensure_actor_identity_middleware,
)
from cryptography.fernet import Fernet

LOGGER_NAME = 'agent_webui.server'
# Inert placeholders, not real credentials -- named constants (rather than
# inline literals) so the repository's secret scanner does not have to
# distinguish a test fixture from a real assignment (mirrors
# test_oidc_session.py's PLACEHOLDER_CLIENT_CREDENTIAL convention).
PLACEHOLDER_CLIENT_CREDENTIAL = 'placeholder-value'
PLACEHOLDER_ACCESS_CREDENTIAL = 'placeholder-users-own-credential'


class _AppStub:
    """The minimum ``add_middleware`` surface the installer touches."""

    def __init__(self) -> None:
        self.user_middleware: list[Any] = []
        self.installed: Any = None

    def add_middleware(self, cls: Any, **_kwargs: Any) -> None:
        self.installed = cls


class _Recorder:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def __call__(self, message: dict) -> None:
        self.messages.append(message)

    @property
    def close_codes(self) -> list[int]:
        return [m['code'] for m in self.messages if m['type'] == 'websocket.close']

    @property
    def accepted(self) -> bool:
        return any(m['type'] == 'websocket.accept' for m in self.messages)


def _oidc_settings() -> OIDCSettings:
    return OIDCSettings(
        client_id='agent-webui',
        client_secret=PLACEHOLDER_CLIENT_CREDENTIAL,
        issuer='https://idp.example.test/realms/test',
        redirect_uri='https://au.arpa/auth/callback',
        scope='openid profile email',
        session_key=Fernet.generate_key().decode('ascii'),
    )


def _ws_scope(*, headers: list[tuple[bytes, bytes]]) -> dict:
    return {
        'type': 'websocket',
        'path': '/ws/dashboard',
        'method': '',
        'scheme': 'wss',
        'headers': headers,
    }


async def _ws_receive() -> dict:
    return {'type': 'websocket.connect'}


def _build_chain(inner: Any, *, minter: Any) -> Any:
    """Compose the same three middlewares server.py installs, in the same
    execution order (BrowserSSO runs first, then ActorIdentity, then
    Authorization) — see server.py's ``add_middleware`` ordering comment."""

    authz = WebUIAuthorizationMiddleware(inner)

    app_stub = _AppStub()
    _ensure_actor_identity_middleware(app_stub, mint_graph_session=minter)
    actor_identity = app_stub.installed(authz)

    return OIDCBrowserSessionMiddleware(actor_identity, settings=_oidc_settings())


def _sealed_cookie(
    oidc_mw: OIDCBrowserSessionMiddleware, *, access_token: str, expires_in: float = 300
) -> bytes:
    sealed = oidc_mw._seal(
        {'access_token': access_token, 'expires_at': time.time() + expires_in}
    )
    cookie = '; '.join(
        raw.decode('latin-1').split(';', 1)[0]
        for _name, raw in _session_cookie_headers(sealed, secure=True)
    )
    return cookie.encode('latin-1')


@pytest.fixture(autouse=True)
def _configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mint-time + identity-enforcement config every scenario needs."""

    from agent_utilities.core.config import config

    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    monkeypatch.setattr(
        config,
        'auth_jwt_issuer',
        'https://idp.example.test/realms/test',
        raising=False,
    )
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui', raising=False)
    monkeypatch.setattr(config, 'kg_policy_version', '1', raising=False)
    monkeypatch.setattr(config, 'allowed_origins', 'https://au.arpa', raising=False)


def _fake_actor(monkeypatch: pytest.MonkeyPatch, *, roles: frozenset[str]) -> None:
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


def test_full_chain_admits_a_valid_kg_admin_browser_websocket_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Disproves the "websocket never resolves a session" hypothesis: a
    real session cookie, forwarded through the real BrowserSSO ->
    ActorIdentity -> Authorization chain, DOES reach the inner app for the
    admin-only `/ws/dashboard` route when the caller holds `kg:admin`."""

    from agent_webui.graph_identity import mint_frontend_graph_session

    _fake_actor(monkeypatch, roles=frozenset({'kg:admin'}))

    reached: list[str] = []

    async def inner(scope: dict, _receive: Any, send: Any) -> None:
        reached.append(scope['type'])
        await send({'type': 'websocket.accept'})

    chain = _build_chain(inner, minter=mint_frontend_graph_session)
    cookie = _sealed_cookie(chain, access_token=PLACEHOLDER_ACCESS_CREDENTIAL)

    scope = _ws_scope(
        headers=[
            (b'cookie', cookie),
            (b'origin', b'https://au.arpa'),
            (b'host', b'au.arpa'),
        ]
    )
    send = _Recorder()
    asyncio.run(chain(scope, _ws_receive, send))

    assert reached == ['websocket']
    assert send.accepted
    assert send.close_codes == []


def test_full_chain_denies_and_logs_no_credential_resolved_without_a_cookie(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The reproduction of the live symptom: role granted (kg:admin), origin
    allowlisted, but no usable session cookie arrives on the websocket
    handshake (e.g. cookie delivery/refresh failed) — the actor-identity
    middleware closes 4401 before Authorization is ever reached, and BOTH
    render as a bare "403 Forbidden" in uvicorn's access log. The new log
    line is what makes this branch identifiable."""

    from agent_webui.graph_identity import mint_frontend_graph_session

    _fake_actor(monkeypatch, roles=frozenset({'kg:admin'}))

    async def inner_never_called(_scope: dict, _receive: Any, _send: Any) -> None:
        raise AssertionError('the inner app must not be reached with no credential')

    chain = _build_chain(inner_never_called, minter=mint_frontend_graph_session)

    # No `cookie` header at all -- OIDCBrowserSessionMiddleware forwards the
    # scope unmodified, so ActorIdentityMiddleware sees no bearer credential.
    scope = _ws_scope(headers=[(b'origin', b'https://au.arpa'), (b'host', b'au.arpa')])
    send = _Recorder()

    with caplog.at_level(logging.WARNING, logger=LOGGER_NAME):
        asyncio.run(chain(scope, _ws_receive, send))

    assert send.close_codes == [4401]
    assert not send.accepted
    denial_lines = [
        r.getMessage() for r in caplog.records if 'ws_denied' in r.getMessage()
    ]
    assert len(denial_lines) == 1
    assert 'reason=no-credential-resolved' in denial_lines[0]
    assert 'path=/ws/dashboard' in denial_lines[0]


def test_authorization_denies_and_logs_scope_missing_for_a_resolved_session(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The literal "403 for a websocket WITH a valid session" case: identity
    resolves fine (a real, unexpired, verified session is bound) but its
    scope (`kg:write`) does not satisfy the admin route's `kg:admin`
    requirement. Distinctly logged as `scope-missing`, never confusable with
    `no-credential-resolved` above even though uvicorn logs both as 403."""

    from agent_utilities.knowledge_graph.core.session import GraphSession, use_session
    from agent_utilities.security.brain_context import ActorContext

    actor = ActorContext(
        actor_id='subject-1',
        tenant_id='homelab',
        roles=frozenset({'kg:write'}),
        authenticated=True,
    )
    session = GraphSession(
        actor=actor, tenant='homelab', scopes=frozenset({'kg:write', 'kg:read'})
    )

    async def inner_never_called(_scope: dict, _receive: Any, _send: Any) -> None:
        raise AssertionError('a kg:write-only session must never reach /ws/dashboard')

    middleware = WebUIAuthorizationMiddleware(inner_never_called)
    scope = _ws_scope(headers=[(b'origin', b'https://au.arpa'), (b'host', b'au.arpa')])
    send = _Recorder()

    with caplog.at_level(logging.WARNING, logger=LOGGER_NAME), use_session(session):
        asyncio.run(middleware(scope, _ws_receive, send))

    assert send.close_codes == [4403]
    denial_lines = [
        r.getMessage() for r in caplog.records if 'ws_denied' in r.getMessage()
    ]
    assert len(denial_lines) == 1
    assert 'reason=scope-missing' in denial_lines[0]
    assert 'required=kg:admin' in denial_lines[0]
    assert 'session_resolved=True' in denial_lines[0]


def test_authorization_denies_and_logs_origin_rejected(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A cross-origin websocket handshake is refused before any session/scope
    check runs, and is now distinctly logged as `origin-rejected`."""

    async def inner_never_called(_scope: dict, _receive: Any, _send: Any) -> None:
        raise AssertionError('a foreign-origin handshake must never reach the app')

    middleware = WebUIAuthorizationMiddleware(inner_never_called)
    scope = _ws_scope(
        headers=[
            (b'origin', b'https://evil.example'),
            (b'host', b'au.arpa'),
        ]
    )
    send = _Recorder()

    with caplog.at_level(logging.WARNING, logger=LOGGER_NAME):
        asyncio.run(middleware(scope, _ws_receive, send))

    assert send.close_codes == [4403]
    denial_lines = [
        r.getMessage() for r in caplog.records if 'ws_denied' in r.getMessage()
    ]
    assert len(denial_lines) == 1
    assert 'reason=origin-rejected' in denial_lines[0]
    assert 'origin=https://evil.example' in denial_lines[0]


def test_authorization_denies_and_logs_webui_role_insufficient(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A `kg:admin`-scoped caller explicitly demoted by an additive
    `webui:reader` realm role is still rejected -- distinctly logged as
    `webui-role-insufficient`, not `scope-missing`."""

    from agent_utilities.core.config import config
    from agent_utilities.knowledge_graph.core.session import GraphSession, use_session
    from agent_utilities.security.brain_context import ActorContext

    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    monkeypatch.setattr(
        config, 'auth_jwt_issuer', 'https://idp.invalid/', raising=False
    )
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui', raising=False)

    actor = ActorContext(
        actor_id='subject-1',
        tenant_id='homelab',
        roles=frozenset({'kg:admin', 'webui:reader'}),
        authenticated=True,
    )
    session = GraphSession(
        actor=actor, tenant='homelab', scopes=frozenset({'kg:admin'})
    )

    async def inner_never_called(_scope: dict, _receive: Any, _send: Any) -> None:
        raise AssertionError('a webui:reader-demoted caller must never reach the app')

    middleware = WebUIAuthorizationMiddleware(inner_never_called)
    scope = _ws_scope(headers=[(b'origin', b'https://au.arpa'), (b'host', b'au.arpa')])
    send = _Recorder()

    with caplog.at_level(logging.WARNING, logger=LOGGER_NAME), use_session(session):
        asyncio.run(middleware(scope, _ws_receive, send))

    assert send.close_codes == [4403]
    denial_lines = [
        r.getMessage() for r in caplog.records if 'ws_denied' in r.getMessage()
    ]
    assert len(denial_lines) == 1
    assert 'reason=webui-role-insufficient' in denial_lines[0]
    assert 'resolved_role=reader' in denial_lines[0]
    assert 'required_role=admin' in denial_lines[0]
