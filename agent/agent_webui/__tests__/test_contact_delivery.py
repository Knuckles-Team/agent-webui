"""Live-path tests for the fail-closed contact delivery boundary."""

from __future__ import annotations

import asyncio
import inspect
from typing import Any

import pytest
from agent_webui.contact_delivery import (
    ContactDeliveryRequest,
    ContactDeliveryResult,
)
from agent_webui.server import create_agent_web_app
from fastapi.testclient import TestClient

VALID_SUBMISSION = {
    'name': 'Test Operator',
    'email': 'operator@example.test',
    'subject': 'A bounded question',
    'message': 'Please confirm this synthetic test submission.',
    'idempotency_key': 'contactreq_0123456789abcdef0123456789abcdef',
}
SAME_ORIGIN = {'Origin': 'http://testserver'}
OPAQUE_RECEIPT = 'contact_abcdefghijklmnop'


class RecordingDelivery:
    supports_atomic_idempotency = True
    supports_shared_rate_limit = True

    def __init__(
        self,
        *,
        success: bool = True,
        receipt: str | None = OPAQUE_RECEIPT,
        error: Exception | None = None,
    ) -> None:
        self.success = success
        self.receipt = receipt
        self.error = error
        self.requests: list[ContactDeliveryRequest] = []

    async def __call__(self, request: ContactDeliveryRequest) -> ContactDeliveryResult:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        return ContactDeliveryResult(success=self.success, receipt=self.receipt)


@pytest.fixture(autouse=True)
def contact_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv('AGENT_WEBUI_CONTACT_DESTINATION', 'configured-support-inbox')
    monkeypatch.setenv('AGENT_WEBUI_CONTACT_RETENTION_DAYS', '30')


def _app(mock_agent: Any, delivery: RecordingDelivery | None) -> Any:
    return create_agent_web_app(mock_agent, {}, contact_delivery=delivery)


def test_contact_delivery_is_part_of_the_public_app_factory_contract() -> None:
    """The published backend must retain its host-injected delivery seam."""
    parameter = inspect.signature(create_agent_web_app).parameters['contact_delivery']

    assert parameter.default is None
    assert parameter.kind is inspect.Parameter.POSITIONAL_OR_KEYWORD


def test_confirmed_delivery_returns_only_an_opaque_receipt(
    mock_agent: Any,
    authenticated_client_factory: Any,
) -> None:
    delivery = RecordingDelivery()
    client = authenticated_client_factory(
        _app(mock_agent, delivery), raise_server_exceptions=False
    )

    response = client.post('/api/contact', headers=SAME_ORIGIN, json=VALID_SUBMISSION)

    assert response.status_code == 200, response.text
    assert set(response.json()) == {'receipt'}
    assert response.json()['receipt'] == OPAQUE_RECEIPT
    assert len(delivery.requests) == 1
    request = delivery.requests[0]
    assert request.destination == 'configured-support-inbox'
    assert request.retention_days == 30
    assert request.submission.model_dump() == VALID_SUBMISSION
    assert request.idempotency_key == VALID_SUBMISSION['idempotency_key']
    assert request.actor_reference != 'test-suite'


@pytest.mark.parametrize(
    'headers',
    [
        {},
        {'Origin': 'https://attacker.example'},
        {'Origin': 'http://testserver/path'},
        {'Origin': 'null'},
    ],
)
def test_route_requires_an_exact_browser_origin(
    mock_agent: Any,
    authenticated_client_factory: Any,
    headers: dict[str, str],
) -> None:
    delivery = RecordingDelivery()
    client = authenticated_client_factory(
        _app(mock_agent, delivery), raise_server_exceptions=False
    )

    response = client.post('/api/contact', headers=headers, json=VALID_SUBMISSION)

    assert response.status_code == 403
    assert delivery.requests == []


def test_route_requires_authenticated_identity(
    mock_agent: Any,
) -> None:
    delivery = RecordingDelivery()
    client = TestClient(_app(mock_agent, delivery), raise_server_exceptions=False)

    response = client.post('/api/contact', headers=SAME_ORIGIN, json=VALID_SUBMISSION)

    assert response.status_code == 401
    assert delivery.requests == []


@pytest.mark.parametrize(
    'missing',
    ['adapter', 'destination', 'retention', 'atomic-idempotency', 'shared-rate-limit'],
)
def test_incomplete_delivery_policy_fails_closed(
    mock_agent: Any,
    authenticated_client_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
    missing: str,
) -> None:
    delivery = RecordingDelivery()
    adapter: RecordingDelivery | None = delivery
    if missing == 'adapter':
        adapter = None
    elif missing == 'destination':
        monkeypatch.delenv('AGENT_WEBUI_CONTACT_DESTINATION')
    elif missing == 'retention':
        monkeypatch.delenv('AGENT_WEBUI_CONTACT_RETENTION_DAYS')
    elif missing == 'atomic-idempotency':
        delivery.supports_atomic_idempotency = False
    else:
        delivery.supports_shared_rate_limit = False
    client = authenticated_client_factory(
        _app(mock_agent, adapter), raise_server_exceptions=False
    )

    response = client.post('/api/contact', headers=SAME_ORIGIN, json=VALID_SUBMISSION)

    assert response.status_code == 503
    assert delivery.requests == []


