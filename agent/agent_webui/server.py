#!/usr/bin/python
"""
Agent WebUI Server Core.

This module provides the factory function for creating the Agent Web
Dashboard application. It integrates Pydantic-AI's built-in web features
with enhanced workspace management, real-time observability via Logfire,
and a high-performance React-based frontend.
"""

import asyncio
import importlib
import json
import logging
import os
import re
import sys
from ipaddress import ip_address
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import logfire
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic_ai import Agent
from starlette import exceptions as _errors
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.routing import Mount
from starlette.routing import Route as StarletteRoute

from .api_extensions import (
    router as enhanced_router,
)
from .api_extensions import (
    set_workspace_helpers,
    sync_work_status,
)

logger = logging.getLogger(__name__)

_LOGFIRE_ENABLED = os.getenv('AGENT_WEBUI_LOGFIRE_ENABLED', '').strip().lower() in {
    '1',
    'true',
    'yes',
    'on',
}
logfire.configure(send_to_logfire='if-token-present' if _LOGFIRE_ENABLED else False)
if _LOGFIRE_ENABLED:
    logfire.instrument_pydantic_ai()

__version__ = '2.1.0'

print(f'Agent WebUI v{__version__}', file=sys.stderr)

_MULTIPART_OVERHEAD_ALLOWANCE = 1024 * 1024
_MAX_REQUEST_BODY_HARD_LIMIT = 50 * 1024 * 1024 + _MULTIPART_OVERHEAD_ALLOWANCE
_MAX_STRUCTURED_REQUEST_BYTES = 2 * 1024 * 1024
_REMOTE_DEFAULT_RATE = 20.0
_REMOTE_DEFAULT_BURST = 40.0
_MAX_WEBSOCKET_MESSAGE_BYTES = 1024 * 1024
_MAX_BEARER_TOKEN_BYTES = 16 * 1024
# W-19: how often `/ws/dashboard` pushes an `update` message after its initial
# `snapshot`. Matches the Aggregator's own short read cache (`agent_utilities.
# gateway.api`'s 10s-TTL comment) so a push never re-fetches data the cache
# would have answered stale anyway, while staying well under the frontend's
# 30s HTTP poll (`DashboardView.tsx` `refetchInterval: 30000`) so the socket
# is genuinely faster than falling back to polling.
_DASHBOARD_WS_PUSH_INTERVAL_SECONDS = 15.0
# `/api/enhanced/sessions` (D-WUI-27, D-WUI-33) is deliberately NOT here: nav-registry.ts
# declares `control-plane.sessions` at `minRole: 'user'`, so this middleware only decides
# whether the ROUTE is reachable (kg:read for GET, kg:write for mutation, like any other
# route). WHICH rows a caller may see (admin: every session; non-admin: only sessions they
# own) is enforced as row-level data scoping inside api_extensions.py's session handlers
# (`_current_webui_is_admin` + the `sessions.owner` column) — a route-level allow/deny here
# cannot express "your own rows only", so it belongs at the data layer, not this chokepoint.
_ADMIN_ROUTE_PREFIXES = (
    '/api/fleet',
    '/api/dashboard',
    '/api/enhanced/agents',
    '/api/enhanced/backend',
    '/api/enhanced/chats',
    '/api/enhanced/commands',
    '/api/enhanced/code',
    '/api/enhanced/config',
    '/api/enhanced/config-files',
    '/api/enhanced/container-manager',
    '/api/enhanced/cron',
    '/api/enhanced/download',
    '/api/enhanced/ecosystem',
    '/api/enhanced/files',
    '/api/enhanced/goals',
    '/api/enhanced/graph',
    '/api/enhanced/kb',
    '/api/enhanced/maintenance',
    '/api/enhanced/ontology/object-set/action',
    '/api/enhanced/pipeline',
    '/api/enhanced/prompts',
    '/api/enhanced/reload',
    '/api/enhanced/repository-manager',
    '/api/enhanced/resources',
    '/api/enhanced/sdd',
    '/api/enhanced/security',
    '/api/enhanced/systems-manager',
    '/api/enhanced/system',
    '/api/enhanced/tools/toggle',
    '/api/enhanced/tunnel-manager',
    '/api/enhanced/upload',
    '/api/enhanced/voice',
    '/api/enhanced/workflows',
    '/api/tools/toggle',
    '/ws/dashboard',
)
_ADMIN_MUTATION_ROUTE_PREFIXES = (
    # Invoking an arbitrary MCP tool through the governed delegation seam is at
    # least as powerful as any other admin mutation (the fleet exposes writes,
    # configuration and orchestration as tools), so every POST under
    # ``/api/enhanced/mcp`` requires ``kg:admin``. The GET inventory route
    # (``/mcp/servers/{name}/tools``) stays a ``kg:read``.
    # CONCEPT:AU-ECO.mcp.webui-governed-mcp-delegation
    '/api/enhanced/mcp',
    '/api/enhanced/skills',
    '/api/enhanced/tools',
)
_PUBLIC_LIVENESS_PATHS = frozenset(
    {'/health', '/healthz', '/api/health', '/api/healthz'}
)
_SECURITY_RESPONSE_HEADERS = (
    (b'referrer-policy', b'no-referrer'),
    (b'x-content-type-options', b'nosniff'),
    (b'x-frame-options', b'DENY'),
)
_DEFAULT_CONTENT_SECURITY_POLICY = '; '.join(
    (
        "default-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "script-src 'self'",
        "script-src-attr 'none'",
        "style-src 'self'",
        "style-src-elem 'self'",
        # React renders bounded visual values through style attributes. Keep the
        # exception scoped to attributes; inline <style> elements remain denied.
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "media-src 'self'",
        "worker-src 'self'",
        "frame-src 'none'",
        "manifest-src 'self'",
    )
)
_CSP_SOURCE_ENV = {
    'script-src': 'AGENT_WEBUI_CSP_SCRIPT_SOURCES',
    'style-src': 'AGENT_WEBUI_CSP_STYLE_SOURCES',
    # Keep the more-specific CSP3 directive aligned with its fallback. Without
    # this entry, a configured external stylesheet would still be denied by
    # the built-in ``style-src-elem 'self'`` directive.
    'style-src-elem': 'AGENT_WEBUI_CSP_STYLE_SOURCES',
    'img-src': 'AGENT_WEBUI_CSP_IMAGE_SOURCES',
    'font-src': 'AGENT_WEBUI_CSP_FONT_SOURCES',
    'connect-src': 'AGENT_WEBUI_CSP_CONNECT_SOURCES',
    'media-src': 'AGENT_WEBUI_CSP_MEDIA_SOURCES',
    'worker-src': 'AGENT_WEBUI_CSP_WORKER_SOURCES',
    'frame-src': 'AGENT_WEBUI_CSP_FRAME_SOURCES',
}
_CSP_HASH_SOURCE = re.compile(r"^'(?:sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}'$")
_CSP_UNSAFE_SOURCES = frozenset(
    {"'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'"}
)
_ACCESS_LOG_POLICY_ENV = 'AGENT_WEBUI_ACCESS_LOG_POLICY'


