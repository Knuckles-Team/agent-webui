"""Every WebUI listener has a verifier; only the static shell is public.

There is no unauthenticated loopback path any more. A deployment configures a
complete JWT verifier or its host injects a session boundary (Arbora's
identity gate). Without a credential a browser can load only the static SPA
bundle that renders the sign-in screens; every application route still
answers 401.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

_INDEX = (
    '<!doctype html><html><head><title>Agent Web Dashboard</title></head>'
    '<body><div id="root">spa-shell-marker</div></body></html>'
)
_ASSET = 'console.log("bundle")'


@pytest.fixture
def built_bundle(tmp_path, monkeypatch):
    """A private ``dist/`` so the SPA mount (and its public shell) is live.

    The server resolves ``dist`` beside its own module file, so the fixture
    points that file into ``tmp_path``. The real build output is never touched.
    """
    from agent_webui import server as server_module

    package = tmp_path / 'agent_webui'
    dist = package / 'dist'
    (dist / 'assets').mkdir(parents=True)
    (dist / 'index.html').write_text(_INDEX)
    (dist / 'assets' / 'identity-test.js').write_text(_ASSET)
    monkeypatch.setattr(server_module, '__file__', str(package / 'server.py'))
    return dist


def _build(**kwargs: Any) -> Any:
    from agent_webui.server import create_agent_web_app
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    return create_agent_web_app(Agent(TestModel()), {'get_path': lambda x: x}, **kwargs)


def _no_verifier(monkeypatch: pytest.MonkeyPatch) -> None:
    from agent_webui.host import config

    for field in ('auth_jwt_jwks_uri', 'auth_jwt_issuer', 'auth_jwt_audience'):
        monkeypatch.setattr(config, field, None, raising=False)


def test_a_loopback_listener_without_a_verifier_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _no_verifier(monkeypatch)
    with pytest.raises(RuntimeError, match='identity verifier on every listener'):
        _build(listener_host='127.0.0.1')


def test_a_half_configured_verifier_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    from agent_webui.host import config

    monkeypatch.setattr(config, 'auth_jwt_audience', None, raising=False)
    with pytest.raises(RuntimeError, match='JWKS URI, issuer, and audience'):
        _build()


def test_a_host_session_boundary_satisfies_the_verifier_requirement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _no_verifier(monkeypatch)
    installed: list[Any] = []
    app = _build(session_boundary=installed.append)
    assert installed == [app]


def test_host_boundary_and_webui_oidc_cannot_both_own_auth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agent_webui import oidc_session

    monkeypatch.setattr(oidc_session, 'load_settings', lambda: object())
    with pytest.raises(RuntimeError, match='both own'):
        _build(session_boundary=lambda app: None)


def test_uncredentialed_browser_gets_only_the_static_shell(built_bundle: Path) -> None:
    _ = built_bundle  # fixture is for its filesystem side effect, not its value
    client = TestClient(_build())
    root = client.get('/')
    assert root.status_code == 200 and 'spa-shell-marker' in root.text
    asset = client.get('/assets/identity-test.js')
    assert asset.status_code == 200 and asset.text == _ASSET
    assert client.get('/api/chats').status_code == 401
    assert client.post('/').status_code in {401, 405}
    assert client.get('/assets/../../server.py').status_code != 200
