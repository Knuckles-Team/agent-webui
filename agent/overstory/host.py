"""The WebUI's one seam to its host: settings, request actor, served operations.

overstory is presentation only. It runs inside Arbora and reaches data and
operations through the Arbora served API (``POST <api>/ops/<op_id>``),
validated by ``arbora.client`` when the host provides it. It never imports
graph engine, Arbora internals, or harness modules in process.

* :data:`config` reads the WebUI's own deployment settings from the
  environment.
* :class:`ActorContext` and :func:`current_actor` carry the verified request
  actor. The identity gate in ``server.py`` binds it per request.
* :func:`verify_bearer` checks a bearer JWT against the configured JWKS as an
  OpenID Connect relying party.
* :func:`invoke_operation` calls one served Arbora operation with the
  caller's credential. Arbora owns admission for every call.
* :class:`OperationUnavailable` is the one "not available" answer for a
  capability whose served operation does not exist yet. The SPA shows it as a
  "not available" state.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import time
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

_MAX_CREDENTIAL_BYTES = 16 * 1024
_JWKS_MAX_BYTES = 256 * 1024
_JWKS_CACHE_TTL = 300.0
_OPERATION_TIMEOUT = 30.0
_LOOPBACK = frozenset({'localhost', '127.0.0.1', '::1'})


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


def setting(name: str, default: Any = None) -> Any:
    """Read one WebUI setting from the environment, live."""

    value = os.environ.get(name)
    return default if value is None or value == '' else value


def _text(raw: Any) -> str | None:
    return str(raw).strip() or None if raw is not None else None


def _float(raw: Any) -> float:
    return float(raw)


def _int(raw: Any) -> int:
    return int(float(raw))


def _csv(raw: Any) -> list[str]:
    return [item.strip() for item in str(raw).split(',') if item.strip()]


#: field -> (environment variable, default, parser)
_FIELDS: dict[str, tuple[str, Any, Any]] = {
    'host': ('HOST', '127.0.0.1', str),
    'allowed_hosts': ('ALLOWED_HOSTS', None, _text),
    'allowed_origins': ('ALLOWED_ORIGINS', None, _text),
    'auth_jwt_jwks_uri': ('AUTH_JWT_JWKS_URI', None, _text),
    'auth_jwt_issuer': ('AUTH_JWT_ISSUER', None, _text),
    'auth_jwt_audience': ('AUTH_JWT_AUDIENCE', None, _text),
    'auth_jwt_algorithms': ('AUTH_JWT_ALGORITHMS', 'RS256,ES256,PS256', _csv),
    'mcp_jwt_audience': ('FASTMCP_SERVER_AUTH_JWT_AUDIENCE', None, _text),
    'kg_policy_version': ('KG_POLICY_VERSION', None, _text),
    'max_upload_size': ('MAX_UPLOAD_SIZE', 10 * 1024 * 1024, _int),
    'gateway_rate_limit': ('GATEWAY_RATE_LIMIT', 0.0, _float),
    'gateway_rate_burst': ('GATEWAY_RATE_BURST', 0.0, _float),
    'workspace_path': ('WORKSPACE_PATH', None, _text),
    'arbora_api_url': ('ARBORA_API_URL', 'http://127.0.0.1:8000/api/v1', str),
}


class WebUiSettings:
    """The WebUI deployment settings, read live from the environment.

    An attribute assignment overrides the environment for this process.
    """

    def __init__(self) -> None:
        object.__setattr__(self, '_overrides', {})

    def __getattr__(self, name: str) -> Any:
        overrides = object.__getattribute__(self, '_overrides')
        if name in overrides:
            return overrides[name]
        try:
            env, default, parse = _FIELDS[name]
        except KeyError:
            raise AttributeError(name) from None
        raw = setting(env)
        if raw is None:
            return parse(default) if default is not None else None
        try:
            return parse(raw)
        except (TypeError, ValueError):
            return parse(default) if default is not None else None

    def __setattr__(self, name: str, value: Any) -> None:
        if name not in _FIELDS:
            raise AttributeError(name)
        object.__getattribute__(self, '_overrides')[name] = value

    def reset(self) -> None:
        """Drop every process override (tests)."""

        object.__getattribute__(self, '_overrides').clear()


config = WebUiSettings()


# ---------------------------------------------------------------------------
# Request actor
# ---------------------------------------------------------------------------


class IdentityRequiredError(PermissionError):
    """Raised when work runs with no bound, verified actor."""


class CredentialExpiredError(PermissionError):
    """Raised when the bound actor's credential has expired."""


