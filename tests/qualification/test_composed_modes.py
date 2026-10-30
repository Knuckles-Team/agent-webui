"""Task-local synthetic probes; no deployment or live provider acceptance."""

import os
import secrets

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get('WEBUI_INSTALLED_QUALIFICATION') != '1',
    reason='Run the installed qualification harness explicitly',
)


@pytest.mark.parametrize('mode', ['none', 'oidc'])
def test_actual_host_arguments_and_factory_refuse_unadmitted_effects(monkeypatch, mode):
    import httpx
    from overstory import oidc_session
    from overstory.host import config
    from overstory.server import create_agent_web_app
    from arbora.webui_host.session_boundary import identity_factory_kwargs
    from cryptography.fernet import Fernet
    from fastapi.testclient import TestClient
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    async def no_network(*args, **kwargs):
        raise AssertionError('Synthetic qualification must not contact a provider')

    monkeypatch.setattr(httpx.AsyncClient, 'request', no_network)
    monkeypatch.setattr(config, 'allowed_hosts', 'testserver', raising=False)
    monkeypatch.setattr(config, 'gateway_rate_limit', 0)
    monkeypatch.setattr(config, 'gateway_rate_burst', 0)
    for name, value in (
        ('auth_jwt_jwks_uri', 'https://provider.invalid/jwks'),
        ('auth_jwt_issuer', 'https://provider.invalid'),
        ('auth_jwt_audience', 'synthetic-webui'),
    ):
        monkeypatch.setattr(
            config, name, value if mode == 'oidc' else None, raising=False
        )
    settings = None
    if mode == 'oidc':
        settings = oidc_session.OIDCSettings(
            client_id='synthetic-webui',
            client_secret=secrets.token_urlsafe(24),
            issuer='https://provider.invalid',
            redirect_uri='http://testserver/auth/callback',
            scope='openid',
            session_key=Fernet.generate_key().decode(),
        )
    monkeypatch.setattr(oidc_session, 'load_settings', lambda: settings)
    app = create_agent_web_app(
        Agent(TestModel()),
        {'get_path': lambda value: value},
        listener_host='127.0.0.1',
        **identity_factory_kwargs(mode, None, factory=create_agent_web_app),
    )
    calls = []

    @app.post('/api/synthetic-effect')
    def effect():
        calls.append(True)
        return {'ok': True}

    client = TestClient(app)
    from pathlib import Path

    import overstory

    packaged = Path(overstory.__file__).parent / 'dist' / 'index.html'
    import re

    shell = client.get('/')
    assert shell.status_code == 200
    match = re.search(r'nonce="([^"]+)"', shell.text)
    assert match is not None
    nonce = match.group(1)
    assert nonce != 'OVERSTORY_CSP_NONCE'
    assert nonce in shell.headers['content-security-policy']
    assert shell.text == packaged.read_text().replace('OVERSTORY_CSP_NONCE', nonce)
    response = client.post('/api/synthetic-effect')
    assert response.status_code == (403 if mode == 'none' else 401)
    assert calls == []
    assert app.state.security_contract['auth_mode'] == mode


def test_installed_candidate_paths_and_packaged_assets():
    import inspect
    from pathlib import Path

    import overstory
    import arbora
    from overstory.server import create_agent_web_app

    for package in (arbora, overstory):
        assert package.__file__ is not None
        assert 'site-packages' in str(Path(package.__file__).resolve())
    assert 'auth_mode' in inspect.signature(create_agent_web_app).parameters
    dist = Path(overstory.__file__).parent / 'dist'
    assert (dist / 'index.html').is_file()
    assert list((dist / 'assets').glob('*.js'))
