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

* the three ``/auth/*`` endpoints it owns are answered by this middleware itself
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
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

logger = logging.getLogger(__name__)

# Paths this middleware answers itself.  They are the login bootstrap only: none
# of them read or write the graph, and none of them are forwarded downstream.
LOGIN_PATH = '/auth/login'
CALLBACK_PATH = '/auth/callback'
LOGOUT_PATH = '/auth/logout'
SESSION_PATH = '/auth/session'
_OWNED_PATHS = frozenset({LOGIN_PATH, CALLBACK_PATH, LOGOUT_PATH, SESSION_PATH})

SESSION_COOKIE = 'au_session'
FLOW_COOKIE = 'au_oidc_flow'

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

    @property
    def post_logout_redirect(self) -> str:
        parsed = urlsplit(self.redirect_uri)
        return f'{parsed.scheme}://{parsed.netloc}/'


def _env(name: str, default: str = '') -> str:
    return str(os.environ.get(name, default) or '').strip()


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

    provided = [
        bool(client_id),
        bool(client_secret),
        bool(issuer),
        bool(redirect_uri),
        bool(session_key),
    ]
    if not any(provided):
        return None
    if not all(provided):
        raise OIDCConfigurationError(
            'Agent WebUI browser SSO requires WEBUI_OIDC_CLIENT_ID, '
            'WEBUI_OIDC_CLIENT_SECRET, an issuer (WEBUI_OIDC_ISSUER or '
            'AUTH_JWT_ISSUER), WEBUI_OIDC_REDIRECT_URI and WEBUI_SESSION_KEY'
        )

    for label, url in (('issuer', issuer), ('redirect URI', redirect_uri)):
        parsed = urlsplit(url)
        if parsed.scheme not in {'http', 'https'} or not parsed.hostname:
            raise OIDCConfigurationError(
                f'Agent WebUI browser SSO {label} is not an absolute http(s) URL'
            )
    return OIDCSettings(
        client_id=client_id,
        client_secret=client_secret,
        issuer=issuer.rstrip('/'),
        redirect_uri=redirect_uri,
        scope=scope,
        session_key=session_key,
    )


def _fernet(settings: OIDCSettings) -> Any:
    from cryptography.fernet import Fernet

    try:
        return Fernet(settings.session_key.encode('ascii'))
    except (ValueError, TypeError) as exc:
        raise OIDCConfigurationError(
            'WEBUI_SESSION_KEY must be a url-safe base64-encoded 32-byte key'
        ) from exc


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
    """Return a same-origin relative continuation target, defaulting to ``/``.

    Anything that could leave the origin (scheme-relative ``//host``, absolute
    URLs, backslash tricks, control characters) collapses to ``/`` so the login
    endpoint can never be used as an open redirector.
    """

    candidate = (raw or '').strip()
    if (
        not candidate.startswith('/')
        or candidate.startswith('//')
        or candidate.startswith('/\\')
        or len(candidate) > 2048
        or any(character in candidate for character in '\r\n\\')
    ):
        return '/'
    return candidate


class OIDCBrowserSessionMiddleware:
    """Give browsers a verified user identity without relaxing the gate.

    Ordering matters: this must be installed so it runs **directly outside**
    ``WebUIActorIdentityMiddleware``.  Everything it forwards is still subject
    to the unmodified identity and authorization boundaries.
    """

    def __init__(self, app: Any, *, settings: OIDCSettings) -> None:
        self.app = app
        self.settings = settings
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

    def _session_from_tokens(self, tokens: dict[str, Any]) -> dict[str, Any]:
        try:
            lifetime = int(tokens.get('expires_in') or 300)
        except (TypeError, ValueError):
            lifetime = 300
        # The id_token is deliberately NOT stored: it is only ever an optional
        # logout hint, and every stored byte is amplified by encryption and
        # base64 before it has to fit in a browser cookie.
        return {
            'access_token': str(tokens.get('access_token') or ''),
            'refresh_token': str(tokens.get('refresh_token') or ''),
            'expires_at': time.time() + max(30, lifetime),
        }

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
            await self._respond(
                send,
                401,
                body=b'{"detail":"Sign-in was not completed"}',
                headers=[clear_flow],
            )
            return

        codes = params.get('code') or []
        states = params.get('state') or []
        flow = self._unseal(_cookies(scope).get(FLOW_COOKIE, ''), max_age=_FLOW_TTL_S)
        if (
            len(codes) != 1
            or len(states) != 1
            or flow is None
            or not secrets.compare_digest(str(flow.get('state') or ''), states[0])
        ):
            await self._respond(
                send,
                401,
                body=b'{"detail":"Sign-in could not be verified"}',
                headers=[clear_flow],
            )
            return

        tokens = await self._token_request(
            {
                'grant_type': 'authorization_code',
                'code': codes[0],
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
        if tokens is None:
            await self._respond(
                send,
                401,
                body=b'{"detail":"Sign-in could not be completed"}',
                headers=[clear_flow],
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
        forwarded = {**scope, 'headers': headers}
        if not set_cookies:
            await self.app(forwarded, receive, send)
            return

        async def cookie_send(message: Any) -> None:
            if message.get('type') == 'http.response.start':
                message = {
                    **message,
                    'headers': [*(message.get('headers') or []), *set_cookies],
                }
            await send(message)

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

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        scope_type = scope.get('type')
        if scope_type not in {'http', 'websocket'}:
            await self.app(scope, receive, send)
            return

        path = str(scope.get('path') or '')
        if scope_type == 'http' and path in _OWNED_PATHS:
            # The login bootstrap is answered here and never forwarded, so the
            # identity gate below is untouched and still sees zero exempt API
            # paths.
            try:
                if path == LOGIN_PATH:
                    await self._handle_login(scope, send)
                elif path == CALLBACK_PATH:
                    await self._handle_callback(scope, send)
                elif path == LOGOUT_PATH:
                    await self._handle_logout(scope, send)
                else:
                    await self._handle_session(scope, send)
            except OIDCConfigurationError:
                logger.exception('Agent WebUI browser SSO is misconfigured')
                await self._respond(
                    send, 503, body=b'{"detail":"Sign-in is unavailable"}'
                )
            return

        # A caller that brought its own credential is a service client; never
        # substitute a browser session for it.
        if any(
            key.decode('latin-1').lower() == 'authorization'
            for key, _value in scope.get('headers') or []
        ):
            await self.app(scope, receive, send)
            return

        session = self._unseal(_read_session_cookie(_cookies(scope)))
        refreshed_cookies: list[tuple[bytes, bytes]] | None = None
        if session is not None:
            expires_at = session.get('expires_at')
            expired = (
                not isinstance(expires_at, int | float)
                or time.time() >= float(expires_at) - _EXPIRY_SKEW_S
            )
            if expired and session.get('refresh_token'):
                refreshed = await self._token_request(
                    {
                        'grant_type': 'refresh_token',
                        'refresh_token': str(session['refresh_token']),
                    }
                )
                if refreshed is None:
                    session = None
                else:
                    session = self._session_from_tokens(refreshed)
                    refreshed_cookies = _session_cookie_headers(
                        self._seal(session), secure=_is_secure(scope)
                    )
            elif expired:
                session = None

        if session and session.get('access_token'):
            await self._forward(
                scope,
                receive,
                send,
                token=str(session['access_token']),
                set_cookies=refreshed_cookies,
            )
            return

        if scope_type == 'http' and self._is_browser_navigation(scope):
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
    'CALLBACK_PATH',
    'FLOW_COOKIE',
    'LOGIN_PATH',
    'LOGOUT_PATH',
    'OIDCBrowserSessionMiddleware',
    'OIDCConfigurationError',
    'OIDCSettings',
    'SESSION_COOKIE',
    'SESSION_PATH',
    'load_settings',
]
