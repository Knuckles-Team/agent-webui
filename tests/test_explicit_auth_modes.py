"""Source contracts only: no live issuer, credentials or deployment changes."""

import pytest
from agent_webui.auth_policy import AuthMode, resolve_auth_mode
from fastapi.testclient import TestClient
from test_identity_boundary import _build, _no_verifier


@pytest.mark.spec('WEBUI-IDENTITY-R003.1.1')
def test_default_and_unknown_modes_remain_protected():
    assert resolve_auth_mode(None) is AuthMode.REQUIRED
    for value in ('', 'NONE', 'disabled', 'invalid'):
        with pytest.raises(ValueError):
            resolve_auth_mode(value)


@pytest.mark.spec('WEBUI-IDENTITY-R003.1.1')
def test_explicit_none_binds_no_identity_or_grant(monkeypatch):
    from agent_webui.host import current_actor, current_grant

    _no_verifier(monkeypatch)
    app = _build(
        auth_mode='none',
        anonymous_read_routes=frozenset(
            {'/api/mode-contract', '/api/context-contract'}
        ),
    )

    @app.get('/api/mode-contract')
    def contract():
        actor = current_actor()
        return {
            'authenticated': actor.authenticated,
            'credential': actor.credential,
            'grant': current_grant(),
            'actor': actor.actor_id,
        }

    response = TestClient(app).get('/api/mode-contract')
    assert response.status_code == 200
    assert response.json() == {
        'authenticated': False,
        'credential': None,
        'grant': None,
        'actor': 'anonymous',
    }
    assert app.state.security_contract['unsecured'] is True
    assert (
        TestClient(app)
        .get('/api/mode-contract', headers={'Authorization': 'Bearer invalid'})
        .status_code
        == 401
    )


@pytest.mark.spec('WEBUI-IDENTITY-R003.1.1')
def test_none_is_not_authentication_failure_fallback(monkeypatch):
    _no_verifier(monkeypatch)
    with pytest.raises(RuntimeError, match='identity verifier'):
        _build()
    with pytest.raises(RuntimeError, match='host session boundary'):
        _build(auth_mode='eg')
    with pytest.raises(RuntimeError, match='complete verifier and browser SSO'):
        _build(auth_mode='oidc')
    with pytest.raises(RuntimeError, match='loopback'):
        _build(auth_mode='none', listener_host='0.0.0.0')
    with pytest.raises(RuntimeError, match='conflicts'):
        _build(auth_mode='none', session_boundary=lambda app: None)


@pytest.mark.spec('WEBUI-IDENTITY-R003.1.1')
def test_none_rejects_configured_verifier(monkeypatch):
    with pytest.raises(RuntimeError, match='conflicts'):
        _build(auth_mode='none')


@pytest.mark.spec('WEBUI-IDENTITY-R003.1.1')
def test_none_preserves_origin_checks_for_ui_and_webmcp(monkeypatch):
    _no_verifier(monkeypatch)
    app = _build(
        auth_mode='none',
        anonymous_read_routes=frozenset(
            {'/api/mode-contract', '/api/context-contract'}
        ),
    )
    calls = []

    def action():
        calls.append('called')
        return {'ok': True}

    for path in ('/api/ui-action', '/api/webmcp-action'):
        app.post(path)(action)
    client = TestClient(app)
    for path in ('/api/ui-action', '/api/webmcp-action'):
        assert (
            client.post(path, headers={'Origin': 'https://other.invalid'}).status_code
            == 403
        )
    assert calls == []


@pytest.mark.spec('WEBUI-IDENTITY-R003.1.1')
def test_none_clears_ambient_authority_and_refuses_stale_cookie(monkeypatch):
    from agent_webui.host import (
        ActorContext,
        RequestGrant,
        current_actor,
        current_grant,
        use_actor,
        use_grant,
    )

    _no_verifier(monkeypatch)
    app = _build(
        auth_mode='none',
        anonymous_read_routes=frozenset(
            {'/api/mode-contract', '/api/context-contract'}
        ),
    )
    inherited = ActorContext(
        actor_id='host-process', tenant_id='host', authenticated=True
    )
    grant = RequestGrant(inherited, 'host', frozenset({'kg:admin'}))

    @app.get('/api/context-contract')
    def context():
        return {'actor': current_actor().actor_id, 'grant': current_grant()}

    with use_actor(inherited), use_grant(grant):
        client = TestClient(app)
        assert client.get('/api/context-contract').json() == {
            'actor': 'anonymous',
            'grant': None,
        }
        assert current_actor() is inherited and current_grant() is grant
        assert (
            client.get(
                '/api/context-contract',
                headers={'Cookie': '__Host-arbora_session=stale'},
            ).status_code
            == 401
        )
    with pytest.raises(RuntimeError, match='identity verifier'):
        _build()


@pytest.mark.spec('WEBUI-IDENTITY-R003.1.1')
def test_anonymous_policy_cannot_admit_direct_workspace_effects(monkeypatch):
    from agent_webui import api_extensions

    _no_verifier(monkeypatch)
    forbidden = frozenset(
        {
            '/api/enhanced/files/private.md',
            '/api/enhanced/config-files',
            '/api/mcp/servers',
        }
    )
    app = _build(auth_mode='none', anonymous_read_routes=forbidden)
    calls = []
    monkeypatch.setattr(
        api_extensions,
        'resolve_workspace_file',
        lambda filename: calls.append(filename),
    )
    client = TestClient(app)
    for method in ('get', 'put', 'delete'):
        response = getattr(client, method)('/api/enhanced/files/private.md')
        assert response.status_code == 403
    assert client.get('/api/enhanced/config-files').status_code == 403
    assert calls == []


@pytest.mark.spec('WEBUI-IDENTITY-R003.3.1')
def test_oidc_cannot_install_an_eg_owner_or_skip_browser_login(monkeypatch):
    with pytest.raises(RuntimeError, match='complete verifier and browser SSO'):
        _build(auth_mode='oidc')
    _no_verifier(monkeypatch)
    with pytest.raises(RuntimeError, match='complete verifier and browser SSO'):
        _build(auth_mode='oidc', session_boundary=lambda app: None)


@pytest.mark.spec('WEBUI-IDENTITY-R003.2.1')
def test_explicit_eg_rejects_an_untyped_callback(monkeypatch):
    _no_verifier(monkeypatch)
    with pytest.raises(RuntimeError, match='identified as eg'):
        _build(auth_mode='eg', session_boundary=lambda app: None)
