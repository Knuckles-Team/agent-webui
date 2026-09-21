"""Live-path and trust-boundary tests for the Graph OS browser channel."""

from __future__ import annotations

import base64
import hashlib
import inspect
import json
import time
import zlib
from types import SimpleNamespace
from typing import Any

import pytest
from agent_webui.browser_control import (
    BrowserControlBinding,
    BrowserMessage,
    ControlCancelled,
)
from agent_webui.browser_control_canonical import canonical_protocol_json
from agent_webui.server import create_agent_web_app
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from pydantic import BaseModel, ConfigDict
from starlette.websockets import WebSocketDisconnect

pytestmark = pytest.mark.integration

_SESSION_KEY = base64.urlsafe_b64encode(b'b' * 32).decode('ascii')
_DIGEST = 'sha256:ae521b848379a3520ed9e6f2482686fd91d9704662d6a349729fee2220e299ac'
_CATALOG_DIGEST = f'sha256:{"b" * 64}'
_TOOL_SCOPE_DIGEST = f'sha256:{"c" * 64}'
_OPEN: dict[str, Any] = {
    'protocol': 'webmcp.control.v1',
    'type': 'channel.open',
    'route_id': 'knowledge.graph',
    'registration_generation': 7,
    'attended': True,
    'secure_context': True,
    'permissions_policy': True,
    'document_visible': True,
}
_CATALOG: dict[str, Any] = {
    'protocol': 'webmcp.control.v1',
    'type': 'catalog.register',
    'authority': 'browser-local',
    'route_id': 'knowledge.graph',
    'registration_generation': 7,
    'catalog_digest': _CATALOG_DIGEST,
    'tool_scope_digest': _TOOL_SCOPE_DIGEST,
    'tools': [
        {
            'tool_id': 'webui.page.context',
            'version': '1.0.0',
            'input_schema': {'type': 'object', 'additionalProperties': False},
            'output_schema': {'type': 'object'},
            'schema_digest': _DIGEST,
            'mutation_class': 'read',
            'confirmation_policy': 'none',
            'required_roles': ['kg:read'],
            'source_ref': 'agent-webui:webmcp/tools',
        }
    ],
}


class RecordingConnection:
    def __init__(self) -> None:
        self.messages: list[BrowserMessage] = []
        self.disconnect_reasons: list[str] = []
        self.outbound_send: Any = None
        self.emit_after_catalog = False

    async def receive(self, message: BrowserMessage) -> Any:
        self.messages.append(message)
        if message.type == 'catalog.register':
            return {
                'authority': 'graph-os',
                'route_id': message.route_id,
                'registration_generation': message.registration_generation,
                'catalog_digest': message.catalog_digest,
                'tool_scope_digest': message.tool_scope_digest,
            }
        if self.emit_after_catalog and message.type != 'catalog.register':
            self.emit_after_catalog = False
            await self.outbound_send(
                _AuCancel(
                    protocol='webmcp.control.v1',
                    type='control.cancel',
                    call_id='call_123',
                    reason='lease_expired',
                )
            )
        return None

    async def disconnect(self, reason: str) -> None:
        self.disconnect_reasons.append(reason)


class MismatchedCatalogReceiptConnection(RecordingConnection):
    async def receive(self, message: BrowserMessage) -> Any:
        receipt = await super().receive(message)
        if message.type == 'catalog.register':
            return {**receipt, 'catalog_digest': f'sha256:{"f" * 64}'}
        return receipt


class AcknowledgingConnection(RecordingConnection):
    async def receive(self, message: BrowserMessage) -> Any:
        receipt = await super().receive(message)
        if message.type != 'catalog.register':
            await self.outbound_send(
                _AuCancel(
                    protocol='webmcp.control.v1',
                    type='control.cancel',
                    call_id=message.call_id,
                    reason='authority_ack',
                )
            )
        return receipt


class _AuCancel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

    protocol: str
    type: str
    call_id: str
    reason: str


