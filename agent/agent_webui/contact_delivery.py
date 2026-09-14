"""Fail-closed contact submission boundary for the WebUI.

The browser route is intentionally narrower than the generic messaging and
``graph/reach`` surfaces.  A deployment must inject one delivery adapter and
declare both its fixed destination and retention decision.  The client can
never select a provider or channel, and provider identifiers never cross the
HTTP boundary.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol, cast
from urllib.parse import urlsplit

from agent_utilities.knowledge_graph.core.session import current_session
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

logger = logging.getLogger(__name__)

_EMAIL = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
_OPAQUE_CONTACT_RECEIPT = re.compile(r'^contact_[A-Za-z0-9_-]{16,56}$')
_MAX_RATE_LIMIT_KEYS = 4096
_RATE_LIMIT_ATTEMPTS = 5
_RATE_LIMIT_WINDOW_SECONDS = 60.0
_DELIVERY_TIMEOUT_SECONDS = 12.0


def _contains_control(value: str, *, allow_line_breaks: bool = False) -> bool:
    allowed = {'\t', '\n', '\r'} if allow_line_breaks else set()
    return any(
        character not in allowed
        and (ord(character) < 32 or 127 <= ord(character) <= 159)
        for character in value
    )


class ContactSubmission(BaseModel):
    """The only client-controlled fields accepted by ``POST /api/contact``."""

    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    subject: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=4000)
    idempotency_key: str = Field(
        pattern=r'^contactreq_[a-f0-9]{32}$',
        min_length=43,
        max_length=43,
    )

    @field_validator('name', 'subject')
    @classmethod
    def _header_safe_text(cls, value: str) -> str:
        if _contains_control(value):
            raise ValueError('control characters are not permitted')
        return value

    @field_validator('email')
    @classmethod
    def _valid_email(cls, value: str) -> str:
        if _contains_control(value) or not _EMAIL.fullmatch(value):
            raise ValueError('invalid email address')
        return value

    @field_validator('message')
    @classmethod
    def _safe_message_text(cls, value: str) -> str:
        if _contains_control(value, allow_line_breaks=True):
            raise ValueError('control characters are not permitted')
        return value


@dataclass(frozen=True, slots=True)
class ContactDeliveryConfig:
    """Server-owned routing and lifecycle policy for contact PII."""

    destination: str
    retention_days: int


@dataclass(frozen=True, slots=True)
class ContactDeliveryRequest:
    """Typed input handed to a host-injected governed delivery adapter."""

    submission: ContactSubmission
    destination: str
    retention_days: int
    actor_reference: str
    idempotency_key: str


class ContactDeliveryResult(BaseModel):
    """Minimal governed outcome with its durable, non-provider receipt."""

    model_config = ConfigDict(extra='forbid', frozen=True, strict=True)

    success: bool
    receipt: str | None = None


class ContactDeliveryPort(Protocol):
    """Host-owned adapter to a governed messaging implementation.

    Enabling adapters must enforce the idempotency key with a durable atomic
    fence and apply a deployment-wide abuse limit.  The route also keeps its
    bounded process-local limiter as defense in depth.
    """

    supports_atomic_idempotency: bool
    supports_shared_rate_limit: bool

    def __call__(
        self, request: ContactDeliveryRequest
    ) -> Awaitable[ContactDeliveryResult]: ...


class ContactReceipt(BaseModel):
    """The complete public success response."""

    receipt: str = Field(
        pattern=r'^contact_[A-Za-z0-9_-]{16,56}$',
        min_length=24,
        max_length=64,
    )


def load_contact_delivery_config() -> ContactDeliveryConfig | None:
    """Load a complete contact policy, returning ``None`` on any omission.

    ``0`` is an explicit delivery-only retention decision.  A missing value is
    different and keeps the route disabled.
    """

    destination = os.getenv('AGENT_WEBUI_CONTACT_DESTINATION', '').strip()
    retention = os.getenv('AGENT_WEBUI_CONTACT_RETENTION_DAYS', '').strip()
    if not destination or len(destination.encode('utf-8')) > 256:
        return None
    if any(ord(character) < 32 or ord(character) == 127 for character in destination):
        return None
    if not retention.isascii() or not retention.isdigit():
        return None
    retention_days = int(retention)
    if retention_days > 3650:
        return None
    return ContactDeliveryConfig(
        destination=destination,
        retention_days=retention_days,
    )


class ContactRateLimiter:
    """Bounded, per-principal limiter dedicated to contact delivery."""

    def __init__(
        self,
        *,
        attempts: int = _RATE_LIMIT_ATTEMPTS,
        window_seconds: float = _RATE_LIMIT_WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._attempts = attempts
        self._window_seconds = window_seconds
        self._clock = clock
        self._entries: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()

    def allow(self, principal: str) -> bool:
        now = self._clock()
        cutoff = now - self._window_seconds
        key = hashlib.sha256(principal.encode('utf-8')).hexdigest()
        with self._lock:
            attempts = self._entries.pop(key, deque())
            while attempts and attempts[0] <= cutoff:
                attempts.popleft()
            allowed = len(attempts) < self._attempts
            if allowed:
                attempts.append(now)
            self._entries[key] = attempts
            while len(self._entries) > _MAX_RATE_LIMIT_KEYS:
                self._entries.popitem(last=False)
            return allowed


def _authenticated_actor_id() -> str | None:
    session = current_session()
    actor = getattr(session, 'actor', None)
    if not getattr(actor, 'authenticated', False):
        return None
    actor_id = str(getattr(actor, 'actor_id', '') or '').strip()
    return actor_id or None


def _request_header_values(request: Request, name: bytes) -> list[str]:
    return [
        value.decode('latin-1').strip()
        for key, value in request.scope.get('headers') or []
        if key.lower() == name
    ]


def _parse_exact_origin(value: str) -> tuple[str, str] | None:
    parsed = urlsplit(value)
    if (
        parsed.scheme.lower() not in {'http', 'https'}
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {'', '/'}
        or parsed.query
        or parsed.fragment
    ):
        return None
    return parsed.scheme.lower(), parsed.netloc.lower()


def _is_exact_same_origin(request: Request) -> bool:
    origins = _request_header_values(request, b'origin')
    hosts = _request_header_values(request, b'host')
    if len(origins) != 1 or len(hosts) != 1 or origins[0].lower() == 'null':
        return False
    parsed_origin = _parse_exact_origin(origins[0])
    if parsed_origin is None:
        return False
    origin_scheme, origin_host = parsed_origin
    return (
        origin_scheme == str(request.scope.get('scheme') or '').lower()
        and origin_host == hosts[0].lower()
    )


def _delivery_enabled(
    delivery_port: ContactDeliveryPort | None,
    config: ContactDeliveryConfig | None,
) -> bool:
    return bool(
        delivery_port is not None
        and config is not None
        and getattr(delivery_port, 'supports_atomic_idempotency', False) is True
        and getattr(delivery_port, 'supports_shared_rate_limit', False) is True
    )


async def _deliver_with_deadline(
    delivery_port: ContactDeliveryPort,
    delivery_request: ContactDeliveryRequest,
) -> ContactDeliveryResult:
    try:
        raw_outcome = await asyncio.wait_for(
            delivery_port(delivery_request),
            timeout=_DELIVERY_TIMEOUT_SECONDS,
        )
        return ContactDeliveryResult.model_validate(raw_outcome, strict=True)
    except (ValidationError, asyncio.TimeoutError) as error:
        logger.error(
            'Contact delivery outcome unknown: error_type=%s',
            type(error).__name__,
            extra={'event': 'contact_delivery_outcome_unknown'},
        )
        raise HTTPException(status_code=503) from None
    except Exception as error:
        logger.error(
            'Contact delivery failed: error_type=%s',
            type(error).__name__,
            extra={'event': 'contact_delivery_failed'},
        )
        raise HTTPException(status_code=503) from None


def _confirmed_receipt(outcome: ContactDeliveryResult) -> ContactReceipt:
    if not outcome.success or not outcome.receipt:
        raise HTTPException(status_code=503)
    if not _OPAQUE_CONTACT_RECEIPT.fullmatch(outcome.receipt):
        raise HTTPException(status_code=503)
    return ContactReceipt(receipt=outcome.receipt)


def build_contact_router(
    delivery_port: ContactDeliveryPort | None,
    *,
    limiter: ContactRateLimiter | None = None,
) -> APIRouter:
    """Build the route around one host-injected delivery port."""

    router = APIRouter()
    rate_limiter = limiter or ContactRateLimiter()

    @router.post('/contact', response_model=ContactReceipt)
    async def submit_contact(
        submission: ContactSubmission,
        request: Request,
    ) -> ContactReceipt:
        if not _is_exact_same_origin(request):
            raise HTTPException(status_code=403)
        actor_id = _authenticated_actor_id()
        if actor_id is None:
            raise HTTPException(status_code=401)
        if not rate_limiter.allow(actor_id):
            raise HTTPException(status_code=429, headers={'Retry-After': '60'})
        config = load_contact_delivery_config()
        if not _delivery_enabled(delivery_port, config):
            raise HTTPException(status_code=503)
        enabled_port = cast(ContactDeliveryPort, delivery_port)
        enabled_config = cast(ContactDeliveryConfig, config)
        delivery_request = ContactDeliveryRequest(
            submission=submission,
            destination=enabled_config.destination,
            retention_days=enabled_config.retention_days,
            actor_reference=hashlib.sha256(actor_id.encode('utf-8')).hexdigest(),
            idempotency_key=submission.idempotency_key,
        )
        outcome = await _deliver_with_deadline(enabled_port, delivery_request)
        return _confirmed_receipt(outcome)

    return router
