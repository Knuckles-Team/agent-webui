"""Every WebUI listener has a verifier; only the static shell is public.

There is no unauthenticated loopback path any more. A deployment configures a
complete JWT verifier or its host injects a session boundary (Graph OS's
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
def built_bundle():
    """A throwaway ``dist/`` so the SPA mount (and its public shell) is live."""
    import agent_webui

    dist = Path(agent_webui.__file__).parent / 'dist'
    existed = dist.exists()
    assets = dist / 'assets'
    assets_existed = assets.exists()
    assets.mkdir(parents=True, exist_ok=True)
    index = dist / 'index.html'
    asset = assets / 'identity-test.js'
    index.write_text(_INDEX)
    asset.write_text(_ASSET)
    try:
        yield dist
    finally:
        asset.unlink(missing_ok=True)
        index.unlink(missing_ok=True)
        for directory, was_there in ((assets, assets_existed), (dist, existed)):
            if not was_there:
                try:
                    directory.rmdir()
                except OSError:
                    pass


def _build(**kwargs: Any) -> Any:
    from agent_webui.server import create_agent_web_app
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    return create_agent_web_app(Agent(TestModel()), {'get_path': lambda x: x}, **kwargs)


def _no_verifier(monkeypatch: pytest.MonkeyPatch) -> None:
    from agent_utilities.core.config import config

    for field in ('auth_jwt_jwks_uri', 'auth_jwt_issuer', 'auth_jwt_audience'):
        monkeypatch.setattr(config, field, None, raising=False)


def test_a_loopback_listener_without_a_verifier_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _no_verifier(monkeypatch)
    with pytest.raises(RuntimeError, match='identity verifier on every listener'):
        _build(listener_host='127.0.0.1')


def test_a_half_configured_verifier_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    from agent_utilities.core.config import config

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
