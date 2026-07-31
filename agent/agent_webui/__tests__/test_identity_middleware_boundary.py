"""Boundary tests for ``WebUIActorIdentityMiddleware``'s HTTP leg.

The WebUI serves the *authenticated* HTTP request itself so both transports
mint through one injected minter (see :mod:`agent_webui.graph_identity`). These
tests pin the two properties that specialization must not cost us:

* every **non**-authenticated outcome is still decided by the shared
  ``ActorIdentityMiddleware`` — same 401 bodies, and ``UNAUTHENTICATED_PATHS``
  is neither read nor rewritten here; and
* an authenticated request binds the ambient actor + session from the
  **injected** minter, never the module-level one.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from agent_utilities.security import request_identity as _shared
from agent_utilities.security.brain_context import ActorContext
from agent_webui.server import _ensure_actor_identity_middleware


class _AppStub:
    """The minimum ``add_middleware`` surface the installer touches."""

    def __init__(self) -> None:
        self.user_middleware: list[Any] = []
        self.installed: Any = None

    def add_middleware(self, cls: Any, **_kwargs: Any) -> None:
        self.installed = cls
        self.user_middleware.append(type('_Entry', (), {'cls': cls})())


class _Recorder:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def __call__(self, message: dict) -> None:
        self.messages.append(message)

    @property
    def status(self) -> int:
        return next(
            m['status'] for m in self.messages if m['type'] == 'http.response.start'
        )

    @property
    def json_body(self) -> Any:
        body = b''.join(
            m.get('body', b'')
            for m in self.messages
            if m['type'] == 'http.response.body'
        )
        return json.loads(body)


def _middleware(inner: Any, minter: Any) -> Any:
    app = _AppStub()
    _ensure_actor_identity_middleware(app, mint_graph_session=minter)
    return app.installed(inner)


def _scope(path: str = '/api/enhanced/info', headers: list | None = None) -> dict:
    return {
        'type': 'http',
        'method': 'GET',
        'path': path,
        'headers': headers if headers is not None else [],
        'state': {},
    }


async def _receive() -> dict:
    return {'type': 'http.request', 'body': b'', 'more_body': False}


async def _never_called(scope: dict, receive: Any, send: Any) -> None:
    raise AssertionError('the inner app must not be reached')


@pytest.mark.asyncio
async def test_absent_credential_gets_the_shared_401() -> None:
    """The shared boundary — not this specialization — answers it."""

    def _minter(_actor: Any) -> Any:
        raise AssertionError('no session may be minted without a credential')

    send = _Recorder()
    await _middleware(_never_called, _minter)(_scope(), _receive, send)

    assert send.status == 401
    assert send.json_body == {'error': 'Verified Bearer identity required'}


@pytest.mark.asyncio
async def test_malformed_authorization_header_is_refused_locally() -> None:
    """A header that is not exactly one bounded Bearer credential."""

    send = _Recorder()
    scope = _scope(headers=[(b'authorization', b'Basic abc')])
    await _middleware(_never_called, lambda _actor: None)(scope, _receive, send)

    assert send.status == 401
    assert send.json_body == {'detail': 'Authentication required'}


@pytest.mark.asyncio
async def test_two_authorization_headers_are_refused() -> None:
    send = _Recorder()
    scope = _scope(
        headers=[(b'authorization', b'Bearer a'), (b'authorization', b'Bearer b')]
    )
    await _middleware(_never_called, lambda _actor: None)(scope, _receive, send)

    assert send.status == 401


@pytest.mark.asyncio
async def test_unverifiable_credential_falls_back_to_the_shared_401(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No JWKS configured → the shared boundary's own message, unchanged."""

    from agent_utilities.core.config import config

    monkeypatch.setattr(config, 'auth_jwt_jwks_uri', '', raising=False)

    send = _Recorder()
    scope = _scope(headers=[(b'authorization', b'Bearer opaque-value')])
    await _middleware(_never_called, lambda _actor: None)(scope, _receive, send)

    assert send.status == 401
    assert send.json_body == {'error': 'Token validation unavailable'}


