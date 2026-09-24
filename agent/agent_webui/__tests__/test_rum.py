"""EH-410: first-party RUM -- fixed shape, no client identity, OTLP relay."""

from __future__ import annotations

from typing import Any

import pytest
from agent_webui import rum
from fastapi import FastAPI
from fastapi.testclient import TestClient

SAMPLE = {
    'session': 'rum_' + 'a' * 32,
    'day': '2026-09-24',
    'route': '/graph',
    'vitals': {'LCP': 1234.5, 'CLS': 0.02, 'BOGUS': 1.0, 'INP': -3.0},
}


@pytest.fixture
def relayed(monkeypatch) -> list[tuple[str, dict[str, Any]]]:
    calls: list[tuple[str, dict[str, Any]]] = []

    async def post(endpoint: str, body: dict) -> None:
        calls.append((endpoint, body))

    monkeypatch.setattr(rum, '_post', post)
    monkeypatch.setenv('RUM_OTLP_METRICS_ENDPOINT', 'http://collector:4318/v1/metrics')
    return calls


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(rum.build_rum_router(), prefix='/api')
    return TestClient(app)


def test_a_sample_is_relayed_as_rum_gauges_without_client_identity(relayed):
    response = _client().post(
        '/api/rum',
        json=SAMPLE,
        headers={'User-Agent': 'Secret-Browser/1.0', 'X-Forwarded-For': '203.0.113.9'},
    )
    assert response.status_code == 204 and response.content == b''
    ((endpoint, body),) = relayed
    assert endpoint.endswith('/v1/metrics')
    metrics = body['resourceMetrics'][0]['scopeMetrics'][0]['metrics']
    assert [m['name'] for m in metrics] == ['rum_cls', 'rum_lcp']
    attrs = {a['key'] for a in metrics[0]['gauge']['dataPoints'][0]['attributes']}
    assert attrs == {'route', 'rum_session', 'rum_day'}
    rendered = repr(body)
    assert 'Secret-Browser' not in rendered and '203.0.113.9' not in rendered


def test_malformed_or_extra_fields_are_refused(relayed):
    client = _client()
    for bad in (
        {**SAMPLE, 'session': 'alice'},
        {**SAMPLE, 'route': 'https://evil.example/'},
        {**SAMPLE, 'ip': '1.2.3.4'},
    ):
        assert client.post('/api/rum', json=bad).status_code == 422
    assert relayed == []


def test_without_a_collector_the_sample_is_accepted_and_dropped(relayed, monkeypatch):
    monkeypatch.delenv('RUM_OTLP_METRICS_ENDPOINT')
    assert _client().post('/api/rum', json=SAMPLE).status_code == 204
    assert relayed == []