@dataclass(frozen=True)
class ActorContext:
    """The verified identity of the current request."""

    actor_id: str = 'anonymous'
    tenant_id: str = ''
    actor_type: str = 'automated_service'
    roles: tuple[str, ...] = ()
    groups: tuple[str, ...] = ()
    authenticated: bool = False
    credential_expires_at: int | None = None
    credential: str | None = field(default=None, repr=False, compare=False)

    def ensure_credential_current(self) -> None:
        if self.credential_expires_at is None:
            return
        if int(time.time()) >= int(self.credential_expires_at):
            raise CredentialExpiredError('Verified actor credential has expired')


_current_actor: contextvars.ContextVar[ActorContext | None] = contextvars.ContextVar(
    'overstory_actor', default=None
)


def current_actor() -> ActorContext:
    """Return the bound actor, or fail closed."""

    actor = _current_actor.get()
    if actor is None:
        raise IdentityRequiredError('A verified actor context is required')
    actor.ensure_credential_current()
    return actor


def bound_actor() -> ActorContext | None:
    """Return the bound actor, or ``None`` when no actor is bound."""

    return _current_actor.get()


def set_actor(actor: ActorContext) -> contextvars.Token[ActorContext | None]:
    actor.ensure_credential_current()
    return _current_actor.set(actor)


def reset_actor(token: contextvars.Token[ActorContext | None]) -> None:
    _current_actor.reset(token)


@contextmanager
def use_actor(actor: ActorContext) -> Iterator[ActorContext]:
    token = _current_actor.set(actor)
    try:
        yield actor
    finally:
        _current_actor.reset(token)


_GRAPH_SCOPES = frozenset({'kg:read', 'kg:write', 'kg:admin'})
_ADMIN_PRINCIPAL_IDS_SETTING = 'KG_ADMIN_PRINCIPAL_IDS'


@dataclass(frozen=True)
class RequestGrant:
    """The WebUI route authority of one verified actor."""

    actor: ActorContext
    tenant: str
    scopes: frozenset[str]


_current_grant: contextvars.ContextVar[RequestGrant | None] = contextvars.ContextVar(
    'overstory_grant', default=None
)


def _admin_principal_ids() -> frozenset[str]:
    raw = str(setting(_ADMIN_PRINCIPAL_IDS_SETTING, '') or '')
    return frozenset(item.strip() for item in raw.split(',') if item.strip())


def grant_for(actor: ActorContext) -> RequestGrant:
    """Project a verified actor onto its WebUI route scopes.

    Scopes are hierarchical: ``kg:admin`` implies write and read, and
    ``kg:write`` implies read. A verified actor with no ``kg:*`` role reads.
    A principal in ``KG_ADMIN_PRINCIPAL_IDS`` is an administrator.
    """

    if not actor.authenticated or not actor.actor_id:
        raise PermissionError('A verified actor is required')
    if not actor.tenant_id:
        raise PermissionError('A verified tenant claim is required')
    actor.ensure_credential_current()
    if actor.actor_id in _admin_principal_ids() and 'kg:admin' not in actor.roles:
        actor = ActorContext(
            actor_id=actor.actor_id,
            tenant_id=actor.tenant_id,
            actor_type=actor.actor_type,
            roles=(*actor.roles, 'kg:admin'),
            groups=actor.groups,
            authenticated=True,
            credential_expires_at=actor.credential_expires_at,
            credential=actor.credential,
        )
    scopes = frozenset(actor.roles) & _GRAPH_SCOPES
    if 'kg:admin' in scopes:
        scopes |= {'kg:read', 'kg:write'}
    elif 'kg:write' in scopes:
        scopes |= {'kg:read'}
    elif not scopes:
        scopes = frozenset({'kg:read'})
    return RequestGrant(actor=actor, tenant=actor.tenant_id, scopes=scopes)