@pytest.mark.parametrize(
    'delivery',
    [
        RecordingDelivery(success=False),
        RecordingDelivery(receipt=None),
        RecordingDelivery(receipt='provider-message-id'),
        RecordingDelivery(error=RuntimeError('provider-id=secret message=private')),
    ],
)
def test_unconfirmed_delivery_never_exposes_provider_data(
    mock_agent: Any,
    authenticated_client_factory: Any,
    delivery: RecordingDelivery,
) -> None:
    client = authenticated_client_factory(
        _app(mock_agent, delivery), raise_server_exceptions=False
    )

    response = client.post('/api/contact', headers=SAME_ORIGIN, json=VALID_SUBMISSION)

    assert response.status_code == 503
    assert 'provider-id' not in response.text
    assert 'private' not in response.text
    assert 'secret' not in response.text


def test_schema_rejects_extra_routing_fields_and_oversized_content(
    mock_agent: Any,
    authenticated_client_factory: Any,
) -> None:
    delivery = RecordingDelivery()
    client = authenticated_client_factory(
        _app(mock_agent, delivery), raise_server_exceptions=False
    )

    for body in (
        {**VALID_SUBMISSION, 'channel': 'caller-selected'},
        {**VALID_SUBMISSION, 'message': 'x' * 4001},
        {**VALID_SUBMISSION, 'email': 'not-an-email'},
        {**VALID_SUBMISSION, 'subject': 'unsafe\r\nBcc: attacker@example.test'},
        {**VALID_SUBMISSION, 'message': 'unsafe\x00content'},
        {**VALID_SUBMISSION, 'idempotency_key': 'caller-chosen'},
    ):
        response = client.post('/api/contact', headers=SAME_ORIGIN, json=body)
        assert response.status_code == 422
    assert delivery.requests == []


def test_global_body_boundary_rejects_an_oversized_json_envelope(
    mock_agent: Any,
    authenticated_client_factory: Any,
) -> None:
    delivery = RecordingDelivery()
    client = authenticated_client_factory(
        _app(mock_agent, delivery), raise_server_exceptions=False
    )

    response = client.post(
        '/api/contact',
        headers=SAME_ORIGIN,
        json={**VALID_SUBMISSION, 'message': 'x' * (2 * 1024 * 1024)},
    )

    assert response.status_code == 413
    assert delivery.requests == []


def test_contact_rate_limit_is_independent_and_bounded(
    mock_agent: Any,
    authenticated_client_factory: Any,
) -> None:
    delivery = RecordingDelivery()
    client = authenticated_client_factory(
        _app(mock_agent, delivery), raise_server_exceptions=False
    )

    responses = [
        client.post('/api/contact', headers=SAME_ORIGIN, json=VALID_SUBMISSION)
        for _ in range(6)
    ]

    assert [response.status_code for response in responses] == [
        200,
        200,
        200,
        200,
        200,
        429,
    ]
    assert len(delivery.requests) == 5
    assert responses[-1].headers['retry-after'] == '60'


def test_malformed_adapter_result_fails_closed(
    mock_agent: Any,
    authenticated_client_factory: Any,
) -> None:
    class MalformedDelivery(RecordingDelivery):
        async def __call__(self, request: ContactDeliveryRequest) -> Any:
            self.requests.append(request)
            return {'success': 'false', 'receipt': OPAQUE_RECEIPT}

    delivery = MalformedDelivery()
    client = authenticated_client_factory(
        _app(mock_agent, delivery), raise_server_exceptions=False
    )

    response = client.post('/api/contact', headers=SAME_ORIGIN, json=VALID_SUBMISSION)

    assert response.status_code == 503
    assert response.json() == {'detail': 'Internal request failed'}


def test_delivery_deadline_fails_closed_with_unknown_outcome(
    mock_agent: Any,
    authenticated_client_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class HangingDelivery(RecordingDelivery):
        async def __call__(
            self, request: ContactDeliveryRequest
        ) -> ContactDeliveryResult:
            self.requests.append(request)
            await asyncio.Event().wait()
            raise AssertionError('unreachable')

    monkeypatch.setattr('agent_webui.contact_delivery._DELIVERY_TIMEOUT_SECONDS', 0.001)
    delivery = HangingDelivery()
    client = authenticated_client_factory(
        _app(mock_agent, delivery), raise_server_exceptions=False
    )

    response = client.post('/api/contact', headers=SAME_ORIGIN, json=VALID_SUBMISSION)

    assert response.status_code == 503
    assert response.json() == {'detail': 'Internal request failed'}
    assert len(delivery.requests) == 1
