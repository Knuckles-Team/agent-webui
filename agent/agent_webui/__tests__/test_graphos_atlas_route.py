"""The Atlas catalog is served through GraphOS's caller-bound invoke port."""

from agent_webui.api_extensions import router
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _client(invoke_op=None) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix='/api/enhanced')
    if invoke_op is not None:
        app.state.graphos_invoke_op = invoke_op
    return TestClient(app)


def test_atlas_catalog_requires_graphos_host() -> None:
    with _client() as client:
        response = client.get('/api/enhanced/atlas/sources')
    assert response.status_code == 501


def test_atlas_catalog_uses_verified_request_port() -> None:
    calls = []

    async def invoke_op(request, op_id, params):
        calls.append((request.url.path, op_id, params))
        return {
            'catalog_version': 'atlas-source-catalog.v1',
            'observed_at': '2026-09-25T00:00:00Z',
            'providers': [],
        }

    with _client(invoke_op) as client:
        response = client.get('/api/enhanced/atlas/sources')
    assert response.status_code == 200
    assert response.json()['providers'] == []
    assert calls == [('/api/enhanced/atlas/sources', 'atlas.sources.list', {})]


def test_atlas_catalog_rejects_malformed_host_result() -> None:
    with _client(lambda *_args: {'providers': []}) as client:
        response = client.get('/api/enhanced/atlas/sources')
    assert response.status_code == 502


def test_atlas_catalog_redacts_host_failure() -> None:
    def broken_host(*_args):
        raise RuntimeError('provider secret must stay server-side')

    with _client(broken_host) as client:
        response = client.get('/api/enhanced/atlas/sources')
    assert response.status_code == 503
    assert 'provider secret' not in response.text
