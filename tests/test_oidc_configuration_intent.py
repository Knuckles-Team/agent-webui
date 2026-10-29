"""Real loader/factory configuration tests, not live identity-provider proof."""

import pytest
from agent_webui.oidc_session import OIDCConfigurationError, load_settings
from test_identity_boundary import _build

_BROWSER_SETTINGS = (
    'WEBUI_OIDC_CLIENT_ID',
    'WEBUI_OIDC_CLIENT_SECRET',
    'WEBUI_OIDC_ISSUER',
    'WEBUI_OIDC_REDIRECT_URI',
    'WEBUI_SESSION_KEY',
    'WEBUI_OIDC_SCOPE',
    'WEBUI_OIDC_ATTENDED_ACR_VALUES',
)
_ISSUER = 'https://identity.example.test'
_INERT_VALUE = 'inert-configuration-probe'
pytestmark = pytest.mark.spec('OVERSTORY-IDENTITY-R003.3.1')


@pytest.fixture(autouse=True)
def isolated_browser_settings(monkeypatch, tmp_path):
    monkeypatch.setenv('XDG_DATA_HOME', str(tmp_path / 'data'))
    for name in _BROWSER_SETTINGS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('AUTH_JWT_ISSUER', _ISSUER)
    monkeypatch.setenv('AUTH_JWT_JWKS_URI', _ISSUER + '/jwks')
    monkeypatch.setenv('AUTH_JWT_AUDIENCE', 'test-webui')


class _Boundary:
    """Nominal host seam only: grants no identity and authenticates no request."""

    identity_mode = 'eg'

    def __init__(self):
        self.installed = []

    def __call__(self, app):
        self.installed.append(app)


def _complete_browser_settings(monkeypatch):
    for name in (
        'WEBUI_OIDC_CLIENT_ID',
        'WEBUI_OIDC_CLIENT_SECRET',
        'WEBUI_SESSION_KEY',
    ):
        monkeypatch.setenv(name, _INERT_VALUE)
    monkeypatch.setenv(
        'WEBUI_OIDC_REDIRECT_URI', 'https://webui.example.test/auth/callback'
    )


def test_shared_verifier_issuer_is_not_browser_sso_intent():
    assert load_settings() is None


def test_real_eg_factory_installs_boundary_with_shared_verifier():
    boundary = _Boundary()
    app = _build(auth_mode='eg', session_boundary=boundary)
    assert boundary.installed == [app]
    assert app.state.security_contract['auth_mode'] == 'eg'


@pytest.mark.parametrize('name', _BROWSER_SETTINGS)
@pytest.mark.parametrize('fallback', [True, False])
def test_any_explicit_partial_browser_setting_fails_closed(monkeypatch, name, fallback):
    if not fallback:
        monkeypatch.delenv('AUTH_JWT_ISSUER')
    monkeypatch.setenv(name, _INERT_VALUE)
    with pytest.raises(OIDCConfigurationError):
        load_settings()
    boundary = _Boundary()
    with pytest.raises(OIDCConfigurationError):
        _build(auth_mode='eg', session_boundary=boundary)
    assert boundary.installed == []


def test_complete_browser_settings_can_reuse_verifier_issuer(monkeypatch):
    _complete_browser_settings(monkeypatch)
    settings = load_settings()
    assert settings is not None
    assert settings.issuer == _ISSUER
    monkeypatch.setenv('WEBUI_OIDC_ISSUER', 'https://browser-idp.example.test')
    explicit = load_settings()
    assert explicit is not None
    assert explicit.issuer == 'https://browser-idp.example.test'


def test_real_oidc_factory_cannot_use_verifier_alone():
    with pytest.raises(RuntimeError, match='complete verifier and browser SSO'):
        _build(auth_mode='oidc')


def test_real_eg_factory_still_rejects_explicit_browser_sso(monkeypatch):
    _complete_browser_settings(monkeypatch)
    boundary = _Boundary()
    with pytest.raises(RuntimeError, match='both own'):
        _build(auth_mode='eg', session_boundary=boundary)
    assert boundary.installed == []


def test_real_oidc_factory_accepts_complete_explicit_browser_settings(monkeypatch):
    from cryptography.fernet import Fernet

    _complete_browser_settings(monkeypatch)
    monkeypatch.setenv('WEBUI_SESSION_KEY', Fernet.generate_key().decode('ascii'))
    app = _build(auth_mode='oidc')
    assert app.state.security_contract['auth_mode'] == 'oidc'
