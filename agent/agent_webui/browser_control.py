"""Authenticated transport for Graph OS control of an attended browser document.

This module owns no lease, call, replay, policy, or receipt state.  It validates
the browser wire boundary and hands every event to one host-injected Graph OS
``BrowserControlPort``.  The port remains the sole authority for browser
control; the WebUI only keeps the WebSocket open.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import math
import os
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated, Any, Literal, Protocol, cast

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic.types import JsonValue

from .browser_control_canonical import canonical_protocol_json, validate_protocol_json

logger = logging.getLogger(__name__)

_PROTOCOL: Literal['webmcp.control.v1'] = 'webmcp.control.v1'
_MAX_CHANNEL_MESSAGE_BYTES = 64 * 1024
_MAX_RESULT_BYTES = 1_500
_OPEN_TIMEOUT_SECONDS = 10.0
_PORT_TIMEOUT_SECONDS = 10.0
_SEND_TIMEOUT_SECONDS = 5.0
_DISCONNECT_TIMEOUT_SECONDS = 5.0
_MAX_TOOLS = 64
_MAX_SCHEMA_BYTES = 16 * 1024
_CHANNEL_RATE_CAPACITY = 32.0
_CHANNEL_RATE_REFILL_PER_SECOND = 16.0
_MAX_ATTENDED_ARM_SECONDS = 15 * 60
_OPAQUE_ID_PATTERN = r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
_DIGEST_PATTERN = r'^sha256:[a-f0-9]{64}$'


class _WireModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)


class _ChannelRateLimitExceeded(Exception):
    """The per-socket transport budget was exhausted."""


def _reject_json_constant(value: str) -> None:
    raise ValueError(f'non-finite JSON value is forbidden: {value}')


def _unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    keys = [key for key, _value in pairs]
    if len(keys) != len(set(keys)):
        raise ValueError('duplicate JSON object key is forbidden')
    return dict(pairs)


def _json_byte_length(value: Any) -> int:
    serialized = json.dumps(
        value,
        separators=(',', ':'),
        ensure_ascii=False,
        allow_nan=False,
    )
    return len(serialized.encode('utf-8'))


class ChannelOpen(_WireModel):
    """The attended document claims compared against server-side authority."""

    protocol: Literal['webmcp.control.v1']
    type: Literal['channel.open']
    route_id: str = Field(min_length=1, max_length=128, pattern=_OPAQUE_ID_PATTERN)
    registration_generation: int = Field(ge=1, le=2**53 - 1)
    attended: Literal[True]
    secure_context: Literal[True]
    permissions_policy: Literal[True]
    document_visible: Literal[True]


class BrowserToolDescriptor(_WireModel):
    tool_id: str = Field(min_length=1, max_length=128, pattern=_OPAQUE_ID_PATTERN)
    version: str = Field(min_length=1, max_length=64, pattern=_OPAQUE_ID_PATTERN)
    input_schema: dict[str, JsonValue]
    output_schema: dict[str, JsonValue]
    schema_digest: str = Field(pattern=_DIGEST_PATTERN)
    mutation_class: Literal['read', 'local-ui-mutation']
    confirmation_policy: Literal['none', 'exact-request']
    required_roles: list[str] = Field(max_length=16)
    source_ref: str = Field(min_length=1, max_length=256)

    @field_validator('input_schema', 'output_schema')
    @classmethod
    def _bounded_schema(cls, value: dict[str, JsonValue]) -> dict[str, JsonValue]:
        validate_protocol_json(value)
        if _json_byte_length(value) > _MAX_SCHEMA_BYTES:
            raise ValueError('schema exceeds the browser-control boundary')
        return value

    @field_validator('required_roles')
    @classmethod
    def _bounded_roles(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError('required roles must be unique')
        if any(
            re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,63}', role) is None
            for role in value
        ):
            raise ValueError('required role is invalid')
        return value

    @field_validator('source_ref')
    @classmethod
    def _safe_source_ref(cls, value: str) -> str:
        validate_protocol_json(value)
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError('source reference contains control characters')
        return value

    @model_validator(mode='after')
    def _consistent_descriptor(self) -> BrowserToolDescriptor:
        canonical = canonical_protocol_json(
            {
                'input_schema': self.input_schema,
                'output_schema': self.output_schema,
            }
        ).encode('utf-8')
        expected_digest = f'sha256:{hashlib.sha256(canonical).hexdigest()}'
        confirmation_matches = (
            self.mutation_class == 'read' and self.confirmation_policy == 'none'
        ) or (
            self.mutation_class == 'local-ui-mutation'
            and self.confirmation_policy == 'exact-request'
        )
        if self.schema_digest != expected_digest or not confirmation_matches:
            raise ValueError('browser tool descriptor is inconsistent')
        return self


class CatalogRegister(_WireModel):
    protocol: Literal['webmcp.control.v1']
    type: Literal['catalog.register']
    authority: Literal['browser-local']
    route_id: str = Field(min_length=1, max_length=128, pattern=_OPAQUE_ID_PATTERN)
    registration_generation: int = Field(ge=1, le=2**53 - 1)
    catalog_digest: str = Field(pattern=_DIGEST_PATTERN)
    tool_scope_digest: str = Field(pattern=_DIGEST_PATTERN)
    tools: list[BrowserToolDescriptor] = Field(min_length=1, max_length=_MAX_TOOLS)

    @field_validator('tools')
    @classmethod
    def _unique_tools(
        cls, value: list[BrowserToolDescriptor]
    ) -> list[BrowserToolDescriptor]:
        identities = [tool.tool_id for tool in value]
        if len(identities) != len(set(identities)):
            raise ValueError('tool identities must be unique')
        return value


class ControlConfirm(_WireModel):
    protocol: Literal['webmcp.control.v1']
    type: Literal['control.confirm']
    call_id: str = Field(min_length=1, max_length=128, pattern=_OPAQUE_ID_PATTERN)
    confirmation_digest: str = Field(pattern=_DIGEST_PATTERN)


class ControlResult(_WireModel):
    protocol: Literal['webmcp.control.v1']
    type: Literal['control.result']
    call_id: str = Field(min_length=1, max_length=128, pattern=_OPAQUE_ID_PATTERN)
    status: Literal['succeeded', 'failed']
    result: JsonValue | None = None
    error_code: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=r'^[a-z][a-z0-9_-]{0,63}$',
    )

    @field_validator('result')
    @classmethod
    def _bounded_result(cls, value: JsonValue | None) -> JsonValue | None:
        if value is not None:
            validate_protocol_json(value)
            if _json_byte_length(value) > _MAX_RESULT_BYTES:
                raise ValueError('result exceeds the browser-control boundary')
        return value

    @model_validator(mode='after')
    def _status_matches_error(self) -> ControlResult:
        if (self.status == 'failed') != (self.error_code is not None):
            raise ValueError('failed results require one safe error code')
        return self


class ControlCancelled(_WireModel):
    protocol: Literal['webmcp.control.v1']
    type: Literal['control.cancelled']
    call_id: str = Field(min_length=1, max_length=128, pattern=_OPAQUE_ID_PATTERN)
    effect: Literal['none', 'browser_reported_committed', 'unknown']


BrowserMessage = Annotated[
    CatalogRegister | ControlConfirm | ControlResult | ControlCancelled,
    Field(discriminator='type'),
]


class _ServerCallBase(_WireModel):
    protocol: Literal['webmcp.control.v1']
    call_id: str = Field(min_length=1, max_length=128, pattern=_OPAQUE_ID_PATTERN)
    lease_id: str = Field(min_length=1, max_length=128, pattern=_OPAQUE_ID_PATTERN)
    tool_id: str = Field(min_length=1, max_length=128, pattern=_OPAQUE_ID_PATTERN)
    arguments: dict[str, JsonValue]
    confirmation_digest: str | None = Field(default=None, pattern=_DIGEST_PATTERN)

    @field_validator('arguments')
    @classmethod
    def _strict_arguments(cls, value: dict[str, JsonValue]) -> dict[str, JsonValue]:
        validate_protocol_json(value)
        return value


class ControlConfirmationRequest(_ServerCallBase):
    type: Literal['control.confirmation_request']
    confirmation_digest: str = Field(pattern=_DIGEST_PATTERN)


class ControlCall(_ServerCallBase):
    type: Literal['control.call']
    authorization: Literal['read', 'confirmed_mutation']

    @model_validator(mode='after')
    def _confirmation_matches_authorization(self) -> ControlCall:
        confirmed = self.authorization == 'confirmed_mutation'
        if confirmed != (self.confirmation_digest is not None):
            raise ValueError('call confirmation does not match its authorization')
        return self


class ControlCancel(_WireModel):
    protocol: Literal['webmcp.control.v1']
    type: Literal['control.cancel']
    call_id: str = Field(min_length=1, max_length=128, pattern=_OPAQUE_ID_PATTERN)
    reason: str = Field(min_length=1, max_length=64, pattern=r'^[a-z][a-z0-9_-]{0,63}$')


class ChannelReady(_WireModel):
    protocol: Literal['webmcp.control.v1']
    type: Literal['channel.ready']
    authority: Literal['graph-os']
    route_id: str = Field(min_length=1, max_length=128, pattern=_OPAQUE_ID_PATTERN)
    registration_generation: int = Field(ge=1, le=2**53 - 1)
    catalog_digest: str = Field(pattern=_DIGEST_PATTERN)
    tool_scope_digest: str = Field(pattern=_DIGEST_PATTERN)


class CatalogRegistrationReceipt(_WireModel):
    authority: Literal['graph-os']
    route_id: str = Field(min_length=1, max_length=128, pattern=_OPAQUE_ID_PATTERN)
    registration_generation: int = Field(ge=1, le=2**53 - 1)
    catalog_digest: str = Field(pattern=_DIGEST_PATTERN)
    tool_scope_digest: str = Field(pattern=_DIGEST_PATTERN)


ServerMessage = Annotated[
    ChannelReady | ControlConfirmationRequest | ControlCall | ControlCancel,
    Field(discriminator='type'),
]

_CHANNEL_OPEN_ADAPTER: TypeAdapter[ChannelOpen] = TypeAdapter(ChannelOpen)
_BROWSER_MESSAGE_ADAPTER: TypeAdapter[BrowserMessage] = TypeAdapter(BrowserMessage)
_SERVER_MESSAGE_ADAPTER: TypeAdapter[ServerMessage] = TypeAdapter(ServerMessage)
_CATALOG_RECEIPT_ADAPTER: TypeAdapter[CatalogRegistrationReceipt] = TypeAdapter(
    CatalogRegistrationReceipt
)


@dataclass(frozen=True, slots=True)
class BrowserControlBinding:
    """Verified server identity and immutable claims for one browser document."""

    session: Any
    login_session_ref: str
    browser_session_ref: str
    principal_ref: str
    origin: str
    document_ref: str
    attended_arm_ref: str
    attended_arm_issued_at: float
    attended_arm_expires_at: float
    access_token_expires_at: float
    attended_auth_time: float
    attended_acr: str
    attended_issuer: str
    session_revalidator: Callable[[], Awaitable[bool]]
    route_id: str
    registration_generation: int
    catalog_digest: str
    tool_scope_digest: str
    attended: bool


@dataclass(frozen=True, slots=True)
class RecentAuthGrant:
    """Verified IdP evidence awaiting exact post-reload document scope."""

    grant_ref: str
    session: Any
    login_session_ref: str
    browser_session_ref: str
    principal_ref: str
    origin: str
    route_id: str
    access_token_expires_at: float
    grant_issued_at: float
    grant_expires_at: float
    attended_auth_time: float
    attended_acr: str
    attended_issuer: str


class BrowserControlConnection(Protocol):
    async def receive(self, message: BrowserMessage) -> Any: ...

    async def disconnect(self, reason: str) -> None: ...


BrowserControlSend = Callable[[Any], Awaitable[None]]


@dataclass(slots=True)
class _ChannelRateLimiter:
    """Per-socket token bucket that bounds transport work without owning calls."""

    tokens: float = _CHANNEL_RATE_CAPACITY
    updated_at: float | None = None

    def allow(self, now: float) -> bool:
        if self.updated_at is not None:
            elapsed = max(0.0, now - self.updated_at)
            self.tokens = min(
                _CHANNEL_RATE_CAPACITY,
                self.tokens + elapsed * _CHANNEL_RATE_REFILL_PER_SECOND,
            )
        self.updated_at = now
        if self.tokens < 1.0:
            return False
        self.tokens -= 1.0
        return True


class BrowserControlPort(Protocol):
    """Host-injected Graph OS authority; WebUI remains a transport adapter."""

    authority: str
    supports_durable_fences: bool
    supports_durable_audit: bool
    supports_attended_leases: bool
    supports_live_revalidation: bool
    supports_backchannel_revalidation: bool
    supports_catalog_verification: bool

    async def open_channel(
        self,
        binding: BrowserControlBinding,
        send: BrowserControlSend,
    ) -> BrowserControlConnection: ...

    async def finalize_attended_arm(
        self,
        grant: RecentAuthGrant,
        binding: BrowserControlBinding,
    ) -> Any: ...

    async def revoke_attended_arm(
        self,
        binding: BrowserControlBinding,
    ) -> Any: ...


def _port_enabled(port: BrowserControlPort | None) -> bool:
    checks = (
        port is not None,
        getattr(port, 'authority', None) == 'graph-os',
        getattr(port, 'supports_durable_fences', False) is True,
        getattr(port, 'supports_durable_audit', False) is True,
        getattr(port, 'supports_attended_leases', False) is True,
        getattr(port, 'supports_live_revalidation', False) is True,
        getattr(port, 'supports_backchannel_revalidation', False) is True,
        getattr(port, 'supports_catalog_verification', False) is True,
        callable(getattr(port, 'open_channel', None)),
        callable(getattr(port, 'finalize_attended_arm', None)),
        callable(getattr(port, 'revoke_attended_arm', None)),
    )
    return all(checks)


def browser_control_port_enabled(port: Any) -> bool:
    """Return whether every executable Graph OS authority seam is present."""

    return _port_enabled(cast(BrowserControlPort | None, port))


def _raw_header_values(websocket: WebSocket, name: bytes) -> list[str]:
    return [
        value.decode('latin-1').strip()
        for key, value in websocket.scope.get('headers') or []
        if key.lower() == name
    ]


def _canonical_secure_origin(websocket: WebSocket) -> str | None:
    from .oidc_session import trusted_request_origin

    origins = _raw_header_values(websocket, b'origin')
    if len(origins) != 1:
        return None
    return trusted_request_origin(websocket.scope, origins[0])


def _session_hmac_key() -> bytes | None:
    raw = os.getenv('WEBUI_SESSION_KEY', '').strip()
    if not raw or len(raw) > 256:
        return None
    try:
        decoded = base64.urlsafe_b64decode(raw.encode('ascii'))
    except (ValueError, UnicodeEncodeError):
        return None
    return decoded if len(decoded) == 32 else None


def _opaque_ref(key: bytes, label: str, *parts: str) -> str:
    material = '\x1f'.join((f'agent-webui:{label}:v1', *parts)).encode('utf-8')
    digest = hmac.new(key, material, hashlib.sha256).hexdigest()
    return f'{label}_{digest}'


def _verified_actor_parts(session: Any) -> tuple[str, str] | None:
    actor = getattr(session, 'actor', None)
    if not getattr(actor, 'authenticated', False):
        return None
    if str(getattr(actor, 'actor_type', '')) != 'human':
        return None
    actor_id = str(getattr(actor, 'actor_id', '') or '').strip()
    tenant = str(getattr(session, 'tenant', '') or '').strip()
    if not actor_id or not tenant:
        return None
    return actor_id, tenant


def _trusted_login_session_ref(websocket: WebSocket) -> str | None:
    state = websocket.scope.get('state') or {}
    if not isinstance(state, dict):
        return None
    reference = str(state.get('browser_login_session_ref') or '').strip()
    if not reference.startswith('login_') or len(reference) != 70:
        return None
    return reference


@dataclass(frozen=True, slots=True)
class _AttendedArmState:
    arm_ref: str
    document_ref: str
    issued_at: float
    expires_at: float
    access_token_expires_at: float
    route_id: str
    registration_generation: int
    catalog_digest: str
    tool_scope_digest: str
    subject: str
    tenant: str
    auth_time: float
    acr: str
    issuer: str


def _arm_numbers(
    state: dict[str, Any],
) -> tuple[float, float, float, float, int] | None:
    try:
        return (
            float(str(state.get('browser_attended_arm_issued_at'))),
            float(str(state.get('browser_attended_arm_expires_at'))),
            float(str(state.get('browser_access_token_expires_at'))),
            float(str(state.get('browser_attended_auth_time'))),
            int(str(state.get('browser_attended_registration_generation'))),
        )
    except (TypeError, ValueError):
        return None


def _state_text(state: dict[str, Any], key: str) -> str:
    return str(state.get(key) or '').strip()


def _parsed_attended_arm(state: dict[str, Any]) -> _AttendedArmState | None:
    arm_ref = _state_text(state, 'browser_attended_arm_ref')
    document_ref = _state_text(state, 'browser_document_ref')
    route_id = _state_text(state, 'browser_attended_route_id')
    catalog_digest = _state_text(state, 'browser_attended_catalog_digest')
    tool_scope_digest = _state_text(state, 'browser_attended_tool_scope_digest')
    numbers = _arm_numbers(state)
    if numbers is None:
        return None
    issued_at, expires_at, access_token_expires_at, auth_time, generation = numbers
    return _AttendedArmState(
        arm_ref=arm_ref,
        document_ref=document_ref,
        issued_at=issued_at,
        expires_at=expires_at,
        access_token_expires_at=access_token_expires_at,
        route_id=route_id,
        registration_generation=generation,
        catalog_digest=catalog_digest,
        tool_scope_digest=tool_scope_digest,
        subject=_state_text(state, 'browser_attended_subject'),
        tenant=_state_text(state, 'browser_attended_tenant'),
        auth_time=auth_time,
        acr=_state_text(state, 'browser_attended_acr'),
        issuer=_state_text(state, 'browser_attended_issuer'),
    )


def _prefixed_hex(value: str, prefix: str) -> bool:
    suffix = value.removeprefix(prefix)
    return (
        len(suffix) == 64
        and len(value) == len(prefix) + 64
        and all(character in '0123456789abcdef' for character in suffix)
    )


def _arm_strings_valid(arm: _AttendedArmState) -> bool:
    return bool(
        _arm_references_valid(arm)
        and _arm_route_valid(arm.route_id)
        and _arm_evidence_valid(arm)
    )


def _arm_references_valid(arm: _AttendedArmState) -> bool:
    return all(
        (
            _prefixed_hex(arm.arm_ref, 'attended_'),
            _prefixed_hex(arm.document_ref, 'document_'),
            _prefixed_hex(arm.catalog_digest, 'sha256:'),
            _prefixed_hex(arm.tool_scope_digest, 'sha256:'),
        )
    )


def _arm_route_valid(route_id: str) -> bool:
    return 1 <= len(route_id) <= 128 and all(
        character.isalnum() or character in '._:-' for character in route_id
    )


def _arm_evidence_valid(arm: _AttendedArmState) -> bool:
    return bool(
        arm.subject and arm.tenant and arm.acr and arm.issuer.startswith('https://')
    )


def _arm_times_valid(arm: _AttendedArmState) -> bool:
    now = time.time()
    values = (
        arm.issued_at,
        arm.expires_at,
        arm.access_token_expires_at,
        arm.auth_time,
    )
    return bool(
        all(math.isfinite(value) for value in values)
        and arm.auth_time
        <= arm.issued_at
        <= now
        < arm.expires_at
        <= arm.access_token_expires_at
        and arm.expires_at - arm.issued_at <= _MAX_ATTENDED_ARM_SECONDS
    )


def _trusted_attended_arm(websocket: WebSocket) -> _AttendedArmState | None:
    """Read one upstream-verified arm receipt; browser frames cannot create it."""

    state = websocket.scope.get('state') or {}
    if not isinstance(state, dict):
        return None
    arm = _parsed_attended_arm(state)
    raw_generation = state.get('browser_attended_registration_generation')
    if (
        arm is None
        or isinstance(raw_generation, bool)
        or not 1 <= arm.registration_generation <= 2**53 - 1
        or not _arm_strings_valid(arm)
        or not _arm_times_valid(arm)
    ):
        return None
    return arm


def _current_graph_session() -> Any | None:
    from agent_utilities.knowledge_graph.core.session import current_session

    try:
        return current_session()
    except (LookupError, PermissionError, RuntimeError):
        return None


def _arm_matches_actor(
    arm: _AttendedArmState,
    actor_id: str,
    tenant: str,
    credential_expires_at: Any,
) -> bool:
    return bool(
        arm.subject == actor_id
        and arm.tenant == tenant
        and isinstance(credential_expires_at, int | float)
        and not isinstance(credential_expires_at, bool)
        and arm.access_token_expires_at <= float(credential_expires_at) + 1.0
    )


def _binding_claims_match(
    arm: _AttendedArmState,
    opened: ChannelOpen,
    actor_id: str,
    tenant: str,
    credential_expires_at: Any,
) -> bool:
    return bool(
        arm.route_id == opened.route_id
        and arm.registration_generation == opened.registration_generation
        and _arm_matches_actor(arm, actor_id, tenant, credential_expires_at)
    )


def _channel_authorities(
    websocket: WebSocket,
) -> (
    tuple[
        str,
        str,
        _AttendedArmState,
        bytes,
        Callable[[], Awaitable[bool]],
    ]
    | None
):
    origin = _canonical_secure_origin(websocket)
    login_session_ref = _trusted_login_session_ref(websocket)
    attended_arm = _trusted_attended_arm(websocket)
    state = websocket.scope.get('state') or {}
    session_revalidator = (
        state.get('browser_session_revalidator') if isinstance(state, dict) else None
    )
    key = _session_hmac_key()
    if (
        origin is None
        or login_session_ref is None
        or attended_arm is None
        or key is None
        or not callable(session_revalidator)
    ):
        return None
    return (
        origin,
        login_session_ref,
        attended_arm,
        key,
        cast(Callable[[], Awaitable[bool]], session_revalidator),
    )


def _server_binding(
    websocket: WebSocket,
    opened: ChannelOpen,
) -> BrowserControlBinding | None:
    session = _current_graph_session()
    if session is None:
        return None
    actor_parts = _verified_actor_parts(session)
    if actor_parts is None:
        return None
    actor_id, tenant = actor_parts
    authorities = _channel_authorities(websocket)
    if authorities is None:
        return None
    origin, login_session_ref, trusted_arm, key, session_revalidator = authorities
    actor = getattr(session, 'actor', None)
    credential_expires_at = getattr(actor, 'credential_expires_at', None)
    if not _binding_claims_match(
        trusted_arm, opened, actor_id, tenant, credential_expires_at
    ):
        return None
    return BrowserControlBinding(
        session=session,
        login_session_ref=login_session_ref,
        browser_session_ref=_opaque_ref(
            key,
            'browser',
            login_session_ref,
            origin,
            trusted_arm.document_ref,
        ),
        principal_ref=_opaque_ref(key, 'principal', actor_id, tenant),
        origin=origin,
        document_ref=trusted_arm.document_ref,
        attended_arm_ref=trusted_arm.arm_ref,
        attended_arm_issued_at=trusted_arm.issued_at,
        attended_arm_expires_at=trusted_arm.expires_at,
        access_token_expires_at=trusted_arm.access_token_expires_at,
        attended_auth_time=trusted_arm.auth_time,
        attended_acr=trusted_arm.acr,
        attended_issuer=trusted_arm.issuer,
        session_revalidator=session_revalidator,
        route_id=opened.route_id,
        registration_generation=opened.registration_generation,
        catalog_digest=trusted_arm.catalog_digest,
        tool_scope_digest=trusted_arm.tool_scope_digest,
        attended=opened.attended,
    )


async def _receive_model(
    websocket: WebSocket,
    adapter: TypeAdapter[Any],
    limiter: _ChannelRateLimiter,
) -> Any:
    event = await websocket.receive()
    if event.get('type') == 'websocket.disconnect':
        raise WebSocketDisconnect(
            code=int(event.get('code') or 1000),
            reason=str(event.get('reason') or ''),
        )
    raw = event.get('text')
    if not isinstance(raw, str):
        raise ValueError('browser-control messages must be JSON text')
    if not limiter.allow(asyncio.get_running_loop().time()):
        raise _ChannelRateLimitExceeded
    if len(raw.encode('utf-8')) > _MAX_CHANNEL_MESSAGE_BYTES:
        raise ValueError('browser-control message is too large')
    try:
        candidate = json.loads(
            raw,
            parse_constant=_reject_json_constant,
            object_pairs_hook=_unique_json_object,
        )
        return adapter.validate_python(candidate, strict=True)
    except (json.JSONDecodeError, ValidationError) as error:
        raise ValueError('browser-control message is invalid') from error


def _message_matches_binding(
    message: BrowserMessage,
    binding: BrowserControlBinding,
) -> bool:
    if not isinstance(message, CatalogRegister):
        return True
    return (
        message.route_id == binding.route_id
        and message.registration_generation == binding.registration_generation
        and message.catalog_digest == binding.catalog_digest
        and message.tool_scope_digest == binding.tool_scope_digest
    )


def _server_payload(message: Any) -> dict[str, JsonValue]:
    candidate = (
        message.model_dump(mode='json') if isinstance(message, BaseModel) else message
    )
    validated = _SERVER_MESSAGE_ADAPTER.validate_python(candidate, strict=True)
    return validated.model_dump(mode='json')


async def _close(websocket: WebSocket, code: int) -> None:
    try:
        await websocket.close(code=code)
    except RuntimeError:
        pass


async def _disconnect(
    connection: BrowserControlConnection | None,
    reason: str,
) -> None:
    if connection is None:
        return
    try:
        await asyncio.wait_for(
            connection.disconnect(reason),
            timeout=_DISCONNECT_TIMEOUT_SECONDS,
        )
    except Exception as error:
        logger.warning(
            'Browser-control disconnect failed: error_type=%s',
            type(error).__name__,
            extra={'event': 'browser_control_disconnect_failed'},
        )


async def _revoke_unopened_arm(
    port: BrowserControlPort | None,
    binding: BrowserControlBinding | None,
) -> None:
    """Release an arm if Graph OS never returned a channel connection."""

    if port is None or binding is None:
        return
    try:
        receipt = await asyncio.wait_for(
            port.revoke_attended_arm(binding),
            timeout=_PORT_TIMEOUT_SECONDS,
        )
        if not _revocation_matches_binding(receipt, binding):
            raise ValueError('Graph OS returned a mismatched revocation receipt')
    except Exception as error:
        logger.warning(
            'Browser-control unopened arm revoke failed: error_type=%s',
            type(error).__name__,
            extra={'event': 'browser_control_unopened_arm_revoke_failed'},
        )


def _revocation_matches_binding(
    receipt: Any,
    binding: BrowserControlBinding,
) -> bool:
    return bool(
        getattr(receipt, 'status', None) in {'revoked', 'expired'}
        and getattr(receipt, 'attended_arm_ref', None) == binding.attended_arm_ref
        and getattr(receipt, 'attended_arm_expires_at', None)
        == binding.attended_arm_expires_at
        and getattr(receipt, 'catalog_digest', None) == binding.catalog_digest
        and getattr(receipt, 'tool_scope_digest', None) == binding.tool_scope_digest
    )


async def _register_initial_catalog(
    websocket: WebSocket,
    connection: BrowserControlConnection,
    binding: BrowserControlBinding,
    limiter: _ChannelRateLimiter,
) -> CatalogRegistrationReceipt:
    catalog = cast(
        BrowserMessage,
        await asyncio.wait_for(
            _receive_model(websocket, _BROWSER_MESSAGE_ADAPTER, limiter),
            timeout=_OPEN_TIMEOUT_SECONDS,
        ),
    )
    if not isinstance(catalog, CatalogRegister) or not _message_matches_binding(
        catalog, binding
    ):
        raise ValueError('first browser-control event must match its catalog')
    receipt = await asyncio.wait_for(
        connection.receive(catalog),
        timeout=_PORT_TIMEOUT_SECONDS,
    )
    candidate = (
        receipt.model_dump(mode='json') if isinstance(receipt, BaseModel) else receipt
    )
    verified = _CATALOG_RECEIPT_ADAPTER.validate_python(candidate, strict=True)
    if (
        verified.route_id != binding.route_id
        or verified.registration_generation != binding.registration_generation
        or verified.catalog_digest != binding.catalog_digest
        or verified.tool_scope_digest != binding.tool_scope_digest
    ):
        raise ValueError('Graph OS returned a mismatched catalog receipt')
    return verified


async def _relay_browser_events(
    websocket: WebSocket,
    connection: BrowserControlConnection,
    limiter: _ChannelRateLimiter,
) -> None:
    while True:
        message = cast(
            BrowserMessage,
            await _receive_model(websocket, _BROWSER_MESSAGE_ADAPTER, limiter),
        )
        if isinstance(message, CatalogRegister):
            raise ValueError('browser-control catalog is already registered')
        await asyncio.wait_for(
            connection.receive(message),
            timeout=_PORT_TIMEOUT_SECONDS,
        )


async def _serve_browser_control(
    websocket: WebSocket,
    port: BrowserControlPort | None,
) -> None:
    if not _port_enabled(port):
        await _close(websocket, 1013)
        return
    await websocket.accept()
    connection: BrowserControlConnection | None = None
    binding: BrowserControlBinding | None = None
    reason = 'channel_lost'
    send_lock = asyncio.Lock()
    inbound_limiter = _ChannelRateLimiter()
    outbound_limiter = _ChannelRateLimiter()
    channel_live = True
    catalog_registered = False

    async def send(message: Any) -> None:
        if not channel_live or not catalog_registered:
            raise RuntimeError('browser-control channel is not dispatchable')
        if not outbound_limiter.allow(asyncio.get_running_loop().time()):
            raise _ChannelRateLimitExceeded
        payload = _server_payload(message)
        serialized = json.dumps(
            payload,
            separators=(',', ':'),
            ensure_ascii=False,
            allow_nan=False,
        )
        if len(serialized.encode('utf-8')) > _MAX_CHANNEL_MESSAGE_BYTES:
            raise ValueError('browser-control message is too large')
        async with send_lock:
            if not channel_live:
                raise RuntimeError('browser-control channel is closed')
            await asyncio.wait_for(
                websocket.send_text(serialized),
                timeout=_SEND_TIMEOUT_SECONDS,
            )

    try:
        opened = cast(
            ChannelOpen,
            await asyncio.wait_for(
                _receive_model(websocket, _CHANNEL_OPEN_ADAPTER, inbound_limiter),
                timeout=_OPEN_TIMEOUT_SECONDS,
            ),
        )
        binding = _server_binding(websocket, opened)
        if binding is None:
            reason = 'trust_prerequisite_missing'
            await _close(websocket, 4403)
            return
        enabled_port = cast(BrowserControlPort, port)
        connection = await asyncio.wait_for(
            enabled_port.open_channel(binding, send),
            timeout=_PORT_TIMEOUT_SECONDS,
        )
        registration = await _register_initial_catalog(
            websocket,
            connection,
            binding,
            inbound_limiter,
        )
        catalog_registered = True
        await send(
            ChannelReady(
                protocol=_PROTOCOL,
                type='channel.ready',
                authority=registration.authority,
                route_id=registration.route_id,
                registration_generation=registration.registration_generation,
                catalog_digest=registration.catalog_digest,
                tool_scope_digest=registration.tool_scope_digest,
            )
        )
        await _relay_browser_events(websocket, connection, inbound_limiter)
    except WebSocketDisconnect:
        reason = 'channel_lost'
    except TimeoutError:
        reason = 'channel_timeout'
        channel_live = False
        await _close(websocket, 4408)
    except _ChannelRateLimitExceeded:
        reason = 'rate_limited'
        channel_live = False
        await _close(websocket, 4429)
    except ValueError:
        reason = 'invalid_message'
        channel_live = False
        await _close(websocket, 4400)
    except Exception as error:
        reason = 'authority_unavailable'
        channel_live = False
        logger.warning(
            'Browser-control channel failed: error_type=%s',
            type(error).__name__,
            extra={'event': 'browser_control_channel_failed'},
        )
        await _close(websocket, 1011)
    finally:
        channel_live = False
        if connection is None:
            await _revoke_unopened_arm(port, binding)
        else:
            await _disconnect(connection, reason)


def build_browser_control_router(port: BrowserControlPort | None) -> APIRouter:
    """Build the always-registered, fail-closed browser-control channel."""

    router = APIRouter()

    @router.websocket('/ws/browser-control')
    async def browser_control(websocket: WebSocket) -> None:
        await _serve_browser_control(websocket, port)

    return router


async def revalidate_browser_control_session(binding: Any) -> bool:
    """Invoke the opaque per-login IdP backchannel verifier from Graph OS."""

    callback = getattr(binding, 'session_revalidator', None)
    if not callable(callback):
        return False
    try:
        result = callback()
        if not isinstance(result, Awaitable):
            return False
        return (await result) is True
    except Exception:
        return False


__all__ = [
    'BrowserControlBinding',
    'BrowserControlConnection',
    'BrowserControlPort',
    'BrowserControlSend',
    'BrowserMessage',
    'ChannelOpen',
    'ServerMessage',
    'RecentAuthGrant',
    'build_browser_control_router',
    'browser_control_port_enabled',
    'revalidate_browser_control_session',
]