def current_grant() -> RequestGrant | None:
    """Return the bound request grant, or ``None``."""

    return _current_grant.get()


def set_grant(grant: RequestGrant) -> contextvars.Token[RequestGrant | None]:
    return _current_grant.set(grant)


def reset_grant(token: contextvars.Token[RequestGrant | None]) -> None:
    _current_grant.reset(token)


@contextmanager
def use_grant(grant: RequestGrant | None) -> Iterator[RequestGrant | None]:
    token = _current_grant.set(grant)
    try:
        yield grant
    finally:
        _current_grant.reset(token)


CORRELATION_HEADER = 'x-correlation-id'
_correlation: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    'overstory_correlation', default=None
)


def get_correlation_id() -> str | None:
    """Return the correlation ID bound to this request, if any."""

    return _correlation.get()


@contextmanager
def bind_correlation(correlation_id: str) -> Iterator[str]:
    """Bind one correlation ID for the duration of a request."""

    value = str(correlation_id)[:128]
    token = _correlation.set(value)
    try:
        yield value
    finally:
        _correlation.reset(token)


# ---------------------------------------------------------------------------
# Bearer verification (OpenID Connect relying party)
# ---------------------------------------------------------------------------


class TokenValidationError(PermissionError):
    """Raised when a bearer credential fails verification."""


def _single_header(authorization: list[bytes]) -> bytes | None:
    if len(authorization) > 1:
        raise PermissionError('ambiguous credentials')
    if not authorization:
        return None
    value = authorization[0]
    if not isinstance(value, bytes) or len(value) > _MAX_CREDENTIAL_BYTES:
        raise PermissionError('invalid credential size')
    return value


def _is_token_text(token: str) -> bool:
    return bool(token) and all(33 <= ord(char) != 127 for char in token)


def parse_bearer_authorization(authorization: list[bytes]) -> str | None:
    """Parse one unambiguous ``Authorization: Bearer`` header value."""

    value = _single_header(authorization)
    if value is None:
        return None
    try:
        raw = value.decode('ascii')
    except UnicodeDecodeError:
        raise PermissionError('malformed authorization') from None
    scheme, separator, token = raw.partition(' ')
    if scheme.lower() != 'bearer' or not separator or not _is_token_text(token):
        raise PermissionError('malformed authorization')
    return token


_jwks_cache: dict[str, tuple[Any, float]] = {}


def _check_jwks_uri(jwks_uri: str) -> None:
    parsed = urlsplit(jwks_uri)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname:
        raise RuntimeError('AUTH_JWT_JWKS_URI must be an absolute HTTP(S) URL')
    if parsed.username or parsed.password or parsed.fragment:
        raise RuntimeError('AUTH_JWT_JWKS_URI cannot contain credentials')
    if parsed.scheme != 'https' and parsed.hostname.lower() not in _LOOPBACK:
        raise RuntimeError('JWKS transport requires HTTPS outside loopback')


async def fetch_jwks(jwks_uri: str) -> Any:
    """Fetch and cache one bounded JSON Web Key Set."""

    now = time.monotonic()
    cached = _jwks_cache.get(jwks_uri)
    if cached is not None and now < cached[1]:
        return cached[0]
    _check_jwks_uri(jwks_uri)
    async with httpx.AsyncClient(
        timeout=10.0, trust_env=False, follow_redirects=False
    ) as client:
        body = bytearray()
        async with client.stream('GET', jwks_uri) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > _JWKS_MAX_BYTES:
                    raise RuntimeError('JWKS response exceeds its safety bound')
    document = json.loads(body)
    keys = document.get('keys') if isinstance(document, dict) else None
    if not isinstance(keys, list) or not 1 <= len(keys) <= 100:
        raise RuntimeError('JWKS response has an invalid shape')
    _jwks_cache[jwks_uri] = (document, now + _JWKS_CACHE_TTL)
    return document


