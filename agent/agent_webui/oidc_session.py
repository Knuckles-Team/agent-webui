#!/usr/bin/python
"""Browser single-sign-on boundary for the Agent WebUI.

The WebUI's request gate
(:class:`agent_utilities.security.request_identity.ActorIdentityMiddleware`) is
deliberately **Bearer-only**: every non-health route requires a JWT that
validates against ``AUTH_JWT_JWKS_URI``/``AUTH_JWT_ISSUER``/``AUTH_JWT_AUDIENCE``.
That is correct for service callers and fatal for a browser, which cannot mint
or carry a bearer token on a top-level navigation.  A browser therefore received
``401 {"error": "Verified Bearer identity required"}`` for *every* URL, including
the SPA shell at ``/``.

This module closes that gap **without weakening the gate**.  It is a pure-ASGI
middleware mounted directly *outside* the identity middleware, so:

* the ``/auth/*`` bootstrap and attended-arm endpoints it owns are answered by this middleware itself
  and never reach the identity gate — the login bootstrap is structurally
  outside the boundary rather than punched through
  ``UNAUTHENTICATED_PATHS``, which stays exactly as shipped;
* every other request is handed down **unchanged** unless a sealed session
  cookie is present, in which case the *user's own* access token is placed on
  the request as ``Authorization: Bearer`` and validated by the unmodified
  identity gate exactly like any other credential.

Identity semantics
------------------
The browser carries the **signed-in human's own token**, not a service
credential.  The code exchange runs server-side with a confidential client so
the client secret never reaches the browser, but the resulting access token's
``sub``, ``email`` and ``realm_access.roles`` are the *user's*.  The UI can
therefore never act with more authority than the person using it: a user
without ``kg:write`` gets 403 from the WebUI's own authorization middleware, and
a user without ``kg:read`` cannot even load the SPA.  This is the deliberate
alternative to a backend that holds one privileged credential and acts "on
behalf of" whoever happens to be connected.

Configuration (all required to enable; unset ⇒ the middleware is an inert
pass-through and the WebUI behaves exactly as it did before):

``WEBUI_OIDC_CLIENT_ID``
    Confidential Keycloak client with the standard (authorization-code) flow.
``WEBUI_OIDC_CLIENT_SECRET``
    That client's secret.  Read from the environment, which the fleet populates
    from OpenBao through an ``ExternalSecret``.
``WEBUI_OIDC_ISSUER``
    Issuer URL; OIDC discovery is performed against it.  Defaults to
    ``AUTH_JWT_ISSUER`` so the browser and the gate cannot drift apart.
``WEBUI_OIDC_REDIRECT_URI``
    Absolute callback URL registered on the client.
``WEBUI_SESSION_KEY``
    URL-safe base64 32-byte Fernet key sealing the session cookie.
``WEBUI_OIDC_SCOPE``
    Optional; defaults to ``openid profile email``.
``WEBUI_OIDC_ATTENDED_ACR_VALUES``
    Comma-separated ACR values accepted after a forced interactive step-up.
    Browser control stays fail-closed when this is unset.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import math
import os
import secrets
import time
from dataclasses import dataclass
from ipaddress import ip_address
from typing import Any, TypeGuard, cast
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

from .browser_control_canonical import canonical_protocol_json, parse_protocol_json

logger = logging.getLogger(__name__)

# Paths this middleware answers itself.  They are the login bootstrap only: none
# of them read or write the graph, and none of them are forwarded downstream.
LOGIN_PATH = '/auth/login'
CALLBACK_PATH = '/auth/callback'
LOGOUT_PATH = '/auth/logout'
SESSION_PATH = '/auth/session'
ATTENDED_ARM_PATH = '/api/browser-control/attended-arm'
ATTENDED_ARM_FINALIZE_PATH = '/api/browser-control/attended-arm/finalize'
_OWNED_PATHS = frozenset(
    {
        LOGIN_PATH,
        CALLBACK_PATH,
        LOGOUT_PATH,
        SESSION_PATH,
        ATTENDED_ARM_PATH,
        ATTENDED_ARM_FINALIZE_PATH,
    }
)

SESSION_COOKIE = 'au_session'
FLOW_COOKIE = 'au_oidc_flow'
ATTENDED_ARM_COOKIE = 'au_browser_attended_arm'
RECENT_AUTH_COOKIE = 'au_browser_recent_auth'

# An in-flight authorization code exchange must complete quickly; a stale state
# cookie is a replay surface, not a convenience.
_FLOW_TTL_S = 600
# Refresh the access token this many seconds before it actually expires.
_EXPIRY_SKEW_S = 30
# Discovery documents change rarely; re-read hourly so a rotated endpoint is
# picked up without a restart.
_DISCOVERY_TTL_S = 3600
# A sealed session holds two JWTs, so it does NOT fit in one cookie: browsers
# cap a single cookie at 4 KiB and the ingress' default upstream header buffer
# is smaller still, which turned an otherwise-successful login into a 502 at the
# proxy. The sealed value is therefore chunked across numbered cookies. Keep the
# chunk comfortably under both limits including the name and attributes.
_COOKIE_CHUNK_CHARS = 3000
# Refuse to reassemble an implausible number of chunks; a forged cookie set must
# be cheap to reject.
_MAX_COOKIE_CHUNKS = 8
_MAX_COOKIE_BYTES = _COOKIE_CHUNK_CHARS * _MAX_COOKIE_CHUNKS
_MAX_TOKEN_RESPONSE_BYTES = 1024 * 1024
_MAX_ATTENDED_ARM_REQUEST_BYTES = 4096
_ATTENDED_ARM_TTL_S = 300
_MAX_ATTENDED_ARM_TTL_S = 900
_RECENT_AUTH_TTL_S = 60
_AUTH_TIME_CLOCK_SKEW_S = 30
_IDENTIFIER_CHARS = frozenset(
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-'
)


class OIDCConfigurationError(RuntimeError):
    """The browser SSO boundary is partially configured, which is never safe."""


@dataclass(frozen=True)
class OIDCSettings:
    """The resolved, validated browser-SSO configuration."""

    client_id: str
    client_secret: str
    issuer: str
    redirect_uri: str
    scope: str
    session_key: str
    attended_acr: tuple[str, ...] = ()

    @property
    def post_logout_redirect(self) -> str:
        parsed = urlsplit(self.redirect_uri)
        return f'{parsed.scheme}://{parsed.netloc}/'


@dataclass(frozen=True, slots=True)
class _StepupEvidence:
    access_token: str
    subject: str
    tenant: str
    origin: str
    acr: str
    now: float
    auth_time: float
    access_expires_at: float


@dataclass(frozen=True, slots=True)
class _VerifiedStepupClaims:
    access: dict[str, Any]
    identity: dict[str, Any]
    now: float
    started_at: float
    auth_time: float
    access_expires_at: float


def _env(name: str, default: str = '') -> str:
    return str(os.environ.get(name, default) or '').strip()


def _attended_acr_values() -> tuple[str, ...]:
    values = tuple(
        item.strip()
        for item in _env('WEBUI_OIDC_ATTENDED_ACR_VALUES').split(',')
        if item.strip()
    )
    invalid = len(values) > 8 or any(
        len(value) > 128
        or any(ord(character) < 33 or ord(character) == 127 for character in value)
        for value in values
    )
    if invalid:
        raise OIDCConfigurationError(
            'WEBUI_OIDC_ATTENDED_ACR_VALUES must contain bounded ACR identifiers'
        )
    return values


def _configuration_is_complete(values: tuple[str, ...]) -> bool:
    present = tuple(bool(value) for value in values)
    if not any(present):
        return False
    if all(present):
        return True
    raise OIDCConfigurationError(
        'Agent WebUI browser SSO requires WEBUI_OIDC_CLIENT_ID, '
        'WEBUI_OIDC_CLIENT_SECRET, an issuer (WEBUI_OIDC_ISSUER or '
        'AUTH_JWT_ISSUER), WEBUI_OIDC_REDIRECT_URI and WEBUI_SESSION_KEY'
    )


def _validate_oidc_url(label: str, value: str) -> None:
    parsed = urlsplit(value)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname:
        raise OIDCConfigurationError(
            f'Agent WebUI browser SSO {label} is not an absolute http(s) URL'
        )


def load_settings() -> OIDCSettings | None:
    """Return the browser SSO settings, or ``None`` when SSO is not configured.

    Raises:
        OIDCConfigurationError: If some but not all required values are present.
            A half-configured login boundary silently degrades to "no login at
            all", so it fails loud instead.
    """

    client_id = _env('WEBUI_OIDC_CLIENT_ID')
    client_secret = _env('WEBUI_OIDC_CLIENT_SECRET')
    issuer = _env('WEBUI_OIDC_ISSUER') or _env('AUTH_JWT_ISSUER')
    redirect_uri = _env('WEBUI_OIDC_REDIRECT_URI')
    session_key = _env('WEBUI_SESSION_KEY')
    scope = _env('WEBUI_OIDC_SCOPE') or 'openid profile email'
    attended_acr = _attended_acr_values()
    required = (client_id, client_secret, issuer, redirect_uri, session_key)
    if not _configuration_is_complete(required):
        return None
    for label, url in (('issuer', issuer), ('redirect URI', redirect_uri)):
        _validate_oidc_url(label, url)
    return OIDCSettings(
        client_id=client_id,
        client_secret=client_secret,
        issuer=issuer.rstrip('/'),
        redirect_uri=redirect_uri,
        scope=scope,
        session_key=session_key,
        attended_acr=attended_acr,
    )


def _fernet(settings: OIDCSettings) -> Any:
    from cryptography.fernet import Fernet

    try:
        return Fernet(settings.session_key.encode('ascii'))
    except (ValueError, TypeError) as exc:
        raise OIDCConfigurationError(
            'WEBUI_SESSION_KEY must be a url-safe base64-encoded 32-byte key'
        ) from exc


def _browser_login_session_ref(settings: OIDCSettings, access_token: str) -> str:
    """Derive a server-only opaque reference for one verified browser login.

    This is added to ASGI state only after a sealed OIDC session opens. A
    caller-supplied Bearer credential bypasses this path and therefore cannot
    stand in for attended browser delegation.
    """

    key = base64.urlsafe_b64decode(settings.session_key.encode('ascii'))
    material = f'agent-webui:browser-login:v1\x1f{access_token}'.encode()
    return 'login_' + hmac.new(key, material, hashlib.sha256).hexdigest()


def _cookies(scope: Any) -> dict[str, str]:
    """Parse request cookies from raw ASGI headers."""

    jar: dict[str, str] = {}
    for key, value in scope.get('headers') or []:
        if key.decode('latin-1').lower() != 'cookie':
            continue
        for chunk in value.decode('latin-1').split(';'):
            name, _, raw = chunk.partition('=')
            name = name.strip()
            if name:
                jar[name] = raw.strip()
    return jar


def _is_secure(scope: Any) -> bool:
    """Return whether the browser reached this request over TLS.

    ``Secure`` cookies are silently dropped by browsers on plain HTTP, so the
    flag is set from the observed scheme (including the ingress' forwarded
    scheme) rather than hardcoded.  See the module's deployment notes: the
    homelab ingress currently serves ``http://au.example``.
    """

    if str(scope.get('scheme') or '').lower() in {'https', 'wss'}:
        return True
    for key, value in scope.get('headers') or []:
        if key.decode('latin-1').lower() == 'x-forwarded-proto':
            return value.decode('latin-1').strip().lower() == 'https'
    return False


def _loopback_host(hostname: str) -> bool:
    if hostname == 'localhost':
        return True
    try:
        return ip_address(hostname).is_loopback
    except ValueError:
        return False


def trusted_request_origin(
    scope: Any, supplied_origin: str | None = None
) -> str | None:
    """Return the exact configured request origin or fail closed.

    Host is accepted only after the application's Host middleware and must map
    to one configured ``ALLOWED_ORIGINS`` entry.  A supplied WebSocket Origin
    must byte-normalize to that same request origin; another allowlisted origin
    is still cross-origin and is refused.
    """

    request_host = _trusted_request_host(scope)
    if request_host is None:
        return None
    host, hostname = request_host
    scheme = _trusted_request_scheme(scope, hostname)
    if scheme is None:
        return None
    origin = f'{scheme}://{host}'
    if origin not in _configured_origins():
        return None
    normalized_supplied = (
        supplied_origin.lower().removesuffix('/')
        if supplied_origin is not None
        else origin
    )
    return origin if normalized_supplied == origin else None


def _trusted_request_host(scope: Any) -> tuple[str, str] | None:
    hosts = [
        value.decode('latin-1').strip().lower()
        for key, value in scope.get('headers') or []
        if key.decode('latin-1').lower() == 'host'
    ]
    if (
        len(hosts) != 1
        or not hosts[0]
        or any(character in hosts[0] for character in '\r\n,@/\\')
    ):
        return None
    return _parsed_request_host(hosts[0])


def _parsed_request_host(host: str) -> tuple[str, str] | None:
    parsed_host = urlsplit(f'//{host}')
    if not parsed_host.hostname or parsed_host.username or parsed_host.password:
        return None
    return host, parsed_host.hostname


def _trusted_request_scheme(scope: Any, hostname: str) -> str | None:
    scope_scheme = str(scope.get('scheme') or '').lower()
    scheme = (
        'https'
        if _is_secure(scope)
        else ('http' if scope_scheme in {'http', 'ws'} else '')
    )
    if scheme != 'https' and not (scheme == 'http' and _loopback_host(hostname)):
        return None
    return scheme


def _configured_origins() -> set[str]:
    from agent_utilities.core.config import config

    return {
        entry.strip().lower().removesuffix('/')
        for entry in str(config.allowed_origins or '').split(',')
        if entry.strip()
    }


def _trusted_backchannel_url(value: Any) -> str | None:
    endpoint = str(value or '')
    parsed = urlsplit(endpoint)
    valid = bool(
        parsed.scheme in {'http', 'https'}
        and parsed.hostname
        and not parsed.username
        and not parsed.password
        and not parsed.fragment
        and (parsed.scheme == 'https' or _loopback_host(str(parsed.hostname).lower()))
    )
    return endpoint if valid else None


def _introspection_is_live(
    claims: Any,
    *,
    subject: str,
    tenant: str,
    expires_at: float,
) -> bool:
    if not isinstance(claims, dict):
        return False
    try:
        live_expiry = float(str(claims.get('exp')))
    except (OverflowError, TypeError, ValueError):
        return False
    return bool(
        math.isfinite(live_expiry)
        and claims.get('active') is True
        and str(claims.get('sub') or '') == subject
        and str(claims.get('tenant_id') or '') == tenant
        and live_expiry >= expires_at - 1.0
        and live_expiry > time.time() + _EXPIRY_SKEW_S
    )


def _stepup_identity_matches(
    id_claims: dict[str, Any],
    flow: dict[str, Any],
    *,
    subject: str,
    tenant: str,
    acr: str,
    accepted_acr: tuple[str, ...],
) -> bool:
    nonce = str(id_claims.get('nonce') or '')
    identity = _stepup_subject_matches(id_claims, flow, subject=subject, tenant=tenant)
    stepup = acr in accepted_acr and secrets.compare_digest(
        nonce, str(flow.get('nonce') or '')
    )
    return identity and stepup


def _stepup_subject_matches(
    id_claims: dict[str, Any],
    flow: dict[str, Any],
    *,
    subject: str,
    tenant: str,
) -> bool:
    return bool(
        subject
        and tenant
        and subject == str(flow.get('subject') or '')
        and subject == str(id_claims.get('sub') or '')
        and tenant == str(flow.get('tenant') or '')
    )


def _stepup_times_match(
    *,
    started_at: float,
    auth_time: float,
    access_expires_at: float,
    now: float,
) -> bool:
    return bool(
        all(
            math.isfinite(value)
            for value in (
                started_at,
                auth_time,
                access_expires_at,
                now,
            )
        )
        and auth_time >= started_at - _AUTH_TIME_CLOCK_SKEW_S
        and auth_time <= now + _AUTH_TIME_CLOCK_SKEW_S
        and now - auth_time <= _ATTENDED_ARM_TTL_S
        and access_expires_at > now + _EXPIRY_SKEW_S
    )


def _single_header(scope: Any, name: bytes) -> str | None:
    values = [
        value.decode('latin-1').strip()
        for key, value in scope.get('headers') or []
        if key.lower() == name
    ]
    return values[0] if len(values) == 1 and values[0] else None


def _bounded_identifier(value: Any) -> str | None:
    candidate = value if isinstance(value, str) else ''
    if not 1 <= len(candidate) <= 128 or any(
        character not in _IDENTIFIER_CHARS for character in candidate
    ):
        return None
    return candidate


def _bounded_digest(value: Any) -> str | None:
    candidate = value if isinstance(value, str) else ''
    if (
        len(candidate) != 71
        or not candidate.startswith('sha256:')
        or any(character not in '0123456789abcdef' for character in candidate[7:])
    ):
        return None
    return candidate


def _float_claims(document: dict[str, Any], *names: str) -> tuple[float, ...] | None:
    try:
        values = tuple(float(document[name]) for name in names)
    except (KeyError, OverflowError, TypeError, ValueError):
        return None
    return values if all(math.isfinite(value) for value in values) else None


def _hex_reference(document: dict[str, Any], name: str, prefix: str) -> bool:
    value = str(document.get(name) or '')
    suffix = value.removeprefix(prefix)
    return bool(
        len(suffix) == 64
        and len(value) == len(prefix) + 64
        and all(character in '0123456789abcdef' for character in suffix)
    )


def _attended_receipt_scope_valid(receipt: dict[str, Any]) -> bool:
    generation = receipt.get('registration_generation')
    return bool(
        isinstance(generation, int)
        and not isinstance(generation, bool)
        and 1 <= generation <= 2**53 - 1
        and _bounded_identifier(receipt.get('route_id')) is not None
        and _bounded_digest(receipt.get('catalog_digest')) is not None
        and _bounded_digest(receipt.get('tool_scope_digest')) is not None
    )


def _attended_receipt_references_valid(receipt: dict[str, Any]) -> bool:
    return _hex_reference(receipt, 'attended_arm_ref', 'attended_') and _hex_reference(
        receipt, 'document_ref', 'document_'
    )


def _authority_window_valid(
    values: tuple[float, float, float],
    *,
    max_lifetime: float,
    require_live: bool = True,
) -> bool:
    issued_at, expires_at, access_expires_at = values
    now = time.time()
    ordered = bool(
        issued_at <= now
        and issued_at < expires_at <= access_expires_at
        and expires_at - issued_at <= max_lifetime
    )
    return ordered and (not require_live or now < expires_at)


def _attended_receipt_identity_valid(
    receipt: dict[str, Any], *, origin: str | None, login_ref: str
) -> bool:
    return bool(
        origin is not None
        and receipt.get('origin') == origin
        and receipt.get('login_session_ref') == login_ref
    )


def _recent_grant_valid(
    grant: dict[str, Any],
    *,
    origin: str | None,
    login_ref: str,
    timing: tuple[float, float, float],
) -> bool:
    return bool(
        _attended_receipt_identity_valid(grant, origin=origin, login_ref=login_ref)
        and _hex_reference(grant, 'grant_ref', 'attended_')
        and _bounded_identifier(grant.get('route_id')) is not None
        and _authority_window_valid(timing, max_lifetime=_RECENT_AUTH_TTL_S)
    )


def _opaque_ref(settings: OIDCSettings, label: str, *parts: str) -> str:
    key = base64.urlsafe_b64decode(settings.session_key.encode('ascii'))
    material = '\x1f'.join((f'agent-webui:{label}:v1', *parts)).encode('utf-8')
    return f'{label}_' + hmac.new(key, material, hashlib.sha256).hexdigest()


def _request_scheme_redirect_uri(configured_redirect_uri: str, scope: Any) -> str:
    """``configured_redirect_uri`` with its scheme swapped to match `scope`.

    D-WUI-31: ``WEBUI_OIDC_REDIRECT_URI`` is one fixed scheme (currently
    ``http://au.example/auth/callback``). The ingress now also serves TLS
    (D-WA-5), and a caller starting the login flow over https sets the
    pre-login flow cookie ``Secure`` — correctly, per ``_is_secure`` — but
    was then bounced to the *statically configured* http callback, so the
    browser silently dropped that Secure cookie before ``_handle_callback``
    could read it back, and every https login failed closed with "Sign-in
    could not be verified".

    The host/path stay exactly as configured (never derived from a
    request-controlled ``Host`` header — that would make the callback URL
    attacker-influenceable); only the scheme varies, to whichever one the
    live request actually used. This is safe precisely because
    ``scripts/provision_identity.py`` already registers BOTH the http and
    https variant of this same host+path as valid Keycloak redirect URIs —
    this function can only ever produce one of those two already-trusted
    values, never a third one.
    """

    parsed = urlsplit(configured_redirect_uri)
    scheme = 'https' if _is_secure(scope) else 'http'
    return urlunsplit(
        (scheme, parsed.netloc, parsed.path, parsed.query, parsed.fragment)
    )


def _set_cookie_header(
    name: str,
    value: str,
    *,
    secure: bool,
    max_age: int | None,
) -> tuple[bytes, bytes]:
    parts = [f'{name}={value}', 'Path=/', 'HttpOnly', 'SameSite=Lax']
    if secure:
        parts.append('Secure')
    if max_age is not None:
        parts.append(f'Max-Age={max_age}')
    return (b'set-cookie', '; '.join(parts).encode('latin-1'))


def _chunk_name(index: int) -> str:
    return f'{SESSION_COOKIE}{index}'


def _session_cookie_headers(value: str, *, secure: bool) -> list[tuple[bytes, bytes]]:
    """Emit the sealed session as numbered cookie chunks, clearing any surplus.

    Every write also expires the chunk slots it does not use, so shrinking from
    a three-chunk session to a two-chunk one cannot leave a stale third chunk
    that corrupts the next read.
    """

    chunks = [
        value[start : start + _COOKIE_CHUNK_CHARS]
        for start in range(0, len(value), _COOKIE_CHUNK_CHARS)
    ] or ['']
    if len(chunks) > _MAX_COOKIE_CHUNKS:
        raise OIDCConfigurationError(
            'The identity provider issued a session too large to store in cookies'
        )
    headers = [
        _set_cookie_header(_chunk_name(index), chunk, secure=secure, max_age=None)
        for index, chunk in enumerate(chunks)
    ]
    headers.extend(
        _set_cookie_header(_chunk_name(index), '', secure=secure, max_age=0)
        for index in range(len(chunks), _MAX_COOKIE_CHUNKS)
    )
    return headers


def _clear_session_cookie_headers(*, secure: bool) -> list[tuple[bytes, bytes]]:
    return [
        _set_cookie_header(_chunk_name(index), '', secure=secure, max_age=0)
        for index in range(_MAX_COOKIE_CHUNKS)
    ]


def _read_session_cookie(jar: dict[str, str]) -> str:
    """Reassemble the sealed session from its numbered chunks."""

    parts: list[str] = []
    for index in range(_MAX_COOKIE_CHUNKS):
        chunk = jar.get(_chunk_name(index))
        if not chunk:
            break
        parts.append(chunk)
    return ''.join(parts)


def _safe_next(raw: str) -> str:
    """Return a same-origin path-only continuation target, defaulting to ``/``.

    Anything that could leave the origin (scheme-relative ``//host``, absolute
    URLs, backslash tricks, control characters) collapses to ``/`` so the login
    endpoint can never be used as an open redirector.
    """

    candidate = (raw or '').strip()
    if _unsafe_continuation(candidate):
        return '/'
    parsed = urlsplit(candidate)
    if parsed.scheme or parsed.netloc:
        return '/'
    return parsed.path or '/'


def _unsafe_continuation(candidate: str) -> bool:
    return bool(
        not candidate.startswith('/')
        or candidate.startswith('//')
        or candidate.startswith('/\\')
        or len(candidate) > 2048
        or any(character in candidate for character in '\r\n\\')
    )


class OIDCBrowserSessionMiddleware:
    """Give browsers a verified user identity without relaxing the gate.

    Ordering matters: this must be installed so it runs **directly outside**
    ``WebUIActorIdentityMiddleware``.  Everything it forwards is still subject
    to the unmodified identity and authorization boundaries.
    """

    def __init__(
        self,
        app: Any,
        *,
        settings: OIDCSettings,
        browser_control: Any | None = None,
        mint_graph_session: Any | None = None,
    ) -> None:
        self.app = app
        self.settings = settings
        self.browser_control = browser_control
        self.mint_graph_session = mint_graph_session
        self._fernet = _fernet(settings)
        self._discovery: dict[str, Any] | None = None
        self._discovery_expires_at = 0.0

    # ---------------------------------------------------------------- discovery

    async def _endpoints(self) -> dict[str, Any]:
        now = time.monotonic()
        if self._discovery is not None and now < self._discovery_expires_at:
            return self._discovery
        import httpx

        url = f'{self.settings.issuer}/.well-known/openid-configuration'
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(url)
                response.raise_for_status()
                document = response.json()
        except Exception as exc:
            raise OIDCConfigurationError(
                'Agent WebUI could not read the OpenID provider metadata'
            ) from exc
        if not isinstance(document, dict) or not document.get('authorization_endpoint'):
            raise OIDCConfigurationError(
                'Agent WebUI received OpenID provider metadata without an '
                'authorization endpoint'
            )
        self._discovery = document
        self._discovery_expires_at = now + _DISCOVERY_TTL_S
        return document

    # ------------------------------------------------------------------ sealing

    def _seal(self, payload: dict[str, Any]) -> str:
        import zlib

        packed = zlib.compress(json.dumps(payload).encode('utf-8'), 9)
        return self._fernet.encrypt(packed).decode('ascii')

    def _unseal(self, raw: str, *, max_age: int | None = None) -> dict[str, Any] | None:
        import zlib

        if not raw or len(raw) > _MAX_COOKIE_BYTES:
            return None
        from cryptography.fernet import InvalidToken

        try:
            opened = self._fernet.decrypt(raw.encode('ascii'), ttl=max_age)
        except (InvalidToken, ValueError, UnicodeEncodeError):
            # A cookie that will not open is an unauthenticated request, not an
            # error: the key may have rotated or the value may be forged.
            return None
        try:
            payload = json.loads(zlib.decompress(opened))
        except (zlib.error, json.JSONDecodeError, ValueError):
            return None
        return payload if isinstance(payload, dict) else None

    # ------------------------------------------------------------------ replies

    @staticmethod
    async def _respond(
        send: Any,
        status: int,
        *,
        body: bytes = b'',
        headers: list[tuple[bytes, bytes]] | None = None,
        content_type: bytes = b'application/json',
    ) -> None:
        raw = [
            (b'content-type', content_type),
            (b'content-length', str(len(body)).encode('ascii')),
            (b'cache-control', b'no-store'),
        ]
        raw.extend(headers or [])
        await send({'type': 'http.response.start', 'status': status, 'headers': raw})
        await send({'type': 'http.response.body', 'body': body})

    async def _redirect(
        self,
        send: Any,
        location: str,
        *,
        headers: list[tuple[bytes, bytes]] | None = None,
    ) -> None:
        raw = [(b'location', location.encode('latin-1'))]
        raw.extend(headers or [])
        await self._respond(
            send,
            302,
            body=b'',
            headers=raw,
            content_type=b'text/plain; charset=utf-8',
        )

    # -------------------------------------------------------------- token calls

    async def _token_request(self, form: dict[str, str]) -> dict[str, Any] | None:
        import httpx

        document = await self._endpoints()
        token_endpoint = str(document.get('token_endpoint') or '')
        if not token_endpoint:
            raise OIDCConfigurationError(
                'Agent WebUI received OpenID provider metadata without a token endpoint'
            )
        payload = {
            **form,
            'client_id': self.settings.client_id,
            'client_secret': self.settings.client_secret,
        }
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(
                    token_endpoint,
                    data=payload,
                    headers={'Accept': 'application/json'},
                )
        except Exception:
            # The provider is unreachable.  Callers turn this into a clean
            # "sign in again" rather than a 500 that leaks provider detail.
            logger.warning('OIDC token endpoint request failed')
            return None
        if response.status_code != 200:
            logger.warning(
                'OIDC token endpoint rejected the exchange: status=%s',
                response.status_code,
            )
            return None
        if len(response.content) > _MAX_TOKEN_RESPONSE_BYTES:
            logger.warning('OIDC token response exceeded its safe boundary')
            return None
        try:
            document = response.json()
        except ValueError:
            logger.warning('OIDC token response was not JSON')
            return None
        if not isinstance(document, dict) or not document.get('access_token'):
            return None
        return document

    async def _introspect_access_token(
        self,
        token: str,
        *,
        subject: str,
        tenant: str,
        expires_at: float,
    ) -> bool:
        """Revalidate a bound browser token through the provider backchannel."""

        document = await self._endpoints()
        endpoint = _trusted_backchannel_url(document.get('introspection_endpoint'))
        if endpoint is None:
            return False
        claims = await self._request_introspection(endpoint, token)
        return _introspection_is_live(
            claims,
            subject=subject,
            tenant=tenant,
            expires_at=expires_at,
        )

    async def _request_introspection(
        self, endpoint: str, token: str
    ) -> dict[str, Any] | None:
        import httpx

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    endpoint,
                    data={
                        'token': token,
                        'client_id': self.settings.client_id,
                        'client_secret': self.settings.client_secret,
                    },
                    headers={'Accept': 'application/json'},
                )
            if response.status_code != 200 or len(response.content) > 64 * 1024:
                return None
            claims = response.json()
        except Exception:
            return None
        return claims if isinstance(claims, dict) else None

    def _session_from_tokens(self, tokens: dict[str, Any]) -> dict[str, Any]:
        try:
            lifetime = int(tokens.get('expires_in') or 300)
        except (OverflowError, TypeError, ValueError):
            lifetime = 300
        lifetime = min(max(30, lifetime), 24 * 60 * 60)
        # The id_token is deliberately NOT stored: it is only ever an optional
        # logout hint, and every stored byte is amplified by encryption and
        # base64 before it has to fit in a browser cookie.
        return {
            'access_token': str(tokens.get('access_token') or ''),
            'refresh_token': str(tokens.get('refresh_token') or ''),
            'expires_at': time.time() + max(30, lifetime),
        }

    async def _verified_jwt_claims(
        self, token: str, *, audience: str
    ) -> dict[str, Any]:
        """Verify one provider JWT through the canonical Graph OS verifier."""

        from agent_utilities.core.config import config
        from agent_utilities.security.auth import _decode_jwt, _fetch_jwks

        jwks_uri = str(config.auth_jwt_jwks_uri or '').strip()
        if not jwks_uri or not audience:
            raise OIDCConfigurationError(
                'Attended browser control requires configured JWT verification'
            )
        jwks = await _fetch_jwks(jwks_uri)
        claims = _decode_jwt(
            token,
            jwks,
            issuer=self.settings.issuer,
            audience=audience,
        )
        if not isinstance(claims, dict):
            raise PermissionError('provider returned invalid claims')
        return claims

    @staticmethod
    async def _read_json(receive: Any) -> dict[str, Any] | None:
        body = bytearray()
        while True:
            message = await receive()
            if message.get('type') != 'http.request':
                return None
            body.extend(message.get('body') or b'')
            if len(body) > _MAX_ATTENDED_ARM_REQUEST_BYTES:
                return None
            if not message.get('more_body'):
                break
        try:
            candidate = parse_protocol_json(body)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            return None
        return candidate if isinstance(candidate, dict) else None

    def _current_session(self, scope: Any) -> dict[str, Any] | None:
        session = self._unseal(_read_session_cookie(_cookies(scope)))
        if not self._session_has_access_token(session):
            return None
        expires_at = session.get('expires_at')
        if (
            not isinstance(expires_at, int | float)
            or time.time() >= float(expires_at) - _EXPIRY_SKEW_S
        ):
            return None
        return session

    def _attended_receipt(
        self,
        scope: Any,
        *,
        token: str,
        require_origin: bool = True,
        require_live: bool = True,
        allow_revoke_only: bool = False,
    ) -> dict[str, Any] | None:
        receipt = self._unseal(
            _cookies(scope).get(ATTENDED_ARM_COOKIE, ''),
            max_age=_MAX_ATTENDED_ARM_TTL_S,
        )
        accepted_kinds = {'browser_control_attended_arm_v1'}
        if allow_revoke_only:
            accepted_kinds.add('browser_control_attended_revoke_v1')
        if not receipt or receipt.get('kind') not in accepted_kinds:
            return None
        supplied_origin = _single_header(scope, b'origin') if require_origin else None
        origin = trusted_request_origin(scope, supplied_origin)
        login_ref = _browser_login_session_ref(self.settings, token)
        timing = _float_claims(
            receipt, 'issued_at', 'expires_at', 'access_token_expires_at'
        )
        if timing is None:
            return None
        valid = bool(
            _attended_receipt_identity_valid(
                receipt, origin=origin, login_ref=login_ref
            )
            and _attended_receipt_scope_valid(receipt)
            and _attended_receipt_references_valid(receipt)
            and _authority_window_valid(
                cast(tuple[float, float, float], timing),
                max_lifetime=_MAX_ATTENDED_ARM_TTL_S,
                require_live=require_live,
            )
        )
        if not valid:
            return None
        return receipt

    def _recent_auth_grant(
        self, scope: Any, *, token: str, require_origin: bool = True
    ) -> dict[str, Any] | None:
        grant = self._unseal(
            _cookies(scope).get(RECENT_AUTH_COOKIE, ''),
            max_age=_RECENT_AUTH_TTL_S,
        )
        if not grant or grant.get('kind') != 'browser_control_recent_auth_v1':
            return None
        supplied_origin = _single_header(scope, b'origin') if require_origin else None
        origin = trusted_request_origin(scope, supplied_origin)
        timing = _float_claims(
            grant, 'issued_at', 'expires_at', 'access_token_expires_at'
        )
        if timing is None:
            return None
        if not _recent_grant_valid(
            grant,
            origin=origin,
            login_ref=_browser_login_session_ref(self.settings, token),
            timing=cast(tuple[float, float, float], timing),
        ):
            return None
        return grant

    # -------------------------------------------------------------- owned routes

    async def _handle_login(self, scope: Any, send: Any) -> None:
        from urllib.parse import parse_qs

        requested = parse_qs(
            (scope.get('query_string') or b'').decode('latin-1'),
            keep_blank_values=False,
        ).get('next') or ['']
        target = _safe_next(requested[0])
        document = await self._endpoints()
        verifier = secrets.token_urlsafe(64)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest())
            .decode('ascii')
            .rstrip('=')
        )
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        flow = self._seal(
            {'state': state, 'verifier': verifier, 'nonce': nonce, 'next': target}
        )
        authorize = str(document['authorization_endpoint'])
        location = f'{authorize}?' + urlencode(
            {
                'client_id': self.settings.client_id,
                'response_type': 'code',
                'redirect_uri': _request_scheme_redirect_uri(
                    self.settings.redirect_uri, scope
                ),
                'scope': self.settings.scope,
                'state': state,
                'nonce': nonce,
                'code_challenge': challenge,
                'code_challenge_method': 'S256',
            },
            quote_via=quote,
        )
        await self._redirect(
            send,
            location,
            headers=[
                _set_cookie_header(
                    FLOW_COOKIE,
                    flow,
                    secure=_is_secure(scope),
                    max_age=_FLOW_TTL_S,
                )
            ],
        )

    async def _handle_attended_arm_start(
        self, scope: Any, receive: Any, send: Any
    ) -> None:
        """Start a fresh, interactive IdP step-up for one exact tool snapshot."""

        if not self.settings.attended_acr:
            raise OIDCConfigurationError(
                'WEBUI_OIDC_ATTENDED_ACR_VALUES is required for browser control'
            )
        origin_header = _single_header(scope, b'origin')
        origin = trusted_request_origin(scope, origin_header) if origin_header else None
        session = self._current_session(scope)
        body = await self._read_json(receive)
        if origin is None or session is None or body is None:
            await self._respond(send, 403, body=b'{"detail":"Attended arm denied"}')
            return
        allowed_fields = {'route_id', 'next'}
        route_id = _bounded_identifier(body.get('route_id'))
        if set(body) - allowed_fields or route_id is None:
            await self._respond(send, 400, body=b'{"detail":"Invalid arm request"}')
            return
        token = str(session['access_token'])
        identity = await self._stepup_identity(token)
        if identity is None:
            await self._respond(send, 401, body=b'{"detail":"Fresh sign-in required"}')
            return
        subject, tenant = identity
        document = await self._endpoints()
        flow, authorization_url, now = self._new_attended_flow(
            scope,
            body,
            origin=origin,
            route_id=route_id,
            subject=subject,
            tenant=tenant,
            authorization_endpoint=str(document['authorization_endpoint']),
        )
        response = json.dumps(
            {'authorization_url': authorization_url, 'expires_at': now + _FLOW_TTL_S},
            sort_keys=True,
        ).encode('utf-8')
        await self._respond(
            send,
            200,
            body=response,
            headers=[
                _set_cookie_header(
                    FLOW_COOKIE,
                    flow,
                    secure=_is_secure(scope),
                    max_age=_FLOW_TTL_S,
                )
            ],
        )

    async def _stepup_identity(self, token: str) -> tuple[str, str] | None:
        try:
            from agent_utilities.core.config import config

            claims = await self._verified_jwt_claims(
                token,
                audience=str(config.auth_jwt_audience or ''),
            )
            subject = str(claims.get('sub') or '').strip()
            tenant = str(claims.get('tenant_id') or '').strip()
            token_expires_at = float(str(claims.get('exp')))
        except Exception:
            return None
        if not subject or not tenant:
            return None
        if (
            not math.isfinite(token_expires_at)
            or token_expires_at <= time.time() + _EXPIRY_SKEW_S
        ):
            return None
        return subject, tenant

    def _new_attended_flow(
        self,
        scope: Any,
        body: dict[str, Any],
        *,
        origin: str,
        route_id: str,
        subject: str,
        tenant: str,
        authorization_endpoint: str,
    ) -> tuple[str, str, float]:
        verifier = secrets.token_urlsafe(64)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest())
            .decode('ascii')
            .rstrip('=')
        )
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        now = time.time()
        flow = self._seal(
            {
                'kind': 'browser_control_attended_arm_v1',
                'state': state,
                'verifier': verifier,
                'nonce': nonce,
                'next': _safe_next(str(body.get('next') or '/')),
                'started_at': now,
                'origin': origin,
                'subject': subject,
                'tenant': tenant,
                'route_id': route_id,
            }
        )
        authorization_url = f'{authorization_endpoint}?' + urlencode(
            {
                'client_id': self.settings.client_id,
                'response_type': 'code',
                'redirect_uri': _request_scheme_redirect_uri(
                    self.settings.redirect_uri, scope
                ),
                'scope': self.settings.scope,
                'state': state,
                'nonce': nonce,
                'code_challenge': challenge,
                'code_challenge_method': 'S256',
                'prompt': 'login',
                'max_age': '0',
                'acr_values': ' '.join(self.settings.attended_acr),
            },
            quote_via=quote,
        )
        return flow, authorization_url, now

    async def _handle_attended_arm_status(self, scope: Any, send: Any) -> None:
        session = self._current_session(scope)
        origin = trusted_request_origin(scope)
        receipt = (
            self._attended_receipt(
                scope, token=str(session['access_token']), require_origin=False
            )
            if session is not None and origin is not None
            else None
        )
        document: dict[str, Any] = {'status': 'none'}
        if receipt is not None:
            document = {
                'status': 'armed',
                **{
                    name: receipt[name]
                    for name in (
                        'expires_at',
                        'route_id',
                        'registration_generation',
                        'catalog_digest',
                        'tool_scope_digest',
                    )
                },
            }
        elif session is not None and origin is not None:
            grant = self._recent_auth_grant(
                scope,
                token=str(session['access_token']),
                require_origin=False,
            )
            if grant is not None:
                document = {
                    'status': 'recent-auth',
                    'expires_at': grant['expires_at'],
                    'route_id': grant['route_id'],
                }
        await self._respond(
            send, 200, body=json.dumps(document, sort_keys=True).encode('utf-8')
        )

    @staticmethod
    def _tool_scope(body: dict[str, Any]) -> str | None:
        tools = body.get('tools')
        if not isinstance(tools, list) or not 1 <= len(tools) <= 64:
            return None
        tool_ids: list[str] = []
        schema_digests: dict[str, str] = {}
        for tool in tools:
            if not isinstance(tool, dict) or set(tool) != {'tool_id', 'schema_digest'}:
                return None
            tool_id = _bounded_identifier(tool.get('tool_id'))
            schema_digest = _bounded_digest(tool.get('schema_digest'))
            if tool_id is None or schema_digest is None or tool_id in schema_digests:
                return None
            tool_ids.append(tool_id)
            schema_digests[tool_id] = schema_digest
        canonical = canonical_protocol_json(
            {'tool_ids': tool_ids, 'schema_digests': schema_digests}
        ).encode('utf-8')
        return f'sha256:{hashlib.sha256(canonical).hexdigest()}'

    @staticmethod
    def _finalize_scope(
        body: dict[str, Any], grant: dict[str, Any]
    ) -> tuple[str, int, str, str] | None:
        if set(body) != {
            'route_id',
            'registration_generation',
            'catalog_digest',
            'tools',
        }:
            return None
        route_id = _bounded_identifier(body.get('route_id'))
        catalog_digest = _bounded_digest(body.get('catalog_digest'))
        generation = body.get('registration_generation')
        tool_scope_digest = OIDCBrowserSessionMiddleware._tool_scope(body)
        valid_generation = (
            isinstance(generation, int)
            and not isinstance(generation, bool)
            and 1 <= generation <= 2**53 - 1
        )
        if (
            route_id is None
            or catalog_digest is None
            or tool_scope_digest is None
            or not valid_generation
            or route_id != grant.get('route_id')
        ):
            return None
        return route_id, cast(int, generation), catalog_digest, tool_scope_digest

    async def _finalize_actor(
        self, token: str, grant: dict[str, Any]
    ) -> tuple[Any, str, str]:
        from agent_utilities.security.request_identity import actor_from_bearer_token

        actor = await actor_from_bearer_token(token)
        actor_id = str(getattr(actor, 'actor_id', '') or '').strip()
        tenant = str(getattr(actor, 'tenant_id', '') or '').strip()
        valid = bool(
            getattr(actor, 'authenticated', False)
            and str(getattr(actor, 'actor_type', '')) == 'human'
            and actor_id == grant.get('subject')
            and tenant == grant.get('tenant')
        )
        if not valid:
            raise PermissionError('recent authentication identity drifted')
        return actor, actor_id, tenant

    def _finalize_contract(
        self,
        token: str,
        grant: dict[str, Any],
        finalized_scope: tuple[str, int, str, str],
        actor: Any,
        actor_id: str,
        tenant: str,
    ) -> tuple[Any, Any]:
        from .browser_control import BrowserControlBinding, RecentAuthGrant

        route_id, generation, catalog_digest, tool_scope_digest = finalized_scope
        mint_graph_session = self.mint_graph_session
        if not callable(mint_graph_session):
            raise PermissionError('Graph session authority is unavailable')
        graph_session = mint_graph_session(actor)
        now = time.time()
        access_expires_at = float(grant['access_token_expires_at'])
        document_ref = f'document_{secrets.token_hex(32)}'
        login_ref = str(grant['login_session_ref'])
        origin = str(grant['origin'])
        browser_session_ref = _opaque_ref(
            self.settings, 'browser', login_ref, origin, document_ref
        )

        async def revalidate_browser_session() -> bool:
            return await self._introspect_access_token(
                token,
                subject=actor_id,
                tenant=tenant,
                expires_at=access_expires_at,
            )

        binding = BrowserControlBinding(
            session=graph_session,
            login_session_ref=login_ref,
            browser_session_ref=browser_session_ref,
            principal_ref=_opaque_ref(self.settings, 'principal', actor_id, tenant),
            origin=origin,
            document_ref=document_ref,
            attended_arm_ref=str(grant['grant_ref']),
            attended_arm_issued_at=now,
            attended_arm_expires_at=min(now + _ATTENDED_ARM_TTL_S, access_expires_at),
            access_token_expires_at=access_expires_at,
            attended_auth_time=float(grant['auth_time']),
            attended_acr=str(grant['acr']),
            attended_issuer=str(grant['issuer']),
            session_revalidator=revalidate_browser_session,
            route_id=route_id,
            registration_generation=generation,
            catalog_digest=catalog_digest,
            tool_scope_digest=tool_scope_digest,
            attended=True,
        )
        recent = RecentAuthGrant(
            grant_ref=str(grant['grant_ref']),
            session=graph_session,
            login_session_ref=login_ref,
            browser_session_ref=browser_session_ref,
            principal_ref=binding.principal_ref,
            origin=origin,
            route_id=route_id,
            access_token_expires_at=access_expires_at,
            grant_issued_at=float(grant['issued_at']),
            grant_expires_at=float(grant['expires_at']),
            attended_auth_time=float(grant['auth_time']),
            attended_acr=str(grant['acr']),
            attended_issuer=str(grant['issuer']),
        )
        return binding, recent

    def _receipt_binding(
        self,
        token: str,
        receipt: dict[str, Any],
        actor: Any,
        actor_id: str,
        tenant: str,
    ) -> Any:
        from .browser_control import BrowserControlBinding

        mint_graph_session = self.mint_graph_session
        if not callable(mint_graph_session):
            raise PermissionError('Graph session authority is unavailable')
        login_ref = str(receipt['login_session_ref'])
        origin = str(receipt['origin'])
        document_ref = str(receipt['document_ref'])
        access_expires_at = float(receipt['access_token_expires_at'])

        async def revalidate_browser_session() -> bool:
            return await self._introspect_access_token(
                token,
                subject=actor_id,
                tenant=tenant,
                expires_at=access_expires_at,
            )

        return BrowserControlBinding(
            session=mint_graph_session(actor),
            login_session_ref=login_ref,
            browser_session_ref=_opaque_ref(
                self.settings, 'browser', login_ref, origin, document_ref
            ),
            principal_ref=_opaque_ref(self.settings, 'principal', actor_id, tenant),
            origin=origin,
            document_ref=document_ref,
            attended_arm_ref=str(receipt['attended_arm_ref']),
            attended_arm_issued_at=float(receipt['issued_at']),
            attended_arm_expires_at=float(receipt['expires_at']),
            access_token_expires_at=access_expires_at,
            attended_auth_time=float(receipt['auth_time']),
            attended_acr=str(receipt['acr']),
            attended_issuer=str(receipt['issuer']),
            session_revalidator=revalidate_browser_session,
            route_id=str(receipt['route_id']),
            registration_generation=int(receipt['registration_generation']),
            catalog_digest=str(receipt['catalog_digest']),
            tool_scope_digest=str(receipt['tool_scope_digest']),
            attended=True,
        )

    @staticmethod
    def _arm_receipt_matches(issued: Any, binding: Any) -> bool:
        return bool(
            getattr(issued, 'status', None) == 'active'
            and getattr(issued, 'attended_arm_ref', None) == binding.attended_arm_ref
            and getattr(issued, 'attended_arm_expires_at', None)
            == binding.attended_arm_expires_at
            and getattr(issued, 'catalog_digest', None) == binding.catalog_digest
            and getattr(issued, 'tool_scope_digest', None) == binding.tool_scope_digest
        )

    @staticmethod
    def _revocation_matches(issued: Any, binding: Any) -> bool:
        return bool(
            getattr(issued, 'status', None) in {'revoked', 'expired'}
            and getattr(issued, 'attended_arm_ref', None) == binding.attended_arm_ref
            and getattr(issued, 'attended_arm_expires_at', None)
            == binding.attended_arm_expires_at
            and getattr(issued, 'catalog_digest', None) == binding.catalog_digest
            and getattr(issued, 'tool_scope_digest', None) == binding.tool_scope_digest
        )

    async def _revoke_binding(self, binding: Any) -> bool:
        try:
            issued = await cast(Any, self.browser_control).revoke_attended_arm(binding)
        except Exception:
            return False
        return self._revocation_matches(issued, binding)

    async def _cleanup_binding(self, binding: Any | None) -> None:
        if binding is not None:
            await self._revoke_binding(binding)

    def _sealed_arm_receipt(self, binding: Any, *, actor_id: str, tenant: str) -> str:
        return self._seal(
            {
                'kind': 'browser_control_attended_arm_v1',
                'attended_arm_ref': binding.attended_arm_ref,
                'login_session_ref': binding.login_session_ref,
                'subject': actor_id,
                'tenant': tenant,
                'origin': binding.origin,
                'document_ref': binding.document_ref,
                'route_id': binding.route_id,
                'registration_generation': binding.registration_generation,
                'catalog_digest': binding.catalog_digest,
                'tool_scope_digest': binding.tool_scope_digest,
                'issued_at': binding.attended_arm_issued_at,
                'expires_at': binding.attended_arm_expires_at,
                'access_token_expires_at': binding.access_token_expires_at,
                'auth_time': binding.attended_auth_time,
                'acr': binding.attended_acr,
                'issuer': binding.attended_issuer,
            }
        )

    async def _finalize_denied(self, scope: Any, send: Any) -> None:
        await self._respond(
            send,
            403,
            body=b'{"detail":"Finalize denied"}',
            headers=[
                _set_cookie_header(
                    RECENT_AUTH_COOKIE,
                    '',
                    secure=_is_secure(scope),
                    max_age=0,
                )
            ],
        )

    async def _publish_attended_arm(
        self,
        scope: Any,
        send: Any,
        binding: Any,
        *,
        actor_id: str,
        tenant: str,
    ) -> None:
        response = json.dumps(
            {
                'status': 'armed',
                'expires_at': binding.attended_arm_expires_at,
                'route_id': binding.route_id,
                'registration_generation': binding.registration_generation,
                'catalog_digest': binding.catalog_digest,
                'tool_scope_digest': binding.tool_scope_digest,
            },
            sort_keys=True,
        ).encode('utf-8')
        await self._respond(
            send,
            200,
            body=response,
            headers=[
                _set_cookie_header(
                    RECENT_AUTH_COOKIE,
                    '',
                    secure=_is_secure(scope),
                    max_age=0,
                ),
                _set_cookie_header(
                    ATTENDED_ARM_COOKIE,
                    self._sealed_arm_receipt(binding, actor_id=actor_id, tenant=tenant),
                    secure=_is_secure(scope),
                    max_age=max(1, int(binding.attended_arm_expires_at - time.time())),
                ),
            ],
        )

    async def _handle_attended_arm_finalize(
        self, scope: Any, receive: Any, send: Any
    ) -> None:
        """Consume recent IdP evidence into one exact post-reload arm receipt."""

        from .browser_control import browser_control_port_enabled

        if not browser_control_port_enabled(self.browser_control) or not callable(
            self.mint_graph_session
        ):
            await self._respond(
                send, 503, body=b'{"detail":"Browser control is unavailable"}'
            )
            return
        request = await self._finalize_request(scope, receive)
        if request is None:
            await self._finalize_denied(scope, send)
            return
        session_cookie, body = request
        token = str(session_cookie['access_token'])
        grant = self._recent_auth_grant(scope, token=token)
        finalized_scope = self._finalize_scope(body, grant or {})
        if grant is None or finalized_scope is None:
            await self._finalize_denied(scope, send)
            return
        try:
            actor, actor_id, tenant = await self._finalize_actor(token, grant)
            binding, recent = self._finalize_contract(
                token,
                grant,
                finalized_scope,
                actor,
                actor_id,
                tenant,
            )
            issued = await cast(Any, self.browser_control).finalize_attended_arm(
                recent, binding
            )
        except Exception:
            await self._finalize_denied(scope, send)
            return
        if not self._arm_receipt_matches(issued, binding):
            await self._cleanup_binding(binding)
            await self._finalize_denied(scope, send)
            return
        try:
            await self._publish_attended_arm(
                scope, send, binding, actor_id=actor_id, tenant=tenant
            )
        except Exception:
            await self._revoke_binding(binding)
            raise

    async def _finalize_request(
        self, scope: Any, receive: Any
    ) -> tuple[dict[str, Any], dict[str, Any]] | None:
        if _single_header(scope, b'origin') is None:
            return None
        session_cookie = self._current_session(scope)
        body = await self._read_json(receive)
        if session_cookie is None or body is None:
            return None
        return session_cookie, body

    async def _handle_attended_arm(self, scope: Any, receive: Any, send: Any) -> None:
        if self._has_own_bearer_credential(scope):
            await self._respond(
                send, 403, body=b'{"detail":"Browser session required"}'
            )
            return
        method = str(scope.get('method') or '').upper()
        if scope.get('path') == ATTENDED_ARM_FINALIZE_PATH:
            await self._handle_finalize_method(scope, receive, send, method)
            return
        if method == 'POST':
            await self._handle_attended_arm_start(scope, receive, send)
            return
        if method == 'GET':
            await self._handle_attended_arm_status(scope, send)
            return
        if method == 'DELETE':
            await self._revoke_attended_arm(scope, send)
            return
        await self._respond(
            send,
            405,
            body=b'{"detail":"Method not allowed"}',
            headers=[(b'allow', b'GET, POST, DELETE')],
        )

    async def _handle_finalize_method(
        self, scope: Any, receive: Any, send: Any, method: str
    ) -> None:
        if method == 'POST':
            await self._handle_attended_arm_finalize(scope, receive, send)
            return
        await self._respond(send, 405, headers=[(b'allow', b'POST')])

    async def _revoke_attended_arm(self, scope: Any, send: Any) -> None:
        origin_header = _single_header(scope, b'origin')
        if (
            origin_header is None
            or trusted_request_origin(scope, origin_header) is None
        ):
            await self._respond(send, 403, body=b'{"detail":"Attended arm denied"}')
            return
        secure = _is_secure(scope)
        clear_arm = _set_cookie_header(
            ATTENDED_ARM_COOKIE, '', secure=secure, max_age=0
        )
        clear_recent = _set_cookie_header(
            RECENT_AUTH_COOKIE, '', secure=secure, max_age=0
        )
        if not _cookies(scope).get(ATTENDED_ARM_COOKIE):
            await self._respond(send, 204, headers=[clear_arm, clear_recent])
            return
        session = self._current_session(scope)
        if session is None:
            await self._respond(
                send,
                403,
                body=b'{"detail":"Attended arm denied"}',
                headers=[clear_arm, clear_recent],
            )
            return
        token = str(session['access_token'])
        receipt = self._attended_receipt(
            scope,
            token=token,
            require_live=False,
            allow_revoke_only=True,
        )
        revoked = await self._revoke_receipt(token, receipt)
        await self._respond(
            send,
            204 if revoked else 503,
            body=b'' if revoked else b'{"detail":"Attended arm revoke failed"}',
            headers=[clear_arm, clear_recent] if revoked else [clear_recent],
        )

    async def _revoke_receipt(self, token: str, receipt: dict[str, Any] | None) -> bool:
        from .browser_control import browser_control_port_enabled

        if receipt is None or not browser_control_port_enabled(self.browser_control):
            return False
        try:
            actor, actor_id, tenant = await self._finalize_actor(token, receipt)
            binding = self._receipt_binding(token, receipt, actor, actor_id, tenant)
        except Exception:
            return False
        return await self._revoke_binding(binding)

    def _verified_callback_code_and_flow(
        self, scope: Any, params: dict[str, list[str]]
    ) -> tuple[str, dict[str, Any]] | None:
        """Validate the callback's ``code``/``state`` against the sealed flow
        cookie's CSRF state. Returns ``(code, flow)`` on success, ``None`` if
        any of the shape/CSRF checks fail."""
        codes = params.get('code') or []
        states = params.get('state') or []
        flow = self._unseal(_cookies(scope).get(FLOW_COOKIE, ''), max_age=_FLOW_TTL_S)
        if (
            len(codes) != 1
            or len(states) != 1
            or flow is None
            or not secrets.compare_digest(str(flow.get('state') or ''), states[0])
        ):
            return None
        return codes[0], flow

    async def _exchange_callback_code(
        self, scope: Any, code: str, flow: dict[str, Any]
    ) -> dict[str, Any] | None:
        return await self._token_request(
            {
                'grant_type': 'authorization_code',
                'code': code,
                # Must byte-match the redirect_uri sent in _handle_login's
                # authorize request (OAuth2 requirement) — deriving it the
                # same way from *this* request's own scheme is correct
                # because Keycloak redirects back to the exact URI it was
                # given, preserving the scheme unchanged.
                'redirect_uri': _request_scheme_redirect_uri(
                    self.settings.redirect_uri, scope
                ),
                'code_verifier': str(flow.get('verifier') or ''),
            }
        )

    async def _reject_callback(self, send: Any, clear_flow: Any, detail: bytes) -> None:
        await self._respond(send, 401, body=detail, headers=[clear_flow])

    async def _verified_stepup_claims(
        self,
        flow: dict[str, Any],
        *,
        access_token: str,
        id_token: str,
    ) -> _VerifiedStepupClaims | None:
        try:
            from agent_utilities.core.config import config

            access_claims = await self._verified_jwt_claims(
                access_token, audience=str(config.auth_jwt_audience or '')
            )
            id_claims = await self._verified_jwt_claims(
                id_token, audience=self.settings.client_id
            )
            return _VerifiedStepupClaims(
                access=access_claims,
                identity=id_claims,
                now=time.time(),
                started_at=float(flow['started_at']),
                auth_time=float(id_claims['auth_time']),
                access_expires_at=float(access_claims['exp']),
            )
        except Exception:
            return None

    async def _verified_stepup_evidence(
        self,
        scope: Any,
        flow: dict[str, Any],
        tokens: dict[str, Any],
    ) -> _StepupEvidence | None:
        verified_tokens = self._stepup_tokens(tokens)
        if verified_tokens is None:
            return None
        access_token, id_token = verified_tokens
        claims = await self._verified_stepup_claims(
            flow, access_token=access_token, id_token=id_token
        )
        if claims is None:
            return None
        subject = str(claims.access.get('sub') or '').strip()
        tenant = str(claims.access.get('tenant_id') or '').strip()
        acr = str(claims.identity.get('acr') or '').strip()
        origin = trusted_request_origin(scope)
        identity_matches = _stepup_identity_matches(
            claims.identity,
            flow,
            subject=subject,
            tenant=tenant,
            acr=acr,
            accepted_acr=self.settings.attended_acr,
        )
        time_matches = _stepup_times_match(
            started_at=claims.started_at,
            auth_time=claims.auth_time,
            access_expires_at=claims.access_expires_at,
            now=claims.now,
        )
        if not all((identity_matches, time_matches, origin == flow.get('origin'))):
            return None
        return _StepupEvidence(
            access_token=access_token,
            subject=subject,
            tenant=tenant,
            origin=str(origin),
            acr=acr,
            now=claims.now,
            auth_time=claims.auth_time,
            access_expires_at=claims.access_expires_at,
        )

    def _stepup_tokens(self, tokens: dict[str, Any]) -> tuple[str, str] | None:
        access_token = str(tokens.get('access_token') or '')
        id_token = str(tokens.get('id_token') or '')
        if not all((access_token, id_token, self.settings.attended_acr)):
            return None
        return access_token, id_token

    def _recent_grant(
        self,
        flow: dict[str, Any],
        evidence: _StepupEvidence,
        *,
        expires_at: float,
    ) -> str:
        return self._seal(
            {
                'kind': 'browser_control_recent_auth_v1',
                'grant_ref': f'attended_{secrets.token_hex(32)}',
                'login_session_ref': _browser_login_session_ref(
                    self.settings, evidence.access_token
                ),
                'subject': evidence.subject,
                'tenant': evidence.tenant,
                'origin': evidence.origin,
                'route_id': str(flow['route_id']),
                'issued_at': evidence.now,
                'expires_at': expires_at,
                'access_token_expires_at': evidence.access_expires_at,
                'auth_time': evidence.auth_time,
                'acr': evidence.acr,
                'issuer': self.settings.issuer,
            }
        )

    async def _complete_attended_callback(
        self,
        scope: Any,
        send: Any,
        *,
        flow: dict[str, Any],
        tokens: dict[str, Any],
        clear_flow: tuple[bytes, bytes],
    ) -> None:
        """Verify step-up evidence and mint a short-lived recent-auth grant."""

        evidence = await self._verified_stepup_evidence(scope, flow, tokens)
        if evidence is None:
            await self._reject_callback(
                send, clear_flow, b'{"detail":"Attended sign-in could not be verified"}'
            )
            return
        session_data = self._session_from_tokens(tokens)
        session_expires_at = min(
            float(session_data['expires_at']), evidence.access_expires_at
        )
        session_data['expires_at'] = session_expires_at
        expires_at = min(evidence.now + _RECENT_AUTH_TTL_S, session_expires_at)
        if expires_at <= evidence.now:
            await self._reject_callback(
                send, clear_flow, b'{"detail":"Attended sign-in could not be verified"}'
            )
            return
        secure = _is_secure(scope)
        grant = self._recent_grant(flow, evidence, expires_at=expires_at)
        await self._redirect(
            send,
            _safe_next(str(flow.get('next') or '/')),
            headers=[
                clear_flow,
                *_session_cookie_headers(self._seal(session_data), secure=secure),
                _set_cookie_header(
                    RECENT_AUTH_COOKIE,
                    grant,
                    secure=secure,
                    max_age=max(1, int(expires_at - evidence.now)),
                ),
                _set_cookie_header(
                    ATTENDED_ARM_COOKIE,
                    '',
                    secure=secure,
                    max_age=0,
                ),
            ],
        )

    async def _handle_callback(self, scope: Any, send: Any) -> None:
        from urllib.parse import parse_qs

        params = parse_qs(
            (scope.get('query_string') or b'').decode('latin-1'),
            keep_blank_values=False,
        )
        clear_flow = _set_cookie_header(
            FLOW_COOKIE, '', secure=_is_secure(scope), max_age=0
        )

        if 'error' in params:
            logger.warning('OIDC provider returned an authorization error')
            await self._reject_callback(
                send, clear_flow, b'{"detail":"Sign-in was not completed"}'
            )
            return

        verified = self._verified_callback_code_and_flow(scope, params)
        if verified is None:
            await self._reject_callback(
                send, clear_flow, b'{"detail":"Sign-in could not be verified"}'
            )
            return
        code, flow = verified

        tokens = await self._exchange_callback_code(scope, code, flow)
        if tokens is None:
            await self._reject_callback(
                send, clear_flow, b'{"detail":"Sign-in could not be completed"}'
            )
            return

        if flow.get('kind') == 'browser_control_attended_arm_v1':
            await self._complete_attended_callback(
                scope,
                send,
                flow=flow,
                tokens=tokens,
                clear_flow=clear_flow,
            )
            return

        session = self._seal(self._session_from_tokens(tokens))
        await self._redirect(
            send,
            _safe_next(str(flow.get('next') or '/')),
            headers=[
                clear_flow,
                *_session_cookie_headers(session, secure=_is_secure(scope)),
            ],
        )

    async def _handle_logout(self, scope: Any, send: Any) -> None:
        secure = _is_secure(scope)
        cleared = [
            *_clear_session_cookie_headers(secure=secure),
            _set_cookie_header(FLOW_COOKIE, '', secure=secure, max_age=0),
            _set_cookie_header(ATTENDED_ARM_COOKIE, '', secure=secure, max_age=0),
            _set_cookie_header(RECENT_AUTH_COOKIE, '', secure=secure, max_age=0),
        ]
        document = await self._endpoints()
        end_session = str(document.get('end_session_endpoint') or '')
        if not end_session:
            await self._redirect(send, '/', headers=cleared)
            return
        # ``client_id`` + ``post_logout_redirect_uri`` is the id_token_hint-free
        # logout form; the id token is not retained (see _session_from_tokens).
        query: dict[str, str] = {
            'post_logout_redirect_uri': self.settings.post_logout_redirect,
            'client_id': self.settings.client_id,
        }
        await self._redirect(
            send, f'{end_session}?{urlencode(query, quote_via=quote)}', headers=cleared
        )

    async def _handle_session(self, scope: Any, send: Any) -> None:
        """Report who the browser is, without ever handing back the token."""

        session = self._unseal(_read_session_cookie(_cookies(scope)))
        if not session or not session.get('access_token'):
            await self._respond(send, 200, body=b'{"authenticated":false}')
            return
        claims = _unverified_claims(str(session['access_token']))
        realm_roles = [
            str(role) for role in (claims.get('realm_access') or {}).get('roles', [])
        ]
        from .rbac import resolve_webui_role

        body = json.dumps(
            {
                'authenticated': True,
                'subject': claims.get('sub'),
                'username': claims.get('preferred_username'),
                'email': claims.get('email'),
                # Additive (D-W-17): the profile surface renders these directly from
                # the IdP claims rather than inventing a second identity store. Both
                # are optional per the OIDC spec -- Keycloak omits `picture` unless an
                # avatar was set on the account, and `name` is absent for some client
                # scope configurations -- so the frontend must treat `null`/absent as
                # "no IdP value", not an error.
                'name': claims.get('name'),
                'picture': claims.get('picture'),
                'tenant': claims.get('tenant_id'),
                'roles': sorted(
                    role for role in realm_roles if role.startswith(('kg:', 'webui:'))
                ),
                # The WebUI page/feature role (R9: reader < user < maintainer <
                # admin), computed the SAME way `WebUIAuthorizationMiddleware`
                # computes it server-side (see `rbac.py`) — the frontend reads
                # this rather than re-deriving a role from claims itself, so the
                # two surfaces cannot drift into disagreeing.
                'webui_role': resolve_webui_role(realm_roles, authenticated=True),
                'expires_at': session.get('expires_at'),
            },
            sort_keys=True,
        ).encode('utf-8')
        await self._respond(send, 200, body=body)

    # ------------------------------------------------------------------- pass-on

    def _browser_socket_receipt(
        self,
        scope: Any,
        token: str,
        set_cookies: list[tuple[bytes, bytes]] | None,
    ) -> dict[str, Any] | None:
        if set_cookies is not None:
            return None
        if (
            scope.get('type') != 'websocket'
            or scope.get('path') != '/ws/browser-control'
        ):
            return None
        return self._attended_receipt(scope, token=token)

    def _receipt_state(self, receipt: dict[str, Any], token: str) -> dict[str, Any]:
        async def revalidate_browser_session() -> bool:
            return await self._introspect_access_token(
                token,
                subject=str(receipt['subject']),
                tenant=str(receipt['tenant']),
                expires_at=float(receipt['access_token_expires_at']),
            )

        return {
            'browser_attended_arm_ref': receipt['attended_arm_ref'],
            'browser_document_ref': receipt['document_ref'],
            'browser_attended_arm_issued_at': receipt['issued_at'],
            'browser_attended_arm_expires_at': receipt['expires_at'],
            'browser_access_token_expires_at': receipt['access_token_expires_at'],
            'browser_attended_route_id': receipt['route_id'],
            'browser_attended_registration_generation': receipt[
                'registration_generation'
            ],
            'browser_attended_catalog_digest': receipt['catalog_digest'],
            'browser_attended_tool_scope_digest': receipt['tool_scope_digest'],
            'browser_attended_subject': receipt['subject'],
            'browser_attended_tenant': receipt['tenant'],
            'browser_attended_auth_time': receipt['auth_time'],
            'browser_attended_acr': receipt['acr'],
            'browser_attended_issuer': receipt['issuer'],
            'browser_session_revalidator': revalidate_browser_session,
        }

    def _cookie_sender(
        self,
        scope: Any,
        send: Any,
        *,
        set_cookies: list[tuple[bytes, bytes]] | None,
        attended_receipt: dict[str, Any] | None,
    ) -> Any:
        async def cookie_send(message: Any) -> None:
            if message.get('type') == 'http.response.start':
                headers = list(message.get('headers') or [])
                headers.extend(set_cookies or [])
            elif message.get('type') == 'websocket.accept':
                headers = list(message.get('headers') or [])
                headers.extend(set_cookies or [])
                if attended_receipt is not None:
                    revoke_receipt = self._seal(
                        {
                            **attended_receipt,
                            'kind': 'browser_control_attended_revoke_v1',
                        }
                    )
                    headers.append(
                        _set_cookie_header(
                            ATTENDED_ARM_COOKIE,
                            revoke_receipt,
                            secure=_is_secure(scope),
                            max_age=max(
                                1,
                                int(
                                    float(attended_receipt['expires_at']) - time.time()
                                ),
                            ),
                        )
                    )
            else:
                await send(message)
                return
            await send({**message, 'headers': headers})

        return cookie_send

    async def _forward(
        self,
        scope: Any,
        receive: Any,
        send: Any,
        *,
        token: str,
        set_cookies: list[tuple[bytes, bytes]] | None,
    ) -> None:
        """Hand the request down with the user's own bearer credential attached."""

        headers = [
            (key, value)
            for key, value in (scope.get('headers') or [])
            if key.decode('latin-1').lower() != 'authorization'
        ]
        headers.append((b'authorization', f'Bearer {token}'.encode('latin-1')))
        state = dict(scope.get('state') or {})
        state['browser_login_session_ref'] = _browser_login_session_ref(
            self.settings, token
        )
        receipt = self._browser_socket_receipt(scope, token, set_cookies)
        if receipt is not None:
            state.update(self._receipt_state(receipt, token))
        forwarded = {**scope, 'headers': headers, 'state': state}
        if set_cookies is None and receipt is None:
            await self.app(forwarded, receive, send)
            return
        cookie_send = self._cookie_sender(
            scope,
            send,
            set_cookies=set_cookies,
            attended_receipt=receipt,
        )
        await self.app(forwarded, receive, cookie_send)

    @staticmethod
    def _is_browser_navigation(scope: Any) -> bool:
        if str(scope.get('method') or '').upper() not in {'GET', 'HEAD'}:
            return False
        if str(scope.get('path') or '').startswith('/api'):
            return False
        accept = ''
        mode = ''
        for key, value in scope.get('headers') or []:
            name = key.decode('latin-1').lower()
            if name == 'accept':
                accept = value.decode('latin-1').lower()
            elif name == 'sec-fetch-mode':
                mode = value.decode('latin-1').strip().lower()
        return mode == 'navigate' or 'text/html' in accept

    async def _dispatch_owned_route(
        self, scope: Any, receive: Any, send: Any, path: str
    ) -> None:
        """The login bootstrap is answered here and never forwarded, so the
        identity gate below is untouched and still sees zero exempt API
        paths."""
        try:
            if path == LOGIN_PATH:
                await self._handle_login(scope, send)
            elif path == CALLBACK_PATH:
                await self._handle_callback(scope, send)
            elif path == LOGOUT_PATH:
                await self._handle_logout(scope, send)
            elif path in {ATTENDED_ARM_PATH, ATTENDED_ARM_FINALIZE_PATH}:
                await self._handle_attended_arm(scope, receive, send)
            else:
                await self._handle_session(scope, send)
        except OIDCConfigurationError:
            logger.exception('Agent WebUI browser SSO is misconfigured')
            await self._respond(send, 503, body=b'{"detail":"Sign-in is unavailable"}')

    @staticmethod
    def _is_owned_http_path(scope_type: str, path: str) -> bool:
        return scope_type == 'http' and path in _OWNED_PATHS

    @staticmethod
    def _session_has_access_token(
        session: dict[str, Any] | None,
    ) -> TypeGuard[dict[str, Any]]:
        return bool(session and session.get('access_token'))

    def _is_navigable_http(self, scope_type: str, scope: Any) -> bool:
        return scope_type == 'http' and self._is_browser_navigation(scope)

    @staticmethod
    def _has_own_bearer_credential(scope: Any) -> bool:
        """A caller that brought its own credential is a service client; never
        substitute a browser session for it."""
        return any(
            key.decode('latin-1').lower() == 'authorization'
            for key, _value in scope.get('headers') or []
        )

    async def _renew_expired_session(
        self, scope: Any, session: dict[str, Any]
    ) -> tuple[dict[str, Any] | None, list[tuple[bytes, bytes]] | None]:
        """Attempt the refresh-token grant for an expired session that still
        carries one. Returns ``(None, None)`` if the refresh itself fails."""
        refreshed = await self._token_request(
            {
                'grant_type': 'refresh_token',
                'refresh_token': str(session['refresh_token']),
            }
        )
        if refreshed is None:
            return None, None
        new_session = self._session_from_tokens(refreshed)
        cookies = _session_cookie_headers(
            self._seal(new_session), secure=_is_secure(scope)
        )
        return new_session, cookies

    async def _resolve_session(
        self, scope: Any
    ) -> tuple[dict[str, Any] | None, list[tuple[bytes, bytes]] | None]:
        """Unseal the session cookie and, if it is expired, either silently
        renew it (refresh token present) or discard it (no refresh token /
        renewal failed). Returns ``(session_or_None, refreshed_cookies_or_None)``."""
        session = self._unseal(_read_session_cookie(_cookies(scope)))
        if session is None:
            return None, None
        expires_at = session.get('expires_at')
        expired = (
            not isinstance(expires_at, int | float)
            or time.time() >= float(expires_at) - _EXPIRY_SKEW_S
        )
        if not expired:
            return session, None
        if session.get('refresh_token'):
            return await self._renew_expired_session(scope, session)
        return None, None

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        scope_type = scope.get('type')
        if scope_type not in {'http', 'websocket'}:
            await self.app(scope, receive, send)
            return

        path = str(scope.get('path') or '')
        if self._is_owned_http_path(scope_type, path):
            await self._dispatch_owned_route(scope, receive, send, path)
            return

        if self._has_own_bearer_credential(scope):
            await self.app(scope, receive, send)
            return

        session, refreshed_cookies = await self._resolve_session(scope)

        if self._session_has_access_token(session):
            await self._forward(
                scope,
                receive,
                send,
                token=str(session['access_token']),
                set_cookies=refreshed_cookies,
            )
            return

        if self._is_navigable_http(scope_type, scope):
            # Send the human to the identity provider instead of handing them a
            # bare 401 they cannot act on.  API and XHR callers still fall
            # through to the unmodified gate and get their 401.
            await self._redirect(
                send,
                f'{LOGIN_PATH}?next={quote(path or "/", safe="/")}',
                headers=_clear_session_cookie_headers(secure=_is_secure(scope)),
            )
            return

        await self.app(scope, receive, send)


def _unverified_claims(token: str) -> dict[str, Any]:
    """Read a JWT payload for *display only*.

    This never authorizes anything — the identity gate performs the real JWKS
    verification.  It exists so ``/auth/session`` can tell the SPA who is
    signed in without a second round trip to the provider.
    """

    parts = token.split('.')
    if len(parts) != 3:
        return {}
    padded = parts[1] + '=' * (-len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(padded.encode('ascii')))
    except (ValueError, json.JSONDecodeError):
        return {}


__all__ = [
    'ATTENDED_ARM_COOKIE',
    'ATTENDED_ARM_FINALIZE_PATH',
    'ATTENDED_ARM_PATH',
    'CALLBACK_PATH',
    'FLOW_COOKIE',
    'LOGIN_PATH',
    'LOGOUT_PATH',
    'OIDCBrowserSessionMiddleware',
    'OIDCConfigurationError',
    'OIDCSettings',
    'RECENT_AUTH_COOKIE',
    'SESSION_COOKIE',
    'SESSION_PATH',
    'load_settings',
    'trusted_request_origin',
]
