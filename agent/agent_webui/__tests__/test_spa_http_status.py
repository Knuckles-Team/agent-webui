"""Direct HTTP status contract for React Router pages and the custom 404."""

from pathlib import Path

from agent_webui.server import SPAStaticFiles, _load_spa_route_patterns
from fastapi import FastAPI
from fastapi.testclient import TestClient

_REPOSITORY_ROOT = Path(__file__).parents[3]
_SPA_SHELL_MARKER = '<div id="root"></div>'


def _client() -> TestClient:
    app = FastAPI()

    @app.get('/api/ping')
    async def api_ping() -> dict[str, bool]:
        return {'ok': True}

    app.mount(
        '/',
        SPAStaticFiles(
            directory=str(_REPOSITORY_ROOT),
            html=True,
            route_patterns=_load_spa_route_patterns(_REPOSITORY_ROOT / 'public'),
        ),
        name='dashboard',
    )
    return TestClient(app)


def test_known_public_and_private_routes_serve_spa_with_200() -> None:
    with _client() as client:
        for path in ('/privacy', '/graph', '/object/demo-id', '/object/demo.id'):
            response = client.get(path)
            assert response.status_code == 200
            assert _SPA_SHELL_MARKER in response.text


def test_unknown_browser_route_serves_spa_body_with_404() -> None:
    with _client() as client:
        response = client.get('/no-such-page')

    assert response.status_code == 404
    assert _SPA_SHELL_MARKER in response.text


def test_missing_asset_and_api_prefix_do_not_use_spa_fallback() -> None:
    with _client() as client:
        missing_asset = client.get('/missing-app.js')
        known_api = client.get('/api/ping')
        missing_api = client.get('/api/no-such-endpoint')

    assert missing_asset.status_code == 404
    assert _SPA_SHELL_MARKER not in missing_asset.text
    assert known_api.status_code == 200
    assert known_api.json() == {'ok': True}
    assert missing_api.status_code == 404
    assert _SPA_SHELL_MARKER not in missing_api.text


def test_head_preserves_status_without_a_response_body() -> None:
    with _client() as client:
        known = client.head('/privacy')
        unknown = client.head('/no-such-page')

    assert known.status_code == 200
    assert unknown.status_code == 404
    assert known.content == b''
    assert unknown.content == b''
