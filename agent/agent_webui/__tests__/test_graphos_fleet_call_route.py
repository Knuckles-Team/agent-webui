"""The browser MCP call route uses the caller-bound GraphOS fleet operation."""

from agent_webui.api_extensions import router
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _client(invoke_op=None) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix='/api/enhanced')
    if invoke_op is not None:
        app.state.graphos_invoke_op = invoke_op
    return TestClient(app)


def test_fleet_call_uses_verified_request_and_exact_operation() -> None:
    calls = []

    async def invoke_op(request, op_id, params):
        calls.append((request.url.path, op_id, params))
        return {'value': {'answer': 42}}

    with _client(invoke_op) as client:
        response = client.post(
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


def test_fleet_call_rejects_bad_input_before_graphos() -> None:
    calls = []

    def invoke_op(*args):
        calls.append(args)
        return {'value': None}

    with _client(invoke_op) as client:
        response = client.post(
            '/api/enhanced/mcp/tools/call',
            json={'server': 'bad server', 'tool': 'read', 'arguments': {}},
        )
    assert response.status_code == 400
    assert calls == []


def test_fleet_call_rejects_missing_result_envelope() -> None:
    with _client(lambda *_: {'wrong': 1}) as client:
        response = client.post(
            '/api/enhanced/mcp/tools/call',
            json={'server': 'worker', 'tool': 'read', 'arguments': {}},
        )
    assert response.status_code == 502


def test_fleet_call_redacts_graphos_failure() -> None:
    def broken_host(*_args):
        raise RuntimeError('private backend credential')

    with _client(broken_host) as client:
        response = client.post(
            '/api/enhanced/mcp/tools/call',
            json={'server': 'worker', 'tool': 'read', 'arguments': {}},
        )
    assert response.status_code == 503
    assert 'private backend credential' not in response.text