def decode_jwt(
    token: str, jwks: Mapping[str, Any], *, issuer: str | None, audience: str | None
) -> dict[str, Any]:
    """Verify signature, expiry, issuer and audience; return the claims."""

    from joserfc import jwt
    from joserfc.jwk import KeySet

    try:
        key_set = KeySet.import_key_set(dict(jwks))  # type: ignore[arg-type]
        claims = dict(
            jwt.decode(token, key_set, algorithms=config.auth_jwt_algorithms).claims
        )
        options: dict[str, Any] = {'exp': {'essential': True}}
        if issuer:
            options['iss'] = {'essential': True, 'value': issuer}
        if audience:
            options['aud'] = {'essential': True, 'value': audience}
        jwt.JWTClaimsRegistry(leeway=30, **options).validate(claims)
    except Exception as exc:  # noqa: BLE001 - every failure is a refusal
        raise TokenValidationError('Token validation failed') from exc
    return claims


def _claim_text(claims: Mapping[str, Any], *names: str) -> str:
    for name in names:
        value = claims.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()[:512]
    return ''


def _claim_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [item for item in value.replace(',', ' ').split() if item]
    if isinstance(value, list | tuple):
        return [str(item) for item in value if isinstance(item, str) and item]
    return []


def actor_from_claims(
    claims: Mapping[str, Any], *, credential: str | None = None
) -> ActorContext:
    """Project verified claims onto an authenticated :class:`ActorContext`."""

    subject = _claim_text(claims, 'sub', 'client_id', 'azp')
    if not subject:
        raise ValueError('verified claims carry no subject')
    roles: list[str] = _claim_list(claims.get('roles'))
    realm = claims.get('realm_access')
    if isinstance(realm, Mapping):
        roles.extend(_claim_list(realm.get('roles')))
    roles.extend(_claim_list(claims.get('scope') or claims.get('scp')))
    groups = _claim_list(claims.get('groups'))
    roles.extend(groups)
    expiry = claims.get('exp')
    return ActorContext(
        actor_id=subject,
        tenant_id=_claim_text(claims, 'tenant_id', 'tenant', 'org_id', 'tid', 'org'),
        actor_type='human' if _claim_text(claims, 'email') else 'automated_service',
        roles=tuple(dict.fromkeys(roles))[:128],
        groups=tuple(dict.fromkeys(groups))[:128],
        authenticated=True,
        credential_expires_at=int(expiry) if isinstance(expiry, int | float) else None,
        credential=credential,
    )


async def verify_bearer(token: str) -> ActorContext:
    """Verify ``token`` against the configured JWKS and project its actor."""

    jwks_uri = config.auth_jwt_jwks_uri
    if not jwks_uri:
        raise TokenValidationError('No bearer verifier is configured')
    claims = decode_jwt(
        token,
        await fetch_jwks(jwks_uri),
        issuer=config.auth_jwt_issuer,
        audience=config.auth_jwt_audience,
    )
    return actor_from_claims(claims, credential=token)


# ---------------------------------------------------------------------------
# Arbora served operations
# ---------------------------------------------------------------------------


def _unavailable_detail(feature: str, operation: str) -> dict[str, str]:
    return {
        'error': 'not_available',
        'feature': feature,
        'needs_operation': operation,
        'message': (
            f'{feature} is not available: Arbora does not serve '
            f'the {operation} operation yet.'
        ),
    }


class OperationUnavailable(HTTPException):
    """The capability needs an Arbora served operation that is not available."""

    def __init__(self, feature: str, operation: str) -> None:
        self.feature = feature
        self.operation = operation
        super().__init__(
            status_code=501, detail=_unavailable_detail(feature, operation)
        )


def unavailable(feature: str, operation: str) -> OperationUnavailable:
    """Build the "not available" answer for one capability."""

    return OperationUnavailable(feature, operation)


