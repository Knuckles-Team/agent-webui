"""The browser MCP call route uses the caller-bound GraphOS fleet operation."""

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
async def test_fleet_call_uses_verified_request_and_exact_operation() -> None:
    calls = []

    async def invoke_op(request, op_id, params):
        calls.append((request.url.path, op_id, params))
        return {'value': {'answer': 42}}

    async with AsyncClient(
        transport=ASGITransport(app=_app(invoke_op)), base_url='http://test'
    ) as client:
        response = await client.post(
            '/api/enhanced/mcp/tools/call',
            json={'server': 'worker', 'tool': 'read', 'arguments': {'id': 'item'}},
        )
    assert response.status_code == 200
    assert response.json() == {'status': 'success', 'result': {'answer': 42}}
    assert calls == [
        (
            '/api/enhanced/mcp/tools/call',
            'fleet.call',
            {'server': 'worker', 'tool': 'read', 'arguments': {'id': 'item'}},
        )
    ]


@pytest.mark.asyncio
async def test_fleet_call_rejects_bad_input_before_graphos() -> None:
    calls = []

    def invoke_op(*args):
        calls.append(args)
        return {'value': None}

    async with AsyncClient(
        transport=ASGITransport(app=_app(invoke_op)), base_url='http://test'
    ) as client:
        response = await client.post(
            '/api/enhanced/mcp/tools/call',
            json={'server': 'bad server', 'tool': 'read', 'arguments': {}},
        )
    assert response.status_code == 400
    assert calls == []


@pytest.mark.asyncio
async def test_fleet_call_rejects_missing_result_envelope() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=_app(lambda *_: {'wrong': 1})),
        base_url='http://test',
    ) as client:
        response = await client.post(
            '/api/enhanced/mcp/tools/call',
            json={'server': 'worker', 'tool': 'read', 'arguments': {}},
        )
    assert response.status_code == 502


@pytest.mark.asyncio
async def test_fleet_call_redacts_graphos_failure() -> None:
    def broken_host(*_args):
        raise RuntimeError('private backend credential')

    async with AsyncClient(
        transport=ASGITransport(app=_app(broken_host)), base_url='http://test'
    ) as client:
        response = await client.post(
            '/api/enhanced/mcp/tools/call',
            json={'server': 'worker', 'tool': 'read', 'arguments': {}},
        )
    assert response.status_code == 503
    assert 'private backend credential' not in response.text
