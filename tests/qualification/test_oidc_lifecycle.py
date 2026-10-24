"""Opt-in installed OIDC protocol qualification with a loopback issuer."""

import os
import time
from types import SimpleNamespace
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get('WEBUI_INSTALLED_QUALIFICATION') != '1',
    reason='Run the installed qualification harness explicitly',
)


@pytest.fixture
def issuer():
    from .loopback_oidc import running_issuer

    with running_issuer() as owner:
        yield owner


@pytest.fixture
def browser(monkeypatch, issuer):
    from agent_webui import host, oidc_session
    from agent_webui.server import create_agent_web_app
    from arbora.webui_host.session_boundary import identity_factory_kwargs
    from cryptography.fernet import Fernet
    from fastapi.testclient import TestClient
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    settings = oidc_session.OIDCSettings(
        client_id='fixture-client',
        client_secret=issuer.client_secret,
        issuer=issuer.url,
        redirect_uri='http://testserver/auth/callback',
        scope='openid',
        session_key=Fernet.generate_key().decode(),
    )
    monkeypatch.setattr(oidc_session, 'load_settings', lambda: settings)
    for field, value in {
        'auth_jwt_jwks_uri': issuer.url + '/jwks',
        'auth_jwt_issuer': issuer.url,
        'auth_jwt_audience': 'fixture-audience',
        'allowed_hosts': 'testserver',
        'gateway_rate_limit': 0,
        'gateway_rate_burst': 0,
    }.items():
        monkeypatch.setattr(host.config, field, value, raising=False)
    monkeypatch.setenv('AGENT_WEBUI_ACCESS_LOG_POLICY', 'disabled')

    def compose(app):
        @app.get('/api/lifecycle')
        def identity():
            actor = host.current_actor()
            return {
                'subject': actor.actor_id,
                'authenticated': actor.authenticated,
                'tenant': actor.tenant_id,
            }

    app = create_agent_web_app(
        Agent(TestModel()),
        {'get_path': lambda v: v},
        application_composer=compose,
        **identity_factory_kwargs('oidc', None, factory=create_agent_web_app),
    )
    with TestClient(app) as client:
        yield client


def sign_in(browser):
    import httpx

    login = browser.get('/auth/login?next=/api/lifecycle', follow_redirects=False)
    assert login.status_code == 302
    authorized = httpx.get(login.headers['location'], follow_redirects=False)
    assert authorized.status_code == 302
    callback = browser.get(authorized.headers['location'], follow_redirects=False)
    assert callback.status_code == 302
    assert callback.headers['location'] == '/api/lifecycle'


def test_signed_oidc_login_refresh_logout(browser, issuer, monkeypatch):
    from agent_webui import oidc_session

    assert browser.get('/api/lifecycle').status_code == 401
    sign_in(browser)
    assert browser.get('/api/lifecycle').json() == {
        'subject': 'disposable-user',
        'authenticated': True,
        'tenant': 'fixture-tenant',
    }
    session = browser.get('/auth/session').json()
    assert session['authenticated'] is True
    assert session['subject'] == 'disposable-user'
    assert 'access_token' not in session and 'refresh_token' not in session
    monkeypatch.setattr(
        oidc_session,
        'time',
        SimpleNamespace(time=lambda: time.time() + 400, monotonic=time.monotonic),
    )
    assert browser.get('/api/lifecycle').status_code == 200
    assert issuer.refreshes == 1
    logout = browser.get('/auth/logout', follow_redirects=False)
    assert logout.status_code == 302
    assert logout.headers['location'].startswith(issuer.url + '/logout?')
    assert browser.get('/auth/session').json() == {'authenticated': False}
    assert browser.get('/api/lifecycle').status_code == 401


@pytest.mark.parametrize('first_path', ['/api/lifecycle', '/auth/session'])
def test_expired_session_refresh_refusal_clears_browser(
    browser, issuer, monkeypatch, first_path
):
    from agent_webui import oidc_session

    sign_in(browser)
    issuer.reject_refresh = True
    monkeypatch.setattr(
        oidc_session,
        'time',
        SimpleNamespace(time=lambda: time.time() + 400, monotonic=time.monotonic),
    )
    response = browser.get(first_path)
    assert response.status_code == (401 if first_path.startswith('/api/') else 200)
    if first_path == '/auth/session':
        assert response.json() == {'authenticated': False}
    assert issuer.refreshes == 1
    assert browser.get('/auth/session').json() == {'authenticated': False}


def test_wrong_callback_state_never_exchanges_or_admits(browser, issuer):
    import httpx

    login = browser.get('/auth/login', follow_redirects=False)
    authorized = httpx.get(login.headers['location'], follow_redirects=False)
    query = parse_qs(urlsplit(authorized.headers['location']).query)
    response = browser.get(
        '/auth/callback?'
        + urlencode({'code': query['code'][0], 'state': 'wrong-state'})
    )
    assert response.status_code == 401
    assert issuer.codes
    assert browser.get('/api/lifecycle').status_code == 401
    assert browser.get('/auth/session').json() == {'authenticated': False}