class RecordingPort:
    authority = 'graph-os'
    supports_durable_fences = True
    supports_durable_audit = True
    supports_attended_leases = True
    supports_live_revalidation = True
    supports_backchannel_revalidation = True
    supports_catalog_verification = True

    def __init__(self, *, emit_after_catalog: bool = False) -> None:
        self.bindings: list[BrowserControlBinding] = []
        self.connection = RecordingConnection()
        self.connection.emit_after_catalog = emit_after_catalog

    async def open_channel(self, binding: BrowserControlBinding, send: Any) -> Any:
        self.bindings.append(binding)
        self.connection.outbound_send = send
        return self.connection

    async def finalize_attended_arm(self, _grant: Any, binding: Any) -> Any:
        return binding

    async def revoke_attended_arm(self, binding: Any) -> Any:
        return binding


class OneUseRecordingPort(RecordingPort):
    def __init__(self) -> None:
        super().__init__()
        self.consumed: set[str] = set()

    async def open_channel(self, binding: BrowserControlBinding, send: Any) -> Any:
        if binding.attended_arm_ref in self.consumed:
            raise PermissionError('attended arm already consumed')
        self.consumed.add(binding.attended_arm_ref)
        return await super().open_channel(binding, send)


class FailingOpenPort(RecordingPort):
    def __init__(self) -> None:
        super().__init__()
        self.revoked: list[BrowserControlBinding] = []

    async def open_channel(self, binding: BrowserControlBinding, send: Any) -> Any:
        self.bindings.append(binding)
        raise RuntimeError('synthetic Graph OS open failure')

    async def revoke_attended_arm(self, binding: BrowserControlBinding) -> Any:
        self.revoked.append(binding)
        return SimpleNamespace(
            status='revoked',
            attended_arm_ref=binding.attended_arm_ref,
            attended_arm_expires_at=binding.attended_arm_expires_at,
            catalog_digest=binding.catalog_digest,
            tool_scope_digest=binding.tool_scope_digest,
        )