def _environment_flag(name: str) -> bool:
    return os.getenv(name, '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _validated_csp_source(
    source: str,
    *,
    directive: str,
    custom_rendering_acknowledged: bool,
) -> str:
    """Accept only exact origins, hashes, or acknowledged unsafe keywords."""

    if source in _CSP_UNSAFE_SOURCES:
        if (
            not custom_rendering_acknowledged
            or directive not in {'script-src', 'style-src', 'style-src-elem'}
            or (source != "'unsafe-inline'" and directive != 'script-src')
        ):
            raise RuntimeError(
                'Unsafe CSP sources require the custom-rendering acknowledgement'
            )
        return source
    if _CSP_HASH_SOURCE.fullmatch(source):
        if directive not in {'script-src', 'style-src', 'style-src-elem'}:
            raise RuntimeError('CSP hashes are only valid for script or style sources')
        return source
    if any(character in source for character in (';', '\r', '\n', '*')) or any(
        ord(character) < 0x21 or ord(character) > 0x7E for character in source
    ):
        raise RuntimeError('Agent WebUI CSP sources must be exact origins')
    parsed = urlsplit(source)
    try:
        _parsed_port = parsed.port
    except ValueError as exc:
        raise RuntimeError('Agent WebUI CSP sources must be exact origins') from exc
    schemes = {'http', 'https'}
    if directive == 'connect-src':
        schemes.update({'ws', 'wss'})
    if (
        parsed.scheme.lower() not in schemes
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in {'', '/'}
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError('Agent WebUI CSP sources must be exact origins')
    return f'{parsed.scheme.lower()}://{parsed.netloc.lower()}'


def _content_security_policy(*, custom_rendering: bool) -> tuple[str, dict[str, Any]]:
    """Build the immutable response policy and a non-secret doctor summary."""

    acknowledged = _environment_flag('AGENT_WEBUI_CSP_CUSTOM_RENDERING')
    if custom_rendering and not acknowledged:
        raise RuntimeError(
            'Custom Agent WebUI HTML requires AGENT_WEBUI_CSP_CUSTOM_RENDERING=1'
        )

    directives: dict[str, list[str]] = {}
    for raw_directive in _DEFAULT_CONTENT_SECURITY_POLICY.split(';'):
        parts = raw_directive.strip().split()
        directives[parts[0]] = parts[1:]

    configured_relaxations: list[dict[str, str]] = []
    for directive, environment_name in _CSP_SOURCE_ENV.items():
        raw_sources = os.getenv(environment_name, '').strip()
        if not raw_sources:
            continue
        for raw_source in re.split(r'[\s,]+', raw_sources):
            if not raw_source:
                continue
            source = _validated_csp_source(
                raw_source,
                directive=directive,
                custom_rendering_acknowledged=acknowledged,
            )
            if directives[directive] == ["'none'"]:
                directives[directive] = []
            if source not in directives[directive]:
                directives[directive].append(source)
                configured_relaxations.append(
                    {'directive': directive, 'source': source}
                )

    policy = '; '.join(
        f'{directive} {" ".join(sources)}' for directive, sources in directives.items()
    )
    return policy, {
        'mode': 'custom-explicit' if custom_rendering else 'built-in-strict',
        'custom_rendering_acknowledged': acknowledged,
        'configured_relaxations': configured_relaxations,
        'built_in_compatibility_relaxations': [
            {
                'directive': 'style-src-attr',
                'source': "'unsafe-inline'",
                'reason': 'React style attributes',
            },
            {
                'directive': 'img-src',
                'source': 'data: blob:',
                'reason': 'local previews',
            },
        ],
    }


def _resolve_access_log_policy(listener_host: str) -> str:
    """Require an auditable raw-query logging decision for served listeners."""

    policy = os.getenv(_ACCESS_LOG_POLICY_ENV, '').strip().lower()
    if not policy:
        if not _is_loopback_listener(listener_host):
            raise RuntimeError(
                'A non-loopback Agent WebUI listener requires '
                'AGENT_WEBUI_ACCESS_LOG_POLICY=disabled or redacted'
            )
        return 'loopback-only'
    if policy not in {'disabled', 'redacted'}:
        raise RuntimeError('AGENT_WEBUI_ACCESS_LOG_POLICY must be disabled or redacted')
    return policy


def _require_graph_session_minter() -> Any:
    """Fail startup unless request identity can mint a scoped graph session.

    The WebUI mints its own **unrouted** session
    (:func:`agent_webui.graph_identity.mint_frontend_graph_session`): identical
    verified authority, no engine placement route. See that module for why a
    thin frontend must not bind one — in short, the engine gates
    ``PlacementRoute`` behind cluster-administrator capability, so the shared
    minter would make every authenticated request depend on authority a
    frontend has no business holding.

    The shared boundary is still required to be importable and to expose its
    own minter: it owns the unauthenticated path, ``UNAUTHENTICATED_PATHS``,
    and the actor projection this specialization builds on, and the contract
    test pins the two minters' authority against each other.
    """

    try:
        module = importlib.import_module('agent_utilities.security.request_identity')
    except Exception as exc:  # noqa: BLE001 - converted to a startup contract
        raise RuntimeError(
            'Agent WebUI requires agent_utilities request identity support'
        ) from exc
    if not callable(getattr(module, 'mint_graph_session', None)):
        raise RuntimeError(
            'Agent WebUI requires callable request_identity.mint_graph_session'
        )
    from .graph_identity import mint_frontend_graph_session

    return mint_frontend_graph_session


def _startup_security_contract(
    listener_host: str,
    *,
    custom_rendering: bool,
) -> tuple[str, Any, dict[str, Any]]:
    """Resolve capabilities and deployment attestations before app composition."""

    minter = _require_graph_session_minter()
    access_log_policy = _resolve_access_log_policy(listener_host)
    content_security_policy, csp_summary = _content_security_policy(
        custom_rendering=custom_rendering
    )
    access_log_expectations = {
        'disabled': 'The ASGI server must disable access logging.',
        'redacted': (
            'The ASGI server must remove raw query strings and credentials before '
            'writing access records.'
        ),
        'loopback-only': (
            'No access-log attestation is present; the listener must remain loopback-only.'
        ),
    }
    contract = {
        'graph_session_minting': 'available',
        'listener_boundary': (
            'loopback'
            if _is_loopback_listener(listener_host)
            else 'authenticated-remote'
        ),
        'access_log_policy': access_log_policy,
        'access_log_expectation': access_log_expectations[access_log_policy],
        'content_security_policy': content_security_policy,
        'csp': csp_summary,
        'synchronous_work_contract': {
            'timeout_behavior': (
                'Running calls remain charged until the underlying function exits.'
            ),
            'native_timeout_required': True,
        },
    }
    return content_security_policy, minter, contract


def _validated_bearer_header(scope: Any) -> tuple[str | None, bool]:
    """Parse exactly one bounded Bearer credential from raw ASGI headers."""

    values = [
        value.decode('latin-1')
        for key, value in scope.get('headers') or []
        if key.decode('latin-1').lower() == 'authorization'
    ]
    if not values:
        return None, True
    if len(values) != 1 or not values[0].lower().startswith('bearer '):
        return None, False
    token = values[0][7:].strip()
    if not token or len(token.encode('utf-8')) > _MAX_BEARER_TOKEN_BYTES:
        return None, False
    return token, True


def _log_ws_denial(scope: Any, *, reason: str, **fields: Any) -> None:
    """Emit one distinct, greppable log line for a websocket handshake denial.

    W-18: uvicorn's ``websockets``/``wsproto`` protocol implementations log
    **every** pre-accept ``websocket.close`` identically as
    ``"WebSocket <path>" 403`` — the ASGI ``code`` field (4400/4401/4403 here)
    is never read for that log line, so origin, auth, scope, and role denials
    were indistinguishable from the access log alone. ``reason`` is a stable
    tag identifying exactly which branch fired; the keyword fields are the
    inputs that branch evaluated. Never pass a raw token or full session
    object here — only booleans, scope names, and role/reason strings.
    """

    origin = ''
    host = ''
    for key, value in scope.get('headers') or []:
        name = key.decode('latin-1').lower()
        if name == 'origin':
            origin = value.decode('latin-1').strip()
        elif name == 'host':
            host = value.decode('latin-1').strip()
    extra = ' '.join(f'{name}={value}' for name, value in fields.items())
    logger.warning(
        'agent_webui.ws_denied reason=%s path=%s origin=%s host=%s scheme=%s %s',
        reason,
        scope.get('path') or '',
        origin or '<absent>',
        host or '<absent>',
        scope.get('scheme') or '<absent>',
        extra,
    )


class _RequestBodyLimitExceeded(Exception):
    """Internal signal used by the streaming ASGI receive boundary."""


class _WebSocketMessageLimitExceeded(Exception):
    """Internal signal used by the websocket receive boundary."""


class SecurityHeadersMiddleware:
    """Attach browser hardening and prevent API responses from being cached."""

    def __init__(
        self,
        app: Any,
        *,
        content_security_policy: str = _DEFAULT_CONTENT_SECURITY_POLICY,
    ) -> None:
        if any(character in content_security_policy for character in ('\r', '\n')):
            raise RuntimeError('Invalid Agent WebUI content security policy')
        self.app = app
        self.content_security_policy = content_security_policy.encode('ascii')

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope.get('type') != 'http':
            await self.app(scope, receive, send)
            return

        path = str(scope.get('path') or '')

        async def hardened_send(message: Any) -> None:
            if message.get('type') == 'http.response.start':
                # The application-owned policy always wins over an upstream
                # route's weaker header; route composition cannot silently
                # relax the browser boundary.
                headers = [
                    (name, value)
                    for name, value in (message.get('headers') or [])
                    if name.lower() != b'content-security-policy'
                ]
                present = {name.lower() for name, _value in headers}
                for name, value in _SECURITY_RESPONSE_HEADERS:
                    if name not in present:
                        headers.append((name, value))
                headers.append(
                    (b'content-security-policy', self.content_security_policy)
                )
                if path.startswith(('/api', '/chat', '/configure')):
                    if b'cache-control' not in present:
                        headers.append((b'cache-control', b'no-store'))
                message = {**message, 'headers': headers}
            await send(message)

        await self.app(scope, receive, hardened_send)


class StrictHostHeaderMiddleware:
    """Reject ambiguous Host headers before the configured allowlist runs."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        scope_type = scope.get('type')
        if scope_type not in {'http', 'websocket'}:
            await self.app(scope, receive, send)
            return
        hosts = [
            value
            for key, value in scope.get('headers') or []
            if key.decode('latin-1').lower() == 'host'
        ]
        if (
            len(hosts) != 1
            or not hosts[0]
            or b',' in hosts[0]
            or any(byte < 0x20 or byte == 0x7F for byte in hosts[0])
        ):
            if scope_type == 'websocket':
                # W-18: this 4400 sits UPSTREAM of every other websocket denial
                # and was the one site the first instrumentation pass missed, so
                # a rejection here still looked like an unexplained bare 403.
                _log_ws_denial(
                    scope,
                    reason='invalid-host-header',
                    host_header_count=len(hosts),
                )
                await send({'type': 'websocket.close', 'code': 4400})
            else:
                body = b'{"detail":"Invalid host header"}'
                await send(
                    {
                        'type': 'http.response.start',
                        'status': 400,
                        'headers': [
                            (b'content-type', b'application/json'),
                            (b'content-length', str(len(body)).encode('ascii')),
                        ],
                    }
                )
                await send({'type': 'http.response.body', 'body': body})
            return
        await self.app(scope, receive, send)


class RequestBodyLimitMiddleware:
    """Reject oversized fixed-length and chunked HTTP bodies before routing."""

    def __init__(self, app: Any, *, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max(1, min(int(max_bytes), _MAX_REQUEST_BODY_HARD_LIMIT))

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope.get('type') != 'http':
            await self.app(scope, receive, send)
            return

        lengths: list[int] = []
        transfer_encodings: list[str] = []
        content_types: list[str] = []
        for key, value in scope.get('headers') or []:
            header_name = key.decode('latin-1').lower()
            if header_name == 'content-type':
                content_types.append(value.decode('latin-1').strip().lower())
                continue
            if header_name == 'transfer-encoding':
                transfer_encodings.append(value.decode('latin-1').strip().lower())
                continue
            if header_name != 'content-length':
                continue
            try:
                lengths.append(int(value.decode('ascii')))
            except (UnicodeDecodeError, ValueError):
                await self._reject(send, status=400)
                return
        if (
            len(lengths) > 1
            or any(length < 0 for length in lengths)
            or (lengths and transfer_encodings)
            or len(transfer_encodings) > 1
            or len(content_types) > 1
            or any(value != 'chunked' for value in transfer_encodings)
        ):
            await self._reject(send, status=400)
            return
        media_type = content_types[0].split(';', 1)[0] if content_types else ''
        effective_limit = (
            self.max_bytes
            if media_type == 'multipart/form-data'
            else min(self.max_bytes, _MAX_STRUCTURED_REQUEST_BYTES)
        )
        if lengths and lengths[0] > effective_limit:
            await self._reject(send, status=413)
            return

        consumed = 0
        response_started = False

        async def limited_receive() -> Any:
            nonlocal consumed
            message = await receive()
            if message.get('type') == 'http.request':
                consumed += len(message.get('body', b''))
                if consumed > effective_limit:
                    raise _RequestBodyLimitExceeded
            return message

        async def tracked_send(message: Any) -> None:
            nonlocal response_started
            if message.get('type') == 'http.response.start':
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracked_send)
        except _RequestBodyLimitExceeded:
            if not response_started:
                await self._reject(send, status=413)

    @staticmethod
    async def _reject(send: Any, *, status: int) -> None:
        body = b'{"detail":"Request rejected"}'
        await send(
            {
                'type': 'http.response.start',
                'status': status,
                'headers': [
                    (b'content-type', b'application/json'),
                    (b'content-length', str(len(body)).encode('ascii')),
                ],
            }
        )
        await send({'type': 'http.response.body', 'body': body})


class WebUIAuthorizationMiddleware:
    """Require graph scopes for every authenticated HTTP/websocket route."""

    def __init__(self, app: Any) -> None:
        self.app = app

    @staticmethod
    def _is_admin_route(path: str) -> bool:
        return any(
            path == prefix or path.startswith(f'{prefix}/')
            for prefix in _ADMIN_ROUTE_PREFIXES
        )

    @staticmethod
    def _is_admin_mutation_route(path: str) -> bool:
        return any(
            path == prefix or path.startswith(f'{prefix}/')
            for prefix in _ADMIN_MUTATION_ROUTE_PREFIXES
        )

    @staticmethod
    def _role_requirement(*, required_scope: str, method: str, path: str) -> str | None:
        """The additional WebUI role (R9: reader < user < maintainer < admin)
        required for this request, layered ON TOP OF the `required_scope` KG
        scope check the caller already had to pass.

        It is evaluated only after the scope check already succeeded, and by
        DEFAULT is non-breaking: `rbac.resolve_webui_role` maps ``kg:admin`` ->
        ``admin`` and ``kg:write`` -> ``maintainer`` whenever no explicit
        ``webui:*`` realm role is assigned, so nobody who depended on a scope
        alone loses access the day this ladder is introduced. An operator MAY
        assign an explicit lower ``webui:*`` role to deliberately restrict a
        principal's WebUI reach below what its ``kg:*`` scope alone would
        otherwise imply here (e.g. a service account with `kg:admin` API access
        but no business reaching the WebUI's admin console) — that is the
        intended escape hatch, not a bug.
        """

        if required_scope == 'kg:admin':
            return 'admin'
        if method not in {
            'GET',
            'HEAD',
            'OPTIONS',
        } and WebUIAuthorizationMiddleware._is_admin_mutation_route(path):
            return 'maintainer'
        return None

    @staticmethod
    def _origin_allowed(scope: Any) -> bool:
        origins: list[str] = []
        hosts: list[str] = []
        fetch_sites: list[str] = []
        for key, value in scope.get('headers') or []:
            name = key.decode('latin-1').lower()
            if name == 'origin':
                origins.append(value.decode('latin-1').strip())
            elif name == 'host':
                hosts.append(value.decode('latin-1').strip().lower())
            elif name == 'sec-fetch-site':
                fetch_sites.append(value.decode('latin-1').strip().lower())
        if not origins:
            return len(fetch_sites) <= 1 and fetch_sites != ['cross-site']
        if (
            len(origins) != 1
            or len(hosts) != 1
            or len(fetch_sites) > 1
            or origins[0].lower() == 'null'
        ):
            return False

        from agent_utilities.core.config import config

        allowed = {
            value.strip().rstrip('/').lower()
            for value in str(config.allowed_origins or '').split(',')
            if value.strip()
        }
        parsed = urlsplit(origins[0])
        if (
            parsed.scheme.lower() not in {'http', 'https'}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path not in {'', '/'}
            or parsed.query
            or parsed.fragment
        ):
            return False
        origin = f'{parsed.scheme.lower()}://{parsed.netloc.lower()}'
        if origin in allowed:
            return True

        request_scheme = str(scope.get('scheme') or '').lower()
        expected_scheme = 'https' if request_scheme in {'https', 'wss'} else 'http'
        return (
            parsed.scheme.lower() == expected_scheme
            and parsed.netloc.lower() == hosts[0]
        )

    async def _call_with_transport_bounds(
        self,
        scope: Any,
        receive: Any,
        send: Any,
    ) -> None:
        if scope.get('type') != 'websocket':
            await self.app(scope, receive, send)
            return

        async def limited_receive() -> Any:
            message = await receive()
            if message.get('type') == 'websocket.receive':
                binary = message.get('bytes') or b''
                text = message.get('text') or ''
                size = len(binary) + len(str(text).encode('utf-8'))
                if size > _MAX_WEBSOCKET_MESSAGE_BYTES:
                    raise _WebSocketMessageLimitExceeded
            return message

        async def limited_send(message: Any) -> None:
            if message.get('type') == 'websocket.send':
                binary = message.get('bytes') or b''
                text = message.get('text') or ''
                size = len(binary) + len(str(text).encode('utf-8'))
                if size > _MAX_WEBSOCKET_MESSAGE_BYTES:
                    raise _WebSocketMessageLimitExceeded
            await send(message)

        try:
            await self.app(scope, limited_receive, limited_send)
        except _WebSocketMessageLimitExceeded:
            await send({'type': 'websocket.close', 'code': 1009})

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        scope_type = scope.get('type')
        if scope_type not in {'http', 'websocket'}:
            await self.app(scope, receive, send)
            return

        from agent_utilities.knowledge_graph.core.session import current_session

        path = str(scope.get('path') or '')
        method = str(scope.get('method') or '').upper()
        if scope_type == 'websocket':
            required = 'kg:admin' if self._is_admin_route(path) else 'kg:write'
        else:
            if self._is_admin_route(path) or (
                method not in {'GET', 'HEAD', 'OPTIONS'}
                and self._is_admin_mutation_route(path)
            ):
                required = 'kg:admin'
            elif method in {'GET', 'HEAD', 'OPTIONS'}:
                required = 'kg:read'
            else:
                required = 'kg:write'
        origin_sensitive = scope_type == 'websocket' or required != 'kg:read'
        if origin_sensitive and not self._origin_allowed(scope):
            if scope_type == 'websocket':
                _log_ws_denial(scope, reason='origin-rejected', required=required)
                await send({'type': 'websocket.close', 'code': 4403})
            else:
                body = b'{"detail":"Request forbidden"}'
                await send(
                    {
                        'type': 'http.response.start',
                        'status': 403,
                        'headers': [
                            (b'content-type', b'application/json'),
                            (b'content-length', str(len(body)).encode('ascii')),
                        ],
                    }
                )
                await send({'type': 'http.response.body', 'body': body})
            return
        if not _identity_enforced() or path in _PUBLIC_LIVENESS_PATHS:
            await self._call_with_transport_bounds(scope, receive, send)
            return

        session = current_session()
        scopes = session.scopes if session is not None else frozenset()
        if required in scopes:
            role_requirement = self._role_requirement(
                required_scope=required, method=method, path=path
            )
            if role_requirement is not None:
                from .rbac import resolve_webui_role, role_at_least

                actor = getattr(session, 'actor', None)
                webui_role = resolve_webui_role(
                    tuple(getattr(actor, 'roles', ()) or ()),
                    authenticated=bool(getattr(actor, 'authenticated', False)),
                )
                if not role_at_least(webui_role, role_requirement):
                    if scope_type == 'websocket':
                        _log_ws_denial(
                            scope,
                            reason='webui-role-insufficient',
                            required_scope=required,
                            required_role=role_requirement,
                            resolved_role=webui_role,
                            scopes=','.join(sorted(scopes)) or '<none>',
                        )
                        await send({'type': 'websocket.close', 'code': 4403})
                        return
                    body = b'{"detail":"Request forbidden"}'
                    await send(
                        {
                            'type': 'http.response.start',
                            'status': 403,
                            'headers': [
                                (b'content-type', b'application/json'),
                                (b'content-length', str(len(body)).encode('ascii')),
                            ],
                        }
                    )
                    await send({'type': 'http.response.body', 'body': body})
                    return
            await self._call_with_transport_bounds(scope, receive, send)
            return

        if scope_type == 'websocket':
            _log_ws_denial(
                scope,
                reason='scope-missing',
                required=required,
                session_resolved=session is not None,
                scopes=','.join(sorted(scopes)) or '<none>',
            )
            await send({'type': 'websocket.close', 'code': 4403})
            return
        body = b'{"detail":"Request forbidden"}'
        await send(
            {
                'type': 'http.response.start',
                'status': 403,
                'headers': [
                    (b'content-type', b'application/json'),
                    (b'content-length', str(len(body)).encode('ascii')),
                ],
            }
        )
        await send({'type': 'http.response.body', 'body': body})


def _is_loopback_listener(host: str) -> bool:
    """Return whether a listener name is constrained to the local machine."""

    candidate = host.strip().lower()
    if candidate == 'localhost':
        return True
    if candidate.startswith('[') and candidate.endswith(']'):
        candidate = candidate[1:-1]
    try:
        return ip_address(candidate).is_loopback
    except ValueError:
        return False


def _configure_served_boundary(listener_host: str | None) -> str:
    """Resolve the bind host and fail closed for incomplete served identity.

    Loopback remains the zero-configuration development boundary. Any other
    listener requires a complete JWT verifier in ``AgentConfig``; issuer and
    audience checks are mandatory so a valid token for another service cannot
    be replayed against the WebUI.
    """

    from agent_utilities.core.config import config

    host = (listener_host or config.host or '127.0.0.1').strip()
    if not host:
        host = '127.0.0.1'

    jwt_fields = (
        config.auth_jwt_jwks_uri,
        config.auth_jwt_issuer,
        config.auth_jwt_audience,
    )
    if any(jwt_fields) and not all(jwt_fields):
        raise RuntimeError(
            'Agent WebUI JWT authentication requires JWKS URI, issuer, and audience'
        )
    if not _is_loopback_listener(host) and not all(jwt_fields):
        raise RuntimeError(
            'Refusing a non-loopback Agent WebUI listener without complete JWT '
            'authentication in AgentConfig'
        )

    if not _is_loopback_listener(host) and float(config.gateway_rate_limit or 0) <= 0:
        config.gateway_rate_limit = _REMOTE_DEFAULT_RATE
        config.gateway_rate_burst = _REMOTE_DEFAULT_BURST

    if all(jwt_fields):
        # ``AgentConfig`` has no ``kg_auth_required``/``kg_brain_enforce`` field
        # in any shipped agent-utilities, so assigning them raised
        # ``ValueError: "AgentConfig" object has no field`` and killed startup —
        # but only once all three JWT fields were present, i.e. only once
        # authentication was actually configured. Enforcement is derived from
        # that same configuration instead (see ``_identity_enforced``); the
        # environment-backed accessors stay, since they are what the graph
        # enforcement layers read.
        os.environ['KG_AUTH_REQUIRED'] = '1'
        os.environ['KG_BRAIN_ENFORCE'] = '1'
    return host


def _identity_enforced() -> bool:
    """Return whether a complete JWT verifier makes identity mandatory.

    This is the single predicate the WebUI's own authorization and websocket
    boundaries consult. It is derived, not stored, so an embedder that composes
    the app without going through :func:`_configure_served_boundary` still gets
    the fail-closed answer whenever a verifier is configured.
    """

    from agent_utilities.core.config import config

    return bool(
        config.auth_jwt_jwks_uri and config.auth_jwt_issuer and config.auth_jwt_audience
    )


def _ensure_actor_identity_middleware(
    app: FastAPI,
    *,
    mint_graph_session: Any,
) -> None:
    """Install the server-minted identity boundary exactly once, app-wide.

    The shared middleware owns the **unauthenticated** decision for HTTP —
    which paths are exempt (``UNAUTHENTICATED_PATHS``), and every 401 shape —
    and this specialization delegates to it untouched for all of that. What it
    owns itself is (a) websocket routes, which the generic graph middleware
    deliberately leaves to transport-specific callers, and (b) the *session
    mint* for an already-authenticated HTTP request, so both transports mint
    through the same injected ``mint_graph_session``. The shared HTTP branch
    would otherwise call the module-level minter, which binds an engine
    placement route this frontend must not require — see
    :mod:`agent_webui.graph_identity`.
    """

    from agent_utilities.security.request_identity import (
        ActorIdentityMiddleware,
        actor_from_bearer_token,
        actor_from_claims,
    )

    async def _authenticated_http_actor(scope: Any) -> Any:
        """Return the verified actor for an HTTP request, or ``None``.

        ``None`` means "this request is not an authenticated one" for ANY
        reason — absent credential, unusable verifier, or a credential that
        failed validation. Every such case is handed straight back to the
        shared middleware, which owns the exempt-path allowance and the exact
        401 body for each. This mirrors the shared actor projection rather
        than replacing it: both branches call the shared
        ``actor_from_claims`` / ``actor_from_bearer_token``.
        """

        from agent_utilities.core.config import config
        from agent_utilities.security.auth import parse_bearer_authorization

        state = scope.get('state') or {}
        prevalidated = state.get('user_claims') if isinstance(state, dict) else None
        authorization = [
            value
            for key, value in scope.get('headers') or []
            if isinstance(key, bytes) and key.lower() == b'authorization'
        ]
        try:
            token = parse_bearer_authorization(authorization)
        except PermissionError:
            return None

        if isinstance(prevalidated, dict) and prevalidated.get('auth_type') == 'jwt':
            # An outer HTTP authentication boundary already verified this
            # credential; reuse its claims rather than re-verifying.
            try:
                return actor_from_claims(prevalidated)
            except (TypeError, ValueError):
                return None
        if not token or not config.auth_jwt_jwks_uri:
            return None
        try:
            return await actor_from_bearer_token(token)
        except Exception:
            # Any verification failure — malformed token, bad signature,
            # unreachable JWKS — means "not authenticated here". The shared
            # boundary re-runs the same check and owns the resulting 401, so
            # nothing is swallowed: the decision is made once, there.
            return None

    class WebUIActorIdentityMiddleware(ActorIdentityMiddleware):
        async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
            scope_type = scope.get('type')
            token, valid_credential = _validated_bearer_header(scope)
            if scope_type == 'http':
                if not valid_credential:
                    body = b'{"detail":"Authentication required"}'
                    await send(
                        {
                            'type': 'http.response.start',
                            'status': 401,
                            'headers': [
                                (b'content-type', b'application/json'),
                                (b'content-length', str(len(body)).encode('ascii')),
                            ],
                        }
                    )
                    await send({'type': 'http.response.body', 'body': body})
                    return
                actor = await _authenticated_http_actor(scope)
                if actor is None:
                    # Unauthenticated, unverifiable, or invalid: the shared
                    # boundary owns that decision end to end, including which
                    # paths may proceed without a credential.
                    await super().__call__(scope, receive, send)
                    return
                await self._serve_authenticated_http(actor, scope, receive, send)
                return
            if scope_type != 'websocket':
                await self.app(scope, receive, send)
                return

            from agent_utilities.core.config import config

            if not valid_credential:
                # W-18: a raw Authorization header was present but was not
                # exactly one bounded `Bearer <token>` value — distinct from
                # "no credential at all" below, since it means SOMETHING
                # (a service client, or a corrupted cookie-derived header
                # forwarded by OIDCBrowserSessionMiddleware) sent a header
                # that failed the shape check.
                _log_ws_denial(scope, reason='malformed-bearer-header')
                await send({'type': 'websocket.close', 'code': 4401})
                return

            if token and not config.auth_jwt_jwks_uri:
                _log_ws_denial(scope, reason='verifier-unconfigured')
                await send({'type': 'websocket.close', 'code': 4401})
                return
            if not token:
                if _identity_enforced():
                    # W-18: no Authorization header reached this middleware at
                    # all. For a browser session this means
                    # OIDCBrowserSessionMiddleware did not forward a bearer —
                    # most commonly because no usable session cookie arrived
                    # on the websocket handshake (missing, expired with a
                    # failed refresh, or never established). Check the cookie
                    # delivery path first when this reason fires repeatedly.
                    _log_ws_denial(scope, reason='no-credential-resolved')
                    await send({'type': 'websocket.close', 'code': 4401})
                    return
                await self.app(scope, receive, send)
                return

            try:
                actor = await actor_from_bearer_token(token)
                session = mint_graph_session(actor)
            except Exception as exc:  # noqa: BLE001 - any credential failure is denied
                _log_ws_denial(
                    scope,
                    reason='credential-verification-failed',
                    error_type=type(exc).__name__,
                )
                await send({'type': 'websocket.close', 'code': 4401})
                return

            from agent_utilities.knowledge_graph.core.session import (
                reset_session,
                set_session,
            )
            from agent_utilities.security.brain_context import reset_actor, set_actor

            actor_token = set_actor(actor)
            session_token = set_session(session)
            try:
                await self.app(scope, receive, send)
            finally:
                reset_session(session_token)
                reset_actor(actor_token)

        async def _serve_authenticated_http(
            self, actor: Any, scope: Any, receive: Any, send: Any
        ) -> None:
            """Bind ``actor`` + its minted session and serve the request.

            Field-for-field the shared middleware's authenticated HTTP leg —
            same 401/403 mapping, same ambient currencies, same teardown — with
            the injected minter in place of the module-level one.
            """

            from agent_utilities.knowledge_graph.core.session import (
                SessionExpiredError,
                reset_session,
                set_session,
            )
            from agent_utilities.security.brain_context import (
                CredentialExpiredError,
                reset_actor,
                set_actor,
            )
            from agent_utilities.security.request_identity import _send_json

            try:
                session = mint_graph_session(actor)
            except SessionExpiredError:
                await _send_json(send, 401, {'error': 'Bearer credential expired'})
                return
            except PermissionError:
                await _send_json(send, 403, {'error': 'Verified tenant claim required'})
                return
            try:
                actor_token = set_actor(actor)
                try:
                    session_token = set_session(session)
                except Exception:
                    reset_actor(actor_token)
                    raise
            except (CredentialExpiredError, SessionExpiredError):
                await _send_json(send, 401, {'error': 'Bearer credential expired'})
                return

            response_started = False

            async def tracked_send(message: Any) -> None:
                nonlocal response_started
                if message.get('type') == 'http.response.start':
                    response_started = True
                await send(message)

            try:
                await self.app(scope, receive, tracked_send)
            except (CredentialExpiredError, SessionExpiredError):
                if response_started:
                    raise
                await _send_json(send, 401, {'error': 'Bearer credential expired'})
            finally:
                reset_session(session_token)
                reset_actor(actor_token)

    # ``register_graph_routes`` may already have installed the HTTP-only base
    # middleware. Replace that entry before Starlette builds the stack.
    app.user_middleware[:] = [
        middleware
        for middleware in app.user_middleware
        if getattr(middleware, 'cls', None) is not ActorIdentityMiddleware
    ]
    if not any(
        getattr(middleware, 'cls', None) is WebUIActorIdentityMiddleware
        for middleware in app.user_middleware
    ):
        app.add_middleware(WebUIActorIdentityMiddleware)


def _ensure_authorization_middleware(app: FastAPI) -> None:
    """Install route-wide scope enforcement inside the identity middleware."""

    if not any(
        getattr(middleware, 'cls', None) is WebUIAuthorizationMiddleware
        for middleware in app.user_middleware
    ):
        app.add_middleware(WebUIAuthorizationMiddleware)


def _ensure_browser_sso_middleware(app: FastAPI) -> None:
    """Install the browser authorization-code boundary outside the identity gate.

    ``add_middleware`` prepends, so calling this *after*
    :func:`_ensure_actor_identity_middleware` places it directly outside the
    identity gate: it owns ``/auth/*`` (never forwarded, so the gate keeps its
    shipped ``UNAUTHENTICATED_PATHS``) and, for every other request, may attach
    the signed-in user's own token before the unmodified gate validates it.

    Unconfigured is a supported state — the WebUI then behaves exactly as it
    did before, with bearer-only access. A *partial* configuration raises,
    because a login boundary that silently does nothing is indistinguishable
    from a broken one.
    """

    from .oidc_session import OIDCBrowserSessionMiddleware, load_settings

    if any(
        getattr(middleware, 'cls', None) is OIDCBrowserSessionMiddleware
        for middleware in app.user_middleware
    ):
        return
    settings = load_settings()
    if settings is None:
        logger.info(
            'Agent WebUI browser SSO is not configured — API clients must '
            'present their own Bearer credential'
        )
        return
    app.add_middleware(OIDCBrowserSessionMiddleware, settings=settings)
    logger.info(
        'Agent WebUI browser SSO active: authorization-code + PKCE against %s '
        'as client %s',
        settings.issuer,
        settings.client_id,
    )


def _ensure_security_headers_middleware(
    app: FastAPI,
    *,
    content_security_policy: str,
) -> None:
    """Install the response hardening boundary outside every application route."""

    if not any(
        getattr(middleware, 'cls', None) is SecurityHeadersMiddleware
        for middleware in app.user_middleware
    ):
        app.add_middleware(
            SecurityHeadersMiddleware,
            content_security_policy=content_security_policy,
        )


def _install_host_boundary(app: FastAPI, listener_host: str) -> None:
    """Reject Host-header confusion and require an allowlist when remote."""

    from agent_utilities.core.config import config

    configured = [
        value.strip()
        for value in str(config.allowed_hosts or '').split(',')
        if value.strip()
    ]
    if '*' in configured:
        raise RuntimeError('Agent WebUI does not permit wildcard Host headers')
    allowed_origins = {
        value.strip()
        for value in str(config.allowed_origins or '').split(',')
        if value.strip()
    }
    if '*' in allowed_origins:
        raise RuntimeError('Agent WebUI does not permit wildcard browser origins')
    for origin in allowed_origins:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {'http', 'https'}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path not in {'', '/'}
            or parsed.query
            or parsed.fragment
        ):
            raise RuntimeError('Agent WebUI ALLOWED_ORIGINS contains an invalid origin')
    if not configured:
        if not _is_loopback_listener(listener_host):
            raise RuntimeError(
                'A non-loopback Agent WebUI listener requires ALLOWED_HOSTS'
            )
        configured = ['localhost', '127.0.0.1', '[::1]', 'testserver']
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=configured)
    app.add_middleware(StrictHostHeaderMiddleware)


def _install_request_body_boundary(app: FastAPI) -> None:
    """Install a streaming request cap sourced from ``AgentConfig``."""

    from agent_utilities.core.config import config

    try:
        configured = int(config.max_upload_size)
    except (TypeError, ValueError):
        configured = 10 * 1024 * 1024
    limit = min(
        max(1, configured) + _MULTIPART_OVERHEAD_ALLOWANCE,
        _MAX_REQUEST_BODY_HARD_LIMIT,
    )
    app.add_middleware(RequestBodyLimitMiddleware, max_bytes=limit)


def _ensure_rate_limit_middleware(app: FastAPI) -> None:
    """Apply the AgentConfig token bucket to the entire composed application."""

    from agent_utilities.core.config import config

    if float(config.gateway_rate_limit or 0) <= 0:
        return
    from agent_utilities.gateway.rate_limit import GatewayRateLimitMiddleware

    if not any(
        getattr(middleware, 'cls', None) is GatewayRateLimitMiddleware
        for middleware in app.user_middleware
    ):
        app.add_middleware(GatewayRateLimitMiddleware)


def create_agent_web_app(
    agent: Agent,
    workspace_helpers: dict[str, Any],
    models: dict[str, str] | None = None,
    builtin_tools: list[Any] | None = None,
    html_source: str | Path | None = None,
    listener_host: str | None = None,
) -> FastAPI:
    """Create the agent-web FastAPI application.

    Integrates Pydantic-AI's internal web UI with custom extensions for
    workspace awareness, dynamic model selection, and high-fidelity
    observability.

    Args:
        agent: The Pydantic-AI Agent instance to serve.
        workspace_helpers: Metadata and tools for workspace situational awareness.
        models: Optional explicit mapping of provider:model_id to display names.
        builtin_tools: Deprecated compatibility input. Current Pydantic AI discovers
            native tools from ``Agent.capabilities``; a non-empty value is rejected
            instead of being silently dropped.
        html_source: Path to custom HTML to serve as the dashboard root.
        listener_host: Intended listener host. Defaults to ``AgentConfig.host``;
            non-loopback listeners require complete JWT authentication.

    Returns:
        A fully configured FastAPI application instance.
    """

    resolved_listener_host = _configure_served_boundary(listener_host)
    content_security_policy, mint_graph_session, security_contract = (
        _startup_security_contract(
            resolved_listener_host,
            custom_rendering=html_source is not None,
        )
    )
    set_workspace_helpers(workspace_helpers)

    # Detect available providers based on environment variables
    default_models = {}
    if os.getenv('ANTHROPIC_API_KEY'):
        default_models['Claude Sonnet 3.5'] = 'anthropic:claude-3-5-sonnet-latest'
    if os.getenv('OPENAI_API_KEY'):
        default_models['GPT 4o'] = 'openai:gpt-4o'
    if os.getenv('GOOGLE_API_KEY'):
        default_models['Gemini 2.0 Pro'] = 'google:gemini-2.0-pro'

    # Support for local induction via Ollama/OpenWebUI patterns
    if os.getenv('OLLAMA_BASE_URL') or os.getenv('OLLAMA_HOST'):
        default_models['Qwen 3 Coder'] = 'ollama:qwen3-coder'

    if not default_models:
        default_models['Test Model (Markdown Only)'] = 'test'

    app = FastAPI(title='Agent Web Dashboard')
    app.state.agent = agent
    app.state.security_contract = security_contract
    _install_request_body_boundary(app)
    _install_host_boundary(app, resolved_listener_host)

    @app.exception_handler(_errors.HTTPException)
    async def _privacy_safe_http_error(_request, exc: _errors.HTTPException):
        """Prevent upstream exception detail from being reflected to clients."""

        detail = (
            'Request failed' if exc.status_code < 500 else 'Internal request failed'
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={'detail': detail},
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _privacy_safe_validation_error(_request, _exc: RequestValidationError):
        """Do not reflect submitted values or schema internals in validation errors."""

        return JSONResponse(
            status_code=422,
            content={'detail': 'Request could not be processed'},
        )

    @app.exception_handler(Exception)
    async def _privacy_safe_unhandled_error(_request, exc: Exception):
        """Keep unexpected exception values out of responses and server logs."""

        logger.error('Unhandled request failed: error_type=%s', type(exc).__name__)
        return JSONResponse(
            status_code=500,
            content={'detail': 'Internal request failed'},
        )

    @app.get('/api/enhanced/security/doctor')
    async def _security_doctor() -> dict[str, Any]:
        """Return the active, non-secret startup and sync-capacity contract."""

        sync_status = sync_work_status()
        degraded = bool(sync_status['timed_out_in_flight']) or (
            sync_status['in_flight'] >= sync_status['max_pending']
        )
        return {
            'status': 'degraded' if degraded else 'ok',
            **app.state.security_contract,
            'synchronous_work': sync_status,
        }

    # Mount the enhanced API extensions (ACP/A2A/Management)
    app.include_router(enhanced_router, prefix='/api/enhanced')

    # Mount the service dashboard API if available (optional dependency)
    try:
        from agent_utilities.gateway.api import dashboard_router, get_full_dashboard

        app.include_router(dashboard_router, prefix='/api/dashboard')
        logger.info('Service Dashboard API mounted at /api/dashboard')

        # W-19 (reports/webui-graphos-defects-2026-08-08.md): `/ws/dashboard`
        # never registered a real route — Starlette closed the unmatched
        # handshake and uvicorn logged that as a bare "403 Forbidden", which
        # read for hours like an authorization bug. `_ADMIN_ROUTE_PREFIXES`
        # above already lists `/ws/dashboard` and `WebUIAuthorizationMiddleware`
        # already enforces `kg:admin` on it (proven with a real sealed-cookie
        # chain test in `test_ws_dashboard_denial_diagnostics.py`) — the only
        # missing piece was the endpoint itself.
        #
        # Deliberately NOT `agent_utilities.gateway.ws.dashboard_ws_router`:
        # that handler re-checks capabilities itself using the OLDER
        # `gateway:read/write/admin` namespace (`identity_group_capability_map`
        # never maps `kg:admin` -> `gateway:admin`), so it would reject a
        # caller `WebUIAuthorizationMiddleware` just admitted. This route
        # performs NO additional internal auth check — the middleware chain
        # above is the single source of truth for who may connect — and
        # streams the exact same payload `GET /api/dashboard/full` serves by
        # calling that route's own handler (`get_full_dashboard`) rather than
        # re-deriving the data.
        @app.websocket('/ws/dashboard')
        async def _dashboard_ws(websocket: WebSocket) -> None:
            """Stream dashboard widget data: a `snapshot` on connect, then
            periodic `update` messages, both shaped exactly like
            `GET /api/dashboard/full`'s `data` field so the frontend's single
            `['dashboard-full']` query-cache merge (`DashboardView.tsx`)
            applies to either source unmodified.
            """
            await websocket.accept()
            message_type = 'snapshot'
            try:
                while True:
                    full = await get_full_dashboard()
                    await websocket.send_json(
                        {
                            'type': message_type,
                            'data': {
                                widget_id: widget.model_dump(mode='json')
                                for widget_id, widget in full.data.items()
                            },
                        }
                    )
                    message_type = 'update'
                    try:
                        # The client never sends anything meaningful (see
                        # DashboardView.tsx — it only listens); this is purely
                        # the cheapest way to notice a disconnect promptly
                        # instead of blocking a full interval on a dead socket.
                        await asyncio.wait_for(
                            websocket.receive_text(),
                            timeout=_DASHBOARD_WS_PUSH_INTERVAL_SECONDS,
                        )
                    except TimeoutError:
                        pass
            except WebSocketDisconnect:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    '/ws/dashboard stream failed: error_type=%s',
                    type(exc).__name__,
                )

        # Canonical Knowledge Graph REST surface (CONCEPT:AU-ECO.messaging.native-backend-abstraction): mount the
        # SAME route table the API gateway serves — /api/graph/*, /api/ontology/*,
        # /api/object/*, /api/sessions, /api/goals, /api/tools, plus the fleet
        # supervisory plane (CONCEPT:AU-OS.safety.ontological-guardrail) and the /cypher fast path — via
        # the single canonical registrar. WebUI clients and gateway clients are
        # served by one route implementation, so the two surfaces cannot drift.
        try:
            from agent_utilities.gateway.graph_api import register_graph_routes

            register_graph_routes(app, prefix='/api')
            logger.info(
                'Canonical KG REST surface + fleet supervisory plane mounted under /api'
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                'Failed to mount canonical KG REST surface: error_type=%s',
                type(exc).__name__,
            )

        # This process is the KG daemon HOST by default: it runs the single
        # consolidated background daemon (queue drain + graph writer + task
        # workers + maintenance scheduler + file-watch) that all
        # KG_DAEMON_ROLE=client processes (MCP server / CLI / scripts) rely on.
        # (CONCEPT:EG-KG.storage.nonblocking-checkpoint / OS-5.9)
        #
        # Thin, horizontally-scalable instances opt out with KG_DAEMON_ROLE=client:
        # they reach a SHARED KG host over the engine socket instead of each
        # forcing itself to be the host, so many webui API instances can run
        # behind a load balancer against one backend (the agent-terminal-ui
        # scale-many-instances pattern; see the agent-utilities "Scalable
        # Frontends" guide).
        @app.on_event('startup')
        async def _start_kg_host_daemon() -> None:
            if (os.environ.get('KG_DAEMON_ROLE') or '').strip().lower() == 'client':
                logger.info(
                    'KG_DAEMON_ROLE=client — thin instance; skipping in-process '
                    'KG host daemon (using the shared backend over the engine socket)'
                )
                return
            try:
                from agent_utilities.gateway.daemon import start_host_daemon

                start_host_daemon()
                logger.info('KG host daemon started (KG_DAEMON_ROLE=host)')
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    'Failed to start KG host daemon: error_type=%s',
                    type(exc).__name__,
                )
    except ImportError:
        logger.info('agent-utilities gateway not available — dashboard API unavailable')

    # Current Pydantic AI has no ``builtin_tools`` web-adapter argument.
    # Native tools now belong to the Agent capability contract and are discovered
    # by ``to_web``.  Silently ignoring an old non-empty list would make the UI
    # advertise a capability that the execution agent does not actually own.
    if builtin_tools:
        raise ValueError(
            'builtin_tools is no longer accepted by Pydantic AI; configure '
            'NativeTool capabilities on the Agent before creating the WebUI'
        )

    # Delegate to Pydantic-AI's native web wrapper for base functionality.
    pydantic_app = agent.to_web(
        models=models or default_models,
        html_source=html_source,
    )

    def add_pydantic_routes(routes, prefix=''):
        """Recursively discover and mount Pydantic-AI internal routes.

        Args:
            routes: List of routes to process.
            prefix: URL prefix for the current route layer.
        """
        for route in routes:
            if isinstance(route, Mount):
                add_pydantic_routes(route.app.routes, prefix + route.path)
            elif isinstance(route, StarletteRoute):
                full_path = prefix + route.path
                full_path = '/' + full_path.strip('/')

                # Only bridge routes that match the dashboard's functional scope
                if (
                    full_path.startswith('/api')
                    or full_path.startswith('/chat')
                    or full_path.startswith('/configure')
                    or (html_source and (full_path == '/' or full_path == '/{id}'))
                ):
                    app.add_route(full_path, route.endpoint, methods=route.methods)

    add_pydantic_routes(pydantic_app.routes)

    dist_path = Path(__file__).parent / 'dist'

    class SPAStaticFiles(StaticFiles):
        """Custom StaticFiles implementation to support Single Page Application (SPA).

        Intercepts 404s for client-side routing, falling back to index.html
        unless the request targets a known API endpoint or specific file.
        """

        async def get_response(self, path: str, scope):
            try:
                return await super().get_response(path, scope)
            except _errors.HTTPException as ex:
                if (
                    ex.status_code == 404
                    and not any(
                        path.startswith(p)
                        for p in ['api', 'chat', 'configure', 'mcp', 'a2a', 'ag-ui']
                    )
                    and '.' not in path
                ):
                    return await super().get_response('index.html', scope)
                raise ex

    # Fallback to serving the built React dashboard if no custom source provided
    if not html_source:
        if dist_path.exists():
            app.mount(
                '/',
                SPAStaticFiles(directory=str(dist_path), html=True),
                name='dashboard',
            )
        else:
            logger.warning(
                'Static assets were not found at the configured location. '
                'Dashboard UI will not be served.'
            )

    if _LOGFIRE_ENABLED:
        logfire.instrument_starlette(app)
    # Some gateway configurations install this middleware while registering
    # graph routes. Ensure it exists exactly once even when that optional
    # gateway is absent, and install it after every WebUI route is composed so
    # Pydantic-AI, static, dashboard, websocket, and enhanced routes share one
    # authenticated actor boundary.
    _ensure_rate_limit_middleware(app)
    _ensure_authorization_middleware(app)
    _ensure_actor_identity_middleware(
        app,
        mint_graph_session=mint_graph_session,
    )
    _ensure_browser_sso_middleware(app)
    _ensure_security_headers_middleware(
        app,
        content_security_policy=content_security_policy,
    )
    return app


def main() -> None:
    """Application entry point for CLI usage and ecosystem validation."""
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default=None)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--web', action='store_true')
    parser.add_argument('--security-doctor', action='store_true')
    args, _ = parser.parse_known_args()

    # This entry point owns the ASGI server and disables its access records
    # below. Embedders must make the equivalent explicit choice or provide a
    # redacting access logger before selecting the ``redacted`` policy.
    os.environ.setdefault(_ACCESS_LOG_POLICY_ENV, 'disabled')
    host = _configure_served_boundary(args.host)
    if args.security_doctor:
        _policy, _minter, contract = _startup_security_contract(
            host,
            custom_rendering=False,
        )
        print(
            json.dumps(
                {
                    'status': 'ok',
                    **contract,
                    'synchronous_work': sync_work_status(),
                },
                sort_keys=True,
            )
        )
        return

    import uvicorn

    from agent_webui.api_extensions import _get_engine_bounded
    from agent_webui.orchestrator_model import build_orchestrator_model

    # D-W5OEP-2: this was ``Agent(TestModel())`` -- a canned, no-LLM double,
    # so every chat turn the production Dockerfile CMD served was ungrounded
    # by construction. ``build_orchestrator_model`` routes chat through
    # ``Orchestrator.execute_agent`` (the SAME universal execution plane
    # messaging already uses), which resolves its model/provider from the
    # existing ``AgentConfig`` -- there is no separate webui model config to
    # build here, only the wiring to the one that already exists.
    agent = Agent(build_orchestrator_model(_get_engine_bounded))
    app = create_agent_web_app(agent, workspace_helpers={}, listener_host=host)

    print('Application startup complete', file=sys.stderr)
    # Uvicorn access records include the raw query string, which can contain
    # user searches, graph symbols, or other sensitive text.
    uvicorn.run(app, host=host, port=args.port, access_log=False)


if __name__ == '__main__':
    main()
