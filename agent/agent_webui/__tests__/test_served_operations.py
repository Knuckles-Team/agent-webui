"""WebUI routes backed by Arbora served operations, over a faked Arbora HTTP API.

Each test drives the real app (identity gate, route scopes, the ``host`` seam)
and answers ``POST <api>/ops/<op_id>`` with an in-process ``httpx`` transport.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import msgpack
import pytest
from _agent_webui_shared_fixtures import authenticated_asgi_app
from agent_webui import host
from agent_webui.server import create_agent_web_app
from fastapi.testclient import TestClient
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

_ADMIN = 'kg:read kg:write kg:admin'


class FakeArbora:
    """Record each served-operation call and answer from a per-op table."""

    def __init__(self) -> None:
        self.results: dict[str, Any] = {}
        self.calls: list[tuple[str, dict[str, Any], httpx.Headers]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        op_id = request.url.path.rsplit('/', 1)[-1]
        self.calls.append((op_id, json.loads(request.content), request.headers))
        if op_id not in self.results:
            return httpx.Response(404, json={'ok': False, 'error': 'NOT_FOUND'})
        answer = self.results[op_id]
        if isinstance(answer, httpx.Response):
            return answer
        meta = {'registry_digest': 'test', 'api_version': 'v1'}
        return httpx.Response(
            200, json={'ok': True, 'result': {'value': answer}, 'meta': meta}
        )


@pytest.fixture
def arbora(monkeypatch: pytest.MonkeyPatch) -> FakeArbora:
    fake = FakeArbora()
    real_client = httpx.AsyncClient

    def client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs['transport'] = httpx.MockTransport(fake.handle)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(host.httpx, 'AsyncClient', client)
    monkeypatch.setattr(host.config, 'kg_policy_version', 'test-1')
    return fake


@pytest.fixture
def app(arbora: FakeArbora) -> Any:
    return create_agent_web_app(Agent(TestModel()), workspace_helpers={})


def _client(app: Any, scope: str = _ADMIN) -> TestClient:
    return TestClient(authenticated_asgi_app(app, scope=scope))


@pytest.mark.parametrize(
    ('method', 'path', 'body', 'op_id', 'value', 'sent', 'expected'),
    [
        (
            'GET',
            '/graph/search?query=fans&top_k=1',
            None,
            'retrieval.search',
            {'results': [{'id': 'a'}, {'id': 'b'}]},
            {'query': 'fans'},
            [{'id': 'a'}],
        ),
        (
            'POST',
            '/graph/magma',
            {'query': 'fans'},
            'retrieval.search',
            [{'id': 'a'}],
            {'query': 'fans'},
            [{'id': 'a'}],
        ),
        (
            'POST',
            '/graph/query',
            {'query': 'MATCH (n) RETURN n LIMIT 1'},
            'query.uql',
            {'rows': [{'n': 1}]},
            {'text': 'MATCH (n) RETURN n LIMIT 1', 'params': {}},
            [{'n': 1}],
        ),
        (
            'GET',
            '/graph/memory/note-1',
            None,
            'memory.read',
            {'tenant': 't', 'key': 'note-1', 'value': {'text': 'hi'}},
            {'key': 'note-1'},
            {'tenant': 't', 'key': 'note-1', 'value': {'text': 'hi'}},
        ),
        (
            'GET',
            '/sessions',
            None,
            'agents.tasks.list',
            {'tasks': [{'id': 'task-1'}]},
            {'limit': 50},
            [{'id': 'task-1'}],
        ),
        (
            'GET',
            '/sessions/task-1',
            None,
            'agents.tasks.get',
            {'id': 'task-1', 'status': {'state': 'working'}},
            {'task_id': 'task-1'},
            {'id': 'task-1', 'status': {'state': 'working'}},
        ),
        (
            'GET',
            '/llm/models',
            None,
            'ops.config',
            {'settings': {'chat_models': [{'id': 'm1', 'api_key_ref': 'vault:x'}]}},
            {},
            [{'id': 'm1'}],
        ),
        (
            'GET',
            '/ecosystem/services',
            None,
            'fleet.status',
            {'servers': [{'name': 'b-mcp'}, {'name': 'a-mcp'}]},
            {},
            ['a-mcp', 'b-mcp'],
        ),
        (
            'GET',
            '/mcp/servers/a-mcp/tools?limit=1',
            None,
            'fleet.catalog.list',
            {'items': [{'name': 'x'}, {'name': 'y'}]},
            {'servers': ['a-mcp']},
            {
                'server': 'a-mcp',
                'tools': [{'name': 'x'}],
                'total': 2,
                'offset': 0,
                'limit': 1,
            },
        ),
        (
            'GET',
            '/graph/nodes?node_type=Tool',
            None,
            'eg.graph.GetNodesByLabel',
            [['t1', {'node_type': 'Tool', 'name': 'ping'}]],
            {'label': 'Tool', 'after': None},
            [{'id': 't1', 'labels': ['Tool'], 'properties': {'name': 'ping'}}],
        ),
        (
            'GET',
            '/graph/relationships',
            None,
            'eg.graph.GetEdgesPage',
            [['a', 'b', 0, list(msgpack.packb({'type': 'USES'}))]],
            {'after': None},
            [{'source': 'a', 'type': 'USES', 'target': 'b'}],
        ),
        (
            'GET',
            '/atlas/sources',
            None,
            'ingest.sources.list',
            {'sources': [{'id': 'github'}]},
            {},
            {'sources': [{'id': 'github'}]},
        ),
    ],
)
# spec: APIUI-06.1
def test_read_routes_project_the_served_operation(
    app, arbora, method, path, body, op_id, value, sent, expected
) -> None:
    arbora.results[op_id] = value
    response = _client(app).request(method, f'/api/enhanced{path}', json=body)
    assert response.status_code == 200, response.text
    assert response.json() == expected
    called, params, headers = arbora.calls[-1]
    assert called == op_id
    assert sent.items() <= params.items()
    assert headers['accept'] == 'application/json'


@pytest.mark.parametrize(
    ('path', 'body', 'op_id', 'sent'),
    [
        (
            '/graph/memory',
            {'id': 'note-1', 'text': 'hi'},
            'memory.write',
            {'key': 'note-1'},
        ),
        (
            '/mcp/tools/call',
            {'server': 'a-mcp', 'tool': 'ping', 'arguments': {'n': 1}},
            'fleet.call',
            {'server': 'a-mcp', 'tool': 'ping', 'arguments': {'n': 1}},
        ),
        ('/sessions/task-1/cancel', None, 'agents.tasks.cancel', {'task_id': 'task-1'}),
        (
            '/graph/link',
            {'source': 'a', 'target': 'b', 'relationship_type': 'USES'},
            'eg.graph.AddEdge',
            {
                'source_id': 'a',
                'target_id': 'b',
                'properties_msgpack': list(msgpack.packb({'type': 'USES'})),
            },
        ),
        (
            '/atlas/sources/sync',
            {'source': 'github', 'mode': 'full'},
            'ingest.sources.sync',
            {'source_id': 'github', 'mode': 'full'},
        ),
    ],
)
def test_write_routes_send_one_idempotency_key(
    app, arbora, path, body, op_id, sent
) -> None:
    arbora.results[op_id] = {'status': 'ok'}
    response = _client(app).post(f'/api/enhanced{path}', json=body)
    assert response.status_code == 200, response.text
    called, params, headers = arbora.calls[-1]
    assert called == op_id
    assert sent.items() <= params.items()
    assert len(headers['idempotency-key']) == 32


def test_a_missing_operation_answers_not_available(app, arbora) -> None:
    response = _client(app).get('/api/enhanced/graph/search?query=x')
    assert response.status_code == 501
    assert response.json()['detail']['needs_operation'] == 'retrieval.search'


@pytest.mark.parametrize(
    ('code', 'status'),
    [('PERMISSION_DENIED', 403), ('INVALID_ARGUMENT', 400), ('SOMETHING_NEW', 502)],
)
def test_a_arbora_refusal_keeps_its_status(app, arbora, code, status) -> None:
    arbora.results['retrieval.search'] = httpx.Response(
        403, json={'ok': False, 'error': {'code': code, 'message': 'secret detail'}}
    )
    response = _client(app).get('/api/enhanced/graph/search?query=x')
    assert response.status_code == status
    assert 'secret detail' not in response.text


@pytest.mark.parametrize(
    ('path', 'operation'),
    [
        ('/graph/impact/main', 'graph.impact.read'),
        ('/kb/list', 'kb.articles.read'),
        ('/cron/calendar', 'schedule.tasks.read'),
    ],
)
# spec: APIUI-06.1
def test_routes_without_a_served_operation_answer_not_available(
    app, arbora, path, operation
) -> None:
    response = _client(app).get(f'/api/enhanced{path}')
    assert response.status_code == 501
    detail = response.json()['detail']
    assert (detail['error'], detail['needs_operation']) == ('not_available', operation)
    assert arbora.calls == []


def test_unsafe_graph_queries_never_reach_arbora(app, arbora) -> None:
    arbora.results['query.uql'] = []
    response = _client(app).post(
        '/api/enhanced/graph/query', json={'query': 'MATCH (n) DETACH DELETE n'}
    )
    assert response.status_code == 400
    assert arbora.calls == []


@pytest.mark.parametrize(
    ('scope', 'method', 'path', 'expected'),
    [
        ('kg:read', 'POST', '/api/enhanced/graph/query', 403),
        ('kg:read kg:write', 'POST', '/api/enhanced/graph/query', 403),
        (_ADMIN, 'POST', '/api/enhanced/graph/query', 200),
        ('kg:read', 'GET', '/api/enhanced/tunnel-manager/hosts', 403),
        ('kg:read', 'GET', '/api/enhanced/graph/search?query=x', 200),
        ('kg:read', 'GET', '/api/enhanced/sessions', 200),
    ],
)
def test_route_scopes_gate_before_arbora(
    app, arbora, scope, method, path, expected
) -> None:
    arbora.results.update(
        {'query.uql': [], 'retrieval.search': [], 'agents.tasks.list': []}
    )
    response = _client(app, scope).request(
        method, path, json={'query': 'MATCH (n) RETURN n'} if method == 'POST' else None
    )
    assert response.status_code == expected
    assert bool(arbora.calls) == (expected == 200)


def test_an_unauthenticated_request_is_refused(app, arbora) -> None:
    response = TestClient(app).get('/api/enhanced/graph/search?query=x')
    assert response.status_code == 401
    assert arbora.calls == []