@pytest.mark.asyncio
async def test_exempt_path_is_still_decided_by_the_shared_boundary() -> None:
    """``UNAUTHENTICATED_PATHS`` is the shared module's, and it still applies."""

    served: list[str] = []

    async def _inner(scope: dict, receive: Any, send: Any) -> None:
        served.append(scope['path'])
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{}'})

    exempt = sorted(_shared.UNAUTHENTICATED_PATHS)[0]
    send = _Recorder()
    await _middleware(_inner, lambda _actor: None)(_scope(path=exempt), _receive, send)

    assert served == [exempt]
    assert send.status == 200


@pytest.mark.asyncio
async def test_authenticated_request_binds_the_injected_minters_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The injected minter is used; the module-level one is never called."""

    from agent_utilities.core.config import config
    from agent_utilities.knowledge_graph.core.session import (
        GraphSession,
        current_session,
    )

    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    actor = ActorContext(
        actor_id='subject-1',
        tenant_id='homelab',
        roles=frozenset({'kg:read'}),
        authenticated=True,
    )

    async def _fake_actor_from_bearer_token(_token: str) -> ActorContext:
        return actor

    def _shared_minter_must_not_run(_actor: Any) -> Any:
        raise AssertionError('the module-level minter must not be used')

    monkeypatch.setattr(
        _shared, 'actor_from_bearer_token', _fake_actor_from_bearer_token
    )
    monkeypatch.setattr(_shared, 'mint_graph_session', _shared_minter_must_not_run)

    expected = GraphSession(
        actor=actor, tenant='homelab', scopes=frozenset({'kg:read'})
    )
    minted: list[Any] = []

    def _injected(candidate: Any) -> GraphSession:
        minted.append(candidate)
        return expected

    observed: list[Any] = []

    async def _inner(scope: dict, receive: Any, send: Any) -> None:
        observed.append(current_session())
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{"ok":true}'})

    send = _Recorder()
    scope = _scope(headers=[(b'authorization', b'Bearer a-valid-looking-token')])
    await _middleware(_inner, _injected)(scope, _receive, send)

    assert send.status == 200
    assert minted == [actor]
    assert observed == [expected]
    assert current_session() is None, 'the ambient session must be reset'


@pytest.mark.asyncio
async def test_a_minter_permission_error_is_a_403_not_a_500(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agent_utilities.core.config import config

    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    actor = ActorContext(actor_id='subject-1', tenant_id='homelab', authenticated=True)

    async def _fake_actor_from_bearer_token(_token: str) -> ActorContext:
        return actor

    monkeypatch.setattr(
        _shared, 'actor_from_bearer_token', _fake_actor_from_bearer_token
    )

    def _refuse(_actor: Any) -> Any:
        raise PermissionError('no tenant')

    send = _Recorder()
    scope = _scope(headers=[(b'authorization', b'Bearer a-valid-looking-token')])
    await _middleware(_never_called, _refuse)(scope, _receive, send)

    assert send.status == 403
    assert send.json_body == {'error': 'Verified tenant claim required'}


@pytest.mark.asyncio
async def test_an_invalid_credential_never_reaches_the_injected_minter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agent_utilities.core.config import config

    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )

    async def _reject(_token: str) -> ActorContext:
        raise ValueError('bad signature')

    monkeypatch.setattr(_shared, 'actor_from_bearer_token', _reject)

    def _minter(_actor: Any) -> Any:
        raise AssertionError('an invalid credential must not mint a session')

    send = _Recorder()
    scope = _scope(headers=[(b'authorization', b'Bearer forged')])
    await _middleware(_never_called, _minter)(scope, _receive, send)

    assert send.status == 401
    assert send.json_body == {'error': 'Token validation failed'}