class HttpOperationTransport:
    """Call served Arbora operations over its HTTP API."""

    def __init__(
        self,
        base_url: str,
        *,
        credential: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip('/')
        self._credential = credential
        self._client = client

    async def invoke(
        self,
        op_id: str,
        params: Mapping[str, Any],
        *,
        idempotency_key: str | None = None,
    ) -> Mapping[str, Any]:
        headers = {'Accept': 'application/json'}
        if idempotency_key:
            headers['Idempotency-Key'] = idempotency_key
        if self._credential:
            headers['Authorization'] = f'Bearer {self._credential}'
        url = f'{self._base_url}/ops/{op_id}'
        if self._client is not None:
            response = await self._client.post(url, json=dict(params), headers=headers)
        else:
            async with httpx.AsyncClient(
                timeout=_OPERATION_TIMEOUT, trust_env=False, follow_redirects=False
            ) as client:
                response = await client.post(url, json=dict(params), headers=headers)
        if response.status_code == 404:
            raise OperationUnavailable(op_id, op_id)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, Mapping):
            raise RuntimeError('Arbora returned a non-object operation result')
        return payload


class _KeyedTransport:
    """Attach one idempotency key to the next served-operation call."""

    def __init__(self, inner: Any, key: str) -> None:
        self._inner = inner
        self._key = key

    async def invoke(self, op_id: str, params: Mapping[str, Any]) -> Mapping[str, Any]:
        return await self._inner.invoke(op_id, params, idempotency_key=self._key)


async def invoke_operation(
    op_id: str,
    params: Mapping[str, Any],
    *,
    transport: Any = None,
    idempotency_key: str | None = None,
) -> Mapping[str, Any]:
    """Invoke one served Arbora operation as the bound actor.

    ``arbora.client`` validates the operation ID and the registry digest
    when the host provides it.
    """

    if transport is None:
        actor = bound_actor()
        transport = HttpOperationTransport(
            config.arbora_api_url,
            credential=actor.credential if actor is not None else None,
        )
    if idempotency_key:
        transport = _KeyedTransport(transport, idempotency_key)
    try:
        from arbora.client.invoke import invoke as client_invoke
    except ImportError:
        return await transport.invoke(op_id, params)
    return await client_invoke(transport, op_id, params)  # type: ignore[arg-type]


#: Arbora error codes that the WebUI passes to the browser as their own status.
_ERROR_STATUS = {
    'UNAUTHENTICATED': 401,
    'PERMISSION_DENIED': 403,
    'NOT_FOUND': 404,
    'INVALID_ARGUMENT': 400,
    'FAILED_PRECONDITION': 409,
    'RESOURCE_EXHAUSTED': 429,
    'UNAVAILABLE': 503,
}


def _error_code(payload: Mapping[str, Any]) -> str:
    error = payload.get('error')
    if isinstance(error, Mapping):
        return str(error.get('code') or 'INTERNAL')
    return str(error or 'INTERNAL')


def operation_value(payload: Mapping[str, Any]) -> Any:
    """Return the ``value`` of one Arbora operation envelope.

    A refusal envelope becomes an :class:`HTTPException` with the matching
    status. The detail carries the Arbora error code, never its message.
    """

    if payload.get('ok') is False:
        code = _error_code(payload)
        raise HTTPException(status_code=_ERROR_STATUS.get(code, 502), detail=code)
    result = payload.get('result', payload)
    if isinstance(result, Mapping) and 'value' in result:
        return result['value']
    return result


async def served(
    op_id: str,
    params: Mapping[str, Any] | None = None,
    *,
    idempotency_key: str | None = None,
    transport: Any = None,
) -> Any:
    """Invoke one served Arbora operation and return its value."""

    try:
        payload = await invoke_operation(
            op_id,
            params or {},
            transport=transport,
            idempotency_key=idempotency_key,
        )
    except httpx.HTTPStatusError as exc:
        try:
            body = exc.response.json()
        except ValueError:
            body = None
        if isinstance(body, Mapping):
            return operation_value(body)
        raise HTTPException(status_code=502, detail='arbora_error') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail='arbora_unreachable') from exc
    return operation_value(payload)