class VerifiedAttendedArmMiddleware:
    """Test stand-in for the server step-up verifier that populates ASGI state."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        now = time.time()

        async def revalidate() -> bool:
            return True

        state = dict(scope.get('state') or {})
        state.update(
            {
                'browser_attended_arm_ref': f'attended_{"a" * 64}',
                'browser_document_ref': f'document_{"d" * 64}',
                'browser_attended_arm_issued_at': now,
                'browser_attended_arm_expires_at': now + 240,
                'browser_access_token_expires_at': now + 300,
                'browser_attended_route_id': 'knowledge.graph',
                'browser_attended_registration_generation': 7,
                'browser_attended_catalog_digest': _CATALOG_DIGEST,
                'browser_attended_tool_scope_digest': _TOOL_SCOPE_DIGEST,
                'browser_attended_subject': 'human-operator',
                'browser_attended_tenant': 'homelab',
                'browser_attended_auth_time': now - 1,
                'browser_attended_acr': 'urn:example:acr:mfa',
                'browser_attended_issuer': 'https://idp.invalid',
                'browser_session_revalidator': revalidate,
            }
        )
        await self.app({**scope, 'state': state}, receive, send)


def _configure_identity(
    monkeypatch: pytest.MonkeyPatch,
    *,
    human: bool = True,
    allowed_origins: str = 'https://au.example',
) -> None:
    import agent_utilities.security.request_identity as request_identity
    from agent_utilities.core.config import config
    from agent_utilities.security.actor_identity import ActorType
    from agent_utilities.security.brain_context import ActorContext

    monkeypatch.setenv('WEBUI_SESSION_KEY', _SESSION_KEY)
    monkeypatch.setenv('WEBUI_OIDC_CLIENT_ID', 'agent-webui')
    monkeypatch.setenv('WEBUI_OIDC_CLIENT_SECRET', 'synthetic-test-secret')
    monkeypatch.setenv('WEBUI_OIDC_ISSUER', 'https://idp.invalid')
    monkeypatch.setenv('WEBUI_OIDC_REDIRECT_URI', 'https://au.example/auth/callback')
    monkeypatch.setattr(
        config, 'auth_jwt_jwks_uri', 'https://idp.invalid/certs', raising=False
    )
    monkeypatch.setattr(
        config, 'auth_jwt_issuer', 'https://idp.invalid/', raising=False
    )
    monkeypatch.setattr(config, 'auth_jwt_audience', 'agent-webui', raising=False)
    monkeypatch.setattr(config, 'kg_policy_version', '1', raising=False)
    monkeypatch.setattr(config, 'allowed_hosts', 'au.example', raising=False)
    monkeypatch.setattr(config, 'allowed_origins', allowed_origins, raising=False)
    actor = ActorContext(
        actor_id='human-operator' if human else 'service-client',
        actor_type=ActorType.HUMAN if human else ActorType.AUTOMATED_SERVICE,
        tenant_id='homelab',
        roles=('kg:read', 'kg:write'),
        authenticated=True,
        credential_expires_at=int(time.time() + 900),
    )

    async def actor_from_bearer_token(_token: str) -> ActorContext:
        return actor

    monkeypatch.setattr(
        request_identity, 'actor_from_bearer_token', actor_from_bearer_token
    )


def _app(
    mock_agent: Any,
    port: RecordingPort | None,
    *,
    attended_arm: bool = True,
) -> Any:
    app = create_agent_web_app(mock_agent, {}, browser_control=port)
    if attended_arm:
        app.add_middleware(VerifiedAttendedArmMiddleware)
    return app


def _browser_headers(*, origin: str = 'https://au.example') -> dict[str, str]:
    session = {
        'access_token': 'verified-human-access-token',
        'refresh_token': '',
        'expires_at': time.time() + 300,
    }
    packed = zlib.compress(json.dumps(session).encode('utf-8'), 9)
    sealed = Fernet(_SESSION_KEY.encode('ascii')).encrypt(packed).decode('ascii')
    return {
        'Cookie': f'au_session0={sealed}',
        'Host': 'au.example',
        'Origin': origin,
        'X-Forwarded-Proto': 'https',
        'User-Agent': 'browser-control-test',
    }


def test_browser_control_is_a_public_injected_factory_contract() -> None:
    parameter = inspect.signature(create_agent_web_app).parameters['browser_control']

    assert parameter.default is None
    assert parameter.kind is inspect.Parameter.POSITIONAL_OR_KEYWORD


def test_browser_control_route_is_always_registered(mock_agent: Any) -> None:
    app = _app(mock_agent, None)

    # FastAPI 0.139 keeps included routers behind an internal lazy route rather
    # than flattening every child into ``app.routes``.  Resolve the public route
    # name so this assertion covers both router representations.
    assert str(app.url_path_for('browser_control')) == '/ws/browser-control'


@pytest.mark.parametrize(
    'headers',
    [
        {'Host': 'disallowed.example'},
        {'Host': 'au.example,disallowed.example'},
        [('Host', 'au.example'), ('Host', 'disallowed.example')],
    ],
)
def test_oidc_owned_routes_are_behind_the_exact_host_boundary(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
    headers: Any,
) -> None:
    _configure_identity(monkeypatch)
    client = TestClient(_app(mock_agent, RecordingPort()))

    response = client.get('/auth/login', headers=headers, follow_redirects=False)

    assert response.status_code == 400


def test_authority_without_live_catalog_verification_fails_closed(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    port.supports_catalog_verification = False
    client = TestClient(_app(mock_agent, port))

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.receive_json()

    assert denied.value.code == 1013


def test_authority_without_backchannel_session_revalidation_fails_closed(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    port.supports_backchannel_revalidation = False
    client = TestClient(_app(mock_agent, port))

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.receive_json()

    assert denied.value.code == 1013
    assert port.bindings == []


def test_authenticated_channel_binds_opaque_server_identity_and_forwards_catalog(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))

    with client.websocket_connect(
        '/ws/browser-control', headers=_browser_headers()
    ) as websocket:
        websocket.send_json(_OPEN)
        websocket.send_json(_CATALOG)

    assert len(port.bindings) == 1
    binding = port.bindings[0]
    assert binding.session.actor.actor_id == 'human-operator'
    assert binding.session.tenant == 'homelab'
    assert binding.origin == 'https://au.example'
    assert binding.route_id == 'knowledge.graph'
    assert binding.registration_generation == 7
    assert binding.catalog_digest == _CATALOG_DIGEST
    assert binding.tool_scope_digest == _TOOL_SCOPE_DIGEST
    assert binding.attended is True
    assert binding.login_session_ref.startswith('login_')
    assert binding.browser_session_ref.startswith('browser_')
    assert binding.principal_ref.startswith('principal_')
    assert binding.document_ref.startswith('document_')
    assert binding.attended_arm_ref.startswith('attended_')
    assert binding.attended_arm_expires_at > time.time()
    exposed = repr(binding)
    assert 'verified-human-access-token' not in exposed
    assert 'sealed-browser-session' not in exposed
    assert len(port.connection.messages) == 1
    assert port.connection.messages[0].type == 'catalog.register'
    assert port.connection.disconnect_reasons == ['channel_lost']


def test_authority_rejects_replay_of_the_same_server_attended_receipt(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = OneUseRecordingPort()
    client = TestClient(_app(mock_agent, port))

    with client.websocket_connect(
        '/ws/browser-control', headers=_browser_headers()
    ) as websocket:
        websocket.send_json(_OPEN)
        websocket.send_json(_CATALOG)
        assert websocket.receive_json()['type'] == 'channel.ready'

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(_OPEN)
            websocket.receive_json()

    assert denied.value.code == 1011


def test_browser_claim_without_server_attended_arm_receipt_fails_closed(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port, attended_arm=False))

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(_OPEN)
            websocket.receive_json()

    assert denied.value.code == 4403
    assert port.bindings == []


def test_post_reload_document_generation_must_match_the_finalized_arm(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))
    stale_open = {**_OPEN, 'registration_generation': 8}

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(stale_open)
            websocket.receive_json()

    assert denied.value.code == 4403
    assert port.bindings == []


def test_structural_au_message_is_validated_and_sent_to_browser(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort(emit_after_catalog=True)
    client = TestClient(_app(mock_agent, port))

    with client.websocket_connect(
        '/ws/browser-control', headers=_browser_headers()
    ) as websocket:
        websocket.send_json(_OPEN)
        websocket.send_json(_CATALOG)
        assert websocket.receive_json() == {
            'protocol': 'webmcp.control.v1',
            'type': 'channel.ready',
            'authority': 'graph-os',
            'route_id': 'knowledge.graph',
            'registration_generation': 7,
            'catalog_digest': _CATALOG_DIGEST,
            'tool_scope_digest': _TOOL_SCOPE_DIGEST,
        }
        websocket.send_json(
            {
                'protocol': 'webmcp.control.v1',
                'type': 'control.cancelled',
                'call_id': 'call_123',
                'effect': 'none',
            }
        )
        message = websocket.receive_json()

    assert message == {
        'protocol': 'webmcp.control.v1',
        'type': 'control.cancel',
        'call_id': 'call_123',
        'reason': 'lease_expired',
    }


def test_one_injected_connection_handles_every_browser_event_and_outbound_send(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    port.connection = AcknowledgingConnection()
    client = TestClient(_app(mock_agent, port))
    events = [
        {
            'protocol': 'webmcp.control.v1',
            'type': 'control.confirm',
            'call_id': 'call_confirm',
            'confirmation_digest': _DIGEST,
        },
        {
            'protocol': 'webmcp.control.v1',
            'type': 'control.result',
            'call_id': 'call_result',
            'status': 'succeeded',
            'result': {'value': 1},
        },
        {
            'protocol': 'webmcp.control.v1',
            'type': 'control.cancelled',
            'call_id': 'call_cancelled',
            'effect': 'unknown',
        },
    ]

    with client.websocket_connect(
        '/ws/browser-control', headers=_browser_headers()
    ) as websocket:
        websocket.send_json(_OPEN)
        websocket.send_json(_CATALOG)
        assert websocket.receive_json()['authority'] == 'graph-os'
        for event in events:
            websocket.send_json(event)
            assert websocket.receive_json() == {
                'protocol': 'webmcp.control.v1',
                'type': 'control.cancel',
                'call_id': event['call_id'],
                'reason': 'authority_ack',
            }

    assert len(port.bindings) == 1
    assert [message.type for message in port.connection.messages] == [
        'catalog.register',
        'control.confirm',
        'control.result',
        'control.cancelled',
    ]


def test_channel_ready_refuses_a_tampered_graph_os_catalog_receipt(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    port.connection = MismatchedCatalogReceiptConnection()
    client = TestClient(_app(mock_agent, port))

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(_OPEN)
            websocket.send_json(_CATALOG)
            websocket.receive_json()

    assert denied.value.code == 4400


def test_channel_open_failure_revokes_the_same_authoritative_arm(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = FailingOpenPort()
    client = TestClient(_app(mock_agent, port))

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(_OPEN)
            websocket.receive_json()

    assert denied.value.code == 1011
    assert len(port.bindings) == 1
    assert port.revoked == port.bindings


@pytest.mark.parametrize(
    ('port', 'human', 'service_bearer', 'expected_code'),
    [
        (None, True, False, 1013),
        (RecordingPort(), False, False, 4403),
        (RecordingPort(), True, True, 4403),
    ],
)
def test_missing_authority_or_browser_login_fails_closed(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
    port: RecordingPort | None,
    human: bool,
    service_bearer: bool,
    expected_code: int,
) -> None:
    _configure_identity(monkeypatch)
    if not human:
        _configure_identity(monkeypatch, human=False)
    client = TestClient(_app(mock_agent, port))
    headers = _browser_headers()
    if service_bearer:
        headers['Authorization'] = 'Bearer direct-service-credential'

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=headers
        ) as websocket:
            if port is not None:
                websocket.send_json(_OPEN)
                websocket.receive_json()

    assert denied.value.code == expected_code
    if port is not None:
        assert port.bindings == []


def test_insecure_non_loopback_origin_fails_closed_after_global_origin_check(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(
        monkeypatch,
        allowed_origins='https://au.example,http://insecure.example',
    )
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))
    headers = _browser_headers(origin='http://insecure.example')

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=headers
        ) as websocket:
            websocket.send_json(_OPEN)
            websocket.receive_json()

    assert denied.value.code == 4403
    assert port.bindings == []


@pytest.mark.parametrize(
    'opened',
    [
        {**_OPEN, 'attended': False},
        {**_OPEN, 'secure_context': False},
        {**_OPEN, 'permissions_policy': False},
        {**_OPEN, 'document_visible': False},
        {**_OPEN, 'service_token': 'forbidden'},
    ],
)
def test_channel_open_requires_every_attended_trust_prerequisite(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
    opened: dict[str, Any],
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(opened)
            websocket.receive_json()

    assert denied.value.code == 4400
    assert port.bindings == []


def test_binary_channel_frames_are_rejected_as_protocol_input(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_bytes(b'not-json-text')
            websocket.receive_json()

    assert denied.value.code == 4400
    assert port.bindings == []


@pytest.mark.parametrize(
    'raw_message',
    [
        '{"protocol":"webmcp.control.v1","type":"control.result",'
        '"call_id":"call_1","status":"succeeded","result":NaN}',
        '{"protocol":"webmcp.control.v1","type":"control.cancelled",'
        '"call_id":"call_1","call_id":"call_2","effect":"none"}',
    ],
)
def test_nonstandard_or_ambiguous_json_is_rejected(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
    raw_message: str,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(_OPEN)
            websocket.send_text(raw_message)
            websocket.receive_json()

    assert denied.value.code == 4400
    assert port.connection.messages == []


@pytest.mark.parametrize(
    'raw_result',
    [
        '1.5',
        '9007199254740992',
        '"\\ud800"',
    ],
)
def test_protocol_subset_rejects_ambiguous_numbers_and_invalid_unicode(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
    raw_result: str,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))
    message = (
        '{"protocol":"webmcp.control.v1","type":"control.result",'
        '"call_id":"call_1","status":"succeeded","result":'
        f'{raw_result}'
        '}'
    )

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(_OPEN)
            websocket.send_text(message)
            websocket.receive_json()

    assert denied.value.code == 4400
    assert port.connection.messages == []


def test_canonical_json_vector_matches_javascript_utf16_order() -> None:
    value = {
        'z': [True, None, 2**53 - 1, -(2**53 - 1)],
        'a': 'café 雪 😀',
        '\ue000': 'bmp-private-use',
        '😀': 'astral',
        'nested': {'beta': 2, 'alpha': 1},
    }
    canonical = canonical_protocol_json(value)

    assert canonical == (
        '{"a":"café 雪 😀","nested":{"alpha":1,"beta":2},'
        '"z":[true,null,9007199254740991,-9007199254740991],'
        '"😀":"astral","\ue000":"bmp-private-use"}'
    )
    assert hashlib.sha256(canonical.encode()).hexdigest() == (
        'd8fc415c3a0c2de5f586eed3e8a6be46807b24ef0110f398e8a2157425df1862'
    )


def test_catalog_route_or_generation_drift_never_reaches_authority(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))
    stale_catalog = {**_CATALOG, 'registration_generation': 6}

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(_OPEN)
            websocket.send_json(stale_catalog)
            websocket.receive_json()

    assert denied.value.code == 4400
    assert port.connection.messages == []
    assert port.connection.disconnect_reasons == ['invalid_message']


def test_duplicate_tool_id_with_a_different_version_is_rejected(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))
    duplicate = {
        **_CATALOG,
        'tools': [
            *_CATALOG['tools'],
            {**_CATALOG['tools'][0], 'version': '2.0.0'},
        ],
    }

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(_OPEN)
            websocket.send_json(duplicate)
            websocket.receive_json()

    assert denied.value.code == 4400
    assert port.connection.messages == []


@pytest.mark.parametrize(
    'tools',
    [
        [],
        [{**_CATALOG['tools'][0], 'schema_digest': f'sha256:{"f" * 64}'}],
        [{**_CATALOG['tools'][0], 'confirmation_policy': 'exact-request'}],
        [{**_CATALOG['tools'][0], 'required_roles': ['é']}],
    ],
)
def test_catalog_descriptor_invariants_fail_before_graph_os(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
    tools: list[dict[str, Any]],
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(_OPEN)
            websocket.send_json({**_CATALOG, 'tools': tools})
            websocket.receive_json()

    assert denied.value.code == 4400
    assert port.connection.messages == []


def test_second_catalog_is_rejected_without_replacing_the_active_generation(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(_OPEN)
            websocket.send_json(_CATALOG)
            websocket.receive_json()
            websocket.send_json(_CATALOG)
            websocket.receive_json()

    assert denied.value.code == 4400
    assert [message.type for message in port.connection.messages] == [
        'catalog.register'
    ]


def test_channel_message_rate_is_bounded_before_authority_work(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(_OPEN)
            websocket.send_json(_CATALOG)
            websocket.receive_json()
            for _ in range(48):
                websocket.send_json(
                    {
                        'protocol': 'webmcp.control.v1',
                        'type': 'control.cancelled',
                        'call_id': 'call_rate',
                        'effect': 'none',
                    }
                )
            websocket.receive_json()

    assert denied.value.code == 4429
    assert len(port.connection.messages) < 48
    assert port.connection.disconnect_reasons == ['rate_limited']


def test_result_contract_is_bounded_and_reports_honest_cancellation(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))

    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(
            '/ws/browser-control', headers=_browser_headers()
        ) as websocket:
            websocket.send_json(_OPEN)
            websocket.send_json(_CATALOG)
            websocket.receive_json()
            websocket.send_json(
                {
                    'protocol': 'webmcp.control.v1',
                    'type': 'control.result',
                    'call_id': 'call_oversized',
                    'status': 'succeeded',
                    'result': 'x' * 1_501,
                }
            )
            websocket.receive_json()

    assert denied.value.code == 4400
    assert [message.type for message in port.connection.messages] == [
        'catalog.register'
    ]

    with client.websocket_connect(
        '/ws/browser-control', headers=_browser_headers()
    ) as websocket:
        websocket.send_json(_OPEN)
        websocket.send_json(_CATALOG)
        websocket.send_json(
            {
                'protocol': 'webmcp.control.v1',
                'type': 'control.cancelled',
                'call_id': 'call_123',
                'effect': 'unknown',
            }
        )

    cancellation = port.connection.messages[-1]
    assert isinstance(cancellation, ControlCancelled)
    assert cancellation.effect == 'unknown'


def test_unicode_result_uses_the_same_utf8_json_budget_as_the_browser(
    mock_agent: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_identity(monkeypatch)
    port = RecordingPort()
    client = TestClient(_app(mock_agent, port))

    with client.websocket_connect(
        '/ws/browser-control', headers=_browser_headers()
    ) as websocket:
        websocket.send_json(_OPEN)
        websocket.send_json(_CATALOG)
        websocket.send_json(
            {
                'protocol': 'webmcp.control.v1',
                'type': 'control.result',
                'call_id': 'call_unicode',
                'status': 'succeeded',
                'result': 'é' * 749,
            }
        )

    assert port.connection.messages[-1].type == 'control.result'
