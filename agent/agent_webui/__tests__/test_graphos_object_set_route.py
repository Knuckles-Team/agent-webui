"""Concrete-label object sets use GraphOS's verified caller authority."""

import pytest
from agent_webui.api_extensions import router
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


def _app(invoke_op=None) -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix='/api/enhanced')
    if invoke_op is not None:
        app.state.graphos_invoke_op = invoke_op
    return app


@pytest.mark.asyncio
async def test_label_read_uses_request_scoped_graphos_op() -> None:
    calls = []

    async def invoke_op(request, op_id, params):
        calls.append((request.url.path, op_id, params))
        return {'ids': ['node-1'], 'rows': [{'id': 'node-1', 'name': 'A'}], 'count': 1}

    async with AsyncClient(
        transport=ASGITransport(app=_app(invoke_op)), base_url='http://test'
    ) as client:
        response = await client.post(
            '/api/enhanced/ontology/object-set/by-label',
            json={'label': 'Position', 'limit': 20},
        )
    assert response.status_code == 200
    assert response.json()['ids'] == ['node-1']
    assert calls == [
        (
            '/api/enhanced/ontology/object-set/by-label',
            'objects.by_label',
            {'label': 'Position', 'limit': 20},
        )
    ]


@pytest.mark.asyncio
async def test_label_read_requires_host_and_validates_bounds() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url='http://test'
    ) as client:
        route = '/api/enhanced/ontology/object-set/by-label'
        assert (await client.post(route, json={'label': 'Position'})).status_code == 501
        assert (
            await client.post(route, json={'label': '', 'limit': 20})
        ).status_code == 400
        assert (
            await client.post(route, json={'label': 'Position', 'limit': 257})
        ).status_code == 400
        assert (
            await client.post(route, json={'label': 'Position', 'limit': True})
        ).status_code == 400


@pytest.mark.asyncio
async def test_label_read_without_host_never_uses_local_engine(monkeypatch) -> None:
    def unexpected_engine():
        raise AssertionError('local engine must not answer a GraphOS read')

    monkeypatch.setattr('agent_webui.api_extensions.get_engine', unexpected_engine)
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url='http://test'
    ) as client:
        response = await client.post(
            '/api/enhanced/ontology/object-set/by-label',
            json={'label': 'Position'},
        )
    assert response.status_code == 501
    assert response.json()['detail'] == 'Capability is not available'


@pytest.mark.asyncio
async def test_label_read_rejects_malformed_host_result() -> None:
    async with AsyncClient(
        transport=ASGITransport(
            app=_app(lambda *_args: {'ids': ['a'], 'rows': [], 'count': 0})
        ),
        base_url='http://test',
    ) as client:
        response = await client.post(
            '/api/enhanced/ontology/object-set/by-label', json={'label': 'Position'}
        )
    assert response.status_code == 502


@pytest.mark.asyncio
async def test_label_read_rejects_boolean_count_from_host() -> None:
    async with AsyncClient(
        transport=ASGITransport(
            app=_app(
                lambda *_args: {
                    'ids': ['a'],
                    'rows': [{'id': 'a'}],
                    'count': True,
                }
            )
        ),
        base_url='http://test',
    ) as client:
        response = await client.post(
            '/api/enhanced/ontology/object-set/by-label', json={'label': 'Position'}
        )
    assert response.status_code == 502


@pytest.mark.asyncio
async def test_label_read_redacts_host_failure() -> None:
    def broken_host(*_args):
        raise RuntimeError('provider secret must stay server-side')

    async with AsyncClient(
        transport=ASGITransport(app=_app(broken_host)), base_url='http://test'
    ) as client:
        response = await client.post(
            '/api/enhanced/ontology/object-set/by-label', json={'label': 'Position'}
        )
    assert response.status_code == 503
    assert 'provider secret' not in response.text


@pytest.mark.asyncio
async def test_filtered_graph_canvas_uses_label_union_and_preserves_shape() -> None:
    calls = []

    async def invoke_op(request, op_id, params):
        calls.append((op_id, params))
        return {
            'ids': ['n1', 'n2'],
            'rows': [
                {'id': 'n1', 'node_type': 'Position', 'name': 'A'},
                {'id': 'n2', 'type': 'Position', 'name': 'legacy'},
            ],
            'count': 2,
        }

    async with AsyncClient(
        transport=ASGITransport(app=_app(invoke_op)), base_url='http://test'
    ) as client:
        response = await client.get('/api/enhanced/graph/nodes?node_type=Position')

    assert response.status_code == 200
    assert response.json() == [
        {'id': 'n1', 'labels': ['Position'], 'properties': {'name': 'A'}}
    ]
    assert calls == [('objects.by_label', {'label': 'Position', 'limit': 256})]


@pytest.mark.asyncio
async def test_filtered_graph_canvas_fails_closed_without_graphos_host() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url='http://test'
    ) as client:
        response = await client.get('/api/enhanced/graph/nodes?node_type=Position')
    assert response.status_code == 501
