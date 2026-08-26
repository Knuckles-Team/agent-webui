import asyncio
import base64
import contextlib
import contextvars
import hashlib
import inspect
import json
import logging
import math
import os
import re
import secrets
import stat
import threading
import time
from concurrent import futures as _futures
from dataclasses import replace
from datetime import datetime, timezone
from ipaddress import ip_address
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import quote, urlsplit

from agent_utilities.core.config import config
from agent_utilities.core.paths import config_dir, data_dir
from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine
from agent_utilities.knowledge_graph.core.maintainer import GraphMaintainer
from agent_utilities.knowledge_graph.kb.ingestion import KBIngestionEngine
from agent_utilities.knowledge_graph.pipeline.phases import PHASES
from agent_utilities.knowledge_graph.pipeline.runner import PipelineRunner
from agent_utilities.knowledge_graph.pipeline.types import PipelineContext
from agent_utilities.models.knowledge_graph import PipelineConfig
from agent_utilities.sdd import SDDManager
from agent_utilities.security.persistence_privacy import (
    persistence_reference,
    sanitize_for_persistence,
)
from fastapi import (
    APIRouter,
    File,
    Request,
    UploadFile,
)
from fastapi import (
    HTTPException as FastAPIHTTPException,
)
from fastapi.responses import Response

# Global constant for agent directory

router = APIRouter()
# Chat-session history CRUD, mounted separately at the top-level `/api/chats`
# resource (prefix='/api', paths below already spell `/chats...`) rather than
# under `/api/enhanced` -- see PHASE B/C unify-chat-resource. Kept as its own
# `APIRouter` (not folded into `router`) so the mount prefix in `server.py`
# can differ from the rest of the webui-only `/api/enhanced/*` surface
# without special-casing individual routes at inclusion time.
chats_router = APIRouter()
logger = logging.getLogger(__name__)
_REFERENCE_KEY = secrets.token_bytes(32)
_MAX_CONTAINER_RECORDS = 256
_MAX_EXTERNAL_RESULT_BYTES = 2 * 1024 * 1024
_MAX_EXTERNAL_ARGUMENT_BYTES = 256 * 1024
_MAX_EXTERNAL_COLLECTION_ITEMS = 256
_MAX_EXTERNAL_DEPTH = 10
# GET /tools (list_all_tools) legitimately combines up to 5 already-bounded collections
# (mcp_tools, builtin_tools, skills, skill_graphs, skill_workflows -- each independently
# capped at _MAX_EXTERNAL_COLLECTION_ITEMS above). Measured live: 256 real skill entries
# alone already walk to ~3,392 nodes (~13.25 nodes/item), so the previous 4096-node
# budget rejected genuinely first-party, already-bounded data with a 500 the moment real
# skills data existed (D-WD-7 / D-WUI-4) -- it was never exercised with real payloads
# before. Raised with headroom for the worst case (5 collections * 256 items * ~13
# nodes/item =~ 17,000) while still bounding a truly runaway/malicious delegated result,
# which is what this constant exists to catch.
_MAX_EXTERNAL_NODES = 20000
_MAX_EXTERNAL_STRING_BYTES = 64 * 1024
_MAX_UPLOAD_HARD_LIMIT = 50 * 1024 * 1024
_SAFE_INVENTORY_TOKEN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
_SAFE_HOSTNAME = re.compile(r'^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$')
_SAFE_DELEGATION_TOKEN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
# MCP Apps resources are addressed with the extension's own ``ui://`` scheme
# (``io.modelcontextprotocol/ui``). Pinning the scheme here keeps the resource
# route from being turned into a general-purpose reader for any URI a caller
# can name (``file://``, ``http://`` to an internal host, ...).
_SAFE_MCP_APP_URI = re.compile(r'^ui://[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$')
_MAX_SESSION_RECORDS = 256
_MAX_SESSION_TURNS = 256
_MAX_SESSION_REPLY_BYTES = 64 * 1024
_MAX_GRAPH_QUERY_BYTES = 64 * 1024
_MAX_GRAPH_QUERY_ROWS = 1000
_MAX_LIST_FILES = 5000
_MAX_WORKFLOW_RECORDS = 256
_MAX_WORKFLOW_ID_BYTES = 512
_MAX_DELEGATION_FANOUT = 20
_SAFE_GRAPH_LABEL = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')
_MAX_SYNC_WORKERS = 4
_MAX_SYNC_PENDING = 8


class SyncWorkCapacityError(RuntimeError):
    """The fixed synchronous-work budget is already fully occupied."""


class _BoundedSyncWorkExecutor:
    """Run blocking adapters without an unbounded thread or queue escape hatch.

    A caller timeout does not release capacity for work that Python cannot
    cancel. The slot remains charged until the underlying function exits, so a
    stuck backend can degrade this pool but can never cause thread growth.
    """

    def __init__(self, *, max_workers: int, max_pending: int) -> None:
        if max_workers < 1 or max_pending < max_workers:
            raise ValueError('Invalid synchronous-work capacity')
        self.max_workers = max_workers
        self.max_pending = max_pending
        self._capacity = threading.BoundedSemaphore(max_pending)
        self._executor = _futures.ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix='agent-webui-bounded',
        )
        self._lock = threading.Lock()
        self._in_flight = 0
        self._timed_out: set[_futures.Future[Any]] = set()
        self._timeouts_total = 0
        self._rejections_total = 0

    def submit(self, function: Any, /, *args: Any, **kwargs: Any) -> Any:
        if not self._capacity.acquire(blocking=False):
            with self._lock:
                self._rejections_total += 1
            raise SyncWorkCapacityError('Synchronous-work capacity is exhausted')
        with self._lock:
            self._in_flight += 1
        try:
            request_context = contextvars.copy_context()
            future = self._executor.submit(
                request_context.run,
                function,
                *args,
                **kwargs,
            )
        except BaseException:
            with self._lock:
                self._in_flight -= 1
            self._capacity.release()
            raise
        future.add_done_callback(self._complete)
        return future

    def mark_timed_out(self, future: Any) -> None:
        with self._lock:
            self._timeouts_total += 1
            if future.done():
                return
            self._timed_out.add(future)

    def _complete(self, future: Any) -> None:
        with self._lock:
            self._timed_out.discard(future)
            self._in_flight -= 1
        self._capacity.release()

    def status(self) -> dict[str, int]:
        with self._lock:
            return {
                'max_workers': self.max_workers,
                'max_pending': self.max_pending,
                'in_flight': self._in_flight,
                'timed_out_in_flight': len(self._timed_out),
                'timeouts_total': self._timeouts_total,
                'rejections_total': self._rejections_total,
            }

    def shutdown(self, *, wait: bool = True) -> None:
        self._executor.shutdown(wait=wait, cancel_futures=True)


_SYNC_WORK_EXECUTOR = _BoundedSyncWorkExecutor(
    max_workers=_MAX_SYNC_WORKERS,
    max_pending=_MAX_SYNC_PENDING,
)


def sync_work_status() -> dict[str, int]:
    """Return a non-sensitive snapshot for the security doctor."""

    return _SYNC_WORK_EXECUTOR.status()


def _opaque_reference(namespace: str, value: str) -> str:
    digest = hashlib.blake2b(
        value.encode('utf-8'), key=_REFERENCE_KEY, digest_size=16
    ).hexdigest()
    return f'{namespace}:{digest}'


_PUBLIC_HTTP_ERRORS = {
    400: 'Invalid request',
    401: 'Authentication required',
    403: 'Request forbidden',
    404: 'Resource not found',
    409: 'Request conflict',
    422: 'Request could not be processed',
    500: 'Internal request failed',
    501: 'Capability is not available',
    503: 'Service unavailable',
}


class HTTPException(FastAPIHTTPException):
    """HTTP error boundary that never reflects internal data to API clients."""

    def __init__(
        self,
        status_code: int,
        detail: Any = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        del detail
        super().__init__(
            status_code=status_code,
            detail=_PUBLIC_HTTP_ERRORS.get(status_code, 'Request failed'),
            headers=headers,
        )


def _log_failure(
    operation: str, error: BaseException, *, level: int = logging.ERROR
) -> None:
    """Log only a stable operation label and exception type."""

    safe_operation = re.sub(r'[^a-z0-9_.-]+', '_', operation.lower())[:64]
    logger.log(
        level,
        '%s failed: error_type=%s',
        safe_operation or 'operation',
        type(error).__name__,
    )


def _atomic_private_write(target: Path, payload: bytes) -> None:
    """Atomically write through a pinned directory without following links."""

    dir_fd_capable = all(
        function in os.supports_dir_fd for function in (os.open, os.stat, os.unlink)
    )
    if not dir_fd_capable:
        # Native Windows lacks openat-style directory descriptors. Preserve an
        # atomic, no-follow final-component boundary with the platform APIs.
        if target.is_symlink() or target.parent.is_symlink():
            raise OSError('Refusing symbolic-link write target')
        temp_path = target.parent / f'.{target.name}.{secrets.token_hex(8)}.tmp'
        write_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, 'O_NOFOLLOW'):
            write_flags |= os.O_NOFOLLOW
        fd = -1
        try:
            fd = os.open(temp_path, write_flags, 0o600)
            remaining = memoryview(payload)
            while remaining:
                written = os.write(fd, remaining)
                if written <= 0:
                    raise OSError('Unable to complete private write')
                remaining = remaining[written:]
            os.fsync(fd)
            os.close(fd)
            fd = -1
            if target.is_symlink() or target.parent.is_symlink():
                raise OSError('Write target changed during persistence')
            os.replace(temp_path, target)
            try:
                os.chmod(target, 0o600)
            except OSError:
                pass
            return
        finally:
            if fd >= 0:
                os.close(fd)
            temp_path.unlink(missing_ok=True)

    parent_flags = os.O_RDONLY
    if hasattr(os, 'O_DIRECTORY'):
        parent_flags |= os.O_DIRECTORY
    if hasattr(os, 'O_NOFOLLOW'):
        parent_flags |= os.O_NOFOLLOW
    parent_fd = os.open(target.parent, parent_flags)
    parent_stat = os.fstat(parent_fd)
    if not stat.S_ISDIR(parent_stat.st_mode):
        os.close(parent_fd)
        raise OSError('Write parent is not a directory')

    temp_name = f'.{target.name}.{secrets.token_hex(8)}.tmp'
    write_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, 'O_NOFOLLOW'):
        write_flags |= os.O_NOFOLLOW
    fd = -1
    try:
        try:
            destination_stat = os.stat(
                target.name,
                dir_fd=parent_fd,
                follow_symlinks=False,
            )
        except FileNotFoundError:
            destination_stat = None
        if destination_stat is not None and not stat.S_ISREG(destination_stat.st_mode):
            raise OSError('Refusing non-regular write target')

        fd = os.open(temp_name, write_flags, 0o600, dir_fd=parent_fd)
        remaining = memoryview(payload)
        while remaining:
            written = os.write(fd, remaining)
            if written <= 0:
                raise OSError('Unable to complete private write')
            remaining = remaining[written:]
        os.fsync(fd)
        os.close(fd)
        fd = -1
        os.replace(
            temp_name,
            target.name,
            src_dir_fd=parent_fd,
            dst_dir_fd=parent_fd,
        )
        try:
            os.chmod(
                target.name,
                0o600,
                dir_fd=parent_fd,
                follow_symlinks=False,
            )
        except (NotImplementedError, OSError, ValueError):
            # The temporary file was already created private. Some mounted or
            # non-POSIX filesystems do not implement descriptor-relative chmod.
            pass
        try:
            os.fsync(parent_fd)
        except OSError:
            pass
    finally:
        if fd >= 0:
            os.close(fd)
        try:
            os.unlink(temp_name, dir_fd=parent_fd)
        except OSError:
            pass
        os.close(parent_fd)


def _unlink_regular_file(target: Path) -> None:
    """Unlink one regular file through a pinned, no-follow parent directory."""

    dir_fd_capable = all(
        function in os.supports_dir_fd for function in (os.open, os.stat, os.unlink)
    )
    if not dir_fd_capable:
        if target.is_symlink() or target.parent.is_symlink() or not target.is_file():
            raise OSError('Refusing unsafe delete target')
        target.unlink()
        return

    parent_flags = os.O_RDONLY
    if hasattr(os, 'O_DIRECTORY'):
        parent_flags |= os.O_DIRECTORY
    if hasattr(os, 'O_NOFOLLOW'):
        parent_flags |= os.O_NOFOLLOW
    parent_fd = os.open(target.parent, parent_flags)
    try:
        target_stat = os.stat(
            target.name,
            dir_fd=parent_fd,
            follow_symlinks=False,
        )
        if not stat.S_ISREG(target_stat.st_mode):
            raise OSError('Refusing non-regular delete target')
        os.unlink(target.name, dir_fd=parent_fd)
        try:
            os.fsync(parent_fd)
        except OSError:
            pass
    finally:
        os.close(parent_fd)


def _private_directory(path: Path) -> Path:
    """Create an application-owned directory without accepting a link target."""

    if path.is_symlink():
        raise RuntimeError('Refusing symbolic-link application data directory')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink() or not path.is_dir():
        raise RuntimeError('Application data directory is not a private directory')
    try:
        path.chmod(0o700)
    except OSError:
        # Some non-POSIX filesystems do not expose meaningful Unix modes. Link
        # and confinement checks remain active there.
        pass
    return path.resolve()


def _upload_limit() -> int:
    """Return the AgentConfig upload limit under an absolute safety ceiling."""

    try:
        configured = int(config.max_upload_size)
    except (TypeError, ValueError):
        configured = 10 * 1024 * 1024
    return max(1, min(configured, _MAX_UPLOAD_HARD_LIMIT))


def _git_probe_environment() -> dict[str, str]:
    """Return a secret-free environment for bounded, read-only Git probes."""

    child_env = {
        key: value
        for key in ('PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP')
        if (value := os.environ.get(key))
    }
    child_env.update(
        {
            'GIT_CONFIG_NOSYSTEM': '1',
            'GIT_CONFIG_GLOBAL': os.devnull,
            'GIT_OPTIONAL_LOCKS': '0',
            'GIT_TERMINAL_PROMPT': '0',
            'LC_ALL': 'C',
        }
    )
    return child_env


def _loopback_gateway_url(path: str) -> str:
    """Build the legacy local-gateway URL without permitting an SSRF target."""

    host = str(os.getenv('KG_SERVER_HOST', '127.0.0.1')).strip().lower()
    if host == 'localhost':
        host = '127.0.0.1'
    try:
        address = ip_address(host)
    except ValueError as exc:
        raise ValueError('Knowledge gateway host must be a loopback address') from exc
    if not address.is_loopback:
        raise ValueError('Knowledge gateway host must be a loopback address')
    try:
        port = int(os.getenv('KG_SERVER_PORT', '8100'))
    except ValueError as exc:
        raise ValueError('Knowledge gateway port is invalid') from exc
    if not 1 <= port <= 65535:
        raise ValueError('Knowledge gateway port is invalid')
    if not re.fullmatch(r'/[A-Za-z0-9_./-]{0,1023}', path) or '..' in path:
        raise ValueError('Knowledge gateway path is invalid')
    authority = f'[{address}]' if address.version == 6 else str(address)
    return f'http://{authority}:{port}{path}'


def _is_inline_secret_key(key: str) -> bool:
    """Return whether a config key denotes secret material rather than a ref."""

    normalized = key.lower().replace('-', '_')
    if normalized.endswith(('_ref', '_reference')):
        return False
    return normalized in {
        'password',
        'token',
        'access_token',
        'auth_token',
        'bearer_token',
        'api_token',
        'api_key',
        'secret',
        'secret_key',
        'client_secret',
        'credential',
        'credentials',
        'private_key',
        'authorization',
        'cookie',
        'session_cookie',
    } or normalized.endswith(
        (
            '_password',
            '_token',
            '_access_token',
            '_api_key',
            '_secret',
            '_secret_key',
            '_credential',
            '_credentials',
        )
    )


def _redact_inline_secrets(value: Any, key: str = '') -> Any:
    """Produce a browser-safe config view without reflecting stored secrets."""

    if _is_inline_secret_key(key) and value not in (None, ''):
        return ''
    if isinstance(value, dict):
        return {str(k): _redact_inline_secrets(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact_inline_secrets(item, key) for item in value]
    return value


def _bounded_external_value(
    value: Any,
    *,
    depth: int = 0,
    budget: list[int] | None = None,
) -> Any:
    """Copy an untrusted delegated result under deterministic shape limits."""

    if budget is None:
        budget = [0]
    budget[0] += 1
    if budget[0] > _MAX_EXTERNAL_NODES or depth > _MAX_EXTERNAL_DEPTH:
        raise ValueError('Delegated result exceeds its structural safety bound')

    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError('Delegated result contains a non-finite number')
        return value
    if isinstance(value, str):
        encoded = value.encode('utf-8')
        if len(encoded) > _MAX_EXTERNAL_STRING_BYTES:
            raise ValueError('Delegated result contains an oversized string')
        return value
    if isinstance(value, dict):
        if len(value) > _MAX_EXTERNAL_COLLECTION_ITEMS:
            raise ValueError('Delegated result contains an oversized mapping')
        clean: dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str) or len(key.encode('utf-8')) > 128:
                raise ValueError('Delegated result contains an invalid mapping key')
            clean[key] = _bounded_external_value(
                item,
                depth=depth + 1,
                budget=budget,
            )
        return clean
    if isinstance(value, (list, tuple, set, frozenset)):
        if len(value) > _MAX_EXTERNAL_COLLECTION_ITEMS:
            raise ValueError('Delegated result contains an oversized collection')
        return [
            _bounded_external_value(item, depth=depth + 1, budget=budget)
            for item in value
        ]
    raise ValueError('Delegated result contains an unsupported value')


def _public_external_result(value: Any) -> Any:
    """Bound and privacy-sanitize data returned by an external delegation."""

    bounded = _bounded_external_value(value)
    clean, _privacy_report = sanitize_for_persistence(bounded)
    encoded = json.dumps(
        clean,
        separators=(',', ':'),
        ensure_ascii=False,
        allow_nan=False,
    ).encode('utf-8')
    if len(encoded) > _MAX_EXTERNAL_RESULT_BYTES:
        raise ValueError('Delegated result exceeds its serialized safety bound')
    return clean


_MCP_UI_CSP_DOMAIN_FIELDS = (
    'connectDomains',
    'resourceDomains',
    'frameDomains',
    'baseUriDomains',
)
_MCP_UI_PERMISSION_FIELDS = ('camera', 'microphone', 'geolocation', 'clipboardWrite')


def _public_tool_ui_meta(meta: Any) -> dict[str, Any] | None:
    """Shape-validate one tool's declared MCP Apps UI binding (``meta['ui']``).

    CONCEPT:AU-ECO.mcp.webui-governed-mcp-delegation

    BUG-071: ``_meta.ui.resourceUri`` is a ``tools/list``-time field
    (``agent_utilities.mcp.shared_multiplexer._live_tools_for_server`` /
    ``server.webui_mcp_delegation._list_mcp_server_tools`` already forward the
    raw ``meta`` dict this reads), naming which ``ui://`` resource a WebUI
    app-launcher should fetch and render via ``McpAppHost``/``McpAppFrame``
    (``src/lib/mcp-apps/``). ``resourceUri`` is the ONLY required field -- a
    tool without a usable, non-empty string ``resourceUri`` carries no app
    binding and this returns ``None``, which is what makes a tool
    non-launchable rather than rendered with a fabricated/empty frame.

    Everything else here is untrusted server metadata (the docstrings in
    ``mcp-apps/policy.ts`` and ``McpAppFrame.tsx`` already treat it that way
    on the client): only the known ``McpUiMeta`` fields are passed through,
    each individually type-checked, so a malformed or hostile ``meta['ui']``
    cannot smuggle arbitrary extra keys into the API response.
    """
    if not isinstance(meta, dict):
        return None
    ui = meta.get('ui')
    if not isinstance(ui, dict):
        return None
    resource_uri = ui.get('resourceUri')
    if not isinstance(resource_uri, str) or not resource_uri:
        return None

    result: dict[str, Any] = {'resourceUri': resource_uri}

    visibility = ui.get('visibility')
    if isinstance(visibility, list):
        allowed_visibility = [v for v in visibility if v in ('app', 'model')]
        if allowed_visibility:
            result['visibility'] = allowed_visibility

    csp = ui.get('csp')
    if isinstance(csp, dict):
        clean_csp = {
            field: [domain for domain in csp[field] if isinstance(domain, str)]
            for field in _MCP_UI_CSP_DOMAIN_FIELDS
            if isinstance(csp.get(field), list)
        }
        if clean_csp:
            result['csp'] = clean_csp

    permissions = ui.get('permissions')
    if isinstance(permissions, dict):
        clean_permissions: dict[str, dict[str, str]] = {
            field: {}
            for field in _MCP_UI_PERMISSION_FIELDS
            if isinstance(permissions.get(field), dict)
        }
        if clean_permissions:
            result['permissions'] = clean_permissions

    domain = ui.get('domain')
    if isinstance(domain, str) and domain:
        result['domain'] = domain

    prefers_border = ui.get('prefersBorder')
    if isinstance(prefers_border, bool):
        result['prefersBorder'] = prefers_border

    return {'ui': result}


def _validate_delegation_call(
    server_name: str, tool_name: str, arguments: dict[str, Any]
) -> dict[str, Any]:
    """Validate a governed MCP delegation without interpreting launch config."""

    if not _SAFE_DELEGATION_TOKEN.fullmatch(server_name):
        raise ValueError('Invalid delegated server name')
    if not _SAFE_DELEGATION_TOKEN.fullmatch(tool_name):
        raise ValueError('Invalid delegated tool name')
    if not isinstance(arguments, dict):
        raise ValueError('Delegated arguments must be an object')
    try:
        bounded_arguments = _bounded_external_value(arguments)
        rendered = json.dumps(
            bounded_arguments,
            separators=(',', ':'),
            ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise ValueError('Delegated arguments must be JSON-compatible') from exc
    if len(rendered.encode('utf-8')) > _MAX_EXTERNAL_ARGUMENT_BYTES:
        raise ValueError('Delegated arguments exceed their safety bound')
    if not isinstance(bounded_arguments, dict):  # defensive type narrowing
        raise ValueError('Delegated arguments must be an object')
    return bounded_arguments


def _validate_runtime_id(value: Any) -> str:
    """Validate a session/goal identifier before storage or proxy routing."""

    if not isinstance(value, str) or not _SAFE_DELEGATION_TOKEN.fullmatch(value):
        raise HTTPException(status_code=400, detail='Invalid runtime identifier')
    return value


def _bounded_identifier_list(value: Any, *, required: bool = False) -> list[str]:
    """Validate a small identifier collection before materializing graph work."""

    if value is None:
        identifiers: list[Any] = []
    elif isinstance(value, list):
        identifiers = value
    else:
        raise HTTPException(status_code=400, detail='Identifiers must be a list')
    if len(identifiers) > _MAX_EXTERNAL_COLLECTION_ITEMS:
        raise HTTPException(status_code=400, detail='Identifier set exceeds its limit')
    clean: list[str] = []
    for item in identifiers:
        if not isinstance(item, str) or not item or len(item.encode('utf-8')) > 512:
            raise HTTPException(status_code=400, detail='Invalid identifier')
        clean.append(item)
    if required and not clean:
        raise HTTPException(status_code=422, detail='Identifiers are required')
    return clean


def _validate_read_only_cypher(query: Any) -> str:
    """Accept one bounded Cypher read while denying mutation/procedure clauses."""

    if not isinstance(query, str) or not query.strip():
        raise HTTPException(status_code=400, detail='Cypher query is required')
    if len(query.encode('utf-8')) > _MAX_GRAPH_QUERY_BYTES:
        raise HTTPException(status_code=400, detail='Cypher query exceeds its limit')

    scrubbed = re.sub(
        r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|`(?:``|[^`])*`|"
        r'//[^\n]*(?:\n|$)|/\*.*?\*/',
        ' ',
        query,
        flags=re.DOTALL,
    )
    namespace_surface = re.sub(
        r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|"
        r'//[^\n]*(?:\n|$)|/\*.*?\*/',
        ' ',
        query,
        flags=re.DOTALL,
    )
    mutation = re.search(
        r'\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|FOREACH|CALL|'
        r'INSERT|UPDATE|ALTER|GRANT|DENY|REVOKE|TERMINATE|LOAD\s+CSV)\b',
        scrubbed,
        flags=re.IGNORECASE,
    )
    unsafe_namespace = re.search(
        r'\b(?:APOC|DB|GDS|ALGO|GENAI)\s*\.',
        scrubbed,
        flags=re.IGNORECASE,
    ) or re.search(
        r'`?\s*(?:APOC|DB|GDS|ALGO|GENAI)\s*`?\s*\.',
        namespace_surface,
        flags=re.IGNORECASE,
    )
    supported_start = re.match(
        r'^\s*(?:EXPLAIN\s+)?'
        r'(?:OPTIONAL\s+MATCH|MATCH|WITH|UNWIND|RETURN)\b',
        scrubbed,
        flags=re.IGNORECASE,
    )
    if mutation or unsafe_namespace or not supported_start or ';' in scrubbed:
        raise HTTPException(status_code=400, detail='Only one read query is allowed')
    return query


def _bounded_query_params(value: Any) -> dict[str, Any]:
    """Validate Cypher parameters as one small JSON-compatible object."""

    if not isinstance(value, dict):
        raise HTTPException(status_code=400, detail='Query params must be an object')
    try:
        bounded = _bounded_external_value(value)
        encoded = json.dumps(
            bounded,
            separators=(',', ':'),
            ensure_ascii=False,
            allow_nan=False,
        ).encode('utf-8')
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail='Query params are invalid') from exc
    if len(encoded) > _MAX_EXTERNAL_ARGUMENT_BYTES or not isinstance(bounded, dict):
        raise HTTPException(status_code=400, detail='Query params exceed their limit')
    return bounded


def _workspace_ingestion_source(source: Any) -> str:
    """Confine direct KB ingestion to a relative path in the workspace.

    Network sources need a separately governed fetch connector so redirects,
    DNS changes, address ranges, response size, and credentials can be checked
    at the transport boundary. This WebUI route deliberately does not fetch
    caller-selected URLs itself.
    """

    if not isinstance(source, str) or not source.strip():
        raise HTTPException(status_code=400, detail='KB source is required')
    candidate = source.strip()
    if len(candidate.encode('utf-8')) > 2048:
        raise HTTPException(status_code=400, detail='KB source exceeds its limit')
    parsed = urlsplit(candidate)
    if parsed.scheme or parsed.netloc:
        raise HTTPException(
            status_code=400,
            detail='Remote KB sources require a governed ingestion connector',
        )
    target = resolve_workspace_file(candidate)
    if target.exists() and target.is_dir():
        entries_seen = 0
        for root, dirs, files in os.walk(target, followlinks=False):
            for name in [*dirs, *files]:
                entries_seen += 1
                if entries_seen > _MAX_LIST_FILES:
                    raise HTTPException(
                        status_code=400,
                        detail='KB source tree exceeds its file limit',
                    )
                if (Path(root) / name).is_symlink():
                    raise HTTPException(
                        status_code=400,
                        detail='KB source tree cannot contain symbolic links',
                    )
    elif target.exists() and not target.is_file():
        raise HTTPException(status_code=400, detail='KB source type is unsupported')
    return str(target)


# Application-owned state never falls back to the process current directory.
_WEBUI_DATA_DIR = _private_directory(data_dir() / 'webui')
DEFAULT_AGENT_DIR = _private_directory(_WEBUI_DATA_DIR / 'workspace')

# Global registry for operational helpers (set during agent initialization)
workspace_helpers: dict[str, Any] = {}


def get_helper(name: str, fallback: Any = None) -> Any:
    """Safely retrieve a registered workspace helper by name.

    Args:
        name: The identifier of the helper function.
        fallback: Value to return if the helper is not registered.

    Returns:
        The matched helper function or the fallback value.
    """
    helper = workspace_helpers.get(name)
    if not helper:
        logger.warning('Requested workspace helper was not found')
        return fallback
    return helper


async def _invoke_governed_helper(
    helper: Any,
    /,
    *args: Any,
    deadline: float,
    **kwargs: Any,
) -> Any:
    """Invoke an adapter under one end-to-end deadline and fixed thread budget."""

    import asyncio

    bounded_timeout = max(0.1, min(float(deadline), 120.0))
    loop = asyncio.get_running_loop()
    started = loop.time()

    try:
        if inspect.iscoroutinefunction(helper):
            return await asyncio.wait_for(
                helper(*args, **kwargs), timeout=bounded_timeout
            )

        try:
            concurrent_future = _SYNC_WORK_EXECUTOR.submit(helper, *args, **kwargs)
        except SyncWorkCapacityError as exc:
            raise HTTPException(
                status_code=503,
                detail='Synchronous backend capacity is exhausted',
            ) from exc

        try:
            result = await asyncio.wait_for(
                asyncio.wrap_future(concurrent_future),
                timeout=bounded_timeout,
            )
        except TimeoutError as exc:
            _SYNC_WORK_EXECUTOR.mark_timed_out(concurrent_future)
            # This succeeds only while work is still queued. Running Python
            # calls cannot be killed safely and retain their charged slot.
            concurrent_future.cancel()
            raise HTTPException(
                status_code=503,
                detail='Synchronous backend deadline exceeded',
            ) from exc

        if not inspect.isawaitable(result):
            return result
        remaining = bounded_timeout - (loop.time() - started)
        if remaining <= 0:
            if hasattr(result, 'close'):
                result.close()
            raise HTTPException(
                status_code=503,
                detail='Backend deadline exceeded',
            )
        return await asyncio.wait_for(result, timeout=remaining)
    except HTTPException:
        raise
    except TimeoutError as exc:
        raise HTTPException(
            status_code=503, detail='Backend deadline exceeded'
        ) from exc


def set_workspace_helpers(helpers: dict[str, Any]) -> None:
    """Register the operational helpers for the current workspace context.

    Args:
        helpers: Mapping of helper names to implementation functions.
    """
    global workspace_helpers
    logger.info('Setting workspace helpers: helper_count=%d', len(helpers))
    workspace_helpers = helpers


def get_engine() -> IntelligenceGraphEngine:
    """Helper to get the active graph engine, lazy-initializing it if necessary.

    CONCEPT:AU-ECO.ui.one-engine-authority — the ONLY sanctioned way to acquire
    the process-wide engine is ``IntelligenceGraphEngine.get_or_create()``: it
    returns the already-active singleton when one exists, and otherwise
    constructs the ONE operational authority (the epistemic-graph engine plus
    any configured mirrors — ``create_backend()`` called with no
    ``backend_type``). This entrypoint must never build its own backend/engine
    directly. It previously did: a hand-rolled
    ``create_backend(backend_type='ladybug', ...)`` fallback here constructed a
    disconnected, empty, ephemeral local LadybugDB whenever this route raced
    ahead of the MCP server's own bootstrap and won the process-wide singleton
    first — "Workflows shows nothing" even though the real ~37k-node graph was
    reachable the whole time (D-WD-7). Routing through ``get_or_create()``
    makes that divergence structurally impossible: whichever caller
    constructs first, it is always the same operational authority.
    """
    import sys

    get_active_fn = IntelligenceGraphEngine.get_active
    is_mocked = (
        hasattr(get_active_fn, 'called')
        or hasattr(get_active_fn, 'return_value')
        or 'mock' in type(get_active_fn).__name__.lower()
    )
    # 'unittest' alone is NOT a reliable test-mode signal: several production
    # dependencies (e.g. pydantic_graph) import `unittest` for non-test reasons,
    # so checking for it made every real deployment look like it was under
    # test, skipping auto-initialization entirely (D-WUI, 2026-08-06). Only
    # 'pytest' in sys.modules is trustworthy — production never imports pytest.
    is_testing = 'pytest' in sys.modules

    engine = get_active_fn()
    if not engine:
        if is_mocked or is_testing:
            logger.info(
                'IntelligenceGraphEngine.get_active is mocked or in testing env and returned None. Skipping auto-initialization.'
            )
            raise HTTPException(
                status_code=501, detail='Intelligence Graph Engine not initialized'
            )

        try:
            from agent_utilities.core.paths import ensure_dirs

            # Kept from the pre-merge fallback: create_backend() (reached below
            # inside the engine constructor) writes into the standard data
            # dirs, and this path can win the process-wide singleton race
            # before kg_server's own bootstrap has run them.
            ensure_dirs()

            # No factory and no backend_type. get_or_create() falls through to
            # IntelligenceGraphEngine(**kwargs), whose constructor resolves the
            # OPERATIONAL AUTHORITY backend via a bare create_backend() -- the
            # same resolution the canonical KG REST surface and kg_server's own
            # bootstrap use. An earlier version passed backend_type='ladybug'
            # here, which silently stood up a second, disconnected, always-empty
            # local store instead of the real graph: the actual cause of
            # "Workflows/graph-nodes show nothing" (D-WD-7). Passing
            # defer_background_start as a kwarg (rather than burying it in a
            # hand-rolled factory) keeps the D-03 deferred-start invariant on
            # the one seam every sanctioned caller shares.
            engine = IntelligenceGraphEngine.get_or_create(defer_background_start=True)
            logger.info(
                'Successfully acquired the process-wide IntelligenceGraphEngine '
                '(operational authority) via get_or_create().'
            )
        except Exception as e:
            _log_failure('api_extension', e)
            raise HTTPException(
                status_code=501,
                detail='Intelligence Graph Engine not initialized',
            )
    return engine


async def _get_engine_bounded() -> IntelligenceGraphEngine:
    """Resolve or initialize the active engine under the shared sync budget."""

    return await _invoke_governed_helper(get_engine, deadline=10.0)


@router.get('/info')
async def get_info() -> dict[str, str]:
    """Retrieve agent identity and user personalization metadata.

    CONCEPT:WU-KG.compute.identity-management — Identity Management

    Returns:
        A dictionary containing agent name, description, and emojis.
    """
    try:
        engine = await _get_engine_bounded()
    except HTTPException as exc:
        if exc.status_code == 503:
            raise
        engine = None
    except Exception:
        engine = None
    if engine:
        identity = await _invoke_governed_helper(
            engine.get_agent_identity, deadline=5.0
        )
        return {
            'name': identity.get('name', 'Agent'),
            'description': identity.get('description', 'AI Agent'),
            'emoji': identity.get('emoji', workspace_helpers.get('agent_emoji', '🤖')),
            'user_emoji': '👤',
        }

    # Legacy fallback for edge cases during startup
    name = workspace_helpers.get('agent_name', 'Agent')
    description = workspace_helpers.get('agent_description', 'AI Agent')
    emoji = workspace_helpers.get('agent_emoji', '🤖')

    return {
        'name': name,
        'description': description,
        'emoji': emoji,
        'user_emoji': '👤',
    }


def get_workspace_dir() -> Path:
    """Resolve the explicit workspace or an application-owned XDG fallback."""

    get_path_helper = get_helper('get_workspace_path')
    if get_path_helper:
        try:
            return Path(get_path_helper('')).resolve()
        except Exception:
            pass
    try:
        from agent_utilities.core.workspace_config import load_workspace_yml

        data = load_workspace_yml()
        if data and 'path' in data:
            return Path(data['path']).expanduser().resolve()
    except Exception:
        pass
    configured = config.workspace_path or os.getenv('AGENT_WORKSPACE')
    if configured:
        return Path(configured).expanduser().resolve()
    return DEFAULT_AGENT_DIR


def get_agent_packages_dir() -> Path:
    """Resolve the ecosystem package root without a machine-specific path."""

    configured = os.getenv('AGENT_PACKAGES_ROOT')
    if configured:
        return Path(configured).expanduser().resolve()
    # ``parents[3]`` only exists when this module is imported from a full
    # ecosystem checkout (``agent-packages/agent-webui/agent/agent_webui/``).
    # A deployed install has a shallower path — the editable NFS mount at
    # ``/webui-src/agent_webui/`` has just two — and indexing past the root
    # raised ``IndexError``, turning every route that resolves a skills or
    # prompts path into a 500. Fall through to the configured workspace
    # instead, which is what a deployment is expected to supply.
    parents = Path(__file__).resolve().parents
    if len(parents) > 3 and parents[3].name == 'agent-packages':
        return parents[3]
    return get_workspace_dir() / 'agent-packages'


def get_agent_utilities_dir() -> Path:
    """Resolve the installed agent-utilities package directory."""

    import agent_utilities

    return Path(agent_utilities.__file__).resolve().parent


def get_prompts_dir() -> Path:
    configured = os.getenv('AGENT_PROMPTS_ROOT')
    if configured:
        return Path(configured).expanduser().resolve()
    return get_agent_utilities_dir() / 'prompts'


def _read_bounded_bytes(path: Path, *, limit: int) -> bytes:
    """Read a regular file through a no-follow descriptor under a hard cap."""

    safe_limit = max(1, min(int(limit), _MAX_UPLOAD_HARD_LIMIT))
    flags = os.O_RDONLY
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise ValueError('Configuration source must be a regular file') from exc
    try:
        file_stat = os.fstat(fd)
        if not stat.S_ISREG(file_stat.st_mode):
            raise ValueError('Source must be a regular file')
        if file_stat.st_size > safe_limit:
            raise ValueError('Source exceeds its safety bound')
        payload = bytearray()
        while chunk := os.read(fd, 64 * 1024):
            payload.extend(chunk)
            if len(payload) > safe_limit:
                raise ValueError('Source exceeds its safety bound')
    finally:
        os.close(fd)
    return bytes(payload)


def _read_bounded_text(path: Path, *, limit: int) -> str:
    """Read strict UTF-8 text through the bounded regular-file helper."""

    return _read_bounded_bytes(path, limit=limit).decode('utf-8')


def _read_bounded_json(path: Path) -> Any:
    """Read a small JSON document without following a file link."""

    return json.loads(_read_bounded_bytes(path, limit=_MAX_EXTERNAL_RESULT_BYTES))


def _mcp_inventory_path() -> Path | None:
    """Locate a registry for read-only inventory; never interpret commands."""

    candidates = (
        config_dir() / 'mcp_config.json',
        config_dir() / 'config.json',
        get_workspace_dir() / 'mcp_config.json',
    )
    return next(
        (path for path in candidates if path.is_file() and not path.is_symlink()), None
    )


def resolve_prompt_file(name: str) -> Path:
    """Resolve one prompt name inside the configured prompt directory."""

    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', name):
        raise HTTPException(status_code=400, detail='Invalid prompt name')
    base = get_prompts_dir().resolve()
    target = (base / f'{name}.json').resolve()
    try:
        target.relative_to(base)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Invalid prompt name') from exc
    return target


def resolve_workspace_file(
    relative_path: str, *, allow_workspace_root: bool = False
) -> Path:
    """Resolve an untrusted relative path inside the configured workspace.

    ``Path.resolve`` closes both ``..`` traversal and symlink escapes. Absolute
    paths and the workspace root itself are rejected before a caller performs
    any read or write.
    """
    if not relative_path or '\x00' in relative_path:
        raise HTTPException(status_code=400, detail='Invalid workspace path')
    if '\\' in relative_path:
        raise HTTPException(status_code=400, detail='Path traversal not allowed')
    supplied = Path(relative_path)
    if supplied.is_absolute() or '..' in supplied.parts:
        raise HTTPException(status_code=400, detail='Path traversal not allowed')

    base = get_workspace_dir().resolve()
    lexical_target = base / supplied
    cursor = base
    for part in supplied.parts:
        cursor /= part
        if cursor.is_symlink():
            raise HTTPException(
                status_code=400, detail='Symbolic links are not allowed'
            )
    target = lexical_target.resolve()
    try:
        target.relative_to(base)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail='Path traversal not allowed'
        ) from exc
    if target == base and not allow_workspace_root:
        raise HTTPException(status_code=400, detail='Workspace root is not a file')
    return target


def _confine_stored_workspace_path(value: Any) -> Path:
    """Revalidate a persisted KB source path against the current workspace."""

    if not isinstance(value, str) or not value.strip() or '\x00' in value:
        raise HTTPException(status_code=400, detail='Invalid stored KB source')
    base = get_workspace_dir().resolve()
    supplied = Path(value).expanduser()
    target = (supplied if supplied.is_absolute() else base / supplied).resolve()
    try:
        relative = target.relative_to(base)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Stored KB source escaped') from exc
    return resolve_workspace_file(relative.as_posix())


@router.get('/files')
async def list_files(limit: int = 1000) -> list[dict[str, Any]]:
    """List workspace files with metadata recursively for all repositories loaded in agent-utilities.

    Excludes .git, node_modules, .venv, venv, and other build/binary directories.
    """
    import itertools
    import os

    limit = max(1, min(limit, _MAX_LIST_FILES))

    # 1. Check if a detailed listing helper is registered
    detailed_helper = get_helper('list_workspace_files_detailed')
    if detailed_helper:
        safe_records = []
        for record in itertools.islice(detailed_helper() or (), limit):
            if not isinstance(record, dict):
                continue
            safe_record = {
                key: value
                for key, value in record.items()
                if key not in {'absolute_path', 'local_path', 'workspace_path'}
            }
            name = safe_record.get('name')
            if isinstance(name, str) and Path(name).is_absolute():
                safe_record['name'] = Path(name).name
            safe_records.append(safe_record)
        return safe_records

    results: list[dict[str, Any]] = []
    allowed_suffixes = (
        '.md',
        '.json',
        '.py',
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.html',
        '.css',
        '.yml',
        '.yaml',
        '.toml',
        '.sh',
        '.txt',
        '.cfg',
        '.ini',
        '.env',
        '.lock',
    )
    excluded_dirs = (
        '.git',
        'node_modules',
        '.venv',
        'venv',
        '__pycache__',
        'dist',
        'build',
        '.specify',
    )

    # 2. Check if get_workspace_path helper is registered (typically in tests or active agent sessions)
    get_path_helper = get_helper('get_workspace_path')
    if get_path_helper:
        try:
            base_path = Path(get_path_helper(''))
            if base_path.exists() and base_path.is_dir():
                for root, dirs, files in os.walk(base_path):
                    # Prune excluded directories in-place
                    dirs[:] = [d for d in dirs if d not in excluded_dirs]

                    # Add directories
                    for d in dirs:
                        if len(results) >= limit:
                            break
                        dir_path = Path(root) / d
                        try:
                            st = dir_path.stat()
                            results.append(
                                {
                                    'name': str(dir_path.relative_to(base_path)),
                                    'size': 0,
                                    'modified_iso': datetime.fromtimestamp(
                                        st.st_mtime, tz=timezone.utc
                                    ).isoformat(),
                                    'is_dir': True,
                                }
                            )
                        except Exception:
                            continue

                    # Add files
                    for file in files:
                        if len(results) >= limit:
                            break
                        path = Path(root) / file
                        if path.suffix.lower() in allowed_suffixes:
                            try:
                                st = path.stat()
                                results.append(
                                    {
                                        'name': str(path.relative_to(base_path)),
                                        'size': st.st_size,
                                        'modified_iso': datetime.fromtimestamp(
                                            st.st_mtime, tz=timezone.utc
                                        ).isoformat(),
                                        'is_dir': False,
                                    }
                                )
                            except Exception:
                                continue
                    if len(results) >= limit:
                        break
                return results
        except Exception as e:
            _log_failure('scan_workspace_files', e)

    # 3. Main path: Scan loaded workspace repositories from config
    try:
        from agent_utilities.core.workspace_config import (
            _extract_repositories,
            load_workspace_yml,
        )

        data = load_workspace_yml()
        if data:
            base_path = Path(data.get('path') or get_workspace_dir())
            repos = _extract_repositories(data, base_path)
            for repo_path, _ in repos:
                if len(results) >= limit:
                    break
                if repo_path.exists() and repo_path.is_dir():
                    for root, dirs, files in os.walk(repo_path):
                        dirs[:] = [d for d in dirs if d not in excluded_dirs]

                        # Add directories
                        # Be forgiving for tests that mock the registry
                        # but real runs should have valid types:
                        for d in dirs:
                            if len(results) >= limit:
                                break
                            dir_path = Path(root) / d
                            try:
                                st = dir_path.stat()
                                results.append(
                                    {
                                        'name': str(dir_path.relative_to(base_path)),
                                        'size': 0,
                                        'modified_iso': datetime.fromtimestamp(
                                            st.st_mtime, tz=timezone.utc
                                        ).isoformat(),
                                        'is_dir': True,
                                    }
                                )
                            except Exception:
                                continue

                        # Add files
                        for file in files:
                            if len(results) >= limit:
                                break
                            path = Path(root) / file
                            if path.suffix.lower() in allowed_suffixes:
                                try:
                                    st = path.stat()
                                    results.append(
                                        {
                                            'name': str(path.relative_to(base_path)),
                                            'size': st.st_size,
                                            'modified_iso': datetime.fromtimestamp(
                                                st.st_mtime, tz=timezone.utc
                                            ).isoformat(),
                                            'is_dir': False,
                                        }
                                    )
                                except Exception:
                                    continue
                        if len(results) >= limit:
                            break
    except Exception as e:
        _log_failure('api_extension', e)
    # 4. Fallback scan if no files found
    if not results:
        base = get_workspace_dir()
        try:
            for root, dirs, files in os.walk(base):
                dirs[:] = [d for d in dirs if d not in excluded_dirs]

                for d in dirs:
                    if len(results) >= limit:
                        break
                    dir_path = Path(root) / d
                    try:
                        st = dir_path.stat()
                        results.append(
                            {
                                'name': str(dir_path.relative_to(base)),
                                'size': 0,
                                'modified_iso': datetime.fromtimestamp(
                                    st.st_mtime, tz=timezone.utc
                                ).isoformat(),
                                'is_dir': True,
                            }
                        )
                    except Exception:
                        continue

                for file in files:
                    if len(results) >= limit:
                        break
                    path = Path(root) / file
                    if path.suffix.lower() in allowed_suffixes:
                        try:
                            st = path.stat()
                            results.append(
                                {
                                    'name': str(path.relative_to(base)),
                                    'size': st.st_size,
                                    'modified_iso': datetime.fromtimestamp(
                                        st.st_mtime, tz=timezone.utc
                                    ).isoformat(),
                                    'is_dir': False,
                                }
                            )
                        except Exception:
                            continue
                if len(results) >= limit:
                    break
        except Exception as e:
            _log_failure('api_extension', e)
    return results


@router.get('/files/{filename:path}')
async def get_file(filename: str) -> dict[str, str]:
    """Retrieve the content of a specific workspace file."""
    target = resolve_workspace_file(filename)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail='File not found')
    try:
        content = _read_bounded_text(target, limit=_upload_limit())
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail='File cannot be read safely'
        ) from exc
    return {'content': content}


@router.put('/files/{filename:path}')
async def update_file(filename: str, data: dict[str, str]) -> dict[str, str]:
    """Create or update a file in the workspace."""
    if not filename.endswith('.md') and not filename.endswith('.json'):
        raise HTTPException(status_code=400, detail='Only .md and .json files allowed')
    content = data.get('content', '')
    if not isinstance(content, str):
        raise HTTPException(status_code=400, detail='File content must be text')
    payload = content.encode('utf-8')
    if len(payload) > _upload_limit():
        raise HTTPException(status_code=400, detail='File exceeds the write limit')
    _safe_content, privacy_report = sanitize_for_persistence(content)
    if privacy_report.changed:
        raise HTTPException(
            status_code=400,
            detail='File content violates the persistence privacy boundary',
        )
    target = resolve_workspace_file(filename)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Re-resolve after creating parents to detect a concurrent link insertion.
    if resolve_workspace_file(filename) != target:
        raise HTTPException(status_code=409, detail='Workspace path changed')
    _atomic_private_write(target, payload)
    return {'status': 'success'}


@router.delete('/files/{filename:path}')
async def delete_workspace_file(filename: str) -> dict[str, Any]:
    """Delete a workspace file."""
    get_path_helper = get_helper('get_workspace_path')
    if not get_path_helper:
        return {'status': 'error', 'detail': 'workspace helper is not configured'}

    try:
        target = resolve_workspace_file(filename)
    except HTTPException:
        return {'status': 'error', 'detail': 'path outside workspace'}
    if not target.exists():
        return {'status': 'error', 'detail': 'not found'}
    if target.is_dir():
        return {'status': 'error', 'detail': 'refusing to delete directory'}
    try:
        _unlink_regular_file(target)
    except OSError as e:
        _log_failure('delete_workspace_file', e)
        return {'status': 'error', 'detail': type(e).__name__}
    return {'status': 'ok', 'deleted': filename}


from pydantic import BaseModel as _EditorContextBaseModel
from pydantic import Field as _editor_context_field


class EditorSelectionContext(_EditorContextBaseModel):
    """Selection range published by the `agent-webui-bridge` extension (R4)."""

    startLine: int = _editor_context_field(ge=0)
    startCharacter: int = _editor_context_field(ge=0)
    endLine: int = _editor_context_field(ge=0)
    endCharacter: int = _editor_context_field(ge=0)
    isEmpty: bool = True
    text: str = _editor_context_field(default='', max_length=4096)


class EditorCursorContext(_EditorContextBaseModel):
    line: int = _editor_context_field(ge=0)
    character: int = _editor_context_field(ge=0)


class EditorDiagnosticContext(_EditorContextBaseModel):
    severity: str = _editor_context_field(max_length=32)
    message: str = _editor_context_field(max_length=1024)
    line: int = _editor_context_field(ge=0)
    character: int = _editor_context_field(ge=0)
    source: str | None = _editor_context_field(default=None, max_length=128)


class EditorContextPayload(_EditorContextBaseModel):
    """Published by the `agent-webui-bridge` openvscode-server extension (R4):
    the workbench's active file, selection, cursor, dirty state, and
    diagnostics, so the shell -- and the chat agent -- always has context for
    what the operator is looking at in the embedded Workspace IDE.
    """

    workspaceRoot: str | None = _editor_context_field(default=None, max_length=4096)
    filePath: str | None = _editor_context_field(default=None, max_length=4096)
    languageId: str | None = _editor_context_field(default=None, max_length=64)
    dirty: bool = False
    cursor: EditorCursorContext | None = None
    selection: EditorSelectionContext | None = None
    diagnostics: list[EditorDiagnosticContext] = _editor_context_field(
        default_factory=list, max_length=25
    )
    capturedAt: str | None = _editor_context_field(default=None, max_length=64)


# Single-replica, latest-wins store (D-W3OV-2: multi-replica fan-out, e.g. a
# per-session store or a broadcast, is deferred -- this webui deployment runs
# replicas=1 today, see plans/au-eg-program/waves/lane-w3-openvscode-2026-08-06.md).
_latest_editor_context: dict[str, Any] | None = None


@router.post('/editor-context')
async def publish_editor_context(payload: EditorContextPayload) -> dict[str, str]:
    """Receive editor context from the `agent-webui-bridge` openvscode-server
    extension. Requires `kg:write` like every other `/api/enhanced/*` mutation
    (`WebUIAuthorizationMiddleware`) -- the extension authenticates with a
    client_credentials bearer token, see the code-server repo's
    `k8s/manifests.yaml` (`envFrom: agent-webui-oidc`).
    """

    global _latest_editor_context
    _latest_editor_context = payload.model_dump()
    return {'status': 'ok'}


@router.get('/editor-context')
async def get_editor_context() -> dict[str, Any]:
    """Return the most recently published editor context for the Workspace
    IDE view to feed into `usePageContextPublisher`, or an empty shape if the
    bridge extension has not published one yet (no active editor, or the
    embedded workbench has not loaded)."""

    return _latest_editor_context or {
        'workspaceRoot': None,
        'filePath': None,
        'capturedAt': None,
    }


@router.get('/config-files')
async def list_config_files() -> list[str]:
    """List configuration files."""
    base = get_workspace_dir()
    all_files = []
    try:
        for f in base.glob('*.md'):
            all_files.append(f.name)
        if (base / 'mcp_config.json').exists():
            all_files.append('mcp_config.json')
    except Exception:
        pass
    if not all_files:
        all_files = ['instructions.md', 'mcp_config.json']
    return sorted(all_files)


@router.get('/agents')
async def list_agents() -> list[dict[str, Any]]:
    """List all agents registered in the Knowledge Graph."""
    try:
        engine = await _get_engine_bounded()
        query = f'MATCH (a:Agent) RETURN a LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}'
        result = await _invoke_governed_helper(
            engine.backend.execute, query, deadline=10.0
        )
        agents = []
        for row in result:
            agent_data = row.get('a', {})
            if isinstance(agent_data, dict):
                agents.append(agent_data)
        return agents
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        return []


async def get_toggle_state(engine: Any, item_type: str, item_id: str) -> bool:
    """Check if an item is enabled or disabled in the KG.

    Degrades to the same "enabled by default" answer on a query FAILURE as on
    a genuinely-absent preference, rather than raising. Found live (D-W6-7):
    every caller of this helper is a per-item read inside a LIST endpoint
    (``list_all_tools``'s mcp/builtin/skill/skill-graph/workflow loops) --
    this previously raised ``HTTPException(500)`` on ANY backend error
    (confirmed live: a real, non-cluster-admin authenticated principal's
    ``query_cypher`` call here hits ``CypherEngineError``/
    ``PlacementAuthorityError`` -- ``graph_compute``'s per-call
    ``resolve_placement`` still requires ``admin:cluster-read``, a DIFFERENT
    call site than the one D-WD-1 already fixed at identity-mint time), which
    killed the ENTIRE ``/api/enhanced/tools`` response for every item behind
    it -- not a partial degrade, a hard 500 the frontend renders as an empty
    view + a toast, for any caller who is not a cluster admin. A single
    toggle-preference lookup failing must not take down the whole list.

    FIX LANE Priority 4 (BUG: a written-disabled preference read back as
    "enabled", proven end to end): this query used to ``RETURN p.value as
    value`` with NO id projection at all. Row-governance
    (``secured_reads.row_node_ids()``) REQUIRES every row to carry an
    ``id``/``node_id``/``n.id``/``_id`` column or it raises ``PermissionError:
    Graph result contains a row without a governed node id`` -- which the
    broad ``except Exception`` below silently swallowed into this function's
    OWN fail-open ``return True``, indistinguishable from "no preference
    set". ``p.id AS id`` is added to the RETURN so every row is governable.
    """
    if not engine:
        return True
    pref_id = f'preference:toggle:{item_type}:{item_id}'
    try:
        res = await _invoke_governed_helper(
            engine.query_cypher,
            'MATCH (p:Preference) WHERE p.id = $pref_id '
            'RETURN p.id AS id, p.value AS value',
            {'pref_id': pref_id},
            deadline=5.0,
        )
        if res and len(res) > 0:
            return res[0]['value'] == 'enabled'
    except HTTPException as e:
        if e.status_code == 503:
            raise
        _log_failure('query_toggle_state', e)
    except Exception as e:
        _log_failure('query_toggle_state', e)
    return True  # Enabled by default: preference absent, or unreadable.


def _log_toggle_batch_failure(item_type: str, error: BaseException) -> None:
    """Log a toggle-batch scan failure, including the TRUE underlying cause
    when it is safely available, without violating ``_log_failure``'s
    established privacy contract (query text/params are never logged).

    Live pod observation: every ``_batch_toggle_states`` sub-call (5/5, every
    request) raised ``CypherEngineError`` -- a deliberately opaque wrapper
    (``epistemic_graph_backend.CypherEngineError``) that hides query text and
    parameters but DOES carry a non-sensitive ``error_type`` attribute (the
    underlying native-engine exception's class name, e.g. ``KeyError`` /
    ``PlacementAuthorityError``). ``_log_failure`` alone only ever logs
    ``CypherEngineError`` itself (the wrapper type), which was not enough to
    tell an operator anything about the real failure. Logging that inner
    ``error_type`` too -- still no query text, no params, no stack trace --
    is the same redaction discipline, more diagnostic.
    """
    inner_type = getattr(error, 'error_type', None)
    if isinstance(inner_type, str) and inner_type:
        safe_item_type = re.sub(r'[^a-z0-9_.-]+', '_', item_type.lower())[:64]
        logger.error(
            'toggle_batch_%s failed: error_type=%s inner_error_type=%s',
            safe_item_type or 'item',
            type(error).__name__,
            inner_type,
        )
    else:
        _log_failure(f'toggle_batch_{item_type}', error)


async def _batch_toggle_states(
    engine: Any, item_type: str, item_ids: list[str]
) -> tuple[dict[str, bool], bool]:
    """Bulk-read the toggle preference of every one of ``item_ids`` (all of
    ``item_type``) in ONE round trip.

    Root cause of the ``/api/enhanced/tools`` hang that never returned
    (measured live: >120s, timed out): ``list_all_tools`` called
    ``get_toggle_state`` once PER ROW -- up to ~256 MCP servers, ~256
    built-in tools, and ~256 skill-catalog rows, each a SEPARATE, serially
    ``await``-ed ``engine.query_cypher`` round trip through
    ``_invoke_governed_helper``'s bounded synchronous executor (a shared,
    process-wide, fixed 4-worker/8-pending-slot budget --
    ``_SYNC_WORK_EXECUTOR`` -- so this was never just slow for this one
    request; a large enough listing could starve every other concurrent
    request's synchronous KG work too). Up to ~768 sequential round trips,
    each individually bounded but never batched or parallelized, is what
    made the response practically never return.

    FIX LANE Priority 4: a single ``WHERE p.id IN $ids`` scan, built from the
    EXACT ids the caller is about to render, replaces both the old N
    sequential round trips AND an intermediate ``STARTS WITH $prefix`` scan
    that does not parse on the deployed engine at all (``STARTS WITH`` with
    a bound-parameter operand fails 5/5, live) -- every toggle read appeared
    to work while being non-functional fleet-wide. ``IN $ids`` is also
    index-servable and O(items rendered) rather than O(every preference in
    the graph), same fail-open semantics as ``get_toggle_state``: a query
    failure degrades every item of this ``item_type`` to "enabled by
    default" (the caller's ``.get(id, True)`` lookup) rather than raising --
    a toggle-preference outage must never take the whole listing down, same
    reasoning ``get_toggle_state`` already documents for the single-item
    case.

    Returns ``(states, ok)``. ``ok`` is ``False`` when the underlying scan
    failed -- ``states`` is still the (fail-open, all-``True``-by-default)
    mapping callers can safely use, but ``ok=False`` lets the caller surface
    that the toggle read itself is broken rather than silently reporting
    "everything enabled" as if it were a real, verified answer. A previous
    version re-raised a 503 ``_invoke_governed_helper`` timeout/capacity
    ``HTTPException`` here, which took the ENTIRE ``/api/enhanced/tools``
    response down over a toggle-preference outage alone; that is now
    degraded the same as any other failure.
    """
    if not engine or not item_ids:
        return {}, True
    prefix = f'preference:toggle:{item_type}:'
    pref_to_item = {f'{prefix}{item_id}': item_id for item_id in item_ids}
    try:
        res = await _invoke_governed_helper(
            engine.query_cypher,
            'MATCH (p:Preference) WHERE p.id IN $ids '
            'RETURN p.id AS id, p.value AS value',
            {'ids': list(pref_to_item.keys())},
            deadline=10.0,
        )
    except HTTPException as e:
        _log_toggle_batch_failure(item_type, e)
        return {}, False
    except Exception as e:
        _log_toggle_batch_failure(item_type, e)
        return {}, False
    states: dict[str, bool] = {}
    for row in res or []:
        if not isinstance(row, dict):
            continue
        row_id = row.get('id')
        if not isinstance(row_id, str):
            continue
        item_id = pref_to_item.get(row_id)
        if item_id is None:
            continue
        states[item_id] = row.get('value') == 'enabled'
    return states, True


async def _batch_toggle_states_many(
    engine: Any, item_types_and_ids: dict[str, list[str]]
) -> dict[str, tuple[dict[str, bool], bool]]:
    """Run one ``_batch_toggle_states`` scan per ``item_type`` CONCURRENTLY.

    ``list_all_tools`` previously issued up to 5 of these scans -- one per
    item_type (``mcp_server``, ``builtin_tool``, ``skill``,
    ``skill_workflow``, ``skill_graph``) -- SEQUENTIALLY, each individually
    deadline-bound but never run in parallel: measured live, this was the
    critical-path long pole (``/api/enhanced/tools`` at 11-17s, later 503 at
    35-41s) for data the dashboard tile never even reads (it only sums array
    lengths). ``asyncio.gather`` cuts that to the slowest single scan instead
    of the sum of all of them -- an immediate ~5x reduction on this path with
    no change to what any consumer that DOES read ``enabled`` sees.

    Args:
        item_types_and_ids: ``{item_type: [exact ids about to be rendered]}``
            (FIX LANE Priority 4) -- each scan is now ``WHERE p.id IN $ids``
            against exactly this list, not a graph-wide prefix scan.
    """
    if not item_types_and_ids:
        return {}
    item_types = list(item_types_and_ids.keys())
    results = await asyncio.gather(
        *(
            _batch_toggle_states(engine, item_type, item_types_and_ids[item_type])
            for item_type in item_types
        )
    )
    return dict(zip(item_types, results, strict=True))


async def set_toggle_state(
    engine: Any, item_type: str, item_id: str, enabled: bool
) -> None:
    """Set the toggle state of an item in the KG."""
    if not engine:
        return
    pref_id = f'preference:toggle:{item_type}:{item_id}'
    try:
        from datetime import datetime

        await _invoke_governed_helper(
            engine.add_node,
            pref_id,
            'Preference',
            {
                'category': 'toggle_state',
                'value': 'enabled' if enabled else 'disabled',
                'timestamp': datetime.now().isoformat(),
                'is_permanent': True,
            },
            deadline=10.0,
        )
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('save_toggle_state', e)
        raise HTTPException(status_code=500, detail='Unable to persist toggle') from e


_FLEET_CATALOG_DEADLINE_SECONDS = 10.0

# Overall wall-clock budget across the WHOLE multi-kind walk performed by
# `_read_fleet_catalog`, on top of (never instead of) each individual page's
# own `_FLEET_CATALOG_DEADLINE_SECONDS` bound. `skills` alone can need ~9
# paginated round trips to drain (841 rows at `_MAX_LIMIT`=100), each
# independently deadline-bound at up to 10s -- with no total cap, a caller
# asking for all four kinds could in the worst case wait minutes before ever
# seeing a response, which is what actually produced the observed 35-41s
# 503s. Once this budget is exhausted, any kind not yet FULLY read (including
# one that has drained some pages but not finished) is reported as failed
# (`None`) rather than raising -- kinds already finished keep their real
# data (see the per-kind independence contract below).
_FLEET_CATALOG_TOTAL_DEADLINE_SECONDS = 30.0


# `_authorized_page` clamps every request to `_MAX_LIMIT` (100) internally
# (`fetch = min(min(limit, _MAX_LIMIT) + 1, ...)`), so asking for more per page
# does NOT get more -- it just makes `len(page) < requested` true on the first
# page and silently truncates the read. Page at exactly the cap and stop on the
# CALLER's ceiling instead: every consumer of this read renders through
# `_public_external_result`, which caps at `_MAX_EXTERNAL_COLLECTION_ITEMS`, so
# draining all ~2500 rows only to discard all but 256 was ~26 sequential engine
# round trips for nothing (measured: 21s for /api/enhanced/tools).


async def _read_fleet_catalog(
    *kinds: str,
) -> dict[str, list[dict[str, Any]] | None] | None:
    """Read one or more fleet-catalog collections through the SAME
    tenant/principal-scoped, fail-closed authority and shape-validation path
    ``agent_utilities.gateway.registry_api`` uses for its own
    ``GET /api/registry/{kind}`` routes
    (CONCEPT:AU-KG.ingest.fleet-catalog-relational-tables). The SQL tables are
    the single source of truth for the MCP/skill fleet catalog -- this never
    re-derives tenant scoping, redaction, or shape validation; it reuses
    registry_api's own private read path in-process (this app already mounts
    ``register_graph_routes``, which mounts ``register_registry_routes`` on
    this SAME app -- see ``server.py``'s ``create_agent_web_app``).

    Every SQL round trip is bounded by ``_invoke_governed_helper`` (the same
    deadline pattern every other engine call in this file uses -- previously
    ``list_all_tools`` awaited the shared multiplexer with NO deadline,
    hanging 45s before an infra timeout returned a 503).

    Each requested ``kind`` degrades INDEPENDENTLY (the root-cause fix for
    the observed live pattern where a ``servers`` hiccup discarded an
    otherwise-healthy ``skills`` catalog before it was even attempted --
    ``skills`` was read third of four, so any earlier failure meant it was
    never reached at all). A kind that fails is reported as ``None`` in the
    returned mapping; a kind that succeeds -- including with zero rows -- is
    a real (possibly empty) ``list``. Callers must check each kind's value
    individually rather than assuming "some data" means "all requested kinds
    loaded".

    Returns ``None`` (the WHOLE mapping, not a per-kind value) only when the
    catalog cannot be reached AT ALL -- authority denied or the catalog
    engine itself is unavailable, before any kind-specific read is even
    attempted. This preserves the original fail-closed contract for that
    total-failure case (every existing caller's "no catalog at all" handling
    is unchanged); the new per-kind ``None`` granularity is additive, for
    the partial-failure case that previously discarded healthy kinds.
    """
    from agent_utilities.gateway.registry_api import (
        _KIND_SPECS,
        _MAX_LIMIT,
        CatalogUnavailable,
        _authorized_page,
        _get_catalog_engine,
        _require_catalog_authority,
        _row_key,
        _validate_item,
    )

    try:
        tenant, principal, grant_digests = _require_catalog_authority(
            require_discovery_binding=True
        )
        engine = _get_catalog_engine()
    except PermissionError as exc:
        _log_failure('fleet_catalog_authority', exc)
        return None
    except Exception as exc:
        _log_failure('fleet_catalog_authority', exc)
        return None

    loop = asyncio.get_running_loop()
    started = loop.time()

    result: dict[str, list[dict[str, Any]] | None] = dict.fromkeys(kinds)
    for kind in kinds:
        remaining_total = _FLEET_CATALOG_TOTAL_DEADLINE_SECONDS - (
            loop.time() - started
        )
        if remaining_total <= 0:
            _log_failure(f'fleet_catalog_{kind}_total_budget', TimeoutError(kind))
            continue  # Leaves result[kind] at its `None` default.
        spec = _KIND_SPECS[kind]
        try:
            # registry_api pushes LIMIT/keyset/filter/authz into SQL, so a
            # page transfers only its own rows. Walk the keyset until the
            # catalog is exhausted rather than asking for the whole table.
            rows: list[dict[str, Any]] = []
            after: tuple[str, str] | None = None
            while True:
                remaining_total = _FLEET_CATALOG_TOTAL_DEADLINE_SECONDS - (
                    loop.time() - started
                )
                if remaining_total <= 0:
                    raise TimeoutError('overall fleet catalog deadline exceeded')
                page = await _invoke_governed_helper(
                    _authorized_page,
                    kind,
                    tenant=tenant,
                    principal=principal,
                    grant_digests=grant_digests,
                    query='',
                    after=after,
                    limit=_MAX_LIMIT,
                    engine=engine,
                    deadline=min(_FLEET_CATALOG_DEADLINE_SECONDS, remaining_total),
                )
                if not page:
                    break
                rows.extend(page)
                if (
                    len(page) < _MAX_LIMIT
                    or len(rows) >= _MAX_EXTERNAL_COLLECTION_ITEMS
                ):
                    break
                after = _row_key(spec, page[-1])
            result[kind] = [
                _validate_item(kind, spec.model, row).model_dump() for row in rows
            ]
        except CatalogUnavailable as exc:
            _log_failure(f'fleet_catalog_{kind}', exc)
            # Independent degradation: this kind failed, but earlier/later
            # kinds must not be discarded because of it (result[kind] stays
            # `None`, the rest of the loop continues).
        except HTTPException as exc:
            _log_failure(f'fleet_catalog_{kind}', exc)
            # A per-call 503 (capacity exhausted / deadline exceeded from
            # `_invoke_governed_helper`) used to propagate and kill the
            # WHOLE multi-kind read. Degrade just this one kind instead.
        except Exception as exc:
            _log_failure(f'fleet_catalog_{kind}', exc)
    return result


# ---------------------------------------------------------------------------
# Fleet-catalog TTL + single-flight cache (FIX LANE Priority 3)
#
# Measured: `/api/enhanced/tools` (73 KiB) at 20.89s; `/api/registry/skills
# ?limit=1` (1,234 bytes) at 9.84s; 5 identical back-to-back calls at
# 9.51/10.45/3.36/11.67/2.96s -- no warm-up, no caching, cost fixed PER CALL
# rather than proportional to row volume. A realistic dashboard burst
# (concurrency 4) timed out past 60s and `/api/enhanced/skills`, `/graph/
# nodes`, `/graph/stats` all returned 503 under it. `_read_fleet_catalog` is
# populated by the HOURLY `fleet-tool-schema-sync` job (see its own
# docstring), so a read that is up to `_FLEET_CATALOG_CACHE_TTL_SECONDS`
# stale is indistinguishable from a live one to any real caller.
#
# Cached PER KIND (not the whole multi-kind response), so one kind's hit
# stands alone while another is mid-refresh. Single-flight per kind
# (`asyncio.Lock`) is mandatory, not an optimization: without it a cache-
# expiry moment under a multi-panel dashboard burst still stampedes the
# bounded sync-work pool into the same 503s caching was meant to fix.
#
# Staleness disclosure (documented, deliberate trade-off -- see this lane's
# report): a cache HIT's `mcp_status`/`skill_status`/`toggle_status` error
# fields reflect the moment the cache was FILLED, not the request moment. A
# real outage that recovers mid-TTL can still render as a stale error for up
# to the TTL. Chosen because the underlying data is itself only hourly-fresh
# -- "fast" strictly dominates "always-current" here.
_FLEET_CATALOG_CACHE_TTL_SECONDS = 60.0


class _FleetCatalogCacheEntry:
    __slots__ = ('rows', 'fetched_at')

    def __init__(self, rows: list[dict[str, Any]], fetched_at: float) -> None:
        self.rows = rows
        self.fetched_at = fetched_at


_fleet_catalog_cache: dict[str, _FleetCatalogCacheEntry] = {}
_fleet_catalog_cache_guard = threading.Lock()
_fleet_catalog_kind_locks: dict[str, asyncio.Lock] = {}
_fleet_catalog_kind_locks_guard = threading.Lock()
# The last `mcp_status.last_synced_at` ANY request has observed (computed by
# `list_all_tools` from the `discoveries` kind's own rows -- a signal this
# cache gets for free, never an extra engine call). The hourly sync job
# advancing this timestamp means fresher data landed than what is cached;
# `note_fleet_catalog_sync_time` uses it to expire the cache EARLY instead of
# making the next request wait out the rest of the TTL for data the sync job
# has already superseded.
_fleet_catalog_last_synced_seen: str | None = None


def _fleet_catalog_kind_lock(kind: str) -> asyncio.Lock:
    """Return the single-flight lock for `kind`, creating it on first use."""
    with _fleet_catalog_kind_locks_guard:
        lock = _fleet_catalog_kind_locks.get(kind)
        if lock is None:
            lock = asyncio.Lock()
            _fleet_catalog_kind_locks[kind] = lock
        return lock


def reset_fleet_catalog_cache() -> None:
    """Clear every cached kind and the single-flight lock table.

    Test-only reset hook (also useful for an operator forcing an immediate
    resync) -- production code never needs to call this; the TTL and the
    `note_fleet_catalog_sync_time` early-expiry path are the only intended
    invalidation.
    """
    global _fleet_catalog_last_synced_seen
    with _fleet_catalog_cache_guard:
        _fleet_catalog_cache.clear()
        _fleet_catalog_last_synced_seen = None
    with _fleet_catalog_kind_locks_guard:
        _fleet_catalog_kind_locks.clear()


def note_fleet_catalog_sync_time(last_synced_at: str | None) -> None:
    """Record an observed `mcp_status.last_synced_at` and expire the cache
    early if it advanced past what the cache was last filled with.

    Called by `list_all_tools` with the value it already computes from
    `discoveries` rows -- no additional engine round trip. A no-op the first
    time (nothing to compare against yet) or when the value is unknown/
    unchanged.
    """
    global _fleet_catalog_last_synced_seen
    if not last_synced_at:
        return
    with _fleet_catalog_cache_guard:
        if (
            _fleet_catalog_last_synced_seen is not None
            and last_synced_at > _fleet_catalog_last_synced_seen
        ):
            # The sync job landed a newer catalog than what is cached --
            # drop every cached kind so the NEXT request refetches instead of
            # serving a now-superseded snapshot for the rest of the TTL.
            _fleet_catalog_cache.clear()
        _fleet_catalog_last_synced_seen = last_synced_at


def _fleet_catalog_cache_hit(kind: str) -> tuple[bool, list[dict[str, Any]] | None]:
    with _fleet_catalog_cache_guard:
        entry = _fleet_catalog_cache.get(kind)
        if entry is None:
            return False, None
        if time.monotonic() - entry.fetched_at >= _FLEET_CATALOG_CACHE_TTL_SECONDS:
            return False, None
        return True, entry.rows


def _fleet_catalog_cache_store(kind: str, rows: list[dict[str, Any]]) -> None:
    with _fleet_catalog_cache_guard:
        _fleet_catalog_cache[kind] = _FleetCatalogCacheEntry(rows, time.monotonic())


async def _refresh_fleet_catalog_kind(kind: str) -> list[dict[str, Any]] | None:
    """Single-flight refresh of one kind: at most one concurrent engine read
    per kind, regardless of how many requests arrive while it is in flight.
    """
    lock = _fleet_catalog_kind_lock(kind)
    async with lock:
        # Re-check inside the lock: a request that waited for it may find
        # another caller already refreshed this kind while it waited --
        # collapsing N concurrent misses into ONE fetch, not N.
        hit, cached_rows = _fleet_catalog_cache_hit(kind)
        if hit:
            return cached_rows
        result = await _read_fleet_catalog(kind)
        rows = (result or {}).get(kind)
        if rows is not None:
            _fleet_catalog_cache_store(kind, rows)
        return rows


async def _read_fleet_catalog_cached(
    *kinds: str,
) -> dict[str, list[dict[str, Any]] | None]:
    """TTL + single-flight cached counterpart of `_read_fleet_catalog`.

    Every kind independently: a cache hit costs ZERO engine calls; a miss (or
    an expired kind) refreshes under that kind's own `asyncio.Lock`
    (`_refresh_fleet_catalog_kind`). Unlike `_read_fleet_catalog`, this never
    returns `None` for the whole mapping -- a total-authority-denial failure
    (the one case `_read_fleet_catalog` reports that way) surfaces here as
    every requested kind independently resolving to `None`, which is the
    SAME per-kind shape every partial failure already uses, so callers
    (`list_all_tools`) do not need a separate "whole thing failed" branch.
    """
    result: dict[str, list[dict[str, Any]] | None] = {}
    to_refresh: list[str] = []
    for kind in kinds:
        hit, rows = _fleet_catalog_cache_hit(kind)
        if hit:
            result[kind] = rows
        else:
            to_refresh.append(kind)
    if to_refresh:
        refreshed = await asyncio.gather(
            *(_refresh_fleet_catalog_kind(kind) for kind in to_refresh)
        )
        for kind, rows in zip(to_refresh, refreshed, strict=True):
            result[kind] = rows
    return result


@router.get('/tools')
async def list_all_tools() -> dict[str, Any]:
    """Retrieve all MCP servers/tools, built-in tools, skills, skill graphs,
    workflows, and MCP prompts -- categorized.

    MCP servers, skills, and prompts are read from the SQL fleet catalog
    (CONCEPT:AU-KG.ingest.fleet-catalog-relational-tables) -- the cheap,
    single-source-of-truth read path -- via ``_read_fleet_catalog``, never
    from a live multiplexer probe, a filesystem ``SKILL.md`` scan, or a
    separate KG classification cross-reference. The catalog is populated by
    the hourly ``fleet-tool-schema-sync`` job, so "not yet synced" is a real,
    expected state and is reported explicitly via ``mcp_status`` -- never
    silently indistinguishable from "genuinely empty".

    ``servers``, ``discoveries``, ``skills``, and ``prompts`` degrade
    INDEPENDENTLY (``_read_fleet_catalog``'s per-kind contract): a failure
    reading one never discards an already-healthy read of another. This
    route ALWAYS returns 200 -- never a hard failure for one degraded
    section -- but every section's failure is reported explicitly and
    UNAMBIGUOUSLY: ``mcp_status.error`` for MCP servers (unchanged) and the
    new ``skill_status.error`` for skills, both at the SAME top level and
    the SAME shape, rather than skills' only signal being the
    three-levels-deep ``skill_classification.kg_reachable`` boolean.
    """
    try:
        engine = await _get_engine_bounded()
    except HTTPException as exc:
        if exc.status_code == 503:
            raise
        engine = None
    except Exception:
        engine = None

    # FIX LANE Priority 3: TTL + single-flight cached, not a fresh engine
    # read on every call -- see `_read_fleet_catalog_cached`'s docstring.
    # Unlike `_read_fleet_catalog`, this never returns `None` for the whole
    # mapping (a total-authority-denial failure already surfaces as every
    # requested kind independently `None`), so the per-kind logic below is
    # the ONLY code path with no separate whole-catalog branch to keep in
    # sync.
    catalog = await _read_fleet_catalog_cached(
        'servers', 'discoveries', 'skills', 'prompts'
    )

    server_rows = catalog.get('servers')
    discovery_rows = catalog.get('discoveries')
    skill_rows = catalog.get('skills')
    prompt_rows = catalog.get('prompts')

    # 0. Toggle-preference reads (mcp_server/builtin_tool/skill/
    # skill_workflow/skill_graph) are independent of each other and of the
    # catalog read above -- gather whichever ones this request actually
    # needs CONCURRENTLY (`asyncio.gather` via `_batch_toggle_states_many`)
    # instead of the previous up-to-5 SEQUENTIAL round trips, which measured
    # live as the critical-path long pole for data the dashboard tile never
    # even reads.
    #
    # FIX LANE Priority 4: `_batch_toggle_states` now takes the EXACT item
    # ids being rendered (`WHERE p.id IN $ids`, not a `STARTS WITH $prefix`
    # scan -- the deployed engine does not parse `STARTS WITH` with a
    # bound-parameter operand at all, failing 5/5). That means the id lists
    # below must be computed BEFORE the toggle batch runs, from the same
    # catalog rows the entry-building loops further down classify again --
    # a small, deliberate duplication of the classification logic (skill
    # `skill_type` bucketing, server-name validation) rather than a larger
    # restructuring that would move toggle reads after entry-building.
    tools_dir = get_agent_utilities_dir() / 'tools'
    builtin_dir_present = tools_dir.exists() and tools_dir.is_dir()

    mcp_server_ids = [
        name
        for row in (server_rows or [])[:_MAX_EXTERNAL_COLLECTION_ITEMS]
        if isinstance(name := row.get('name'), str)
        and name
        and _SAFE_DELEGATION_TOKEN.fullmatch(name)
    ]
    builtin_tool_ids = (
        [f.stem for f in tools_dir.glob('*.py') if not f.name.startswith('_')][
            :_MAX_EXTERNAL_COLLECTION_ITEMS
        ]
        if builtin_dir_present
        else []
    )
    # Same three-way `skill_type` bucketing the entry-building loop (below)
    # uses -- an unclassified row (the `else` branch there) still reads the
    # `skill` toggle namespace, so its id belongs in `skill_ids` too.
    skill_ids: list[str] = []
    skill_workflow_ids: list[str] = []
    skill_graph_ids: list[str] = []
    for row in (skill_rows or [])[:_MAX_EXTERNAL_COLLECTION_ITEMS]:
        skill_id = row.get('id')
        if not isinstance(skill_id, str) or not skill_id:
            continue
        skill_type = str(row.get('skill_type') or '').strip().lower()
        if skill_type == 'workflow':
            skill_workflow_ids.append(skill_id)
        elif skill_type == 'graph':
            skill_graph_ids.append(skill_id)
        else:
            skill_ids.append(skill_id)

    item_types_and_ids: dict[str, list[str]] = {}
    if server_rows is not None:
        item_types_and_ids['mcp_server'] = mcp_server_ids
    if builtin_dir_present:
        item_types_and_ids['builtin_tool'] = builtin_tool_ids
    if skill_rows:
        item_types_and_ids['skill'] = skill_ids
        item_types_and_ids['skill_workflow'] = skill_workflow_ids
        item_types_and_ids['skill_graph'] = skill_graph_ids
    toggle_states = await _batch_toggle_states_many(engine, item_types_and_ids)
    mcp_server_toggles, _mcp_server_toggles_ok = toggle_states.get(
        'mcp_server', ({}, True)
    )
    builtin_toggles, _builtin_toggles_ok = toggle_states.get('builtin_tool', ({}, True))
    skill_toggles, _skill_toggles_ok = toggle_states.get('skill', ({}, True))
    skill_workflow_toggles, _ = toggle_states.get('skill_workflow', ({}, True))
    skill_graph_toggles, _ = toggle_states.get('skill_graph', ({}, True))
    toggles_ok = all(ok for _states, ok in toggle_states.values())
    # FIX LANE Priority 4 (item 3): `ok` is already threaded per item_type,
    # but every per-ITEM fallback in the entry-building loops below is a
    # bare `.get(id, True)` -- during a real toggle-read outage that still
    # renders every item "enabled", indistinguishable from a genuine
    # preference. `degraded_item_types` is additive (never removes/retypes
    # a field) and names exactly which item_type(s)' enabled/disabled state
    # below is not to be trusted, so a caller can render a degraded state
    # per item instead of a silently-wrong "enabled". Frontend rendering of
    # this is out of scope for this file -- see this lane's report.
    degraded_item_types = sorted(
        item_type for item_type, (_states, ok) in toggle_states.items() if not ok
    )
    toggle_status = {
        'source': 'sql_catalog',
        'error': (
            None
            if toggles_ok
            else (
                'One or more toggle-preference reads failed; enable/disable '
                'state below defaults to "enabled" and may not reflect the '
                'real persisted preference.'
            )
        ),
        'degraded_item_types': degraded_item_types,
    }

    # 1. MCP servers -- desired registration (`servers`) joined with the most
    # recent observed probe (`discoveries`, append-only: keep the row with the
    # latest `observed_at` per server). A missing/failed catalog read is
    # reported via `mcp_status`, never silently downgraded to an
    # indistinguishable empty list (fail-closed).
    mcp_tools: list[dict[str, Any]] = []
    last_synced_at: str | None = None
    if server_rows is None:
        mcp_status = {
            'source': 'unavailable',
            'error': 'The MCP server catalog could not be read.',
            'last_synced_at': None,
        }
    else:
        latest_discovery: dict[str, dict[str, Any]] = {}
        for row in discovery_rows or []:
            server_id = str(row.get('server_id') or '')
            observed_at = str(row.get('observed_at') or '')
            if last_synced_at is None or observed_at > last_synced_at:
                last_synced_at = observed_at
            existing = latest_discovery.get(server_id)
            if existing is None or observed_at > str(existing.get('observed_at') or ''):
                latest_discovery[server_id] = row

        for row in server_rows[:_MAX_EXTERNAL_COLLECTION_ITEMS]:
            name = row.get('name')
            if (
                not isinstance(name, str)
                or not name
                or not _SAFE_DELEGATION_TOKEN.fullmatch(name)
            ):
                continue
            server_id = str(row.get('id') or '')
            enabled = mcp_server_toggles.get(name, True)
            discovery = latest_discovery.get(server_id)
            reachable = discovery.get('reachable') if discovery else None
            tool_count = int(discovery.get('tool_count') or 0) if discovery else 0
            last_error = discovery.get('last_error') if discovery else None
            if not enabled:
                status = 'disabled'
            elif discovery is not None and reachable is False:
                status = 'unavailable'
            else:
                status = 'active'
            mcp_tools.append(
                {
                    'name': name,
                    'type': 'MCP Server',
                    'status': status,
                    'enabled': enabled,
                    'tool_count': tool_count,
                    'available': reachable,
                    'error': last_error or None,
                }
            )

        if server_rows:
            mcp_error = None
        elif last_synced_at:
            mcp_error = (
                'The MCP fleet catalog has been synced (last observed '
                f'{last_synced_at}) but currently has no servers registered.'
            )
        else:
            mcp_error = (
                'The MCP fleet catalog has no servers and no recorded sync -- '
                'the hourly fleet-tool-schema-sync job may not have run yet.'
            )
        if discovery_rows is None and mcp_error is None:
            # Servers loaded fine, but the discovery/health probe kind
            # independently failed -- servers are listed (best-effort) but
            # their `available`/`tool_count`/`error` fields are unknown
            # rather than falsely healthy. Report it rather than staying
            # silent about the degraded (not missing) health data.
            mcp_error = (
                'MCP server discovery/health data could not be read; server '
                'status below reflects registration only, not live '
                'reachability.'
            )
        mcp_status = {
            'source': 'sql_catalog',
            'error': mcp_error,
            'last_synced_at': last_synced_at,
        }

    # Free early-invalidation signal for the fleet-catalog cache (FIX LANE
    # Priority 3): `last_synced_at` is already computed above from
    # `discoveries` rows -- no extra engine call. A no-op when `None`/
    # unchanged; when the hourly sync job has advanced it, the cache is
    # cleared so the NEXT request refetches instead of serving a
    # now-superseded snapshot for the rest of the TTL.
    note_fleet_catalog_sync_time(last_synced_at)

    # MCP prompts -- the fleet catalog's own `mcp_prompts` table, never
    # surfaced anywhere in this app before; already tenant-scoped and
    # redacted by `_read_fleet_catalog` (registry_api's `_validate_item`).
    # Degrades independently of every other kind: a `prompts` failure never
    # discards `servers`/`discoveries`/`skills`, and vice versa.
    mcp_prompts: list[dict[str, Any]] = (
        []
        if prompt_rows is None
        else list(prompt_rows)[:_MAX_EXTERNAL_COLLECTION_ITEMS]
    )
    mcp_prompts_status = {
        'source': 'sql_catalog' if prompt_rows is not None else 'unavailable',
        'error': (
            None
            if prompt_rows is not None
            else 'The MCP prompts catalog could not be read.'
        ),
    }

    # 2. Built-in Agent Tools -- bundled Python tool modules shipped with this
    # app; unrelated to the MCP fleet catalog.
    builtin_tools = []
    if builtin_dir_present:
        for index, f in enumerate(tools_dir.glob('*.py')):
            if index >= _MAX_EXTERNAL_COLLECTION_ITEMS:
                break
            if f.name.startswith('_'):
                continue
            builtin_enabled = builtin_toggles.get(f.stem, True)
            builtin_tools.append(
                {
                    'name': f.stem,
                    'type': 'Built-in Tool',
                    'file_path': f'builtin://{f.stem}',
                    'status': 'enabled' if builtin_enabled else 'disabled',
                    'enabled': builtin_enabled,
                }
            )

    # 3. Skills / Skill Graphs / Skill Workflows -- classified directly by the
    # SQL catalog's own `skill_type` column (assigned by the sync job's
    # `classify_skill_type`, which never leaves it blank), never by
    # filesystem path or a separate KG cross-reference query. Degrades
    # independently of `servers`/`discoveries`/`prompts` -- a servers hiccup
    # (the live-observed root cause of "No MCP servers registered" AND "The
    # MCP fleet catalog could not be read" AND an empty skills list, all
    # from ONE `servers` failure) no longer discards an otherwise-healthy
    # skills read, since `skill_rows` is this kind's OWN result, not a
    # shared all-or-nothing `catalog`.
    #
    # An unclassified skill (skill_type outside the recognized set) is still
    # a skill -- it is NOT a fourth bucket. It lands in `skills` alongside
    # every other agent skill, distinguished only by `kg_classified: False`
    # (the UI renders that as an "Unclassified" flag -- see
    # `RunnabilityBadge` in SkillsView.tsx) so it is discoverable as needing
    # attention rather than hidden in a separate, easy-to-miss group.
    skills: list[dict[str, Any]] = []
    skill_graphs: list[dict[str, Any]] = []
    skill_workflows: list[dict[str, Any]] = []
    unclassified_count = 0
    skill_status = {
        'source': 'sql_catalog' if skill_rows is not None else 'unavailable',
        'error': (
            None if skill_rows is not None else 'The skills catalog could not be read.'
        ),
    }
    for row in (skill_rows or [])[:_MAX_EXTERNAL_COLLECTION_ITEMS]:
        skill_id = row.get('id')
        if not isinstance(skill_id, str) or not skill_id:
            continue
        skill_type = str(row.get('skill_type') or '').strip().lower()
        classification = row.get('classification') or skill_type.title()
        entry: dict[str, Any] = {
            'id': skill_id,
            'name': row.get('name', ''),
            'description': row.get('description', ''),
            'type': classification,
        }
        if skill_type in ('skill', 'mcp_skill'):
            entry['runnable'] = True
            entry['resource_type'] = 'AGENT_SKILL'
            entry['kg_classified'] = True
            entry['enabled'] = skill_toggles.get(skill_id, True)
            skills.append(entry)
        elif skill_type == 'workflow':
            entry['file_path'] = row.get('uri') or ''
            entry['runnable'] = False
            entry['resource_type'] = 'WORKFLOW_DEFINITION'
            entry['kg_classified'] = True
            entry['enabled'] = skill_workflow_toggles.get(skill_id, True)
            skill_workflows.append(entry)
        elif skill_type == 'graph':
            entry['file_path'] = row.get('uri') or ''
            entry['enabled'] = skill_graph_toggles.get(skill_id, True)
            skill_graphs.append(entry)
        else:
            entry['runnable'] = False
            entry['resource_type'] = None
            entry['kg_classified'] = False
            entry['enabled'] = skill_toggles.get(skill_id, True)
            skills.append(entry)
            unclassified_count += 1

    result = {
        'mcp_tools': mcp_tools,
        'mcp_status': mcp_status,
        'mcp_prompts': mcp_prompts,
        # Additive (not in the frontend's `toolsDataSchema` yet -- zod
        # ignores unrecognized keys by default, so this is safe to ship
        # ahead of a frontend change): the `mcp_prompts` analogue of
        # `mcp_status`, since `prompts` is now an independently-degradable
        # kind with no other visible failure signal.
        'mcp_prompts_status': mcp_prompts_status,
        'builtin_tools': builtin_tools,
        'skills': sorted(skills, key=lambda x: x.get('name', '').lower()),
        'skill_graphs': sorted(skill_graphs, key=lambda x: x.get('name', '').lower()),
        'skill_workflows': sorted(
            skill_workflows, key=lambda x: x.get('name', '').lower()
        ),
        # `skill_unclassified` is deliberately ABSENT from this response: an
        # unclassified skill is still a skill and is returned inside `skills`
        # with `kg_classified: False` (see the comment above the loop), not
        # in a separate fourth bucket the UI had to render as its own group.
        # Defect B fix: skills previously had NO signal of their own for "the
        # skills catalog read failed" other than the deeply-nested
        # `skill_classification.kg_reachable` boolean -- unlike `mcp_tools`,
        # which has always had `mcp_status.error` at the top level. This is
        # the SAME shape as `mcp_status`, at the SAME top level, so a caller
        # can check `data.skill_status.error` exactly like
        # `data.mcp_status.error` without reading anything nested.
        'skill_status': skill_status,
        # Same signal, additive, for the batched toggle-preference reads
        # (Defect C): `CypherEngineError` on 100% of observed live calls
        # made every enable/disable toggle look like it worked while being
        # non-functional fleet-wide, with no visible indication anywhere in
        # the response. `toggle_status.error` is non-null whenever ANY of
        # this request's toggle-preference batches failed.
        'toggle_status': toggle_status,
        # Live catalog classification summary, computed fresh on every call.
        'skill_classification': {
            'source': 'sql_catalog',
            # Per-kind now (was `catalog is not None`, the whole 4-kind
            # catalog): a `servers`/`discoveries`/`prompts` failure no
            # longer reports skills as unreachable when the `skills` kind
            # itself loaded fine, and vice versa.
            'kg_reachable': skill_rows is not None,
            'filesystem_skill_md_count': len(skill_rows or []),
            'kg_agent_skill_count': len(skills),
            'kg_workflow_definition_count': len(skill_workflows),
            'runnable_count': len(skills) - unclassified_count,
            'describe_only_count': len(skill_workflows),
            'unclassified_count': unclassified_count,
        },
    }
    bounded = _public_external_result(result)
    return bounded if isinstance(bounded, dict) else {}


@router.get('/mcp/servers/{server_name}/tools')
async def list_mcp_server_tools(server_name: str) -> list[dict[str, Any]]:
    """Query tools through a host-injected, governed GraphOS delegation seam."""

    engine = await _get_engine_bounded()
    if not _SAFE_DELEGATION_TOKEN.fullmatch(server_name):
        raise HTTPException(status_code=400, detail='Invalid MCP server name')
    delegated_inventory = get_helper('list_mcp_server_tools')
    if delegated_inventory is None:
        raise HTTPException(
            status_code=501,
            detail='Governed MCP inventory delegation is not configured',
        )

    try:
        tools = await _invoke_governed_helper(
            delegated_inventory,
            deadline=15.0,
            server_name=server_name,
        )
        tools = _public_external_result(tools)
        if not isinstance(tools, list):
            raise ValueError('Governed MCP inventory returned an invalid shape')

        # Map each discovered tool to include its toggled enable status
        enriched_tools = []
        for t in tools[:_MAX_EXTERNAL_COLLECTION_ITEMS]:
            if not isinstance(t, dict):
                continue
            tool_name = str(t.get('name') or '')
            if not _SAFE_DELEGATION_TOKEN.fullmatch(tool_name):
                continue
            tool_enabled = await get_toggle_state(
                engine, 'mcp_tool', f'{server_name}:{tool_name}'
            )
            enriched_entry: dict[str, Any] = {
                'name': tool_name,
                'description': t.get('description', ''),
                'input_schema': t.get('input_schema', {}),
                'enabled': tool_enabled,
            }
            # BUG-071: forward the tool's declared MCP Apps UI binding (if
            # any) so a WebUI app-launcher can discover which tools are
            # launchable via `meta.ui.resourceUri` -- omitted when absent so
            # an ordinary tool's shape is unchanged.
            ui_meta = _public_tool_ui_meta(t.get('meta'))
            if ui_meta is not None:
                enriched_entry['meta'] = ui_meta
            enriched_tools.append(enriched_entry)
        return enriched_tools

    except HTTPException:
        raise
    except Exception as e:
        _log_failure('mcp_inventory_delegation', e)
        raise HTTPException(status_code=503, detail='MCP inventory unavailable')


# ---------------------------------------------------------------------------
# MCP server CRUD — add / modify / delete entries in the fleet catalog.
#
# THIN SEAM (persistence): the fleet catalog is currently the operator-owned
# ``mcp_config.json`` the multiplexer itself reads (``_mcp_server_registry_path``
# resolves it the identical way ``shared_multiplexer._default_config_path``
# does) -- there is no separate "webui storage" here, this IS the real,
# load-bearing catalog file that controls what the multiplexer spawns. A
# sibling lane is building relational ``mcp_servers``/``mcp_tools``/...
# tables in epistemic-graph as the primary store; swapping persistence to
# that store means changing only ``_read_mcp_server_registry`` /
# ``_write_mcp_server_registry`` below, never the routes or the frontend.
#
# Every entry is validated against ``MCPServerEntryModel`` (agent-utilities)
# BEFORE it is written, so an invalid shape (e.g. both ``command`` and
# ``url``) is rejected at CRUD time instead of only failing the next spawn.
# A stdio-transport add/edit is additionally refused up front when this
# deployment prohibits stdio children (``MCP_STDIO_PROHIBITED`` /
# ``enforce_mcp_stdio_permitted``) -- the same stated-reason guard the
# multiplexer itself enforces at spawn time, checked here too so the
# operator sees it at save time, not only when the server is next probed.
# ---------------------------------------------------------------------------


def _mcp_server_registry_path() -> Path:
    """Resolve the fleet ``mcp_config.json`` the SAME way the live
    multiplexer does (``agent_utilities.mcp.shared_multiplexer.
    _default_config_path``: explicit ``MCP_CONFIG`` setting, else
    ``<config_dir>/mcp_config.json``). Writing through any other path would
    silently diverge from what the running multiplexer actually reloads."""
    from agent_utilities.core.config import setting

    explicit = str(setting('MCP_CONFIG', '') or '').strip()
    if explicit:
        return Path(explicit)
    return config_dir() / 'mcp_config.json'


def _read_mcp_server_registry() -> dict[str, Any]:
    """The live ``mcpServers`` map, or ``{}`` if the catalog file is absent."""
    path = _mcp_server_registry_path()
    if not path.exists():
        return {}
    data = _read_bounded_json(path)
    servers = data.get('mcpServers') if isinstance(data, dict) else None
    return dict(servers) if isinstance(servers, dict) else {}


def _write_mcp_server_registry(servers: dict[str, Any]) -> None:
    """Persist the full ``mcpServers`` map atomically, then hot-reload every
    live multiplexer so the change is visible without a pod restart."""
    import json

    if len(servers) > _MAX_EXTERNAL_COLLECTION_ITEMS:
        raise HTTPException(status_code=400, detail='MCP server registry is too large')
    document = {'mcpServers': servers}
    payload = json.dumps(document, indent=2, sort_keys=True).encode('utf-8')
    if len(payload) > _MAX_EXTERNAL_RESULT_BYTES:
        raise HTTPException(
            status_code=400, detail='MCP server registry exceeds its safety bound'
        )
    registry_path = _mcp_server_registry_path()
    target_dir = _private_directory(registry_path.parent)
    try:
        _atomic_private_write(target_dir / registry_path.name, payload)
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('write_mcp_server_registry', e)
        raise HTTPException(
            status_code=500, detail='Failed to save the MCP server catalog'
        ) from e
    try:
        from agent_utilities.mcp.multiplexer import invalidate_live_catalogs

        invalidate_live_catalogs()
    except Exception as e:  # best-effort -- the write already succeeded
        _log_failure('invalidate_mcp_catalog', e)


def _validate_mcp_server_entry(server_name: str, config_payload: Any) -> dict[str, Any]:
    """Validate one submitted server config; refuse stdio when prohibited."""
    from agent_utilities.core.config import enforce_mcp_stdio_permitted
    from agent_utilities.models.mcp import MCPServerEntryModel

    if not isinstance(config_payload, dict):
        raise HTTPException(status_code=400, detail="'config' must be an object")
    try:
        entry = MCPServerEntryModel.model_validate(config_payload)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if entry.command:
        try:
            enforce_mcp_stdio_permitted(server_name=server_name)
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    return entry.model_dump(mode='json', exclude_none=True)


@router.get('/mcp/server-schema')
async def get_mcp_server_schema() -> dict[str, Any]:
    """The JSON schema an add/edit form derives its fields from (matches the
    ``/llm/model-schema`` pattern for ``ChatModelConfig``/``EmbeddingModelConfig``)."""
    from agent_utilities.models.mcp import MCPServerEntryModel

    return MCPServerEntryModel.model_json_schema()


@router.get('/mcp/servers/{server_name}/config')
async def get_mcp_server_config(server_name: str) -> dict[str, Any]:
    """One server's raw catalog entry, typed through ``MCPServerEntryModel`` --
    what an edit form prefills from (mirrors ``/llm/model-detail``)."""
    from agent_utilities.models.mcp import MCPServerEntryModel

    if not _SAFE_DELEGATION_TOKEN.fullmatch(server_name):
        raise HTTPException(status_code=400, detail='Invalid MCP server name')
    servers = _read_mcp_server_registry()
    raw = servers.get(server_name)
    if not isinstance(raw, dict):
        raise HTTPException(
            status_code=404, detail=f'MCP server {server_name!r} not found'
        )
    try:
        entry = MCPServerEntryModel.model_validate(raw)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return entry.model_dump(mode='json', exclude_none=True)


@router.post('/mcp/servers')
async def create_mcp_server(data: dict[str, Any]) -> dict[str, Any]:
    """Add one MCP server to the fleet catalog."""
    name = str(data.get('name') or '').strip()
    if not name or not _SAFE_DELEGATION_TOKEN.fullmatch(name):
        raise HTTPException(status_code=400, detail='Invalid MCP server name')
    validated = _validate_mcp_server_entry(name, data.get('config'))
    try:
        servers = _read_mcp_server_registry()
        if name in servers:
            raise HTTPException(
                status_code=409, detail=f'MCP server {name!r} already exists'
            )
        servers[name] = validated
        _write_mcp_server_registry(servers)
        return {'status': 'success', 'name': name, 'config': validated}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('create_mcp_server', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.put('/mcp/servers/{server_name}')
async def update_mcp_server(server_name: str, data: dict[str, Any]) -> dict[str, Any]:
    """Edit an existing MCP server's catalog entry."""
    if not _SAFE_DELEGATION_TOKEN.fullmatch(server_name):
        raise HTTPException(status_code=400, detail='Invalid MCP server name')
    validated = _validate_mcp_server_entry(server_name, data.get('config'))
    try:
        servers = _read_mcp_server_registry()
        if server_name not in servers:
            raise HTTPException(
                status_code=404, detail=f'MCP server {server_name!r} not found'
            )
        servers[server_name] = validated
        _write_mcp_server_registry(servers)
        return {'status': 'success', 'name': server_name, 'config': validated}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('update_mcp_server', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.delete('/mcp/servers/{server_name}')
async def delete_mcp_server(server_name: str, hard: bool = False) -> dict[str, Any]:
    """Remove an MCP server from the fleet catalog.

    Destructive by nature, made explicit and REVERSIBLE where the storage
    allows: the default (``hard=false``) sets ``disabled: true`` in place --
    the entry stays in the catalog file, fully restorable via a normal
    ``PUT``, and simply stops being mounted (matching the Agent Library's own
    archive-not-delete convention). ``hard=true`` removes the entry from the
    file entirely; the frontend requires a second, explicit confirmation
    before ever sending it.
    """
    if not _SAFE_DELEGATION_TOKEN.fullmatch(server_name):
        raise HTTPException(status_code=400, detail='Invalid MCP server name')
    try:
        servers = _read_mcp_server_registry()
        if server_name not in servers:
            raise HTTPException(
                status_code=404, detail=f'MCP server {server_name!r} not found'
            )
        if hard:
            del servers[server_name]
        else:
            entry = servers[server_name]
            if isinstance(entry, dict):
                entry = {**entry, 'disabled': True}
            servers[server_name] = entry
        _write_mcp_server_registry(servers)
        return {'status': 'success', 'name': server_name, 'hard_deleted': hard}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('delete_mcp_server', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/mcp/tools/call')
async def call_mcp_tool_route(data: dict[str, Any]) -> dict[str, Any]:
    """Invoke one MCP tool through the host's governed delegation seam.

    CONCEPT:AU-ECO.mcp.webui-governed-mcp-delegation

    This is the browser's only path to an MCP tool (``src/lib/mcp-client.ts``),
    and in particular the executor behind an MCP App's ``tools/call`` bridge
    (``src/lib/mcp-apps/bridge.ts``). The browser cannot reach a graph-os
    listener itself — that listener enforces ``MCP_ALLOWED_HOSTS`` on the
    ``Host`` authority and authenticates with a service bearer no page may
    hold — so the call is made here, same-origin, under the session identity
    every ``/api/*`` route already requires.

    The WebUI adds NO authority of its own: it validates the shape of the
    request and hands it to the host-injected ``call_mcp_tool`` helper, which
    owns the allowlist, actor policy, credential references, and audit
    envelope. With no host injection the route reports 501 rather than
    inventing a delegation path.
    """
    server_name = str(data.get('server') or '')
    tool_name = str(data.get('tool') or '')
    arguments = data.get('arguments')
    if arguments is None:
        arguments = {}
    try:
        _validate_delegation_call(server_name, tool_name, arguments)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if get_helper('call_mcp_tool') is None:
        raise HTTPException(
            status_code=501,
            detail='Governed MCP delegation is not configured',
        )
    try:
        result = await _call_mcp_tool(
            server_name,
            tool_name,
            arguments if isinstance(arguments, dict) else {},
        )
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('mcp_tool_delegation', e)
        raise HTTPException(status_code=502, detail='MCP tool call failed') from e
    return {'status': 'success', 'result': result}


@router.post('/mcp/apps/resource')
async def read_mcp_app_resource_route(data: dict[str, Any]) -> dict[str, Any]:
    """Read one ``ui://`` MCP App resource through the governed seam.

    CONCEPT:AU-ECO.mcp.webui-governed-mcp-delegation

    The returned ``html`` is UNTRUSTED tool output. The only supported way to
    render it is ``McpAppFrame``, which sandboxes it (``allow-scripts`` with no
    ``allow-same-origin``) and applies the host-resolved CSP; this route
    deliberately returns it as JSON rather than as an HTML response so it can
    never be navigated to directly and inherit this origin.
    """
    server_name = str(data.get('server') or '')
    uri = str(data.get('uri') or '')
    if not _SAFE_DELEGATION_TOKEN.fullmatch(server_name):
        raise HTTPException(status_code=400, detail='Invalid MCP server name')
    if not _SAFE_MCP_APP_URI.fullmatch(uri):
        raise HTTPException(status_code=400, detail='Invalid MCP app resource URI')

    delegated_read = get_helper('read_mcp_resource')
    if delegated_read is None:
        raise HTTPException(
            status_code=501,
            detail='Governed MCP resource delegation is not configured',
        )
    try:
        resource = await _invoke_governed_helper(
            delegated_read,
            deadline=15.0,
            server_name=server_name,
            uri=uri,
        )
        resource = _public_external_result(resource)
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('mcp_resource_delegation', e)
        raise HTTPException(status_code=502, detail='MCP resource read failed') from e

    if not isinstance(resource, dict):
        raise HTTPException(status_code=502, detail='MCP resource read failed')
    html = resource.get('text', resource.get('html'))
    if not isinstance(html, str):
        raise HTTPException(status_code=502, detail='MCP resource carried no text')
    mime_type = resource.get('mimeType') or resource.get('mime_type') or 'text/html'
    return {
        'status': 'success',
        'result': {
            'uri': uri,
            'html': html,
            'mimeType': str(mime_type),
        },
    }


@router.post('/tools/toggle')
async def toggle_tool_status(data: dict[str, Any]) -> dict[str, Any]:
    """Toggle the enabled status of an item (mcp_server, mcp_tool, builtin_tool, skill, etc.) in the graph."""
    item_type = data.get('type')
    item_id = data.get('id')
    enabled = data.get('enabled', True)

    if (
        not isinstance(item_type, str)
        or not _SAFE_DELEGATION_TOKEN.fullmatch(item_type)
        or not isinstance(item_id, str)
        or not _SAFE_DELEGATION_TOKEN.fullmatch(item_id)
        or not isinstance(enabled, bool)
    ):
        raise HTTPException(status_code=400, detail='Invalid toggle request')

    engine = await _get_engine_bounded()
    await set_toggle_state(engine, item_type, item_id, enabled)
    return {'status': 'success', 'type': item_type, 'id': item_id, 'enabled': enabled}


@router.get('/skills')
async def list_skills() -> list[dict[str, Any]]:
    """Retrieve the catalog of MCP/skill-fleet skills.

    CONCEPT:WU-KG.compute.granular-resource-queries — Granular Resource Queries

    Reads exclusively from the SQL fleet catalog's ``skills`` table via
    ``_read_fleet_catalog`` — the same tenant-scoped, redacted, fail-closed
    read path ``/tools`` and ``agent_utilities.gateway.registry_api`` use;
    never a filesystem ``SKILL.md`` scan or a live-engine fallback chain. A
    degraded/failed catalog read raises 503 rather than returning an
    indistinguishable empty list (fail-closed); a genuinely empty catalog
    (reachable, zero rows — e.g. the hourly ``fleet-tool-schema-sync`` job
    has not run yet) returns an honest ``[]``.

    Returns:
        A list of skill definitions sorted alphabetically.
    """
    catalog = await _read_fleet_catalog('skills')
    # `catalog is None` is total failure (denied authority / catalog engine
    # unavailable); `catalog['skills'] is None` is this specific kind
    # failing while `_read_fleet_catalog` still returned a mapping (the new
    # per-kind-degradable contract -- here only one kind was ever
    # requested, so a kind-level failure is equivalent to a whole-catalog
    # failure for this endpoint, and still fails closed).
    skill_rows = None if catalog is None else catalog.get('skills')
    if skill_rows is None:
        raise HTTPException(
            status_code=503, detail='MCP/skill fleet catalog is unavailable'
        )
    skills = [
        {
            'id': row.get('id', ''),
            'name': row.get('name', ''),
            'description': row.get('description', ''),
            'enabled': bool(row.get('enabled')),
        }
        for row in skill_rows[:_MAX_EXTERNAL_COLLECTION_ITEMS]
        if isinstance(row.get('id'), str) and row.get('id')
    ]
    bounded = _public_external_result(
        sorted(skills, key=lambda x: x.get('name', '').lower())
    )
    return bounded if isinstance(bounded, list) else []


@router.post('/skills/{skill_id}/toggle')
async def toggle_skill(skill_id: str) -> dict[str, Any]:
    """Enable or disable a specific agent skill.

    CONCEPT:WU-KG.compute.granular-resource-queries — Granular Resource Queries

    Args:
        skill_id: The identifier of the skill to toggle.

    Returns:
        The resulting state of the toggled skill.
    """
    if not _SAFE_DELEGATION_TOKEN.fullmatch(skill_id):
        raise HTTPException(status_code=400, detail='Invalid skill identifier')
    try:
        engine = await _get_engine_bounded()
    except HTTPException as exc:
        # See the matching note in list_skills(): only a genuine 503 hard-
        # fails; "no engine" (501) degrades to the toggle_helper fallback.
        if exc.status_code != 501:
            raise
        engine = None
    except Exception:
        engine = None
    if engine:
        # Check current toggle status
        current = await get_toggle_state(engine, 'skill', skill_id)
        target = not current
        await set_toggle_state(engine, 'skill', skill_id, target)
        return {'status': 'success', 'enabled': target}

    toggle_helper = get_helper('toggle_skill')
    if not toggle_helper:
        return {'status': 'disabled', 'detail': 'Skill helper not initialized'}
    return await _invoke_governed_helper(
        toggle_helper,
        skill_id,
        deadline=10.0,
    )


@router.post('/reload')
async def reload_agent(request: Request) -> dict[str, Any]:
    """Trigger a KG-first reload of the agent's configuration.

    CONCEPT:WU-KG.compute.workspace-reload — Workspace Reload

    Args:
        request: The current FastAPI Request object.

    Returns:
        Structured change summary with counts of updated resources.
    """
    try:
        try:
            engine = await _get_engine_bounded()
        except HTTPException as exc:
            # See the matching note in list_skills(): only a genuine 503
            # hard-fails; "no engine" (501) degrades to the legacy
            # workspace-reload fallback below.
            if exc.status_code != 501:
                raise
            engine = None
        except Exception:
            engine = None
        if engine:
            changes = await _invoke_governed_helper(
                engine.reload_from_workspace,
                deadline=30.0,
            )
            return {
                'status': 'success',
                'message': 'Agent reloaded via Knowledge Graph',
                **changes,
            }

        # Legacy fallback
        await _invoke_governed_helper(
            workspace_helpers['initialize_workspace'],
            deadline=30.0,
        )
        reloadable = getattr(request.app.state, 'reload_app', None)
        if not reloadable:
            raise HTTPException(
                status_code=501, detail='Reloadable wrapper not found in app state'
            )
        await _invoke_governed_helper(reloadable.reload, deadline=30.0)
        return {'status': 'success', 'message': 'Agent reloaded successfully'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('reload', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


def parse_cron_table(content: str) -> list[dict[str, Any]]:
    """Parse a markdown table of cron tasks into structured data.

    Args:
        content: Raw markdown string containing the task table.

    Returns:
        A list of task dictionaries with id, name, and schedule.
    """
    tasks = []
    lines = content.split('\n')
    for line in lines:
        if '|' in line and 'ID' not in line and '---' not in line:
            parts = [p.strip() for p in line.split('|') if p.strip()]
            if len(parts) >= 3:
                tasks.append(
                    {
                        'id': parts[0],
                        'name': parts[1],
                        'schedule': parts[2],
                    }
                )
    return tasks


def parse_cron_logs(content: str) -> list[dict[str, Any]]:
    """Extract structured execution logs from a CRON_LOG.md markdown file.

    Args:
        content: Raw markdown string containing formatted log entries.

    Returns:
        A list of log entries in reverse chronological order.
    """
    logs = []

    parts = re.split(r'(?=^### \[)', content, flags=re.MULTILINE)

    for part in parts:
        if not part.strip() or not part.startswith('### ['):
            continue

        try:
            header_match = re.search(r'^### \[(.*?)\] (.*?) \(`(.*?)`\)', part)
            if header_match:
                ts = header_match.group(1)
                name = header_match.group(2)
                tid = header_match.group(3)

                body = part.split('\n\n', 1)[1] if '\n\n' in part else ''
                output = body.split('\n---')[0].strip()
                safe_output, _privacy_report = sanitize_for_persistence(output)

                logs.append(
                    {
                        'timestamp': ts,
                        'task_id': tid,
                        'task_name': name,
                        'status': 'success',
                        'output': safe_output,
                    }
                )
        except Exception as e:
            _log_failure('api_extension', e, level=logging.DEBUG)
    return logs[::-1]


@router.get('/cron/calendar')
async def get_cron_calendar() -> list[dict[str, Any]]:
    """Retrieve the scheduled cron task calendar from Knowledge Graph."""
    try:
        from agent_utilities.core.scheduler import get_cron_tasks

        registry = get_cron_tasks()
        results = []
        for t in list(registry.tasks or [])[:_MAX_EXTERNAL_COLLECTION_ITEMS]:
            results.append(
                {
                    'id': t.id,
                    'name': t.name or t.id,
                    'schedule': str(t.interval_minutes),
                    'last_run': t.last_run,
                    'next_run': t.next_approx,
                    'status': 'idle',
                }
            )
        bounded = _public_external_result(results)
        return bounded if isinstance(bounded, list) else []
    except Exception as e:
        _log_failure('api_extension', e)
        return []


@router.get('/cron/logs')
async def get_cron_logs() -> list[dict[str, Any]]:
    """Retrieve the execution history logs for cron tasks."""
    try:
        from agent_utilities.core.scheduler import get_cron_logs

        logs = get_cron_logs()
        results = []
        for entry in list(logs.entries or [])[-_MAX_EXTERNAL_COLLECTION_ITEMS:]:
            safe_output, _privacy_report = sanitize_for_persistence(entry.message)
            results.append(
                {
                    'timestamp': entry.timestamp,
                    'task_id': entry.task_id,
                    'task_name': entry.task_name or entry.task_id,
                    'output': safe_output,
                    'status': 'success' if entry.status == 'success' else 'error',
                    'chat_id': persistence_reference(
                        'conversation', entry.chat_id, namespace='webui'
                    ),
                }
            )
        bounded = _public_external_result(results)
        return bounded if isinstance(bounded, list) else []
    except Exception as e:
        _log_failure('api_extension', e)
        return []


@router.post('/upload')
async def upload_file(file: Annotated[UploadFile, File()]) -> dict[str, str]:
    """Store one bounded upload atomically inside the configured workspace.

    Args:
        file: The UploadFile object from the request.

    Returns:
        Confirmation containing the saved filename.
    """
    if file.filename is None or not file.filename.strip():
        raise HTTPException(status_code=400, detail='Filename is missing')
    filename = file.filename.strip()
    # Browser uploads are single files. Reject path-bearing names instead of
    # silently rewriting them, including Windows separators on POSIX hosts.
    if Path(filename).name != filename or '\\' in filename or filename in {'.', '..'}:
        raise HTTPException(
            status_code=400, detail='Upload filename must be a basename'
        )
    file_path = resolve_workspace_file(filename)
    limit = _upload_limit()
    payload = bytearray()
    try:
        while chunk := await file.read(64 * 1024):
            payload.extend(chunk)
            if len(payload) > limit:
                raise HTTPException(status_code=400, detail='Upload exceeds size limit')
    finally:
        await file.close()

    # Apply the persistence guard to textual uploads. Binary formats require a
    # format-aware ingestion connector and remain opaque here.
    media_type = (file.content_type or '').split(';', 1)[0].strip().lower()
    if media_type.startswith('text/') or file_path.suffix.lower() in {
        '.csv',
        '.json',
        '.md',
        '.rst',
        '.txt',
        '.yaml',
        '.yml',
    }:
        try:
            decoded = payload.decode('utf-8')
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=400, detail='Text upload is not UTF-8'
            ) from exc
        _safe_content, privacy_report = sanitize_for_persistence(decoded)
        if privacy_report.changed:
            raise HTTPException(
                status_code=400,
                detail='Upload violates the persistence privacy boundary',
            )

    _atomic_private_write(file_path, bytes(payload))
    return {'filename': filename}


@router.get('/agent-icon')
async def get_agent_icon() -> Response:
    """Retrieve the agent's avatar icon, falling back to repository defaults.

    Returns:
        A response containing bounded image data.
    """
    workspace_icon = resolve_workspace_file('icon.png')
    if workspace_icon.is_file() and not workspace_icon.is_symlink():
        try:
            return Response(
                content=_read_bounded_bytes(
                    workspace_icon,
                    limit=min(_upload_limit(), 5 * 1024 * 1024),
                ),
                media_type='image/png',
            )
        except (OSError, ValueError):
            pass

    packaged_icon = Path(__file__).with_name('icon.png')
    if not packaged_icon.is_file() or packaged_icon.is_symlink():
        raise HTTPException(status_code=404, detail='Icon not found')
    try:
        content = _read_bounded_bytes(packaged_icon, limit=5 * 1024 * 1024)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=404, detail='Icon not found') from exc
    return Response(content=content, media_type='image/png')


@router.get('/download/{filename:path}')
async def download_file(filename: str) -> Response:
    """Download a specific file from the agent's workspace.

    Args:
        filename: The relative path of the file to download.

    Returns:
        A bounded response with safe attachment headers.
    """
    file_path = resolve_workspace_file(filename)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail='File not found')
    try:
        content = _read_bounded_bytes(file_path, limit=_upload_limit())
    except (OSError, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail='File cannot be read safely'
        ) from exc
    disposition = f"attachment; filename*=UTF-8''{quote(file_path.name, safe='')}"
    return Response(
        content=content,
        media_type='application/octet-stream',
        headers={'content-disposition': disposition},
    )


@chats_router.get('/chats')
async def list_chats() -> list[dict[str, Any]]:
    """List historical chat sessions stored on the server.

    Returns:
        List of chat metadata summaries.
    """
    h = get_helper('list_chats')
    result = h() if h else []
    if not isinstance(result, list):
        return []
    bounded = _public_external_result(
        [item for item in result if isinstance(item, dict)][:_MAX_SESSION_RECORDS]
    )
    return bounded if isinstance(bounded, list) else []


@chats_router.get('/chats/{chat_id}')
async def get_chat(chat_id: str) -> dict[str, Any]:
    """Retrieve a specific chat session's message history.

    Args:
        chat_id: The unique identifier of the chat session.

    Returns:
        The full chat session object.
    """
    chat_id = _validate_runtime_id(chat_id)
    h = get_helper('get_chat')
    result = h(chat_id) if h else None
    if not result:
        return {'id': chat_id, 'title': 'Chat', 'messages': []}
    bounded = _public_external_result(result)
    if not isinstance(bounded, dict):
        raise HTTPException(status_code=422, detail='Invalid chat record')
    return bounded


@chats_router.post('/chats')
async def save_chat(data: dict[str, Any]) -> dict[str, Any]:
    """Persist a new or updated chat session.

    Args:
        data: The complete chat history payload.

    Returns:
        Acknowledgment or error summary.
    """
    bounded_data = _bounded_query_params(data)
    safe_data, _privacy_report = sanitize_for_persistence(bounded_data)
    if not isinstance(safe_data, dict):
        raise HTTPException(status_code=400, detail='Invalid chat record')
    candidate_id = safe_data.get('id') or safe_data.get('chat_id')
    if candidate_id is not None:
        _validate_runtime_id(candidate_id)
    h = get_helper('save_chat')
    result = h(safe_data) if h else {'status': 'error'}
    bounded_result = _public_external_result(result)
    return bounded_result if isinstance(bounded_result, dict) else {'status': 'error'}


@chats_router.put('/chats/{chat_id}')
async def update_chat(chat_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Update a chat session record -- today, its display title.

    Folded from the old, separate ``PUT /chats/{chat_id}/title`` path: this
    IS the general chat-record update route, not a title-only alias. It
    currently only accepts a ``title`` field because that is the only field
    the ``update_chat_title`` workspace helper's contract accepts; a
    ``data`` payload without a valid ``title`` is rejected rather than
    silently accepted as a no-op, so this stays a real update endpoint
    (not a disguised rename-only one) the moment the helper grows more
    fields.

    Args:
        chat_id: The identifier of the chat session.
        data: Dictionary containing the new 'title'.

    Returns:
        Acknowledgment or error summary.
    """
    chat_id = _validate_runtime_id(chat_id)
    title = data.get('title')
    if not isinstance(title, str) or len(title.encode('utf-8')) > 1024:
        raise HTTPException(status_code=400, detail='Invalid chat title')
    h = get_helper('update_chat_title')
    return h(chat_id, {'title': title}) if h else {'status': 'error'}


@chats_router.delete('/chats/{chat_id}')
async def delete_chat(chat_id: str) -> dict[str, Any]:
    """Permanently delete a chat session record.

    Uses the canonical REST verb DELETE against ``/chats/{chat_id}``. The
    old ``GET /chats/{chat_id}/title`` alias was non-idiomatic (GET is
    expected to be safe/idempotent-read) and collided conceptually with
    the sibling ``PUT /chats/{chat_id}`` update endpoint.

    Args:
        chat_id: The identifier of the chat to remove.

    Returns:
        Acknowledgment or error summary.
    """
    chat_id = _validate_runtime_id(chat_id)
    h = get_helper('delete_chat')
    return h(chat_id) if h else {'status': 'error'}


_MAX_CANVAS_PROPERTY_CHARS = 512
_MAX_CANVAS_NODE_BYTES = 4096


def _canvas_property(value: Any) -> Any:
    """Shrink one node property to something a graph canvas can render.

    The canvas shows `properties.name` and lets an operator edit fields; it
    never needs a whole document body. Truncating long strings covers the
    common case; `_canvas_node` enforces the actual byte bound, because a
    property can also be a deeply nested list/dict this never sees inside.
    """
    if isinstance(value, str) and len(value) > _MAX_CANVAS_PROPERTY_CHARS:
        return value[:_MAX_CANVAS_PROPERTY_CHARS] + '…'
    return value


def _node_bytes(node: dict[str, Any]) -> int:
    return len(
        json.dumps(node, separators=(',', ':'), ensure_ascii=False, default=str).encode(
            'utf-8'
        )
    )


def _canvas_node(node: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Bound ONE node by serialized size, returning it with its byte cost.

    Per-property truncation is not sufficient on its own: a property value can
    be a nested list or dict whose leaves `_canvas_property` never inspects, so
    a node can still serialize to hundreds of kilobytes. Measuring the real
    encoded node is the only bound that holds regardless of shape. A node over
    the cap keeps its identity, its labels and its display name -- everything
    the canvas actually draws -- and drops the rest rather than being omitted.
    """
    size = _node_bytes(node)
    if size <= _MAX_CANVAS_NODE_BYTES:
        return node, size
    name = node['properties'].get('name')
    trimmed = {
        'id': node['id'],
        'labels': node['labels'],
        'properties': {'name': name} if isinstance(name, str) else {},
    }
    return trimmed, _node_bytes(trimmed)


async def _distinct_graph_labels(engine: Any) -> list[str]:
    """Every label known across every graph this actor may read, via each
    graph's own `db.labels()`.

    `db.labels()` is a real Cypher procedure in the engine
    (`DbLabels` in `crates/eg-query/src/cypher/proc.rs`, backed by
    `distinct_labels`), so this is one bounded round trip per graph and not a
    scan this process performs. A build without the procedure yields no labels
    rather than failing the whole request -- the caller still returns the
    unlabeled bucket, which is strictly better than a 503.

    FIX LANE Priority 1: fanned out across `_accessible_graphs` (via
    `_rows_per_accessible_graph`) rather than `engine.backend`-only --
    otherwise a label that exists ONLY in commons (e.g. `Tool`, which the
    caller's own tenant graph carries none of) would never even be
    enumerated, so `get_graph_nodes`' per-label fan-out below would never be
    asked for it regardless of how well THAT part unions. A plain label name
    is not sensitive (it is schema, not row data), so no commons-catalog
    filtering applies here -- the row-level restriction happens once, per
    node, in `_union_nodes_by_label`.
    """

    def _labels_for(scoped_engine: Any) -> list[str]:
        labels: list[str] = []
        try:
            result = scoped_engine.backend.execute(
                'CALL db.labels() YIELD label RETURN label'
            )
        except Exception as labels_error:  # noqa: BLE001 — per-graph fail-soft
            _log_failure(
                'get_graph_nodes.db_labels', labels_error, level=logging.WARNING
            )
            return []
        for row in result or []:
            label = row.get('label') if isinstance(row, dict) else None
            if isinstance(label, str) and label and label not in labels:
                labels.append(label)
        return labels

    def _run() -> list[str]:
        result = _rows_per_accessible_graph(engine, _labels_for)
        if result is None:
            return _labels_for(engine)
        per_graph, _degraded = result
        labels: list[str] = []
        for _graph_name, graph_labels in per_graph:
            for label in graph_labels or []:
                if label not in labels:
                    labels.append(label)
        return labels

    return await _invoke_governed_helper(_run, deadline=10.0)


# ---------------------------------------------------------------------------
# Commons/tenant union read (FIX LANE Priority 1)
#
# Measured, same pod, same moment: a webui session sees a strict SUBSET of
# the knowledge graph an MCP caller sees (25,116 vs 56,853 total nodes; 0 vs
# 2,941 `:Tool`; 58 vs 361 `:CallableResource`). This is BY DESIGN --
# `agent_utilities.knowledge_graph.core.tenant_sharing`'s module docstring:
# "the default graph is the COMMONS. It is readable across orgs" -- and the
# fleet/tool catalog is exactly `tenant_sharing.COMMONS_SHAREABLE_NODE_TYPES`.
# The bug is that `tenant_sharing.accessible_graphs()`/`read_union()` -- the
# union-read primitive built for exactly this -- had ZERO callers anywhere
# in the codebase. This section wires it into this file's Cypher/SQL graph
# reads, in place of a bare `session.graph`-only read.
#
# `agent_webui.graph_identity.frontend_accessible_graphs(actor)` is the
# sanctioned seam for this (branch `fix/tenant-graph-scoping`, commit
# `77458f9`) -- it re-exports `tenant_sharing.accessible_graphs()` verbatim.
# That branch is not yet merged into this lane's base as of this change, so
# `_accessible_graphs()` below imports the underlying `tenant_sharing`
# primitive directly and falls back to `.graph_identity`'s seam once it
# exists (import success is checked at call time, not cached, so merging
# that branch later needs no further change here). NOTE FOR THE MERGE OWNER:
# once `fix/tenant-graph-scoping` lands on this lane's base, the `except
# ImportError` branch below becomes dead and may be deleted.
#
# READS ONLY. `session.graph` (the tenant shard) remains the sole write
# target everywhere in this file -- nothing here is reachable from a write
# path. Widening a write target to the union would be a tenant data leak;
# the parallel `graph_identity` lane explicitly rejected that and pinned an
# equivalence test for it (`test_graph_identity.py`).
def _accessible_graphs(actor: Any) -> list[str]:
    """Ordered, de-duplicated graphs `actor` may READ (tenant shard first,
    ancestors, commons last) -- see the module-level note above for why this
    resolves the seam dynamically (`getattr`, not a static `from .graph_identity
    import frontend_accessible_graphs`) so this file type-checks cleanly both
    before AND after `fix/tenant-graph-scoping` merges that name in -- a static
    import of a not-yet-existing name would need a `# type: ignore` this repo's
    own rules forbid.
    """
    from . import graph_identity

    resolve = getattr(graph_identity, 'frontend_accessible_graphs', None)
    if resolve is not None:
        return resolve(actor)
    from agent_utilities.knowledge_graph.core.tenant_sharing import (
        accessible_graphs,
    )

    return accessible_graphs(actor)


def _graph_union_executor(engine: Any) -> Any:
    """`tenant_sharing.read_union` executor: run `cypher` against ONE named
    graph by (a) obtaining a backend/view actually BOUND to that graph and
    (b) retargeting the ambient `GraphSession` to match it.

    FIX (root cause, verified live in-pod): `engine`/`engine.backend` here is
    itself already a graph-scoped view pinned to the CALLER's original graph
    (`EpistemicGraphBackend.graph_name` / `_SessionRoutedAsyncClient
    ._fixed_graph`, `graph_compute.py::_send_routed`). Retargeting only the
    *session* via `with_graph()`+`use_session()` while continuing to call
    methods on that SAME pinned `engine` reproduces exactly the masked
    failure this lane was asked to fix: `PermissionError: "A graph-scoped
    view cannot retarget the verified GraphSession"` (session.graph no
    longer equals the view's fixed graph). The sanctioned production seam
    for a *different* graph is `IntelligenceGraphEngine.for_graph(graph_name)`
    (`knowledge_graph/core/engine.py`) -- "a graph-scoped facade over the one
    process client... safe for unified read fan-out", the exact "control
    authority already bound to its own graph" shape used by
    `core/schedule_engine.py::_control_backend`/`_control_session_scope` and
    `knowledge_graph/pipeline/__init__.py`'s `RegistryPipeline`. Both moves
    -- a NEW view bound to `graph_name`, AND the session retargeted onto that
    same `graph_name` -- must happen together; retargeting either one alone
    reproduces the mismatch guard (from the opposite side).

    `GraphSession.with_graph()` + the session module's own `use_session()`
    context manager is the documented, audited way to scope one block of
    work to a specific verified session (`session.py::use_session`
    docstring). This never fabricates authority -- it is the SAME actor's
    session, just pointed at another graph that actor's own
    `accessible_graphs()` already says it may read.
    """
    from agent_utilities.knowledge_graph.core.session import (
        current_session,
        use_session,
    )

    def _execute(
        graph_name: str, cypher: str, params: dict[str, Any] | None
    ) -> list[dict[str, Any]]:
        session = current_session()
        exec_cypher, exec_params = cypher, dict(params or {})
        is_commons = False
        if session is not None:
            from agent_utilities.knowledge_graph.core.tenant_sharing import (
                apply_commons_catalog_restriction,
                commons_graph_name,
            )

            is_commons = graph_name == commons_graph_name()
            if is_commons:
                # Push the commons READ catalog restriction (2026-08-09 owner
                # ruling; `COMMONS_SHAREABLE_NODE_TYPES`) INTO the query text so
                # the engine filters, not this process -- `read_union`/
                # `filter_commons_catalog` were built for a post-hoc Python
                # filter, but that pulls every commons row over the wire first.
                # `apply_commons_catalog_restriction` is the companion primitive
                # built for exactly this pushdown (its own docstring: "closes
                # the label/type-index half of the existence-leak... injected
                # into the query TEXT"). Best-effort: a query shape it can't
                # inject into (no bound variable, `UnscopableQueryError`, or any
                # other failure) leaves `exec_cypher` unchanged and is caught
                # below by the row-level fallback -- this must never fail OPEN.
                try:
                    exec_cypher, extra_params = apply_commons_catalog_restriction(
                        cypher, session.actor, graph_name
                    )
                    exec_params.update(extra_params)
                except Exception as exc:  # noqa: BLE001 — pushdown is best-effort; the row-level fallback below is the safety net
                    _log_failure(
                        'graph_union.commons_restriction', exc, level=logging.DEBUG
                    )
                    exec_cypher, exec_params = cypher, dict(params or {})
        # `query=`/`params=` are passed as KEYWORDS, not positionally: the
        # real `QueryMixin.query_cypher(self, query, params=None, ...)`
        # signature (`engine_query.py:137`) binds either way, but this route
        # is pinned to the `query` keyword specifically (see
        # `test_execute_cypher_forwards_the_query_text_under_the_query_keyword`)
        # to distinguish it from the MCP tool surface's `cypher`-named field
        # -- a future accidental rename to `cypher=` must fail loudly here,
        # which a positional call would silently paper over.
        if session is None or graph_name == session.graph:
            rows = list(
                engine.query_cypher(query=exec_cypher, params=exec_params) or []
            )
        else:
            scoped_engine = engine.for_graph(graph_name)
            with use_session(session.with_graph(graph_name)):
                rows = list(
                    scoped_engine.query_cypher(query=exec_cypher, params=exec_params)
                    or []
                )
        if is_commons and exec_cypher == cypher:
            # The pushdown above did not change the query text -- either it
            # legitimately doesn't apply (privileged actor, no WHERE/RETURN
            # site) or it failed -- so apply the row-level allowlist as the
            # fallback. `filter_commons_catalog` itself no-ops for a
            # privileged actor, so this is a no-op in the common "legitimately
            # doesn't apply" case and the actual safety net in the "it failed"
            # case; it never widens access relative to the pushdown succeeding.
            from agent_utilities.knowledge_graph.core.tenant_sharing import (
                filter_commons_catalog,
            )

            rows = filter_commons_catalog(rows, session.actor, graph_name)
        return rows

    return _execute


async def _read_union_cypher(
    engine: Any,
    cypher: str,
    params: dict[str, Any] | None,
    *,
    deadline: float,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Run a row-shaped Cypher read across every graph this actor may read,
    de-duplicated by node id (`tenant_sharing.read_union` -- the actor's own
    tenant graph wins on a duplicate id; commons rows fill in the rest).

    Falls back to exactly today's single-graph (`session.graph`-only) read
    when there is no verified ambient `GraphSession` -- this NEVER widens
    authority beyond what the SAME caller could already reach; it degrades
    to "as narrow as before" rather than raising or fabricating a union.

    Returns `(rows, source_graphs)` -- `source_graphs` is the observability
    half of this fix (see the module note above): which physical graph(s) a
    response actually drew from, so a narrowed view can never again look
    identical to a complete one.
    """
    from agent_utilities.knowledge_graph.core.session import current_session
    from agent_utilities.knowledge_graph.core.tenant_sharing import read_union

    def _run() -> tuple[list[dict[str, Any]], list[str]]:
        session = current_session()
        if session is None:
            return list(engine.query_cypher(cypher, params) or []), []
        actor = session.actor
        graphs = _accessible_graphs(actor)
        rows = read_union(cypher, params, _graph_union_executor(engine), actor)
        return rows, graphs

    return await _invoke_governed_helper(_run, deadline=deadline)


# Bound on concurrent per-graph fan-out (`_rows_per_accessible_graph` below).
# `_accessible_graphs` is small today (tenant graph + commons = 2) and stays
# small (ordered, de-duplicated; ancestors are a short chain in practice) --
# this cap just keeps a pathological tenancy tree from spawning an unbounded
# thread pool, matching the "must not degrade linearly if ancestors are
# added" requirement without over-provisioning for a case that doesn't exist.
_READ_UNION_MAX_WORKERS = 8


def _rows_per_accessible_graph(
    engine: Any,
    engine_call: Any,
) -> tuple[list[tuple[str, Any]], list[str]] | None:
    """Invoke `engine_call(scoped_engine)` once per graph the ambient actor
    may read, each against a backend/view actually BOUND to that graph
    (`engine.for_graph(graph_name)` -- see `_graph_union_executor`'s
    docstring for why retargeting the session alone is not enough) under
    that graph's own scoped `GraphSession`. Returns `None` when there is no
    ambient verified session -- callers fall back to a single unscoped call.

    Unlike `_read_union_cypher`, this does not de-duplicate by row id: it is
    for AGGREGATE reads (counts, `GROUP BY`), where a merged-by-id union is
    meaningless (an aggregate row carries no per-row node id) and would be
    wrong even if forced -- physically partitioned graphs (GOC-61) never
    share a node id, so the correct merge of independent per-graph
    aggregates is for the CALLER to sum/merge them, not de-dup them.

    CONCURRENT, BOUNDED (`_READ_UNION_MAX_WORKERS`): each graph's read is
    genuinely independent (a separate `for_graph` view + a separately
    retargeted session), so running them sequentially would make every
    union-read route's latency scale with the number of accessible graphs
    for no reason -- exactly the linear-degradation shape this fix is
    required not to introduce. `contextvars.copy_context()` per submission is
    load-bearing, not decoration: `current_session`/`use_session` are
    `ContextVar`-backed, and a bare `ThreadPoolExecutor.submit` would hand
    the callable a FRESH context with no ambient session at all, silently
    breaking every graph but the one the caller's own thread happens to
    still be on. Results are re-sorted back into `_accessible_graphs`'
    ordering (tenant graph first) after the fan-out completes, regardless of
    which thread finished first, so downstream "tenant wins on a duplicate
    id" merges stay correct.

    FAIL-SOFT (matches `tenant_sharing.read_union`'s own documented
    contract, `core/tenant_sharing.py:457`: "A per-graph failure is logged
    and skipped -- a missing commons graph degrades to org-only, never an
    error"). A single graph's read failing (offline shard, mid-rebuild
    `PARTIAL_MATERIALIZATION`, a column this graph's projection doesn't
    carry, ...) must never 503 the whole caller -- it previously did,
    because this loop had no per-graph exception boundary at all. Returns
    `(succeeded, degraded)`: `succeeded` is `(graph_name, result)` for every
    graph that answered; `degraded` is the `graph_name`s that were skipped,
    so a caller can report a partial read as partial (never silently as
    complete -- the sibling half of this same fix).
    """
    from agent_utilities.knowledge_graph.core.session import (
        current_session,
        use_session,
    )

    session = current_session()
    if session is None:
        return None
    graphs = _accessible_graphs(session.actor)

    def _one(graph_name: str) -> Any:
        if graph_name == session.graph:
            return engine_call(engine)
        scoped_engine = engine.for_graph(graph_name)
        with use_session(session.with_graph(graph_name)):
            return engine_call(scoped_engine)

    succeeded: list[tuple[str, Any]] = []
    degraded: list[str] = []
    if len(graphs) <= 1:
        for graph_name in graphs:
            try:
                succeeded.append((graph_name, _one(graph_name)))
            except Exception as exc:  # noqa: BLE001 — one graph down ≠ whole read down (mirrors tenant_sharing.read_union's own per-graph guard)
                _log_failure('read_union.per_graph', exc, level=logging.DEBUG)
                degraded.append(graph_name)
        return succeeded, degraded

    max_workers = min(len(graphs), _READ_UNION_MAX_WORKERS)
    with _futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        pending = {
            pool.submit(contextvars.copy_context().run, _one, graph_name): graph_name
            for graph_name in graphs
        }
        for future in pending:
            graph_name = pending[future]
            try:
                succeeded.append((graph_name, future.result()))
            except Exception as exc:  # noqa: BLE001 — one graph down ≠ whole read down (mirrors tenant_sharing.read_union's own per-graph guard)
                _log_failure('read_union.per_graph', exc, level=logging.DEBUG)
                degraded.append(graph_name)
    order = {graph_name: idx for idx, graph_name in enumerate(graphs)}
    succeeded.sort(key=lambda pair: order[pair[0]])
    return succeeded, degraded


async def _read_union_scalar_sum(
    engine: Any,
    cypher: str,
    params: dict[str, Any] | None,
    *,
    field: str,
    deadline: float,
) -> tuple[int, list[str], list[str]]:
    """Sum a scalar Cypher aggregate (e.g. `count(n)`) across every graph
    this actor may read. See `_rows_per_accessible_graph` for why a sum,
    not `read_union`'s dedup, is the correct merge here.

    Returns `(total, source_graphs, degraded_graphs)` -- `source_graphs` is
    only the graphs that actually contributed to `total`; `degraded_graphs`
    is any accessible graph whose read failed and was skipped
    (`_rows_per_accessible_graph`'s fail-soft contract), so a partial sum is
    never reported identically to a complete one.
    """

    def _run() -> tuple[int, list[str], list[str]]:
        result = _rows_per_accessible_graph(
            engine, lambda scoped: scoped.query_cypher(cypher, params) or []
        )
        if result is None:
            rows = engine.query_cypher(cypher, params) or []
            total = int(rows[0].get(field, 0)) if rows else 0
            return total, [], []
        per_graph, degraded = result
        total = 0
        graphs: list[str] = []
        for graph_name, rows in per_graph:
            graphs.append(graph_name)
            if rows:
                value = rows[0].get(field, 0)
                if isinstance(value, int) and not isinstance(value, bool):
                    total += value
        return total, graphs, degraded

    return await _invoke_governed_helper(_run, deadline=deadline)


async def _read_union_sql_group_counts(
    engine: Any,
    statement: str,
    *,
    key: str,
    count_field: str,
    deadline: float,
) -> tuple[dict[str, int], list[str], list[str]]:
    """Run a `GROUP BY` SQL aggregate against every graph this actor may
    read and merge by SUMMING counts per `key`. The `nodes`/`edges` SQL
    tables are the SAME RLS-filtered graph snapshot Cypher reads
    (`fleet_catalog_tables.py`: "only the nodes/edges graph snapshot is
    RLS-filtered via IsolationLayer::filter_view"), scoped by the SAME
    ambient session/graph `_read_union_cypher` uses.

    Returns `(merged, source_graphs, degraded_graphs)` -- see
    `_read_union_scalar_sum` for the same `degraded_graphs` contract.

    BUG-PE-058 (fixed here): this used to call the write-capable
    `engine.graph_compute.sql_exec` -- documented in `graph_compute.py` as
    "the write sibling of the read-only `client.query.sql` surface" for
    DDL/DML -- for what is structurally a read. `sql_exec` has no
    statement-type guard and skips `secured_reads.visible(filter_rows(...))`,
    the RLS defense-in-depth layer `QueryMixin.sql()` applies. The statement
    passed in today is a fixed literal `SELECT ... GROUP BY`, so there was no
    live injection path, but any call site reaching a write-capable entry
    point for a read is a standing risk should this helper or a copied call
    site ever build a statement from anything less than a literal. Fixed by
    routing through `engine.sql()` / `scoped.sql()` (`QueryMixin.sql`,
    `orchestration/engine_query.py:433`) instead -- the read-only surface
    that rejects non-`SELECT`/`WITH`/`EXPLAIN` statements and applies
    `visible(filter_rows(...))` before returning.

    This also resolves, for THIS call site, the cross-graph routing gap
    found live in-pod while first verifying this fix lane: `.sql_exec()`
    reads through `GraphComputeEngine._client` on the (possibly
    independently-constructed) `graph_compute` view, while `.sql()` reads
    through `self.backend` -- the SAME per-request pinned view
    `query_cypher` uses. Verified live: `engine.for_graph("__commons__")`
    correctly made `query_cypher` return DIFFERENT results from the
    caller's own graph (0 vs 25,117 nodes at time of test), while the
    identically-scoped `.graph_compute.sql_exec` returned the CALLER'S OWN
    row counts again under the `__commons__` label (verified with
    textually distinct SQL to rule out a query-text cache) -- i.e. the
    `by_type` breakdown and the `total_nodes`/`total_relationships` totals
    (Cypher, via `_read_union_scalar_sum`) were silently reading through
    two different-scoped engines. `graph_compute.sql_exec` itself is
    unmodified (owned by another lane, out of `agent_webui`'s reach) and
    may still misroute for any OTHER caller that reaches it directly --
    flagged for that lane, not fixed here.
    """

    def _run() -> tuple[dict[str, int], list[str], list[str]]:
        result = _rows_per_accessible_graph(
            engine, lambda scoped: scoped.sql(statement) or []
        )
        if result is None:
            per_graph = [('', engine.sql(statement) or [])]
            graphs: list[str] = []
            degraded: list[str] = []
        else:
            per_graph, degraded = result
            graphs = [graph_name for graph_name, _rows in per_graph]
        merged: dict[str, int] = {}
        for _graph_name, rows in per_graph:
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                k = row.get(key)
                n = row.get(count_field)
                if not isinstance(k, str) or not k:
                    continue
                if not isinstance(n, int) or isinstance(n, bool):
                    continue
                merged[k] = merged.get(k, 0) + n
        return merged, graphs, degraded

    return await _invoke_governed_helper(_run, deadline=deadline)


def _union_nodes_by_label(
    engine: Any, label: str, limit: int
) -> tuple[list[tuple[str, dict[str, Any]]], list[str], list[str]]:
    """Fan `engine.backend.nodes_by_label(label, limit)` out across every graph
    this actor may read and merge, de-duped by node id.

    `nodes_by_label` is a native engine call (`GraphComputeEngine
    .get_nodes_by_label`), not Cypher, so it cannot go through
    `_read_union_cypher` -- this is exactly the "call the engine once per
    accessible graph via `_rows_per_accessible_graph` and merge" case the fix
    lane's own instructions anticipate. Uses `_rows_per_accessible_graph` for
    the per-graph fan-out (same `engine.for_graph`/`use_session` retargeting
    contract as every other union helper here), then applies the commons READ
    catalog restriction (`tenant_sharing.filter_commons_catalog`) to ONLY the
    commons graph's rows before merging -- `nodes_by_label` has no Cypher form
    `apply_commons_catalog_restriction` could inject into, so the row-level
    allowlist function is applied directly here instead (verified: `read_union`
    itself does not call it, so it is this call site's job).

    Returns `(rows, source_graphs, degraded_graphs)`, the same shape
    `_read_union_scalar_sum` returns, so callers can accumulate source/degraded
    sets identically.
    """
    from agent_utilities.knowledge_graph.core.session import current_session
    from agent_utilities.knowledge_graph.core.tenant_sharing import (
        commons_graph_name,
        filter_commons_catalog,
    )

    def _call(scoped_engine: Any) -> list[tuple[str, dict[str, Any]]]:
        fn = getattr(scoped_engine.backend, 'nodes_by_label', None)
        if not callable(fn):
            return []
        return list(fn(label, limit) or [])

    result = _rows_per_accessible_graph(engine, _call)
    if result is None:
        return list(_call(engine)), [], []
    per_graph, degraded = result
    session = current_session()
    actor = session.actor if session is not None else None
    commons = commons_graph_name()
    merged: list[tuple[str, dict[str, Any]]] = []
    seen: set[str] = set()
    source_graphs: list[str] = []
    for graph_name, rows in per_graph:
        source_graphs.append(graph_name)
        clean_rows = [
            (row[0], row[1])
            for row in (rows or [])
            if isinstance(row, (tuple, list)) and len(row) == 2
        ]
        if graph_name == commons and actor is not None:
            props_only = [p if isinstance(p, dict) else {} for _nid, p in clean_rows]
            allowed = filter_commons_catalog(props_only, actor, graph_name)
            allowed_ids = {id(p) for p in allowed}
            clean_rows = [(nid, p) for nid, p in clean_rows if id(p) in allowed_ids]
        for nid, props in clean_rows:
            if isinstance(nid, str):
                if nid in seen:
                    continue
                seen.add(nid)
            merged.append((nid, props))
    return merged, source_graphs, degraded


def _union_engine_call(
    engine: Any, actor: Any, call: Any, *, id_key: str = 'id'
) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    """Fan a native (non-Cypher) engine READ call `call(scoped_engine)` out
    across every graph this actor may read, merging row-shaped dict results
    de-duped by `id_key` (tenant graph wins, matching `read_union`'s own
    semantic; `_rows_per_accessible_graph` already orders its output tenant-
    first). The commons READ catalog restriction (`filter_commons_catalog`)
    is applied to only the commons graph's rows before merging -- same
    reasoning as `_union_nodes_by_label`, for any native call whose results
    are already row/dict-shaped (e.g. `search_hybrid`, `query_impact`) rather
    than the `(id, props)` tuples `nodes_by_label` returns.
    """
    from agent_utilities.knowledge_graph.core.tenant_sharing import (
        commons_graph_name,
        filter_commons_catalog,
    )

    result = _rows_per_accessible_graph(engine, call)
    if result is None:
        return list(call(engine) or []), [], []
    per_graph, degraded = result
    commons = commons_graph_name()
    merged: list[dict[str, Any]] = []
    seen: set[Any] = set()
    source_graphs: list[str] = []
    for graph_name, rows in per_graph:
        source_graphs.append(graph_name)
        rows = [r for r in (rows or []) if isinstance(r, dict)]
        if graph_name == commons and actor is not None:
            rows = filter_commons_catalog(rows, actor, graph_name)
        for row in rows:
            rid = row.get(id_key)
            if rid is None:
                merged.append(row)
                continue
            if rid in seen:
                continue
            seen.add(rid)
            merged.append(row)
    return merged, source_graphs, degraded


@router.get('/graph/nodes')
async def get_graph_nodes(node_type: str | None = None) -> list[dict[str, Any]]:
    """Query Knowledge Graph for nodes of a specific type or all nodes.

    Args:
        node_type: Optional filter for node type (e.g., 'Job', 'Log',
                   'Memory', 'KnowledgeBase')

    Returns:
        List of node dictionaries with properties.
    """
    if node_type and not _SAFE_GRAPH_LABEL.fullmatch(node_type):
        raise HTTPException(status_code=400, detail='Invalid graph node type')
    try:
        try:
            engine = await _get_engine_bounded()
        except HTTPException as exc:
            # CONCEPT:AU-ECO.ui.engine-fallback-reachable -- "no engine"
            # (501) is a distinct condition from a query failing AFTER an
            # engine was acquired (the D-W6-10 hardening below, which stays
            # a hard 503 and is NOT touched by this). Only a genuine 503
            # (bounded deadline/capacity) re-raises here; a still-absent
            # engine degrades to an honest empty list -- the graph simply
            # has nothing to show yet, not a backend malfunction.
            if exc.status_code != 501:
                raise
            return []

        # BUG (this fix): `properties(n)` asked the engine's Cypher RETURN
        # clause to call a function it does not implement. `eg-query`'s
        # `parse_proj_expr` (crates/eg-query/src/cypher/parser.rs) only
        # recognizes a fixed aggregate set (count/collect/sum/avg/min/max)
        # and the special-cased `type(r)` -- there is no general function-
        # call grammar at all, so `properties(n)` fell through to being
        # parsed as a bare `properties` variable followed by a stray `(`,
        # a parse failure the native authority raises back as
        # `CypherEngineError` (live log: "get_graph_nodes failed:
        # error_type=CypherEngineError"). `RETURN n` is not the fix either
        # (api_extensions.py's own history above: that whole-object
        # projection is the ORIGINAL, still-broken bug -- parser-fragile,
        # documented at `get_graph_stats`).
        #
        # There is no scalar-column way to ask Cypher for "all of a node's
        # properties" (the grammar has no wildcard/`RETURN n.*`), so this
        # does not go through Cypher at all: `nodes_by_label` is the
        # engine's OWN purpose-built native replacement for exactly this
        # `MATCH (n[:Label]) ... LIMIT k` shape -- ONE bounded round trip
        # returning `(id, properties)` per node, already decoded
        # (`GraphComputeEngine.get_nodes_by_label`'s docstring: "bounding
        # the wire payload so a MATCH (n:Label) … LIMIT k never
        # materializes the whole graph").
        #
        # BUG (this fix): the previous revision passed `node_type or ''`,
        # believing an empty label meant "no filter" engine-side. It does
        # not. `GraphCore::get_nodes_by_label_page`
        # (`crates/eg-core/src/graph.rs`) opens with
        # `if label.is_empty() { return self.collect_unlabeled(after, limit) }`
        # -- an empty label selects ONLY nodes carrying no label at all,
        # which is the opposite of "everything". So the unfiltered canvas
        # (the default, `node_type=None`) asked for the one bucket the KG
        # has almost nothing in, and the deployed engine build rejected the
        # empty argument outright (live log: "get_graph_nodes failed:
        # error_type=ValueError") -- a 503 on the graph canvas.
        #
        # There is no single "all nodes with properties" engine call, so the
        # unfiltered case enumerates the labels via the engine's own
        # `db.labels()` procedure (`crates/eg-query/src/cypher/proc.rs`) and
        # fans out `nodes_by_label` per label under ONE shared item budget,
        # stopping as soon as the budget is full. The empty-label bucket is
        # queried last, on purpose and for what it actually means: the
        # genuinely unlabeled nodes. A `node_type`-filtered request stays
        # exactly what it was -- a single round trip.
        nodes_by_label = getattr(engine.backend, 'nodes_by_label', None)
        if not callable(nodes_by_label):
            raise HTTPException(
                status_code=503,
                detail='Knowledge Graph node query failed',
            )
        budget = _MAX_EXTERNAL_COLLECTION_ITEMS
        # Leave headroom under the serialized ceiling for the JSON envelope.
        budget_bytes = (_MAX_EXTERNAL_RESULT_BYTES * 3) // 4
        # FIX LANE Priority 1: every `nodes_by_label` call below is fanned out
        # across `_accessible_graphs` and merged (`_union_nodes_by_label`,
        # de-duped by node id, tenant wins, commons READ catalog allowlist
        # applied to commons rows) -- see that helper's docstring for why this
        # goes through `_rows_per_accessible_graph` rather than
        # `_read_union_cypher` (no Cypher form for this native call).
        # `_union_nodes_by_label` itself is a plain sync callable (mirrors
        # `nodes_by_label`'s own shape), so it goes through
        # `_invoke_governed_helper` exactly like the un-unioned call it
        # replaces.
        if node_type:
            rows, node_sources, node_degraded = await _invoke_governed_helper(
                _union_nodes_by_label, engine, node_type, budget, deadline=10.0
            )
            source_graphs = set(node_sources)
            degraded_graphs = set(node_degraded)
        else:
            rows = []
            source_graphs = set()
            degraded_graphs = set()
            for label in await _distinct_graph_labels(engine):
                remaining = budget - len(rows)
                if remaining <= 0:
                    break
                # One label must not be able to blank the whole canvas.
                # Degrading to "every label that COULD be read" is the honest
                # answer; failing all of them because one failed is not. The
                # label is named in the log so the cause stays findable.
                try:
                    page, label_sources, label_degraded = await _invoke_governed_helper(
                        _union_nodes_by_label,
                        engine,
                        label,
                        remaining,
                        deadline=10.0,
                    )
                except Exception as label_error:
                    _log_failure(
                        f'get_graph_nodes.label.{label}',
                        label_error,
                        level=logging.WARNING,
                    )
                    continue
                rows.extend(page or [])
                source_graphs.update(label_sources)
                degraded_graphs.update(label_degraded)
            # The genuinely-unlabeled bucket (`label=''`) is best-effort: the
            # DEPLOYED engine build rejects an empty label argument outright
            # (ValueError), even though `GraphCore::get_nodes_by_label_page`
            # in source handles it via `collect_unlabeled`. Nodes with no
            # label at all are a rounding error next to the labeled graph, so
            # a build that refuses the query must not fail the whole canvas.
            remaining = budget - len(rows)
            if remaining > 0:
                try:
                    page, empty_sources, empty_degraded = await _invoke_governed_helper(
                        _union_nodes_by_label,
                        engine,
                        '',
                        remaining,
                        deadline=10.0,
                    )
                except Exception:
                    logger.debug('engine rejects empty-label read; skipping unlabeled')
                else:
                    rows.extend(page or [])
                    source_graphs.update(empty_sources)
                    degraded_graphs.update(empty_degraded)
        # `source_graphs`/`degraded_graphs` are computed above for
        # observability parity with `get_graph_stats`, but this route's
        # response is a bare JSON array (`list[dict]`, consumed directly by
        # GraphView.tsx's node list) -- there is no envelope field to carry
        # them without breaking that contract. Logged instead so the union's
        # effect stays visible operationally even though it can't ride the
        # response body.
        if degraded_graphs:
            logger.warning(
                'get_graph_nodes: degraded graphs %s (source graphs: %s)',
                sorted(degraded_graphs),
                sorted(source_graphs),
            )
        nodes: list[dict[str, Any]] = []
        for row in rows or []:
            if not isinstance(row, (tuple, list)) or len(row) != 2:
                continue
            node_id, props = row
            if not isinstance(props, dict):
                props = {}
            # `nodes_by_label` indexes the BROADER `GraphCore.label_index`
            # contract (a node's `type`/`node_type`/`label` scalar fields
            # plus the multi-valued `labels` array -- `labels_of` in
            # `crates/eg-core/src/graph.rs`). Cypher's own `(n:Label)`
            # predicate is deliberately narrower -- EXACTLY `node_type` plus
            # the explicit `labels` array (`node_has_label`/
            # `build_cypher_label_index` in `crates/eg-query/src/cypher/
            # exec.rs`, whose comment says this set is "deliberately
            # narrower than `GraphCore.label_index`'s `type`/`node_type`/
            # `label`"). Derive `labels` from EXACTLY those two narrower
            # fields, same as before; both are excluded from `properties`
            # below so a label is never duplicated as an ordinary property.
            labels: list[str] = []
            node_type_prop = props.get('node_type')
            if isinstance(node_type_prop, str) and node_type_prop:
                labels.append(node_type_prop)
            extra_labels = props.get('labels')
            if isinstance(extra_labels, list):
                labels.extend(
                    item
                    for item in extra_labels
                    if isinstance(item, str) and item and item not in labels
                )
            if node_type and node_type not in labels:
                # A broader-index-only match (e.g. a legacy node carrying a
                # bare `type` property but no `node_type`/`labels`; writing
                # `type` is retired going forward -- see
                # `retired_node_type_property_error`). `MATCH (n:<node_type>)`
                # would not have matched it, so a node_type-filtered result
                # must not include it either (kept consistent with the
                # unfiltered list this is filtered from).
                continue
            node = {
                'id': node_id if isinstance(node_id, str) else '',
                'labels': labels,
                'properties': {
                    k: _canvas_property(v)
                    for k, v in props.items()
                    if k not in ('id', 'node_type', 'labels')
                    and not str(k).startswith('_')
                },
            }
            # `_public_external_result` enforces a hard serialized-size bound
            # and raises ValueError past it. That bound is what actually broke
            # this endpoint: a `Skill` node carries its whole SKILL.md body, so
            # 256 of them blow the 2 MiB ceiling and the canvas 503'd -- the
            # failure looked like an engine error but was entirely ours. Keep a
            # running estimate and stop at the budget so the canvas renders
            # what fits instead of nothing at all.
            node, node_size = _canvas_node(node)
            budget_bytes -= node_size
            if budget_bytes <= 0:
                logger.warning(
                    'graph canvas truncated at %d nodes by the result size bound',
                    len(nodes),
                )
                break
            nodes.append(node)
        return _public_external_result(nodes)
    except HTTPException:
        raise
    except Exception as e:
        # D-W6-10: this used to swallow ANY backend failure (including an
        # authorization rejection such as PlacementAuthorityError) into a
        # bare `[]` -- indistinguishable, to both this route's caller and to
        # GraphView.tsx, from a graph that is genuinely empty. Raise instead
        # so the frontend's existing `.catch(() => null)` -> "Failed to load
        # graph database nodes" toast (GraphView.tsx's own fetchData, already
        # wired, previously never fired because a 200 + `[]` looks like
        # success) fires on a REAL failure, and stays silent for a REAL empty
        # graph (which never reaches this except block at all). `_log_failure`
        # already logs the exception TYPE (e.g. `error_type=ValueError`) to
        # the server log without the message/args, so the cause stays legible
        # to an operator reading logs while nothing internal reaches the
        # client response below.
        _log_failure('get_graph_nodes', e)
        raise HTTPException(
            status_code=503,
            detail='Knowledge Graph node query failed',
        ) from e


@router.get('/graph/relationships')
async def get_graph_relationships() -> list[dict[str, Any]]:
    """Query Knowledge Graph for relationships between nodes.

    Returns:
        List of relationship dictionaries with source, target, and type.
    """
    try:
        try:
            engine = await _get_engine_bounded()
        except HTTPException as exc:
            # See the matching note in get_graph_nodes() -- same fix, same
            # reasoning: "no engine" degrades to an honest empty list; a
            # genuine 503 still hard-fails, and D-W6-10's post-acquisition
            # 503 hardening below is untouched.
            if exc.status_code != 501:
                raise
            return []

        query = (
            'MATCH (a)-[r]->(b) RETURN a.id as source, '
            f'type(r) as type, b.id as target LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}'
        )
        # FIX LANE Priority 1: unioned across every graph this actor may read
        # (`_read_union_cypher` -- `tenant_sharing.read_union`, same primitive
        # `get_graph_stats` already uses), not `engine.backend.execute` alone,
        # so relationships among commons-graph nodes (e.g. `Tool`-to-`Server`
        # edges) are visible here too. A relationship row carries no single
        # `id` column, so `read_union`'s id-dedup is a no-op for every row here
        # (its own documented behaviour for an unclassifiable id -- "keep,
        # never drop") -- which is correct: two physically partitioned graphs
        # (GOC-61) never share an edge, so nothing needs de-duplicating.
        result, _source_graphs = await _read_union_cypher(
            engine, query, None, deadline=10.0
        )
        relationships = []
        for row in result:
            relationships.append(
                {
                    'source': row.get('source', ''),
                    'type': row.get('type', ''),
                    'target': row.get('target', ''),
                }
            )
        return _public_external_result(relationships)
    except HTTPException:
        raise
    except Exception as e:
        # D-W6-10: mirror of get_graph_nodes' fix above -- see that comment.
        _log_failure('get_graph_relationships', e)
        raise HTTPException(
            status_code=503,
            detail='Knowledge Graph relationship query failed',
        ) from e


# ---------------------------------------------------------------------------
# 3D knowledge-graph payload (`GET /graph/graph3d`).
#
# WHY THIS ROUTE EXISTS AND IS NOT `/graph/nodes` + `/graph/relationships`:
#
# 1. Those two routes are each bounded by `_MAX_EXTERNAL_COLLECTION_ITEMS`
#    (256). 256 arbitrary nodes and 256 arbitrary edges is enough for a small
#    inspector list; it is NOT a graph -- the 256 edges rarely connect the 256
#    nodes, so a renderer fed from them draws disconnected dust. A 3D view
#    needs a CLOSED payload: every edge's two endpoints present, by
#    construction.
# 2. `/graph/nodes` returns each node's full (truncated) property bag. At the
#    node counts a GPU renderer wants (thousands to tens of thousands) that is
#    megabytes of payload the renderer never draws. This route returns the
#    THREE fields a 3D scene actually needs -- id, type, display name -- and
#    references edge endpoints by ARRAY INDEX rather than repeating the ids.
#    The measured live graph (2,617 edges over 25,221 nodes) serializes to a
#    few hundred KB this way.
#
# ★ THE AGGREGATE IN EVERY QUERY BELOW IS LOAD-BEARING, NOT DECORATION.
#   Measured against the live engine (eg 2.27.0, `platform/graph-os`,
#   2026-08-25): the deployed Cypher executor returns rows ONLY when the
#   RETURN clause contains at least one aggregate. The SAME projection with
#   and without one:
#       MATCH (n:Skill) RETURN n.name as name LIMIT 5          -> []      (!)
#       MATCH (n:Skill) RETURN n.name as name, count(*) as c   -> 308 rows
#       MATCH (a)-[r]->(b) RETURN a.id as s, b.id as o         -> []      (!)
#       MATCH (a)-[r]->(b) RETURN a.id as s, b.id as o,
#                                 count(*) as c                -> 2,617 rows
#   That defect is why `get_graph_relationships` above (a pure non-aggregate
#   projection) answers `[]` on a graph that really has 2,617 edges, and why
#   the existing canvas has never drawn one. This route does not work around
#   it silently: `count(*) as edge_count` is in the RETURN clause with this
#   comment attached, so when the engine is fixed the query still means
#   exactly what it says (group by the projected columns -- for a
#   (source, type, target) triple that IS the edge set, with parallel edges
#   folded into a count the client can render as edge weight).
#
# Bounds are this route's own, deliberately larger than
# `_MAX_EXTERNAL_COLLECTION_ITEMS`, and enforced explicitly below rather than
# through `_public_external_result` (whose 256-item collection ceiling is the
# very limit this route exists to raise). They are still hard ceilings: the
# response is truncated, flagged `truncated: true`, and never silently grown.
# ---------------------------------------------------------------------------

# A GPU point cloud draws 80k nodes in one draw call; the ceiling here is
# about the JSON payload and the layout worker, not the renderer.
_GRAPH3D_MAX_NODES = 80_000
_GRAPH3D_MAX_EDGES = 120_000
# Well under a browser's comfortable single-response size; ~40x the measured
# live payload, so the live graph is nowhere near it.
_GRAPH3D_MAX_RESULT_BYTES = 16 * 1024 * 1024
# A display label, not a document. Long names are truncated, never dropped.
_GRAPH3D_MAX_NAME_CHARS = 120
_GRAPH3D_DEADLINE_SECONDS = 30.0


def _graph3d_label(value: Any, fallback: str) -> str:
    """One node's display name, bounded to a label-sized string."""
    if not isinstance(value, str) or not value:
        return fallback
    if len(value) > _GRAPH3D_MAX_NAME_CHARS:
        return value[:_GRAPH3D_MAX_NAME_CHARS] + '…'
    return value


# Matches one `epistemic_graph_graph_nodes{graph="..."} 56881` exposition line.
# Anchored and non-greedy so a malformed body cannot make it match across lines.
_ENGINE_GRAPH_SIZE_RE = re.compile(
    r'^epistemic_graph_graph_(nodes|edges)\{graph="([^"]*)"\}\s+([0-9]+)\s*$'
)


async def _engine_graph_sizes() -> dict[str, dict[str, int]]:
    """Per-graph node/edge counts as the ENGINE itself reports them.

    ★ WHY THIS EXISTS: every query surface in this file counts what a query
    RETURNS. The engine's own gauges count what its resident topology HOLDS
    (`crates`-side `set_graph_size(graph, topo.graph.node_count(),
    topo.graph.edge_count())`, refreshed on every write). Measured against the
    live pod on 2026-08-26 those two disagree by a lot for the same graph:

        gauge   tenant__homelab____commons__   56,881 nodes   29,992 edges
        query   the same graph, service principal
                                                25,221 nodes    2,617 edges

    Two independent query paths (Cypher `MATCH (n) RETURN count(*)` and the
    SQL `GROUP BY node_type` behind `/graph/node-types`) agree with each other
    on 25,221, so this is not one broken query -- but it is also not something
    a visualization may quietly paper over. A view that draws 2,617 edges and
    captions them "the graph" is wrong by an order of magnitude either way.

    So the payload carries BOTH numbers and the UI states the gap. Resolving
    WHICH is the true user-visible size (row-level visibility filtering? or a
    resident topology that counts internal/tombstoned structure a query
    correctly skips?) is a real open question and is not this route's to
    decide -- it is this route's job not to hide it.

    Best-effort by construction: any failure returns `{}` and the caller
    reports the payload's own counts alone, never a fabricated total.
    """
    try:
        from agent_utilities.observability.gateway_metrics import (
            _fetch_engine_metrics,
        )

        body, ok = await _fetch_engine_metrics()
        if not ok:
            return {}
        sizes: dict[str, dict[str, int]] = {}
        for line in body.decode('utf-8', 'replace').splitlines():
            match = _ENGINE_GRAPH_SIZE_RE.match(line.strip())
            if not match:
                continue
            kind, graph, value = match.groups()
            sizes.setdefault(graph, {})[kind] = int(value)
        return sizes
    except Exception as exc:  # noqa: BLE001 - observability must never fail a read
        logger.debug('engine graph-size gauges unavailable: %s', type(exc).__name__)
        return {}


@router.get('/graph/graph3d')
async def get_graph_3d(include_isolated: bool = False) -> dict[str, Any]:
    """Return a closed node+edge payload sized for a 3D/WebGL renderer.

    Args:
        include_isolated: Also return nodes that participate in no edge. Off
            by default: on the live graph that is ~23,000 of ~25,200 nodes
            (RuntimeSignal/WorkItem/Concept telemetry), which adds payload and
            layout cost while adding no structure to look at. The count is
            always reported so the UI can say how many are being left out
            instead of quietly implying the graph is smaller than it is.

    Returns:
        ``{nodes: [{id, type, name}], edges: [{s, t, r, w}], total_nodes,
        total_relationships, engine_total_nodes, engine_total_relationships,
        connected_nodes, isolated_nodes, truncated, source_graphs,
        degraded_graphs, available}`` where an edge's ``s``/``t`` are INDICES
        into ``nodes`` and ``w`` is the parallel-edge multiplicity.
        ``total_*`` describe THIS payload; ``engine_total_*`` are the engine's
        own gauges for the same graphs (``None`` when unreadable) so a caller
        can see how much of the graph it was handed.
    """
    try:
        try:
            engine = await _get_engine_bounded()
        except HTTPException as exc:
            # Same contract as get_graph_nodes/get_graph_relationships above:
            # "no engine yet" (501) is an honest empty graph, not a failure.
            if exc.status_code != 501:
                raise
            return {
                'nodes': [],
                'edges': [],
                'total_nodes': 0,
                'total_relationships': 0,
                'engine_total_nodes': None,
                'engine_total_relationships': None,
                'connected_nodes': 0,
                'isolated_nodes': 0,
                'truncated': False,
                'source_graphs': [],
                'degraded_graphs': [],
                'available': False,
            }

        # See the ★ note above for why `count(*)` is in this RETURN clause.
        edge_rows, edge_sources = await _read_union_cypher(
            engine,
            'MATCH (a)-[r]->(b) RETURN a.id as s, a.node_type as st, '
            'a.name as sn, type(r) as rt, b.id as t, b.node_type as tt, '
            'b.name as tn, count(*) as edge_count',
            None,
            deadline=_GRAPH3D_DEADLINE_SECONDS,
        )

        index_of: dict[str, int] = {}
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        # The Cypher above is already a GROUP BY on exactly (source, type,
        # target), so a repeated triple cannot come from the data -- it can
        # only come from `_read_union_cypher` running the same query once per
        # accessible graph. Left in, a repeat draws the same line twice at
        # double additive brightness. Deduped here rather than in the renderer
        # so the payload itself is what it claims to be.
        seen_edges: set[tuple[str, str, str]] = set()
        truncated = False

        def intern(node_id: Any, node_type: Any, name: Any) -> int | None:
            if not isinstance(node_id, str) or not node_id:
                return None
            existing = index_of.get(node_id)
            if existing is not None:
                return existing
            if len(nodes) >= _GRAPH3D_MAX_NODES:
                return None
            idx = len(nodes)
            index_of[node_id] = idx
            nodes.append(
                {
                    'id': node_id,
                    'type': node_type
                    if isinstance(node_type, str) and node_type
                    else 'Unknown',
                    'name': _graph3d_label(name, node_id),
                }
            )
            return idx

        for row in edge_rows or []:
            if len(edges) >= _GRAPH3D_MAX_EDGES:
                truncated = True
                break
            source = intern(row.get('s'), row.get('st'), row.get('sn'))
            target = intern(row.get('t'), row.get('tt'), row.get('tn'))
            if source is None or target is None:
                truncated = True
                continue
            key = (
                str(row.get('s')),
                str(row.get('rt')),
                str(row.get('t')),
            )
            if key in seen_edges:
                continue
            seen_edges.add(key)
            weight = row.get('edge_count')
            edges.append(
                {
                    's': source,
                    't': target,
                    'r': row.get('rt') if isinstance(row.get('rt'), str) else '',
                    'w': weight if isinstance(weight, int) and weight > 0 else 1,
                }
            )

        connected_nodes = len(nodes)
        node_sources = list(edge_sources or [])

        if include_isolated:
            # Same aggregate-forced shape, for the same reason.
            all_rows, all_sources = await _read_union_cypher(
                engine,
                'MATCH (n) RETURN n.id as id, n.node_type as nt, n.name as nn, '
                'count(*) as node_count',
                None,
                deadline=_GRAPH3D_DEADLINE_SECONDS,
            )
            node_sources = sorted(set(node_sources) | set(all_sources or []))
            for row in all_rows or []:
                if intern(row.get('id'), row.get('nt'), row.get('nn')) is None:
                    truncated = True

        # The engine's own view of the same graphs, so the UI can say how much
        # of the graph it is actually drawing instead of implying it is all of
        # it. See `_engine_graph_sizes` for the measured discrepancy this
        # exists to surface.
        engine_sizes = await _engine_graph_sizes()
        engine_nodes = 0
        engine_edges = 0
        for graph in node_sources:
            engine_nodes += engine_sizes.get(graph, {}).get('nodes', 0)
            engine_edges += engine_sizes.get(graph, {}).get('edges', 0)

        payload: dict[str, Any] = {
            'nodes': nodes,
            'edges': edges,
            # Reported from THIS payload, never from a second stats call: the
            # numbers a caller reads must describe the bytes it was handed.
            'total_nodes': len(nodes),
            'total_relationships': len(edges),
            # `null` when the gauges could not be read -- distinct from 0.
            'engine_total_nodes': engine_nodes if engine_sizes else None,
            'engine_total_relationships': engine_edges if engine_sizes else None,
            'connected_nodes': connected_nodes,
            'isolated_nodes': max(0, len(nodes) - connected_nodes),
            'truncated': truncated,
            'source_graphs': sorted(node_sources),
            'degraded_graphs': [],
            'available': True,
        }
        encoded = len(
            json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode(
                'utf-8'
            )
        )
        if encoded > _GRAPH3D_MAX_RESULT_BYTES:
            raise HTTPException(
                status_code=422,
                detail='Graph payload exceeds the 3D view size bound',
            )
        return payload
    except HTTPException:
        raise
    except Exception as e:
        # Same D-W6-10 contract as the two routes above: a real failure is a
        # real failure, never an empty graph.
        _log_failure('get_graph_3d', e)
        raise HTTPException(
            status_code=503,
            detail='Knowledge Graph 3D query failed',
        ) from e


# Bounds the node-type breakdown's `GROUP BY` result. The node-type/label
# vocabulary is a finite, curated ontology (~46 distinct values live) -- 200
# is generous headroom over any realistic cardinality while still bounding a
# pathological/malformed `node_type` property fan-out. The route reports
# `truncated` when the result actually reaches this bound, so a clipped tail
# is never presented as the whole distribution.
_GRAPH_STATS_BY_TYPE_LIMIT = 200

# Deadline for the node-type breakdown (`/graph/node-types`). Named (rather
# than left as a bare literal) so the value carries its measurement
# rationale and so the regression tests can drive the real deadline path.
#
# Measured in-pod (graph-os), per single isolated request:
#   * 25,121-row tenant graph, 2026-08-25, service principal
#       - `SELECT COUNT(*) FROM nodes` .......................... 0.07s
#       - `MATCH (a)-[r]->(b) RETURN count(r)` .................. 0.52s
#       - `SELECT node_type, COUNT(*) ... GROUP BY node_type` ... 5.49s
#         (the engine itself logged `slow engine call op=query.sql
#          duration=5.48s (threshold=1.0s); engine likely contended`)
#   * the SAME aggregate on an earlier run, under load ......... 22.39s
#   * 25,118-row tenant graph, service principal
#       - `op=query.cypher_read` (the two REQUIRED total-count aggregates)
#         ....  1.24s and 1.61s -- comfortably inside their own 10s deadline
#       - `op=query.sql` (this `GROUP BY` breakdown) ....  22.39s
#   * 1,124-row view (the same route, the owner's browser)
#       - end-to-end route ....  2.5s .. 12.9s, all 200
#
# The breakdown is 10-80x more expensive than the totals beside it, and a
# caller-side timeout does NOT release the `_SYNC_WORK_EXECUTOR` slot -- it
# stays charged until the underlying call finishes (see
# `_BoundedSyncWorkExecutor`: "A caller timeout does not release capacity for
# work that Python cannot cancel"), so shortening the deadline buys caller
# latency and nothing else. The conclusion drawn from that measurement at the
# time -- pin the deadline at 10s and let the breakdown degrade -- was the
# wrong half of the fix. A 22s aggregate
# behind a 10s deadline degrades EVERY time at production row counts, so
# `/graph/stats` structurally could not return a real breakdown; what the
# dashboard actually rendered as "counts by type" came from a different
# source entirely (`GraphLegend` grouping the 256-node `/graph/nodes` page --
# see that route). The fix is structural, not numeric:
#
# * The breakdown no longer rides `/graph/stats` at all. It has its own route
#   (`/graph/node-types`), so the headline Nodes/Edges totals (~1.2-1.6s) are
#   never held behind it and the UI loads the two independently.
# * That route gets a budget that fits the MEASURED cost (22.4s), not one the
#   query cannot meet. 45s is ~2x the measurement -- headroom for engine
#   contention without being unbounded.
# * Because a caller-side timeout does NOT release the `_SYNC_WORK_EXECUTOR`
#   slot (see `_BoundedSyncWorkExecutor`), a 45s call could otherwise pin 1 of
#   only 4 shared slots for 45s per concurrent caller. `_NODE_TYPE_SLOT`
#   below admits exactly one breakdown at a time so this route can never take
#   more than one slot, however many browsers ask for it at once.
#
# Deliberately NOT solved with a cache: a cache would hide the cost rather
# than budget for it, and would make a stale distribution indistinguishable
# from a live one -- the same "looks authoritative, isn't" defect class the
# rest of this route exists to close.
_GRAPH_STATS_BY_TYPE_DEADLINE_SECONDS = 45.0

# Single-flight admission for the expensive breakdown above. Non-blocking: a
# second concurrent caller is told so (503) rather than queued behind a 45s
# call, which is both faster to fail and impossible to mistake for a result.
_NODE_TYPE_SLOT = threading.BoundedSemaphore(1)


def _by_type_degraded_graphs() -> list[str]:
    """Every graph the `by_type` breakdown was SUPPOSED to cover, for a
    degrade to report as skipped.

    Without this, a degraded breakdown returned `({}, [], [])` -- an empty
    `by_type` with an EMPTY `degraded_graphs`, which `get_graph_stats`
    renders as `partial: False`. That made "the breakdown timed out" look
    byte-identical to "this graph genuinely holds no typed nodes", the exact
    failure mode the rest of this route was built to make impossible. The
    breakdown is a union read (`_read_union_sql_group_counts` ->
    `_rows_per_accessible_graph`), so when it fails as a whole the set it
    failed to cover is the ambient actor's accessible graphs.

    Best-effort by construction: this runs on an error path, so it must not
    be able to raise a second, more confusing failure out of the degrade.
    """
    from agent_utilities.knowledge_graph.core.session import current_session

    try:
        session = current_session()
        if session is None:
            return []
        return _accessible_graphs(session.actor)
    except Exception as exc:  # noqa: BLE001 — a degrade must never itself raise
        _log_failure('graph_stats.by_type_degraded_graphs', exc, level=logging.DEBUG)
        return []


async def _by_type_call(
    engine: Any,
) -> tuple[dict[str, int], list[str], list[str]]:
    """The REAL node-type distribution: one `GROUP BY node_type` aggregate
    over every node in every graph this actor may read, with its own
    fail-soft degrade.

    This is an aggregate, not a page. The distinction is the whole point of
    this function: the number a person reads as "how much of what is in this
    graph" must be computed by the engine over ALL rows. The dashboard's
    previous "counts by type" was `GraphLegend` grouping the 256-row
    `/graph/nodes` sample, which summed to exactly the sample size (256) and
    named only the alphabetically-first labels that fitted in it -- an
    arbitrary slice presented as a distribution.

    Contract: failing degrades to `({}, [], <accessible graphs>)` -- an empty
    breakdown plus the graphs it could not cover -- so the route reports the
    response as `partial` rather than as a genuinely empty distribution.
    """
    try:
        return await _read_union_sql_group_counts(
            engine,
            f'SELECT node_type, COUNT(*) AS n FROM nodes GROUP BY node_type '
            f'ORDER BY n DESC LIMIT {_GRAPH_STATS_BY_TYPE_LIMIT}',
            key='node_type',
            count_field='n',
            deadline=_GRAPH_STATS_BY_TYPE_DEADLINE_SECONDS,
        )
    except HTTPException as e:
        # 503 from this call means exactly "the bounded sync budget said no"
        # (deadline exceeded, or capacity exhausted) -- both are precisely
        # what this call is allowed to degrade on, and both must render as
        # an explicitly-partial response rather than as an empty
        # distribution. Any OTHER status is a real, differently-shaped
        # failure and still propagates unchanged.
        if e.status_code != 503:
            raise
        _log_failure('graph_stats.by_type_degraded', e, level=logging.WARNING)
        return {}, [], _by_type_degraded_graphs()
    except Exception as e:
        # Second-line net for a totally unexpected failure shape. It still
        # degrades rather than 500s, but it degrades HONESTLY -- reporting
        # the graphs it failed to cover, so the caller can tell "the
        # breakdown did not run" from "these graphs hold no typed nodes".
        _log_failure('api_extension', e, level=logging.DEBUG)
        return {}, [], _by_type_degraded_graphs()


@router.get('/graph/stats')
async def get_graph_stats() -> dict[str, Any]:
    """Headline Knowledge-Graph totals: node count and relationship count.

    The per-type breakdown deliberately does NOT live here -- it is
    `/graph/node-types`, a separate route with its own budget and its own
    single-flight admission. Measured in-pod, the two totals below cost
    ~1.2-1.6s while the `GROUP BY` breakdown costs ~22.4s on the same graph;
    keeping them in one response meant either the totals waited on the
    breakdown or the breakdown degraded on every request. Splitting them lets
    the UI render fast, trustworthy totals immediately and load the expensive
    distribution independently.

    Returns:
        `total_nodes`, `total_relationships`, `available`, plus the union-read
        provenance every read on this route carries (`source_graphs`,
        `degraded_graphs`, `partial`) so a narrowed or partly-failed read can
        never be rendered as an authoritative one.
    """
    try:
        try:
            engine = await _get_engine_bounded()
        except HTTPException as exc:
            # CONCEPT:AU-ECO.ui.engine-fallback-reachable -- get_engine()
            # raises HTTPException(501) rather than returning None, so the
            # `if not engine` degrade below was unreachable dead code (every
            # no-engine request 501'd first). Only a genuine 503 (bounded
            # deadline/capacity) still hard-fails here; "not initialized"
            # (501) degrades to the explicitly-marked response below.
            # `available: False` keeps this HONEST -- distinguishable from a
            # real empty graph -- per the no-fabrication charter rule (see
            # this lane's report; a sibling fabrication bug was fixed in this
            # same file today in update_backend_config()).
            if exc.status_code != 501:
                raise
            return {
                'total_nodes': 0,
                'total_relationships': 0,
                'available': False,
            }
        if not engine or not engine.backend:
            return {
                'total_nodes': 0,
                'total_relationships': 0,
                'available': False,
            }

        # Get total counts (Test expects these first). FIX LANE Priority 1:
        # summed across every graph this actor may read (tenant shard +
        # commons/ancestors -- `_read_union_scalar_sum`), not `session.graph`
        # alone, so the fleet/tool catalog (written to commons by design,
        # `tenant_sharing.COMMONS_SHAREABLE_NODE_TYPES`) is actually counted
        # instead of silently invisible to this endpoint. `_degraded` is
        # this call's OWN accessible-but-unreadable graphs (e.g. a shard
        # mid-`PARTIAL_MATERIALIZATION` rebuild) -- merged into the response
        # below alongside the other two calls' degraded sets so a partial
        # total is never reported identically to a complete one.
        #
        # PERF (this fix lane): the three aggregate calls below are each
        # independently expensive engine-side (measured 8-12s total for a
        # ~25k-node tenant, serialized) and share no state, so they now run
        # CONCURRENTLY via `asyncio.gather` instead of being awaited one
        # after another -- roughly a 3x wall-clock reduction with no change
        # to per-call engine cost. This is safe for ambient-session
        # propagation without any extra plumbing here: each coroutine
        # `asyncio.gather` schedules becomes its own `asyncio.Task`, and
        # asyncio's own `Task` creation already snapshots the CURRENT
        # `contextvars.Context` at creation time (stdlib behaviour, not
        # something this call site has to arrange) -- so all three tasks
        # see the SAME `current_session()` this request already has bound,
        # exactly as the sequential `await` chain did. Underneath, each of
        # the three still goes through `_invoke_governed_helper` ->
        # `_SYNC_WORK_EXECUTOR.submit()`, which ALSO does its own
        # `contextvars.copy_context()` per submission (see that class'
        # `submit()` above) before crossing into a worker thread -- the
        # same load-bearing pattern `_rows_per_accessible_graph` uses for
        # its inner per-graph fan-out. Verified directly (not just by
        # reading the stdlib docs) in
        # `__tests__/test_api_extensions.py::test_get_graph_stats_concurrent_calls_preserve_session`,
        # which asserts the actor bound to the ambient session is visible
        # inside all three concurrently-running calls.
        #
        # ENGINE-BREAKER / CAPACITY: this does multiply the worst-case
        # in-flight fan-out for ONE request (3 outer calls x up to
        # `_READ_UNION_MAX_WORKERS`=8 inner per-graph threads = up to 24
        # transient threads, vs 8 today) -- but it does not bypass the
        # existing admission control. All three outer calls still go
        # through the SAME shared, bounded `_SYNC_WORK_EXECUTOR`
        # (`_MAX_SYNC_WORKERS`=4, `_MAX_SYNC_PENDING`=8): once that budget
        # is exhausted, `.submit()` raises `SyncWorkCapacityError`, which
        # `_invoke_governed_helper` already converts into a clean 503
        # ("Synchronous backend capacity is exhausted") rather than
        # unbounded engine fan-out. The engine's own circuit breaker
        # (`agent_utilities...core.engine_breaker.CircuitBreaker`) only
        # trips on transport-level failures (`OSError`/`EOFError` -- a dead
        # or unreachable socket), never on call volume alone, so 3x'ing
        # this one route's demand on an already-bounded pool does not by
        # itself risk tripping it. The one real cost: while a
        # `get_graph_stats` request is in flight, it now holds up to 3 of
        # the 4 global `_SYNC_WORK_EXECUTOR` slots at once (vs 1 before),
        # so a second concurrent caller of THIS route (or of any other sync
        # route sharing that pool) has less headroom and is more likely to
        # see that capacity 503 under concurrent load on this one endpoint.
        # Kept deliberately simple: no new semaphore/bound was added here,
        # because the existing shared executor is already the intended
        # single choke point for this class of resource, and it already
        # fails honestly (503) rather than silently overloading anything.
        (
            (total_nodes, node_source_graphs, node_degraded),
            (total_relationships, rel_source_graphs, rel_degraded),
        ) = await asyncio.gather(
            _read_union_scalar_sum(
                engine,
                'MATCH (n) RETURN count(n) as count',
                None,
                field='count',
                deadline=10.0,
            ),
            _read_union_scalar_sum(
                engine,
                # BUG-262: the engine's native Cypher parser rejects a
                # relationship pattern with BOTH endpoints anonymous
                # (`()-[r]->()`) -- it raised a masked PermissionError that
                # this function's outer `except` turned into a 503 for the
                # WHOLE stats response, so GraphView's "Nodes"/"Edges"
                # summary badges stayed at their `0` default even when the
                # graph held data (matches `/graph/relationships` below,
                # which already uses named endpoints and works). Verified
                # live against the cluster engine: the anonymous form fails
                # with error_class=PermissionError/failing_layer=
                # knowledge_graph; the named form returns the correct count.
                'MATCH (a)-[r]->(b) RETURN count(r) as count',
                None,
                field='count',
                deadline=10.0,
            ),
        )

        # Observability requirement (FIX LANE Priority 1): which physical
        # graph(s) this response actually drew from, additive so a narrowed
        # view can never again look identical to a complete one without
        # anyone noticing. Non-strict frontend zod schemas (`graphStatsSchema`
        # et al.) tolerate an unrecognized field -- see this lane's report
        # for whether a frontend change is wanted to surface it.
        source_graphs = sorted(set(node_source_graphs) | set(rel_source_graphs))
        # FIX LANE Priority 2 (Defect 2): the sibling half of the fail-soft
        # fix -- every accessible graph that was skipped by ANY of the three
        # union reads above, so a partial response is never indistinguishable
        # from a complete one. Non-empty exactly when this response is a
        # degrade, not a full union.
        degraded_graphs = sorted(set(node_degraded) | set(rel_degraded))

        return {
            'total_nodes': total_nodes,
            'total_relationships': total_relationships,
            # Explicit counterpart to the two `available: False` degrade
            # responses above -- the frontend schema now keeps this field
            # (previously stripped by GraphView's zod schema, which made an
            # unavailable engine render identically to a genuinely empty
            # graph) rather than inferring "available" from its absence.
            'available': True,
            'source_graphs': source_graphs,
            'degraded_graphs': degraded_graphs,
            'partial': bool(degraded_graphs),
        }
    except HTTPException:
        raise
    except Exception as e:
        # D-W6-10 (get_graph_stats' narrower related gap, named alongside the
        # get_graph_nodes/get_graph_relationships fix above): a failure of the
        # total_nodes/total_relationships queries themselves used to render as
        # a fake "genuinely empty" {0, 0, {}} response -- identical to a real
        # empty graph, with no signal anything went wrong. The per-node-type
        # loop above intentionally keeps its own narrower degrade (one label's
        # count failing should not take down the whole stats response), but a
        # failure of the two TOTAL-count queries is a real backend failure and
        # must surface as one.
        _log_failure('get_graph_stats', e)
        raise HTTPException(
            status_code=503,
            detail='Knowledge Graph stats query failed',
        ) from e


@router.get('/graph/node-types')
async def get_graph_node_types() -> dict[str, Any]:
    """The Knowledge Graph's REAL node-type distribution.

    Deliberately a separate route from `/graph/stats`, not a field on it.
    Measured in-pod against the live 25,121-node graph: `COUNT(*)` over
    `nodes` answers in ~0.07s and the two Cypher totals in ~1.2-1.6s, while
    the `GROUP BY node_type` aggregate costs 5.5s uncontended and has been
    measured at 22.4s under engine contention. Sharing one response forced a
    false choice -- either the headline totals waited on the breakdown, or
    (as shipped) the breakdown degraded to `{}` on essentially every
    production request. Two routes, two budgets, two independent frontend
    loads: totals stay fast and the distribution is allowed to be slow.

    NOT cached, on purpose. A cache would hide the cost rather than budget
    for it, and would make a stale distribution indistinguishable from a live
    one -- exactly the "reads authoritative, isn't" failure this route exists
    to end.

    Admission: `_NODE_TYPE_SLOT` admits one breakdown at a time. A caller
    timeout does not release a `_SYNC_WORK_EXECUTOR` slot (see
    `_BoundedSyncWorkExecutor`), so without this a handful of browsers could
    pin the whole 4-slot shared pool for 45s each. A second concurrent caller
    gets an immediate, explicit 503 instead of queueing invisibly.

    Returns:
        `by_type` (node_type -> count, descending), `type_count`,
        `total_typed_nodes` (the sum, which the caller can compare against
        `/graph/stats`' `total_nodes` to see the untyped remainder),
        `truncated` (the result actually hit `_GRAPH_STATS_BY_TYPE_LIMIT`, so
        a tail was clipped), `available`, and the union-read provenance
        (`source_graphs`, `degraded_graphs`, `partial`).
    """
    if not _NODE_TYPE_SLOT.acquire(blocking=False):
        raise HTTPException(
            status_code=503,
            detail='A node-type breakdown is already running; retry shortly',
        )
    try:
        try:
            engine = await _get_engine_bounded()
        except HTTPException as exc:
            # Same contract as `get_graph_stats`: a 501 ("engine not
            # initialized") is a knowable state and is reported as one --
            # `available: False`, never as a genuinely empty distribution.
            if exc.status_code != 501:
                raise
            return _empty_node_type_breakdown()
        if not engine or not engine.backend:
            return _empty_node_type_breakdown()

        counts, source_graphs, degraded_graphs = await _by_type_call(engine)
        ordered = dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))
        return {
            'by_type': ordered,
            'type_count': len(ordered),
            'total_typed_nodes': sum(ordered.values()),
            'truncated': len(ordered) >= _GRAPH_STATS_BY_TYPE_LIMIT,
            'available': True,
            'source_graphs': sorted(set(source_graphs)),
            'degraded_graphs': sorted(set(degraded_graphs)),
            'partial': bool(degraded_graphs),
        }
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('get_graph_node_types', e)
        raise HTTPException(
            status_code=503,
            detail='Knowledge Graph node-type breakdown failed',
        ) from e
    finally:
        _NODE_TYPE_SLOT.release()


def _empty_node_type_breakdown() -> dict[str, Any]:
    """The `available: False` shape -- "we could not ask", never "there is
    nothing". Kept as one function so both no-engine paths above cannot
    drift apart.
    """
    return {
        'by_type': {},
        'type_count': 0,
        'total_typed_nodes': 0,
        'truncated': False,
        'available': False,
        'source_graphs': [],
        'degraded_graphs': [],
        'partial': False,
    }


# ---------------------------------------------------------------------------
# Knowledge Graph CRUD Endpoints
# ---------------------------------------------------------------------------


@router.post('/graph/memory')
async def add_memory(data: dict[str, Any]) -> dict[str, Any]:
    """Add a new memory node to the Knowledge Graph.

    Args:
        data: Dictionary containing memory data (id, content, importance, tags, etc.)

    Returns:
        Success status and created memory ID.
    """
    try:
        from agent_utilities.models.knowledge_graph import MemoryNode

        engine = await _get_engine_bounded()

        data_copy = _bounded_query_params(data)
        safe_copy, _privacy_report = sanitize_for_persistence(data_copy)
        if not isinstance(safe_copy, dict):
            raise HTTPException(status_code=400, detail='Invalid memory record')
        data_copy = safe_copy
        if 'name' not in data_copy:
            data_copy['name'] = data_copy.get('content', 'Memory Node')[:50]

        memory = MemoryNode(**data_copy)
        await _invoke_governed_helper(engine.add_memory_node, memory, deadline=10.0)
        return {'status': 'success', 'id': memory.id}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('add_memory', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.get('/graph/memory/{memory_id}')
async def get_memory(memory_id: str) -> dict[str, Any]:
    """Retrieve a specific memory node from the Knowledge Graph.

    Args:
        memory_id: The unique identifier of the memory node.

    Returns:
        Memory node data or 404 if not found.
    """
    try:
        memory_id = _validate_runtime_id(memory_id)
        engine = await _get_engine_bounded()

        memory = await _invoke_governed_helper(
            engine.get_memory_node, memory_id, deadline=10.0
        )
        if not memory:
            raise HTTPException(status_code=404, detail='Memory not found')

        bounded = _public_external_result(memory.model_dump())
        if not isinstance(bounded, dict):
            raise HTTPException(status_code=422, detail='Invalid memory record')
        return bounded
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('get_memory', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.put('/graph/memory/{memory_id}')
async def update_memory(memory_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Update an existing memory node in the Knowledge Graph.

    Args:
        memory_id: The unique identifier of the memory node.
        data: Dictionary containing updated memory data.

    Returns:
        Success status.
    """
    try:
        from agent_utilities.models.knowledge_graph import MemoryNode

        memory_id = _validate_runtime_id(memory_id)
        engine = await _get_engine_bounded()

        data_copy = _bounded_query_params(data)
        safe_copy, _privacy_report = sanitize_for_persistence(data_copy)
        if not isinstance(safe_copy, dict):
            raise HTTPException(status_code=400, detail='Invalid memory record')
        data_copy = safe_copy
        data_copy['id'] = memory_id
        # Also ensure name is present as it's required in RegistryNode
        if 'name' not in data_copy:
            data_copy['name'] = data_copy.get('content', 'Memory Node')[:50]

        updated_memory = MemoryNode(**data_copy)
        await _invoke_governed_helper(
            engine.update_memory_node, memory_id, updated_memory, deadline=10.0
        )
        return {'status': 'success'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('update_memory', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.delete('/graph/memory/{memory_id}')
async def delete_memory(memory_id: str) -> dict[str, Any]:
    """Delete a memory node from the Knowledge Graph.

    Args:
        memory_id: The unique identifier of the memory node.

    Returns:
        Success status.
    """
    try:
        memory_id = _validate_runtime_id(memory_id)
        engine = await _get_engine_bounded()

        await _invoke_governed_helper(
            engine.delete_memory_node, memory_id, deadline=10.0
        )
        return {'status': 'success'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('delete_memory', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/graph/link')
async def link_nodes(data: dict[str, Any]) -> dict[str, Any]:
    """Create a relationship between two nodes in the Knowledge Graph.

    Args:
        data: Dictionary containing source, target, relationship_type, and properties.

    Returns:
        Success status.
    """
    try:
        source = _validate_runtime_id(data.get('source', ''))
        target = _validate_runtime_id(data.get('target', ''))
        relationship_type = data.get('relationship_type')
        if not isinstance(relationship_type, str) or not _SAFE_GRAPH_LABEL.fullmatch(
            relationship_type
        ):
            raise HTTPException(status_code=400, detail='Invalid relationship type')
        properties = _bounded_query_params(data.get('properties', {}))
        safe_properties, _privacy_report = sanitize_for_persistence(properties)
        if not isinstance(safe_properties, dict):
            raise HTTPException(status_code=400, detail='Invalid link properties')

        engine = await _get_engine_bounded()

        await _invoke_governed_helper(
            engine.link_nodes,
            source,
            target,
            relationship_type,
            safe_properties,
            deadline=10.0,
        )
        return {'status': 'success'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.get('/graph/search')
async def hybrid_search(query: str, top_k: int = 10) -> list[dict[str, Any]]:
    """Perform hybrid search across the Knowledge Graph.

    Args:
        query: Search query string.
        top_k: Maximum number of results to return.

    Returns:
        List of matching nodes with relevance scores.
    """
    if not query.strip() or len(query.encode('utf-8')) > 8192:
        raise HTTPException(status_code=400, detail='Invalid search query')
    if not 1 <= top_k <= 100:
        raise HTTPException(status_code=400, detail='Invalid result limit')
    try:
        engine = await _get_engine_bounded()

        # FIX LANE Priority 1: `search_hybrid` is a native ranked-retrieval
        # call with no Cypher form (`_read_union_cypher` does not apply), so
        # this fans it out per accessible graph via `_union_engine_call`
        # (`_rows_per_accessible_graph` underneath) and merges by node id --
        # the fleet/tool catalog is otherwise invisible to hybrid search from
        # a webui session exactly like it was to `/graph/nodes`. `top_k` is
        # pushed down to EACH per-graph call (not fetched unbounded then
        # sliced) -- the merge below still trims to the caller's `top_k` after
        # de-duping, since the union of two `top_k`-bounded shards can exceed
        # `top_k`.
        from agent_utilities.knowledge_graph.core.session import current_session

        session = current_session()
        actor = session.actor if session is not None else None

        def _call(scoped_engine: Any) -> list[dict[str, Any]]:
            return list(scoped_engine.search_hybrid(query, top_k=top_k) or [])

        results, _source_graphs, degraded = await _invoke_governed_helper(
            _union_engine_call, engine, actor, _call, deadline=15.0
        )
        if not results and degraded:
            # ROOT CAUSE of the observed live non-determinism (item C/F:
            # identical successive `/graph/search` calls returning 5 results,
            # then 0): `_union_engine_call` -> `_rows_per_accessible_graph`
            # fan-out is fail-SOFT per graph by design (a per-graph exception
            # is logged and the graph is added to `degraded`, never raised --
            # see that function's own docstring). This route used to discard
            # `degraded` entirely (`_degraded`), so when EVERY accessible
            # graph's `search_hybrid` call happened to fail on a given
            # request (contention/timeout), the union quietly degraded to a
            # legitimate-looking `results=[]` -- a 200 indistinguishable from
            # "reachable, genuinely zero matches". The very next identical
            # request, with no failure this time, returned the real hits.
            # Distinguish the two: zero results with at least one graph that
            # could not even be read is a failure (503, same D-W6-10 class as
            # get_graph_nodes/get_graph_relationships/list_workflows), not an
            # honest empty answer. Zero results with `degraded` empty (every
            # accessible graph was actually read) stays a genuine 200 [].
            _log_failure('search_graph', RuntimeError(f'degraded graphs: {degraded}'))
            raise HTTPException(
                status_code=503,
                detail='Knowledge Graph search failed',
            )
        bounded = _public_external_result(list(results or [])[:top_k])
        return bounded if isinstance(bounded, list) else []
    except HTTPException as exc:
        # "No engine" (501) degrades to an honest empty list -- same as
        # get_graph_nodes/relationships/workflows treat it (D-W6-10); a
        # genuine 503 (bounded deadline/capacity, or the all-graphs-degraded
        # case just above) still hard-fails below.
        if exc.status_code == 501:
            return []
        raise
    except Exception as e:
        # D-W6-10 (same class of fix as get_graph_nodes/get_graph_relationships/
        # list_workflows): a failure raised OUTSIDE the fail-soft per-graph
        # fan-out above (e.g. `_invoke_governed_helper`'s own deadline/capacity
        # handling, or an error before/after the union call) must also surface
        # as a distinguishable failure, not a fabricated `200 []`.
        _log_failure('search_graph', e)
        raise HTTPException(
            status_code=503,
            detail='Knowledge Graph search failed',
        ) from e


@router.get('/graph/impact/{symbol}')
async def get_impact(symbol: str) -> list[dict[str, Any]]:
    """Calculate the topological impact set for a code entity.

    Args:
        symbol: The symbol or file identifier to analyze.

    Returns:
        List of affected nodes and impact severity.
    """
    if not symbol.strip() or len(symbol.encode('utf-8')) > 2048:
        raise HTTPException(status_code=400, detail='Invalid impact symbol')
    try:
        engine = await _get_engine_bounded()

        # FIX LANE Priority 1: `query_impact` is a native BFS-traversal call
        # with no Cypher form, fanned out per accessible graph and merged by
        # node id (`_union_engine_call`), same reasoning as `hybrid_search`
        # above. The traversal itself is graph-local (edges never cross a
        # GOC-61 graph boundary), so `symbol` resolves in at most one
        # accessible graph -- the other graph(s) cheaply return `[]` via
        # `query_impact`'s own `has_node` early-return, not an error.
        from agent_utilities.knowledge_graph.core.session import current_session

        session = current_session()
        actor = session.actor if session is not None else None

        def _call(scoped_engine: Any) -> list[dict[str, Any]]:
            return list(scoped_engine.query_impact(symbol) or [])

        impact_set, _source_graphs, _degraded = await _invoke_governed_helper(
            _union_engine_call, engine, actor, _call, deadline=15.0
        )
        bounded = _public_external_result(
            list(impact_set or [])[:_MAX_EXTERNAL_COLLECTION_ITEMS]
        )
        return bounded if isinstance(bounded, list) else []
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('get_impact', e)
        return []


@router.post('/graph/query')
async def execute_cypher(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Execute a custom Cypher query against the Knowledge Graph.

    Args:
        data: Dictionary containing 'query' and optional 'params'.

    Returns:
        Query results.
    """
    try:
        query = _validate_read_only_cypher(data.get('query'))
        params = _bounded_query_params(data.get('params', {}))

        engine = await _get_engine_bounded()

        # FIX LANE Priority 1: unioned across every graph this actor may read
        # (`_read_union_cypher`). Safe to union unconditionally -- unlike a
        # general Cypher surface, `_validate_read_only_cypher` above has
        # ALREADY rejected any mutating clause (CREATE/MERGE/DELETE/SET/
        # REMOVE/CALL/...); every query reaching this point is a bounded read,
        # so there is no write-vs-read branch to preserve here (the union
        # helper itself never touches `session.graph`'s write path either
        # way).
        result, _source_graphs = await _read_union_cypher(
            engine, query, params, deadline=15.0
        )
        if not isinstance(result, list):
            raise ValueError('Graph query returned an invalid result shape')
        bounded_result = _bounded_external_value(
            result[:_MAX_EXTERNAL_COLLECTION_ITEMS]
        )
        if not isinstance(bounded_result, list):
            raise HTTPException(status_code=422, detail='Invalid query result')
        try:
            response_size = len(
                json.dumps(
                    bounded_result,
                    separators=(',', ':'),
                    ensure_ascii=False,
                    allow_nan=False,
                ).encode('utf-8')
            )
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail='Invalid query result') from exc
        if response_size > _MAX_EXTERNAL_RESULT_BYTES:
            raise HTTPException(status_code=422, detail='Query result is too large')
        return bounded_result
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('execute_query', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


# ---------------------------------------------------------------------------
# Native visualization (D-VZ-1 lane w6-viz-xy) — renders a ViewSpec through the
# eg-viz LOD ColumnStore/export pipeline (Method::Viz on the epistemic-graph
# engine) and returns the resulting PNG/SVG/PDF bytes as a data: URL. The image
# is rendered server-side (Rust) at a bounded primitive/byte budget regardless
# of how many rows the request describes -- this is the mechanism that lets a
# 100M-row scatter or a 100k-node graph render in the browser without shipping
# 100M points over the wire. See plans/au-eg-program/program/visualization-native.md.
# ---------------------------------------------------------------------------
_MAX_VIZ_RESPONSE_BYTES = 20 * 1024 * 1024


@router.get('/graph/viz/capabilities')
async def get_viz_capabilities() -> dict[str, Any]:
    """Return the eg-viz mark/surface capability matrix (what's renderable today)."""
    try:
        engine = await _get_engine_bounded()
        if not engine or not engine.backend:
            raise HTTPException(status_code=503, detail='Graph engine not available')
        client = engine.backend._graph.client
        result = await _invoke_governed_helper(
            client.viz.capability_matrix, deadline=10.0
        )
        return _bounded_external_value(result)
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('viz_capabilities', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/graph/viz/render')
async def render_viz(data: dict[str, Any]) -> dict[str, Any]:
    """Render a chart or graph through the eg-viz LOD pipeline.

    Body: ``{"spec": <ViewSpec JSON>, "dataset": <VizDatasetSource JSON>,
    "width_px", "height_px", "format" ("png"|"svg"|"pdf"), "max_primitives",
    "max_bytes"}``. ``dataset`` may be an ``InlineColumns`` payload (small,
    caller-supplied data) or a ``SyntheticScatterClusters``/``SyntheticGraph``
    generator spec -- the latter are generated ENGINE-SIDE (never shipped over
    the wire), which is how a high-density demo (millions of rows / tens of
    thousands of graph nodes) stays a small request.

    Returns ``{"view_result", "format", "content_type", "data_url"}`` -- the
    ``data_url`` is a ready-to-render ``data:<content_type>;base64,...`` string.
    """
    try:
        spec = data.get('spec')
        dataset = data.get('dataset')
        if not isinstance(spec, dict) or not isinstance(dataset, dict):
            raise HTTPException(
                status_code=422, detail="'spec' and 'dataset' must be objects"
            )
        width_px = max(16, min(int(data.get('width_px', 900)), 8192))
        height_px = max(16, min(int(data.get('height_px', 600)), 8192))
        fmt = str(data.get('format', 'png')).lower()
        if fmt not in ('png', 'svg', 'pdf'):
            raise HTTPException(status_code=422, detail='format must be png|svg|pdf')
        max_primitives = max(
            1, min(int(data.get('max_primitives', 200_000)), 2_000_000)
        )
        max_bytes = max(1, min(int(data.get('max_bytes', 50_000_000)), 200_000_000))
        dataset_ref = str(data.get('dataset_ref', 'webui-viz-render'))[:200]

        engine = await _get_engine_bounded()
        if not engine or not engine.backend:
            raise HTTPException(status_code=503, detail='Graph engine not available')
        client = engine.backend._graph.client

        result = await _invoke_governed_helper(
            client.viz.render,
            spec,
            dataset,
            deadline=30.0,
            width_px=width_px,
            height_px=height_px,
            format=fmt,
            max_primitives=max_primitives,
            max_bytes=max_bytes,
            dataset_ref=dataset_ref,
        )
        image_bytes = result.get('bytes') or b''
        if not isinstance(image_bytes, (bytes, bytearray)):
            raise HTTPException(
                status_code=502, detail='Engine returned no image bytes'
            )
        if len(image_bytes) > _MAX_VIZ_RESPONSE_BYTES:
            raise HTTPException(status_code=422, detail='Rendered image is too large')
        content_type = {
            'png': 'image/png',
            'svg': 'image/svg+xml',
            'pdf': 'application/pdf',
        }[fmt]
        b64 = base64.b64encode(bytes(image_bytes)).decode('ascii')
        return {
            'view_result': _bounded_external_value(result.get('view_result', {})),
            'format': fmt,
            'content_type': content_type,
            'byte_len': len(image_bytes),
            'data_url': f'data:{content_type};base64,{b64}',
        }
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('viz_render', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


# ---------------------------------------------------------------------------
# Code Graph Navigation (CONCEPT:AU-KG.backend.declared-columns-so-schema) — the Phase 5 lens over the resolved
# :Code symbol graph (find definition / references / call graph / impact). Reuses
# the canonical `build_code_nav_query` so the UI and the graph_code_nav MCP tool
# share one query contract; scoped by source_system (e.g. 'gitlab:gitlab.example').
# ---------------------------------------------------------------------------
@router.post('/code/nav')
async def code_nav(data: dict[str, Any]) -> dict[str, Any]:
    """Navigate the resolved code graph.

    Body: ``{action, symbol|node_id, source_system?, depth?, limit?}`` where
    ``action`` is find_definition | find_references | trace_call_graph |
    impact_of_change.
    """
    try:
        from agent_utilities.mcp.tools.query_tools import build_code_nav_query

        action = str(data.get('action', 'find_definition'))
        depth = int(data.get('depth', 3) or 3)
        limit = int(data.get('limit', 200) or 200)
        if not 1 <= depth <= 10 or not 1 <= limit <= _MAX_EXTERNAL_COLLECTION_ITEMS:
            raise HTTPException(
                status_code=400, detail='Invalid code navigation bounds'
            )
        for field in ('symbol', 'node_id', 'source_system'):
            value = data.get(field, '')
            if not isinstance(value, str) or len(value.encode('utf-8')) > 2048:
                raise HTTPException(
                    status_code=400, detail='Invalid code navigation input'
                )
        cypher, params = build_code_nav_query(
            action=action,
            symbol=str(data.get('symbol', '')),
            node_id=str(data.get('node_id', '')),
            source_system=str(data.get('source_system', '')),
            depth=depth,
            limit=limit,
        )
        engine = await _get_engine_bounded()
        rows = await _invoke_governed_helper(
            engine.query_cypher, cypher, params, deadline=15.0
        )
        bounded_rows = list(rows or [])[:limit]
        return _public_external_result(
            {'action': action, 'results': bounded_rows, 'count': len(bounded_rows)}
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=type(e).__name__) from e
    except Exception as e:
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.get('/code/instances')
async def code_instances() -> dict[str, Any]:
    """List source_systems that have code in the graph (the indexed GitLab tenants)."""
    try:
        engine = await _get_engine_bounded()
        rows = await _invoke_governed_helper(
            engine.query_cypher,
            'MATCH (c:Code) WHERE c.source_system IS NOT NULL '
            'RETURN DISTINCT c.source_system AS source_system '
            'ORDER BY source_system LIMIT 200',
            {},
            deadline=10.0,
        )
        return {'source_systems': [r.get('source_system') for r in (rows or [])]}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


# ---------------------------------------------------------------------------
# Knowledge Base Endpoints
# ---------------------------------------------------------------------------


@router.post('/kb/ingest')
async def ingest_kb(data: dict[str, Any]) -> dict[str, Any]:
    """Ingest documents into a Knowledge Base.

    Args:
        data: Dictionary containing kb_id, source, name, and ingestion options.

    Returns:
        Success status and ingestion job ID.
    """
    try:
        engine = await _get_engine_bounded()

        kb_engine = await _invoke_governed_helper(
            KBIngestionEngine,
            engine.graph if engine else None,
            engine.backend if engine else None,
            deadline=10.0,
        )
        kb_id = data.get('kb_id')
        if not isinstance(kb_id, str) or not _SAFE_DELEGATION_TOKEN.fullmatch(kb_id):
            raise HTTPException(status_code=400, detail='Invalid KB identifier')
        source = _workspace_ingestion_source(data.get('source'))
        options = _bounded_query_params(data.get('options', {}))
        name = data.get('name', kb_id)
        if not isinstance(name, str) or len(name.encode('utf-8')) > 1024:
            raise HTTPException(status_code=400, detail='Invalid KB name')
        result = await _invoke_governed_helper(
            kb_engine.ingest,
            deadline=120.0,
            kb_id=kb_id,
            source=source,
            name=name,
            **options,
        )
        return {'status': 'success', 'job_id': result.get('job_id')}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.get('/kb/list')
async def list_kbs() -> list[dict[str, Any]]:
    """List all Knowledge Bases.

    Returns:
        List of Knowledge Base metadata.
    """
    try:
        engine = await _get_engine_bounded()

        kb_engine = await _invoke_governed_helper(
            KBIngestionEngine,
            engine.graph if engine else None,
            engine.backend if engine else None,
            deadline=10.0,
        )
        bases = await _invoke_governed_helper(
            kb_engine.list_knowledge_bases,
            deadline=15.0,
        )
        bounded = _public_external_result(
            list(bases or [])[:_MAX_EXTERNAL_COLLECTION_ITEMS]
        )
        return bounded if isinstance(bounded, list) else []
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('list_knowledge_bases', e)
        return []


@router.get('/kb/search')
async def search_kb(query: str, kb_id: str | None = None) -> list[dict[str, Any]]:
    """Search within Knowledge Bases.

    Args:
        query: Search query string.
        kb_id: Optional KB ID to restrict search.

    Returns:
        List of matching articles and concepts.
    """
    if not query.strip() or len(query.encode('utf-8')) > 8192:
        raise HTTPException(status_code=400, detail='Invalid search query')
    if kb_id and not _SAFE_DELEGATION_TOKEN.fullmatch(kb_id):
        raise HTTPException(status_code=400, detail='Invalid KB identifier')
    try:
        try:
            engine = await _get_engine_bounded()
        except HTTPException as exc:
            # CONCEPT:AU-ECO.ui.engine-fallback-reachable -- this route
            # already anticipated a None engine below (`engine.graph if
            # engine else None`), but `_get_engine_bounded()` raises rather
            # than returning None, so that ternary was dead code. KB search
            # is a separate subsystem from the graph engine's own live
            # backend, so a still-absent engine degrades to None here
            # (KBIngestionEngine is constructed with graph=None,
            # backend=None); a genuine 503 still hard-fails.
            if exc.status_code != 501:
                raise
            engine = None

        kb_engine = await _invoke_governed_helper(
            KBIngestionEngine,
            engine.graph if engine else None,
            engine.backend if engine else None,
            deadline=10.0,
        )
        results = await _invoke_governed_helper(
            kb_engine.search,
            query,
            kb_id=kb_id,
            deadline=30.0,
        )
        bounded = _public_external_result(
            list(results or [])[:_MAX_EXTERNAL_COLLECTION_ITEMS]
        )
        return bounded if isinstance(bounded, list) else []
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('search_knowledge_base', e)
        return []


@router.get('/kb/article/{article_id}')
async def get_kb_article(article_id: str) -> dict[str, Any]:
    """Retrieve a specific KB article.

    Args:
        article_id: The unique identifier of the article.

    Returns:
        Article data or 404 if not found.
    """
    try:
        article_id = _validate_runtime_id(article_id)
        engine = await _get_engine_bounded()

        query = 'MATCH (a:Article) WHERE a.id = $id RETURN a'
        result = await _invoke_governed_helper(
            engine.backend.execute,
            query,
            {'id': article_id},
            deadline=10.0,
        )
        if not result:
            raise HTTPException(status_code=404, detail='Article not found')

        article_data = result[0].get('a', {})
        if not isinstance(article_data, dict):
            return {}
        bounded = _public_external_result(article_data)
        return bounded if isinstance(bounded, dict) else {}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('get_article', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/kb/health')
async def kb_health_check(data: dict[str, Any]) -> dict[str, Any]:
    """Perform health check on a Knowledge Base.

    Args:
        data: Dictionary containing kb_id.

    Returns:
        Health status and any issues found.
    """
    try:
        kb_id = data.get('kb_id')
        if not isinstance(kb_id, str) or not _SAFE_DELEGATION_TOKEN.fullmatch(kb_id):
            raise HTTPException(status_code=400, detail='Invalid KB identifier')

        engine = await _get_engine_bounded()

        kb_engine = await _invoke_governed_helper(
            KBIngestionEngine,
            engine.graph if engine else None,
            engine.backend if engine else None,
            deadline=10.0,
        )
        health_result = await _invoke_governed_helper(
            kb_engine.health_check,
            kb_id,
            deadline=30.0,
        )
        bounded = _public_external_result(health_result)
        if not isinstance(bounded, dict):
            raise HTTPException(status_code=422, detail='Invalid KB health result')
        return bounded
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('knowledge_base_health', e)
        return {'health_status': 'error', 'issues': [type(e).__name__]}


@router.post('/kb/update')
async def update_kb(data: dict[str, Any]) -> dict[str, Any]:
    """Update a Knowledge Base with changed files.

    Args:
        data: Dictionary containing kb_id and update options.

    Returns:
        Success status.
    """
    try:
        kb_id = data.get('kb_id')
        if not isinstance(kb_id, str) or not _SAFE_DELEGATION_TOKEN.fullmatch(kb_id):
            raise HTTPException(status_code=400, detail='Invalid KB identifier')
        try:
            engine = await _get_engine_bounded()
        except HTTPException as exc:
            # See the matching note in search_kb() -- same pre-existing dead
            # `engine.graph if engine else None` ternary, same fix.
            if exc.status_code != 501:
                raise
            engine = None

        kb_engine = await _invoke_governed_helper(
            KBIngestionEngine,
            engine.graph if engine else None,
            engine.backend if engine else None,
            deadline=10.0,
        )

        def validate_sources() -> None:
            graph = getattr(kb_engine, 'graph', None)
            if graph is None or not hasattr(graph, 'predecessors'):
                raise HTTPException(
                    status_code=503, detail='KB source graph unavailable'
                )
            source_ids = list(graph.predecessors(kb_id)) if kb_id in graph else []
            if len(source_ids) > _MAX_LIST_FILES:
                raise HTTPException(
                    status_code=400, detail='KB source set is too large'
                )
            for source_id in source_ids:
                source_data = graph.nodes[source_id]
                if not isinstance(source_data, dict):
                    continue
                file_path = source_data.get('file_path')
                if file_path:
                    _confine_stored_workspace_path(file_path)

        await _invoke_governed_helper(validate_sources, deadline=15.0)
        await _invoke_governed_helper(kb_engine.update, kb_id, deadline=120.0)
        return {'status': 'success'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('update_knowledge_base', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


# ---------------------------------------------------------------------------
# SDD Lifecycle Endpoints
# ---------------------------------------------------------------------------


@router.get('/sdd/constitution')
async def get_constitution() -> dict[str, Any]:
    """Retrieve the project constitution.

    Returns:
        Constitution data or null if not exists.
    """
    try:
        manager = SDDManager(DEFAULT_AGENT_DIR)
        constitution = await _invoke_governed_helper(
            manager.get_constitution, deadline=10.0
        )
        if not constitution:
            return {}
        bounded = _public_external_result(constitution)
        return bounded if isinstance(bounded, dict) else {}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        return {}


@router.post('/sdd/constitution')
async def save_constitution(data: dict[str, Any]) -> dict[str, Any]:
    """Save the project constitution.

    Args:
        data: Constitution data.

    Returns:
        Success status.
    """
    try:
        bounded_data = _bounded_query_params(data)
        safe_data, _privacy_report = sanitize_for_persistence(bounded_data)
        if not isinstance(safe_data, dict):
            raise HTTPException(status_code=400, detail='Invalid constitution')
        manager = SDDManager(DEFAULT_AGENT_DIR)
        await _invoke_governed_helper(
            manager.save_constitution, safe_data, deadline=15.0
        )
        return {'status': 'success'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.get('/sdd/specs')
async def list_specs() -> list[dict[str, Any]]:
    """List all specifications.

    Returns:
        List of specification metadata.
    """
    try:
        manager = SDDManager(DEFAULT_AGENT_DIR)
        specs_result = await _invoke_governed_helper(manager.list_specs, deadline=10.0)
        specs = list(specs_result or [])[:_MAX_EXTERNAL_COLLECTION_ITEMS]
        bounded = _public_external_result(
            [s.model_dump() if hasattr(s, 'model_dump') else s for s in specs]
        )
        return bounded if isinstance(bounded, list) else []
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('list_specs', e)
        return []


@router.post('/sdd/spec')
async def create_spec(data: dict[str, Any]) -> dict[str, Any]:
    """Create a new specification.

    Args:
        data: Specification data.

    Returns:
        Created specification with ID.
    """
    try:
        bounded_data = _bounded_query_params(data)
        safe_data, _privacy_report = sanitize_for_persistence(bounded_data)
        if not isinstance(safe_data, dict):
            raise HTTPException(status_code=400, detail='Invalid specification')
        manager = SDDManager(DEFAULT_AGENT_DIR)
        spec = await _invoke_governed_helper(
            manager.create_spec, safe_data, deadline=15.0
        )
        bounded = _public_external_result(spec.model_dump())
        if not isinstance(bounded, dict):
            raise HTTPException(status_code=422, detail='Invalid specification')
        return bounded
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('create_spec', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.get('/sdd/plans')
async def list_plans() -> list[dict[str, Any]]:
    """List all implementation plans.

    Returns:
        List of plan metadata.
    """
    try:
        manager = SDDManager(DEFAULT_AGENT_DIR)
        plans_result = await _invoke_governed_helper(manager.list_plans, deadline=10.0)
        plans = list(plans_result or [])[:_MAX_EXTERNAL_COLLECTION_ITEMS]
        bounded = _public_external_result(
            [p.model_dump() if hasattr(p, 'model_dump') else p for p in plans]
        )
        return bounded if isinstance(bounded, list) else []
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        return []


@router.get('/sdd/tasks')
async def get_tasks(plan_id: str | None = None) -> list[Any] | dict[str, Any]:
    """Retrieve tasks for a plan or all tasks.

    Args:
        plan_id: Optional plan ID to filter tasks.

    Returns:
        Tasks data.
    """
    try:
        if plan_id:
            plan_id = _validate_runtime_id(plan_id)
        manager = SDDManager(DEFAULT_AGENT_DIR)
        if plan_id:
            tasks = await _invoke_governed_helper(
                manager.get_tasks, plan_id, deadline=10.0
            )
        else:
            tasks = await _invoke_governed_helper(manager.get_all_tasks, deadline=10.0)
        raw_tasks = tasks.model_dump() if hasattr(tasks, 'model_dump') else tasks
        if isinstance(raw_tasks, dict) and isinstance(raw_tasks.get('tasks'), list):
            raw_tasks = {
                **raw_tasks,
                'tasks': [
                    task.model_dump() if hasattr(task, 'model_dump') else task
                    for task in raw_tasks['tasks'][:_MAX_EXTERNAL_COLLECTION_ITEMS]
                ],
            }
        return _public_external_result(raw_tasks)
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('get_tasks', e)
        return {}


@router.post('/sdd/sync')
async def sync_sdd_to_memory(data: dict[str, Any]) -> dict[str, Any]:
    """Sync SDD lifecycle data to Knowledge Graph memory.

    Args:
        data: Dictionary containing plan_id or spec_id.

    Returns:
        Success status.
    """
    try:
        bounded_data = _bounded_query_params(data)
        safe_data, _privacy_report = sanitize_for_persistence(bounded_data)
        if not isinstance(safe_data, dict):
            raise HTTPException(status_code=400, detail='Invalid SDD sync request')
        engine = await _get_engine_bounded()

        manager = SDDManager(DEFAULT_AGENT_DIR)
        await _invoke_governed_helper(
            manager.sync_to_memory, engine, deadline=30.0, **safe_data
        )
        return {'status': 'success'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


# ---------------------------------------------------------------------------
# MAGMA and Advanced Query Endpoints
# ---------------------------------------------------------------------------


@router.post('/graph/magma')
async def magma_retrieve(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Retrieve context using MAGMA orthogonal views.

    Args:
        data: Dictionary containing query, view_type, and policy options.

    Returns:
        Retrieved context from specified orthogonal view.
    """
    try:
        engine = await _get_engine_bounded()

        view_type = data.get('view_type', 'semantic')
        query = data.get('query', '')
        if not isinstance(view_type, str) or not _SAFE_DELEGATION_TOKEN.fullmatch(
            view_type
        ):
            raise HTTPException(status_code=400, detail='Invalid MAGMA view type')
        if not isinstance(query, str) or len(query.encode('utf-8')) > 8192:
            raise HTTPException(status_code=400, detail='Invalid MAGMA query')
        policy = _bounded_query_params(data.get('policy', {}))

        result = await _invoke_governed_helper(
            engine.retrieve_orthogonal_context,
            query=query,
            view_type=view_type,
            policy=policy,
            deadline=15.0,
        )
        if not isinstance(result, list):
            raise HTTPException(status_code=422, detail='Invalid MAGMA result')
        return _public_external_result(result[:_MAX_EXTERNAL_COLLECTION_ITEMS])
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('magma_retrieval', e)
        return []


# ---------------------------------------------------------------------------
# Resource Management Endpoints
# ---------------------------------------------------------------------------


@router.get('/resources')
async def list_resources() -> list[dict[str, Any]]:
    """List all callable resources (MCP tools, A2A agents, skills).

    Returns:
        List of resource metadata.
    """
    try:
        engine = await _get_engine_bounded()

        query = f'MATCH (r:CallableResource) RETURN r LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}'
        result = await _invoke_governed_helper(
            engine.backend.execute, query, deadline=10.0
        )
        resources = []
        for row in result:
            resource_data = row.get('r', {})
            if isinstance(resource_data, dict):
                resources.append(resource_data)
        return _public_external_result(resources)
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('list_resources', e)
        return []


@router.post('/resources/spawn')
async def spawn_agent(data: dict[str, Any]) -> dict[str, Any]:
    """Spawn a specialized sub-agent with curated toolset.

    Args:
        data: Dictionary containing agent configuration and toolset.

    Returns:
        Spawned agent metadata.
    """
    try:
        engine = await _get_engine_bounded()

        bounded_data = _bounded_query_params(data)
        agent = await _invoke_governed_helper(
            engine.spawn_specialized_agent, deadline=30.0, **bounded_data
        )
        return _public_external_result(agent.model_dump())
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


# ---------------------------------------------------------------------------
# Agent Library — compose delegatable agents, register external A2A agents,
# and suggest agents to build from the installed tool/skill inventory.
#
# A library entry IS the same ``CallableResource`` node ``run_agent`` resolves
# for delegation, never a UI-only record: a locally composed agent is written
# with ``resource_type=AGENT_SKILL`` using the identical field contract
# ``ingest_runnable_skill``/atomic-skill ingestion produces (``source_ref``
# starting ``skill://``, ``instruction_digest = runnable_skill_digest(body)``)
# so ``run_agent``'s fail-closed skill-runnable check accepts it; an external
# agent is written with ``resource_type=A2A_AGENT`` via the engine's own
# ``ingest_a2a_agent_card``/``ingest_agent_toolkit``, the same primitives an
# offline A2A config sync uses. ``provider_ref == _AGENT_LIBRARY_PROVIDER_REF``
# marks a locally composed entry so the Library lists only what was authored
# here, not every ingested skill in the corpus (that corpus is browsed
# separately via ``/api/enhanced/skills``).
# ---------------------------------------------------------------------------

_AGENT_LIBRARY_PROVIDER = 'agent-webui-library'
_AGENT_LIBRARY_PROVIDER_REF = f'provider://{_AGENT_LIBRARY_PROVIDER}'
_MAX_INSTRUCTIONS_BYTES = 32_000


def _library_agent_view(row: dict[str, Any]) -> dict[str, Any]:
    """Shape one ``CallableResource`` row for the Agent Library list/detail views."""

    resource_type = str(row.get('resource_type') or '')
    return {
        'id': row.get('id'),
        'name': row.get('name'),
        'description': row.get('description') or '',
        'kind': 'a2a' if resource_type == 'A2A_AGENT' else 'local',
        'mcp_server': row.get('mcp_server'),
        'model_preference': row.get('model_preference'),
        'timestamp': row.get('timestamp'),
        'status': row.get('status') or 'active',
        'runnable_bound': bool(row.get('runnable_bound', resource_type == 'A2A_AGENT')),
    }


@router.get('/agent-library/agents')
async def list_library_agents() -> list[dict[str, Any]]:
    """List every agent composed or registered through the Agent Library.

    Local agents are ``CallableResource(resource_type=AGENT_SKILL)`` nodes
    written by this feature (marked by ``provider_ref``); external agents are
    every ``CallableResource(resource_type=A2A_AGENT)`` node regardless of
    which pipeline registered it, since the KG — not this endpoint — is the
    one source of truth for what is externally callable.
    """
    try:
        engine = await _get_engine_bounded()
        rows = await _invoke_governed_helper(
            engine.backend.execute,
            'MATCH (r:CallableResource) WHERE r.resource_type = $a2a '
            'OR (r.resource_type = $skill AND r.provider_ref = $ref) '
            f'RETURN r LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}',
            {
                'a2a': 'A2A_AGENT',
                'skill': 'AGENT_SKILL',
                'ref': _AGENT_LIBRARY_PROVIDER_REF,
            },
            deadline=10.0,
        )
        agents = [
            _library_agent_view(row['r'])
            for row in (rows or [])
            if isinstance(row, dict)
            and isinstance(row.get('r'), dict)
            and str(row['r'].get('status') or '') != 'ARCHIVED'
        ]
        agents.sort(key=lambda a: str(a.get('name') or '').lower())
        bounded = _public_external_result(agents)
        return bounded if isinstance(bounded, list) else []
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('list_library_agents', e)
        return []


@router.get('/agent-library/tools')
async def list_library_tools(mcp_server: str | None = None) -> list[dict[str, Any]]:
    """List ``:Tool`` nodes from the KG for the agent composer's tool picker.

    Optionally filtered to one owning ``mcp_server`` so a composer can offer
    "everything this package's server exposes" as a starting point.
    """
    if mcp_server is not None and not _SAFE_DELEGATION_TOKEN.fullmatch(mcp_server):
        raise HTTPException(status_code=400, detail='Invalid MCP server filter')
    try:
        engine = await _get_engine_bounded()
        if mcp_server:
            query = (
                'MATCH (t:Tool) WHERE t.mcp_server = $s RETURN t.id AS id, '
                't.name AS name, t.mcp_server AS mcp_server, t.tags AS tags '
                f'LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}'
            )
            params = {'s': mcp_server}
        else:
            query = (
                'MATCH (t:Tool) RETURN t.id AS id, t.name AS name, '
                't.mcp_server AS mcp_server, t.tags AS tags '
                f'LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}'
            )
            params = {}
        rows = await _invoke_governed_helper(
            engine.backend.execute, query, params, deadline=15.0
        )
        tools = [
            {
                'id': r.get('id'),
                'name': r.get('name'),
                'mcp_server': r.get('mcp_server'),
                'tags': r.get('tags') or [],
            }
            for r in (rows or [])
            if isinstance(r, dict) and r.get('id')
        ]
        tools.sort(
            key=lambda t: (
                str(t.get('mcp_server') or ''),
                str(t.get('name') or '').lower(),
            )
        )
        bounded = _public_external_result(tools)
        return bounded if isinstance(bounded, list) else []
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('list_library_tools', e)
        return []


@router.get('/agent-library/suggestions')
async def suggest_library_agents() -> list[dict[str, Any]]:
    """Suggest agents to build, derived from the installed tool inventory.

    Groups ``:Tool`` nodes by their owning ``mcp_server`` (an installed
    ``agent-packages/agents/*`` package's MCP server, once ingested) and
    proposes one for every server that has no Agent Library entry bound to it
    yet. Nothing here is hardcoded: an uningested package, or one that
    already has a composed agent, produces no suggestion.
    """
    try:
        engine = await _get_engine_bounded()
        tool_rows = await _invoke_governed_helper(
            engine.backend.execute,
            'MATCH (t:Tool) WHERE t.mcp_server IS NOT NULL AND t.mcp_server <> "" '
            f'RETURN t.mcp_server AS server, t.name AS name LIMIT {_MAX_LIST_FILES}',
            {},
            deadline=15.0,
        )
        bound_rows = await _invoke_governed_helper(
            engine.backend.execute,
            'MATCH (r:CallableResource) WHERE r.resource_type = $skill '
            'AND r.provider_ref = $ref AND r.mcp_server IS NOT NULL '
            'RETURN DISTINCT r.mcp_server AS server',
            {'skill': 'AGENT_SKILL', 'ref': _AGENT_LIBRARY_PROVIDER_REF},
            deadline=15.0,
        )
        bound = {
            str(row.get('server'))
            for row in (bound_rows or [])
            if isinstance(row, dict) and row.get('server')
        }
        by_server: dict[str, list[str]] = {}
        for row in tool_rows or []:
            if not isinstance(row, dict):
                continue
            server = row.get('server')
            if not server:
                continue
            server = str(server)
            names = by_server.setdefault(server, [])
            name = row.get('name')
            if name and len(names) < 8:
                names.append(str(name))

        suggestions: list[dict[str, Any]] = []
        for server, names in by_server.items():
            if server in bound:
                continue
            suggestions.append(
                {
                    'mcp_server': server,
                    'tool_count': sum(
                        1 for r in tool_rows if r.get('server') == server
                    ),
                    'sample_tools': names,
                    'reason': (
                        f"Tools from '{server}' are installed and ingested, "
                        'but no agent in the Library uses them yet.'
                    ),
                }
            )
        suggestions.sort(key=lambda s: s.get('tool_count', 0), reverse=True)
        bounded = _public_external_result(suggestions[:_MAX_EXTERNAL_COLLECTION_ITEMS])
        return bounded if isinstance(bounded, list) else []
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('suggest_library_agents', e)
        return []


@router.get('/agent-library/agents/{agent_id:path}')
async def get_library_agent(agent_id: str) -> dict[str, Any]:
    """Return one Agent Library entry with its instructions and bound tools."""

    agent_id = _validate_runtime_id(agent_id)
    try:
        engine = await _get_engine_bounded()
        rows = await _invoke_governed_helper(
            engine.backend.execute,
            'MATCH (r:CallableResource {id: $id}) RETURN r',
            {'id': agent_id},
            deadline=10.0,
        )
        if not rows or not isinstance(rows[0].get('r'), dict):
            raise HTTPException(status_code=404, detail='Agent not found')
        row = rows[0]['r']
        if str(row.get('resource_type') or '') not in {'AGENT_SKILL', 'A2A_AGENT'}:
            raise HTTPException(status_code=404, detail='Agent not found')
        view = _library_agent_view(row)
        view['instructions'] = row.get('system_prompt') or ''
        view['endpoint'] = row.get('endpoint')
        view['agent_card'] = row.get('agent_card')
        tool_rows = await _invoke_governed_helper(
            engine.backend.execute,
            'MATCH (r {id: $id})-[:USES_TOOL]->(t) RETURN t.name AS name, t.id AS id',
            {'id': agent_id},
            deadline=10.0,
        )
        view['tools'] = [
            {'id': t.get('id'), 'name': t.get('name')}
            for t in (tool_rows or [])
            if isinstance(t, dict) and (t.get('id') or t.get('name'))
        ]
        return _public_external_result(view)
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('get_library_agent', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/agent-library/agents')
async def create_library_agent(data: dict[str, Any]) -> dict[str, Any]:
    """Compose a new locally-delegatable agent from a name, instructions, and tools.

    Writes the exact ``CallableResource(resource_type=AGENT_SKILL)`` field
    contract atomic-skill ingestion produces, so the saved agent is
    delegatable by name immediately — never a second, UI-only representation.
    Optionally expands ``bind_server`` into ``USES_TOOL`` edges for every
    currently-ingested tool of that MCP server, in addition to any explicitly
    picked ``tool_ids``.
    """
    name = str(data.get('name') or '').strip()
    description = str(data.get('description') or '').strip()
    instructions = str(data.get('instructions') or '').strip()
    bind_server = str(data.get('bind_server') or '').strip()
    model_preference = str(data.get('model_preference') or '').strip()
    tool_ids = _bounded_identifier_list(data.get('tool_ids'))

    if not name or len(name) > 120:
        raise HTTPException(status_code=422, detail='Agent name is required')
    if not instructions:
        raise HTTPException(status_code=422, detail='Agent instructions are required')
    if len(instructions.encode('utf-8')) > _MAX_INSTRUCTIONS_BYTES:
        raise HTTPException(
            status_code=400, detail='Instructions exceed the safety bound'
        )
    if bind_server and not _SAFE_DELEGATION_TOKEN.fullmatch(bind_server):
        raise HTTPException(status_code=400, detail='Invalid MCP server name')
    if model_preference and not _SAFE_DELEGATION_TOKEN.fullmatch(model_preference):
        raise HTTPException(status_code=400, detail='Invalid model id')

    try:
        engine = await _get_engine_bounded()
        from agent_utilities.knowledge_graph.ingestion.skill_workflow_ingest import (
            runnable_skill_digest,
            skill_reference,
        )

        def persist_agent() -> tuple[str, list[str]]:
            source_ref = skill_reference(name)
            digest = runnable_skill_digest(instructions)
            skill_id = f'skill:{source_ref.removeprefix("skill://")}'
            resource_id = f'resource:{skill_id}'
            ts = datetime.now(timezone.utc).isoformat()
            common: dict[str, Any] = {
                'name': name,
                'description': description or name,
                'source_ref': source_ref,
                'provider_ref': _AGENT_LIBRARY_PROVIDER_REF,
                'instruction_digest': digest,
                'timestamp': ts,
            }
            resolved_tool_ids = list(tool_ids)
            if bind_server:
                common['mcp_server'] = bind_server
                server_rows = engine.backend.execute(
                    'MATCH (t:Tool) WHERE t.mcp_server = $s RETURN t.id AS id',
                    {'s': bind_server},
                )
                resolved_tool_ids.extend(
                    str(r['id'])
                    for r in (server_rows or [])
                    if isinstance(r, dict) and r.get('id')
                )
            engine.add_node(
                skill_id,
                'Skill',
                {**common, 'body': instructions, 'instruction': instructions},
            )
            resource_props: dict[str, Any] = {
                **common,
                'resource_type': 'AGENT_SKILL',
                'system_prompt': instructions,
                'runnable_bound': True,
            }
            if model_preference:
                resource_props['model_preference'] = model_preference
            engine.add_node(resource_id, 'CallableResource', resource_props)
            engine.link_nodes(skill_id, resource_id, 'BINDS_RUNNABLE')
            seen: set[str] = set()
            for tool_id in resolved_tool_ids:
                if tool_id in seen or len(seen) >= _MAX_EXTERNAL_COLLECTION_ITEMS:
                    continue
                seen.add(tool_id)
                engine.link_nodes(resource_id, tool_id, 'USES_TOOL')
            return resource_id, sorted(seen)

        resource_id, bound_tools = await _invoke_governed_helper(
            persist_agent, deadline=30.0
        )
        return _public_external_result(
            {
                'id': resource_id,
                'name': name,
                'description': description or name,
                'kind': 'local',
                'mcp_server': bind_server or None,
                'model_preference': model_preference or None,
                'tools': bound_tools,
            }
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        _log_failure('create_library_agent', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.put('/agent-library/agents/{agent_id:path}')
async def update_library_agent(agent_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Edit a locally-composed Agent Library entry (the missing U of CRUD next
    to POST/DELETE above). Same field contract and validation as ``POST
    /agent-library/agents``; only a local entry this feature itself created
    (``provider_ref == _AGENT_LIBRARY_PROVIDER_REF``) may be edited here — an
    ingested/external ``A2A_AGENT`` has no editable ``instructions`` and is
    edited at its own source, matching the same restriction ``DELETE``
    already enforces for archiving.

    ``tool_ids``/``bind_server`` fully REPLACE the bound tool set (not merge)
    so the edited agent's tools always match exactly what was submitted.
    """
    agent_id = _validate_runtime_id(agent_id)
    name = str(data.get('name') or '').strip()
    description = str(data.get('description') or '').strip()
    instructions = str(data.get('instructions') or '').strip()
    bind_server = str(data.get('bind_server') or '').strip()
    model_preference = str(data.get('model_preference') or '').strip()
    tool_ids = _bounded_identifier_list(data.get('tool_ids'))

    if not name or len(name) > 120:
        raise HTTPException(status_code=422, detail='Agent name is required')
    if not instructions:
        raise HTTPException(status_code=422, detail='Agent instructions are required')
    if len(instructions.encode('utf-8')) > _MAX_INSTRUCTIONS_BYTES:
        raise HTTPException(
            status_code=400, detail='Instructions exceed the safety bound'
        )
    if bind_server and not _SAFE_DELEGATION_TOKEN.fullmatch(bind_server):
        raise HTTPException(status_code=400, detail='Invalid MCP server name')
    if model_preference and not _SAFE_DELEGATION_TOKEN.fullmatch(model_preference):
        raise HTTPException(status_code=400, detail='Invalid model id')

    try:
        engine = await _get_engine_bounded()
        from agent_utilities.knowledge_graph.ingestion.skill_workflow_ingest import (
            runnable_skill_digest,
        )

        def load_existing() -> tuple[str, str]:
            rows = engine.backend.execute(
                'MATCH (r:CallableResource {id: $id}) '
                'RETURN r.resource_type AS rtype, r.provider_ref AS provider_ref, '
                'r.source_ref AS source_ref',
                {'id': agent_id},
            )
            if not rows or not isinstance(rows[0], dict):
                raise HTTPException(status_code=404, detail='Agent not found')
            rtype = str(rows[0].get('rtype') or '')
            provider_ref = str(rows[0].get('provider_ref') or '')
            if rtype != 'AGENT_SKILL' or provider_ref != _AGENT_LIBRARY_PROVIDER_REF:
                raise HTTPException(
                    status_code=403,
                    detail='Only agents composed in the Agent Library can be edited here',
                )
            skill_id = str(rows[0].get('source_ref') or '').removeprefix('skill://')
            return f'skill:{skill_id}', str(rows[0].get('source_ref') or '')

        def persist_update() -> list[str]:
            skill_id, source_ref = load_existing()
            digest = runnable_skill_digest(instructions)
            ts = datetime.now(timezone.utc).isoformat()
            common: dict[str, Any] = {
                'name': name,
                'description': description or name,
                'instruction_digest': digest,
                'updated_at': ts,
                'mcp_server': bind_server or None,
                'model_preference': model_preference or None,
            }
            engine.backend.execute(
                'MATCH (s:Skill {id: $id}) '
                'SET s.name = $name, s.description = $description, '
                's.instruction_digest = $instruction_digest, s.updated_at = $updated_at, '
                's.mcp_server = $mcp_server, s.body = $instructions, '
                's.instruction = $instructions',
                {'id': skill_id, 'instructions': instructions, **common},
            )
            engine.backend.execute(
                'MATCH (r:CallableResource {id: $id}) '
                'SET r.name = $name, r.description = $description, '
                'r.instruction_digest = $instruction_digest, r.updated_at = $updated_at, '
                'r.mcp_server = $mcp_server, r.model_preference = $model_preference, '
                'r.system_prompt = $instructions',
                {'id': agent_id, 'instructions': instructions, **common},
            )
            # Full-replace: drop every existing binding then re-add exactly the
            # submitted set, so the edited agent's tools never accumulate stale
            # edges from a prior save.
            engine.backend.execute(
                'MATCH (r:CallableResource {id: $id})-[e:USES_TOOL]->() DELETE e',
                {'id': agent_id},
            )
            resolved_tool_ids = list(tool_ids)
            if bind_server:
                server_rows = engine.backend.execute(
                    'MATCH (t:Tool) WHERE t.mcp_server = $s RETURN t.id AS id',
                    {'s': bind_server},
                )
                resolved_tool_ids.extend(
                    str(r['id'])
                    for r in (server_rows or [])
                    if isinstance(r, dict) and r.get('id')
                )
            seen: set[str] = set()
            for tool_id in resolved_tool_ids:
                if tool_id in seen or len(seen) >= _MAX_EXTERNAL_COLLECTION_ITEMS:
                    continue
                seen.add(tool_id)
                engine.link_nodes(agent_id, tool_id, 'USES_TOOL')
            _ = source_ref
            return sorted(seen)

        bound_tools = await _invoke_governed_helper(persist_update, deadline=30.0)
        return _public_external_result(
            {
                'id': agent_id,
                'name': name,
                'description': description or name,
                'kind': 'local',
                'mcp_server': bind_server or None,
                'model_preference': model_preference or None,
                'tools': bound_tools,
            }
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        _log_failure('update_library_agent', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.delete('/agent-library/agents/{agent_id:path}')
async def archive_library_agent(agent_id: str) -> dict[str, Any]:
    """Archive an Agent Library entry (soft delete, matching the fleet's
    ``deregister_function`` convention: it stops being listed, but the node
    and its provenance stay in the graph)."""

    agent_id = _validate_runtime_id(agent_id)
    try:
        engine = await _get_engine_bounded()
        rows = await _invoke_governed_helper(
            engine.backend.execute,
            'MATCH (r:CallableResource {id: $id}) '
            'RETURN r.resource_type AS rtype, r.provider_ref AS provider_ref',
            {'id': agent_id},
            deadline=10.0,
        )
        if not rows or not isinstance(rows[0], dict):
            raise HTTPException(status_code=404, detail='Agent not found')
        rtype = str(rows[0].get('rtype') or '')
        provider_ref = str(rows[0].get('provider_ref') or '')
        if rtype not in {'AGENT_SKILL', 'A2A_AGENT'}:
            raise HTTPException(status_code=404, detail='Agent not found')
        if rtype == 'AGENT_SKILL' and provider_ref != _AGENT_LIBRARY_PROVIDER_REF:
            raise HTTPException(
                status_code=403,
                detail='Only agents composed in the Agent Library can be archived here',
            )
        await _invoke_governed_helper(
            engine.backend.execute,
            "MATCH (r:CallableResource {id: $id}) SET r.status = 'ARCHIVED'",
            {'id': agent_id},
            deadline=10.0,
        )
        return {'status': 'success', 'id': agent_id, 'archived': True}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('archive_library_agent', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/agent-library/a2a')
async def register_a2a_agent(data: dict[str, Any]) -> dict[str, Any]:
    """Register an external A2A agent alongside local ones.

    Paste an agent-card JSON directly (no outbound fetch needed), or give
    just a URL to fetch its published card through the engine's governed A2A
    ingestion. Writes through the same ``CallableResource(resource_type=
    A2A_AGENT)`` primitive ``run_agent`` resolves for delegation — the exact
    mechanism an offline A2A config sync uses, so an agent registered here is
    indistinguishable from one wired at deploy time.
    """
    url = str(data.get('url') or '').strip()
    card = data.get('agent_card')
    parsed = urlsplit(url) if url else None
    if (
        not url
        or not parsed
        or parsed.scheme not in {'http', 'https'}
        or not parsed.netloc
    ):
        raise HTTPException(status_code=422, detail='A valid http(s) URL is required')
    if len(url.encode('utf-8')) > 2048:
        raise HTTPException(status_code=400, detail='URL exceeds its safety bound')

    try:
        engine = await _get_engine_bounded()
        if isinstance(card, dict) and card:
            bounded_card = _bounded_query_params(card)
            await _invoke_governed_helper(
                engine.ingest_a2a_agent_card, url, bounded_card, deadline=20.0
            )
            return {
                'status': 'success',
                'name': bounded_card.get('name'),
                'endpoint_configured': True,
            }
        summary = await _invoke_governed_helper(
            engine.ingest_agent_toolkit, [url], deadline=25.0
        )
        registered = bool(isinstance(summary, dict) and summary.get('a2a_agents'))
        if not registered:
            raise HTTPException(
                status_code=502,
                detail=(
                    'Could not fetch an agent card from that URL. '
                    'Paste the agent-card JSON manually instead.'
                ),
            )
        bounded_summary = _public_external_result(summary)
        return {
            'status': 'success',
            'endpoint_configured': True,
            'summary': bounded_summary,
        }
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('register_a2a_agent', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.get('/agent-library/config-summary')
async def agent_config_summary() -> dict[str, Any]:
    """Curated, secret-free projection of the active AgentConfig model registry.

    ``agent_utilities.core.config.AgentConfig`` has thousands of fields; this
    surfaces only what matters for choosing a model when composing an agent —
    never API keys, secret references, or provider credentials.
    """
    try:
        from agent_utilities.core.config import AgentConfig

        cfg = await _invoke_governed_helper(AgentConfig, deadline=15.0)
        chat_models = [
            {
                'id': m.id,
                'provider': m.provider,
                'intelligence_level': m.intelligence_level,
                'vision': m.vision,
                'reasoning': m.reasoning,
                'tools_enabled': m.tools_enabled,
                'can_route': m.can_route,
                'can_kg': m.can_kg,
                'context_window': m.context_window,
            }
            for m in (cfg.chat_models or [])
        ]
        embedding_models = [
            {
                'id': m.id,
                'provider': m.provider,
                'chunk_size': m.chunk_size,
                'context_window': m.context_window,
            }
            for m in (cfg.embedding_models or [])
        ]
        result = {
            'app_profile': cfg.app_profile,
            'deployment_profile': cfg.deployment_profile,
            'chat_models': chat_models,
            'embedding_models': embedding_models,
        }
        bounded = _public_external_result(result)
        return bounded if isinstance(bounded, dict) else result
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('agent_config_summary', e)
        return {
            'app_profile': '',
            'deployment_profile': '',
            'chat_models': [],
            'embedding_models': [],
        }


# ---------------------------------------------------------------------------
# Maintenance and Pipeline Endpoints
# ---------------------------------------------------------------------------


@router.get('/maintenance/status')
async def get_maintenance_status() -> dict[str, Any]:
    """Get status of all maintenance operations.

    Returns:
        Maintenance operation status and history.
    """
    try:
        try:
            engine = await _get_engine_bounded()
        except HTTPException as exc:
            # CONCEPT:AU-ECO.ui.engine-fallback-reachable -- the
            # `if not engine` degrade below was unreachable dead code for
            # the same reason as get_graph_stats(); this route's degraded
            # response already carries an honest 'unavailable' status
            # distinct from 'idle'/other real states, so no shape change is
            # needed here -- only making it reachable. A genuine 503
            # (bounded deadline/capacity) still hard-fails.
            if exc.status_code != 501:
                raise
            return {'status': 'unavailable', 'operations': {}}
        if not engine or not engine.backend:
            return {'status': 'unavailable', 'operations': {}}

        maintainer = GraphMaintainer(engine)
        status = await _invoke_governed_helper(maintainer.get_status, deadline=10.0)
        bounded = _public_external_result(status)
        return bounded if isinstance(bounded, dict) else {'status': 'unavailable'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        return {'status': 'error', 'operations': {}}


@router.post('/maintenance/trigger')
async def trigger_maintenance(data: dict[str, Any]) -> dict[str, Any]:
    """Trigger a specific maintenance operation.

    Args:
        data: Dictionary containing operation.

    Returns:
        Operation status and results.
    """
    try:
        operation = data.get('operation')
        if not isinstance(operation, str) or not _SAFE_DELEGATION_TOKEN.fullmatch(
            operation
        ):
            raise HTTPException(status_code=400, detail='Invalid maintenance operation')

        engine = await _get_engine_bounded()
        maintainer = GraphMaintainer(engine)
        result = await _invoke_governed_helper(
            maintainer.trigger_operation, operation, deadline=30.0
        )
        bounded = _public_external_result({'status': 'success', 'result': result})
        return bounded if isinstance(bounded, dict) else {'status': 'error'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.get('/pipeline/status')
async def get_pipeline_status() -> dict[str, Any]:
    """Get status of the 12-phase intelligence pipeline.

    Returns:
        Pipeline status and phase information.
    """
    try:
        engine = await _get_engine_bounded()
        if not engine:
            return {'status': 'unavailable', 'phases': {}}

        runner = PipelineRunner(PHASES)
        status = await _invoke_governed_helper(runner.get_status, deadline=10.0)
        bounded = _public_external_result(status)
        return bounded if isinstance(bounded, dict) else {'status': 'unavailable'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        return {'status': 'error', 'phases': {}}


@router.post('/pipeline/trigger')
async def trigger_pipeline(data: dict[str, Any]) -> dict[str, Any]:
    """Trigger pipeline execution or specific phase.

    Args:
        data: Dictionary containing phase.

    Returns:
        Pipeline execution status.
    """
    try:
        engine = await _get_engine_bounded()

        config = PipelineConfig(workspace_path=str(DEFAULT_AGENT_DIR))
        ctx = PipelineContext(
            config=config, nx_graph=engine.graph, backend=engine.backend
        )
        runner = PipelineRunner(PHASES)
        result = await runner.run(ctx)
        bounded = _public_external_result({'status': 'success', 'result': result})
        return bounded if isinstance(bounded, dict) else {'status': 'error'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


# ---------------------------------------------------------------------------
# Backend Configuration Endpoints
# ---------------------------------------------------------------------------


@router.get('/models')
async def list_configured_models(request: Request) -> dict[str, Any]:
    """Return the configured LLM model registry.

    Mirrors the core server's ``GET /models`` endpoint so the web UI can
    power its model picker and cost display from the same declarative
    configuration as the terminal UI and graph orchestrator. When no
    registry is attached to ``app.state.model_registry`` (e.g. the server
    was started without ``MODELS_CONFIG`` and without explicit kwargs) the
    response still validates as an empty registry.

    Returns:
        ``{"models": [...ModelDefinition...], "default_id": "..."}``.
    """
    app = request.app
    # The registry may live on the root app or on a parent app when we are
    # mounted under /api/enhanced; walk the parent chain until we find it.
    reg = getattr(app.state, 'model_registry', None)
    while reg is None:
        parent = getattr(app, 'parent', None)
        if parent is None:
            break
        app = parent
        reg = getattr(app.state, 'model_registry', None)
    if reg is None:
        return {'models': [], 'default_id': None}
    if hasattr(reg, 'to_api_payload'):
        payload = reg.to_api_payload()
        bounded = _public_external_result(payload)
        return bounded if isinstance(bounded, dict) else {'models': []}
    # Be forgiving for tests that mock the registry with a plain dict.
    bounded = _public_external_result(reg)
    return bounded if isinstance(bounded, dict) else {'models': []}


@router.get('/config/backend')
async def get_backend_config() -> dict[str, Any]:
    """Get current backend configuration.

    Returns:
        Backend type and connection settings.
    """
    try:
        import os

        from agent_utilities.knowledge_graph.backends import get_active_backend

        backend = get_active_backend()
        if not backend:
            return {'status': 'no_backend'}

        config = {
            'backend_type': backend.__class__.__name__,
            'env_vars': {
                'GRAPH_BACKEND': os.getenv('GRAPH_BACKEND', 'ladybug'),
                'GRAPH_DB_PATH': (
                    'configured' if os.getenv('GRAPH_DB_PATH') else 'default'
                ),
            },
        }
        return config
    except Exception as e:
        _log_failure('api_extension', e)
        return {'status': 'error'}


@router.put('/config/backend')
async def update_backend_config(data: dict[str, Any]) -> dict[str, Any]:
    """Reject a backend configuration write: no write path is wired.

    GOC-28 (BUG-008-class fabrication): this handler previously accepted any
    payload and unconditionally returned ``{"status": "success", ...}``
    without writing an environment variable, config file, or anything else —
    a mutation that always claims success no matter what it was asked to do
    or whether the caller was even authorized to do it. That is exactly the
    invariant this lane forbids: "a mocked response rendered where the
    backend returned nothing is a defect, not a convenience." There is
    currently no real backend-config write mechanism to delegate to (see
    ``get_backend_config`` above, which only ever reads process env vars), so
    the honest response is a typed failure, not a fabricated success — the
    established 501 pattern this file already uses elsewhere for "not
    wired" mutations (e.g. the tunnel-manager/MCP-app/ontology handlers).

    Args:
        data: Requested backend configuration (unused — nothing is written).

    Raises:
        HTTPException: Always 501; no config-write path is implemented.
    """
    raise HTTPException(
        status_code=501,
        detail=(
            'Backend configuration cannot be updated: no config-write path '
            'is wired. This endpoint previously returned a fabricated '
            '"success" for any payload; it now reports the true unconfigured '
            'state instead of a fake one.'
        ),
    )


# ─────────────────────────────────────────────────────────────────────────
#  Prompt Management (CONCEPT:WU-KG.compute.prompt-management-ahe-rollback)
# ─────────────────────────────────────────────────────────────────────────


def _extract_system_prompt(agent: Any) -> str:
    """Helper to safely extract system prompt from a Pydantic AI agent instance."""
    if not agent:
        return ''
    if hasattr(agent, '_system_prompts'):
        prompts = []
        for p in agent._system_prompts:
            if isinstance(p, str):
                prompts.append(p)
            elif callable(p):
                try:
                    res = p()
                    prompts.append(str(res) if res is not None else '')
                except Exception:
                    prompts.append(
                        f'[Dynamic prompt: {getattr(p, "__name__", "function")}]'
                    )
        if prompts:
            return '\n\n'.join(prompts)

    sys_prompt = getattr(agent, 'system_prompt', '')
    if callable(sys_prompt):
        try:
            res = sys_prompt()
            return str(res) if res is not None else ''
        except Exception:
            return str(sys_prompt)
    return str(sys_prompt) if sys_prompt is not None else ''


@router.get('/prompts/graph')
async def list_graph_prompts(request: Request) -> list[dict[str, Any]]:
    """List all prompts from the Knowledge Graph.

    CONCEPT:WU-KG.compute.prompt-management-ahe-rollback — Prompt Management

    Returns:
        A list of prompt dicts with id, name, content, and metadata.
    """
    try:
        engine = await _get_engine_bounded()
    except HTTPException as exc:
        if exc.status_code == 503:
            raise
        engine = None
    except Exception:
        engine = None
    if engine:
        try:
            prompt_result = await _invoke_governed_helper(
                engine.get_all_prompts, deadline=10.0
            )
            prompts = list(prompt_result or [])[:_MAX_EXTERNAL_COLLECTION_ITEMS]
            bounded = _public_external_result(prompts)
            return bounded if isinstance(bounded, list) else []
        except HTTPException:
            raise
        except Exception as e:
            _log_failure('api_extension', e)
    # Fallback to returning agent's system prompt as a default prompt
    agent = getattr(request.app.state, 'agent', None)
    if agent:
        sys_prompt = _extract_system_prompt(agent)
        if sys_prompt:
            bounded = _public_external_result(
                [
                    {
                        'id': 'system_prompt',
                        'name': 'System Prompt',
                        'content': sys_prompt,
                        'description': 'The default system prompt configured for this agent.',
                        'author': 'System',
                        'version': 1,
                        'created_at': datetime.now(timezone.utc).isoformat(),
                    }
                ]
            )
            return bounded if isinstance(bounded, list) else []
    return []


@router.get('/prompts/graph/{prompt_id}')
async def get_graph_prompt(prompt_id: str, request: Request) -> dict[str, Any]:
    """Retrieve a single prompt by ID.

    CONCEPT:WU-KG.compute.prompt-management-ahe-rollback — Prompt Management

    Args:
        prompt_id: The unique identifier of the prompt.

    Returns:
        The prompt dict with full content.
    """
    prompt_id = _validate_runtime_id(prompt_id)
    try:
        engine = await _get_engine_bounded()
    except HTTPException as exc:
        if exc.status_code == 503:
            raise
        engine = None
    except Exception:
        engine = None
    if engine:
        result = await _invoke_governed_helper(
            engine.get_prompt, prompt_id, deadline=10.0
        )
        if not result:
            raise HTTPException(status_code=404, detail=f'Prompt {prompt_id} not found')
        bounded = _public_external_result(result)
        if not isinstance(bounded, dict):
            raise HTTPException(status_code=422, detail='Invalid prompt record')
        return bounded

    agent = getattr(request.app.state, 'agent', None)
    if prompt_id == 'system_prompt' and agent:
        sys_prompt = _extract_system_prompt(agent)
        if sys_prompt:
            bounded = _public_external_result(
                {
                    'id': 'system_prompt',
                    'name': 'System Prompt',
                    'content': sys_prompt,
                    'description': 'The default system prompt configured for this agent.',
                    'author': 'System',
                    'version': 1,
                    'created_at': datetime.now(timezone.utc).isoformat(),
                }
            )
            return bounded if isinstance(bounded, dict) else {}
    raise HTTPException(status_code=404, detail=f'Prompt {prompt_id} not found')


@router.post('/prompts/graph')
async def create_graph_prompt(data: dict[str, Any]) -> dict[str, Any]:
    """Create a new prompt in the Knowledge Graph.

    CONCEPT:WU-KG.compute.prompt-management-ahe-rollback — Prompt Management

    Args:
        data: Dict with 'name', 'content', and optional 'description', 'author'.

    Returns:
        The created prompt dict.
    """
    bounded_data = _bounded_query_params(data)
    safe_data, _privacy_report = sanitize_for_persistence(bounded_data)
    if not isinstance(safe_data, dict):
        raise HTTPException(status_code=400, detail='Invalid prompt record')
    engine = await _get_engine_bounded()
    name = safe_data.get('name', '')
    content = safe_data.get('content', '')
    if not isinstance(name, str) or not name.strip() or len(name.encode('utf-8')) > 512:
        raise HTTPException(status_code=400, detail='name and content are required')
    if (
        not isinstance(content, str)
        or not content
        or len(content.encode('utf-8')) > _MAX_EXTERNAL_STRING_BYTES
    ):
        raise HTTPException(status_code=400, detail='name and content are required')
    result = await _invoke_governed_helper(
        engine.add_prompt,
        content=content,
        name=name,
        author=safe_data.get('author', 'user'),
        description=safe_data.get('description', ''),
        deadline=15.0,
    )
    bounded = _public_external_result(result)
    if not isinstance(bounded, dict):
        raise HTTPException(status_code=422, detail='Invalid prompt record')
    return bounded


@router.put('/prompts/graph/{prompt_id}')
async def update_graph_prompt(prompt_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Update a prompt, creating a new version via SUPERSEDES.

    CONCEPT:WU-KG.compute.prompt-management-ahe-rollback — Prompt Management

    Args:
        prompt_id: The identifier of the prompt to update.
        data: Dict with 'content' and optional 'author'.

    Returns:
        The new version dict with version number and parent_id.
    """
    prompt_id = _validate_runtime_id(prompt_id)
    bounded_data = _bounded_query_params(data)
    safe_data, _privacy_report = sanitize_for_persistence(bounded_data)
    if not isinstance(safe_data, dict):
        raise HTTPException(status_code=400, detail='Invalid prompt record')
    engine = await _get_engine_bounded()
    content = safe_data.get('content', '')
    if (
        not isinstance(content, str)
        or not content
        or len(content.encode('utf-8')) > _MAX_EXTERNAL_STRING_BYTES
    ):
        raise HTTPException(status_code=400, detail='content is required')
    try:
        result = await _invoke_governed_helper(
            engine.update_prompt,
            prompt_id=prompt_id,
            content=content,
            author=safe_data.get('author', 'user'),
            deadline=15.0,
        )
        bounded = _public_external_result(result)
        if not isinstance(bounded, dict):
            raise HTTPException(status_code=422, detail='Invalid prompt record')
        return bounded
    except ValueError as e:
        raise HTTPException(status_code=404, detail=type(e).__name__) from e


@router.get('/prompts/graph/{prompt_id}/versions')
async def get_graph_prompt_versions(prompt_id: str) -> list[dict[str, Any]]:
    """Get version history for a prompt.

    CONCEPT:WU-KG.compute.prompt-management-ahe-rollback — Prompt Management

    Args:
        prompt_id: The identifier of the prompt.

    Returns:
        List of version dicts ordered newest-first.
    """
    prompt_id = _validate_runtime_id(prompt_id)
    engine = await _get_engine_bounded()
    versions_result = await _invoke_governed_helper(
        engine.get_prompt_versions, prompt_id, deadline=10.0
    )
    versions = list(versions_result or [])[:_MAX_EXTERNAL_COLLECTION_ITEMS]
    bounded = _public_external_result(versions)
    return bounded if isinstance(bounded, list) else []


@router.post('/prompts/graph/{prompt_id}/rollback/{version_id}')
async def rollback_graph_prompt(prompt_id: str, version_id: str) -> dict[str, Any]:
    """Rollback a prompt to a previous version.

    CONCEPT:WU-KG.compute.prompt-management-ahe-rollback — Prompt Management (AHE Rollback)

    Creates a new version that copies the target's content.
    Always forward, never destructive.

    Args:
        prompt_id: The current prompt identifier.
        version_id: The target version to rollback to.

    Returns:
        The new version dict (a copy of the target).
    """
    prompt_id = _validate_runtime_id(prompt_id)
    version_id = _validate_runtime_id(version_id)
    engine = await _get_engine_bounded()
    try:
        result = await _invoke_governed_helper(
            engine.rollback_prompt, prompt_id, version_id, deadline=15.0
        )
        bounded = _public_external_result(result)
        if not isinstance(bounded, dict):
            raise HTTPException(status_code=422, detail='Invalid prompt record')
        return bounded
    except ValueError as e:
        raise HTTPException(status_code=404, detail=type(e).__name__) from e


@router.get('/prompts/graph/{prompt_id}/diff/{version_a}/{version_b}')
async def diff_graph_prompt_versions(
    prompt_id: str, version_a: str, version_b: str
) -> dict[str, Any]:
    """Get a unified diff between two prompt versions.

    CONCEPT:WU-KG.compute.prompt-management-ahe-rollback — Prompt Management

    Args:
        prompt_id: The prompt family identifier (unused, for URL structure).
        version_a: ID of the first version.
        version_b: ID of the second version.

    Returns:
        Dict with 'diff' (unified diff string) and version metadata.
    """
    import difflib

    _validate_runtime_id(prompt_id)
    version_a = _validate_runtime_id(version_a)
    version_b = _validate_runtime_id(version_b)
    engine = await _get_engine_bounded()
    va = await _invoke_governed_helper(engine.get_prompt, version_a, deadline=10.0)
    vb = await _invoke_governed_helper(engine.get_prompt, version_b, deadline=10.0)
    if not va:
        raise HTTPException(status_code=404, detail=f'Version {version_a} not found')
    if not vb:
        raise HTTPException(status_code=404, detail=f'Version {version_b} not found')

    raw_content_a = va.get('content', va.get('system_prompt', ''))
    raw_content_b = vb.get('content', vb.get('system_prompt', ''))
    if not isinstance(raw_content_a, str) or not isinstance(raw_content_b, str):
        raise HTTPException(status_code=422, detail='Invalid prompt content')
    if (
        len(raw_content_a.encode('utf-8')) > _MAX_EXTERNAL_STRING_BYTES
        or len(raw_content_b.encode('utf-8')) > _MAX_EXTERNAL_STRING_BYTES
    ):
        raise HTTPException(status_code=422, detail='Prompt content exceeds its limit')
    content_a = raw_content_a.splitlines(keepends=True)
    content_b = raw_content_b.splitlines(keepends=True)
    diff_lines = list(
        difflib.unified_diff(
            content_a,
            content_b,
            fromfile=f'{version_a} ({va.get("timestamp", "")})',
            tofile=f'{version_b} ({vb.get("timestamp", "")})',
        )
    )
    bounded = _public_external_result(
        {
            'diff': ''.join(diff_lines),
            'version_a': {'id': version_a, 'timestamp': va.get('timestamp', '')},
            'version_b': {'id': version_b, 'timestamp': vb.get('timestamp', '')},
        }
    )
    return bounded if isinstance(bounded, dict) else {}


# ─────────────────────────────────────────────────────────────────────────
#  Tools Management (CONCEPT:WU-KG.compute.granular-resource-queries)
# ─────────────────────────────────────────────────────────────────────────


@router.get('/tools/graph')
async def list_graph_tools(request: Request) -> list[dict[str, Any]]:
    """List MCP tools from the Knowledge Graph.

    CONCEPT:WU-KG.compute.granular-resource-queries — Granular Resource Queries

    Returns:
        A list of MCP tool dicts sorted alphabetically.
    """
    try:
        engine = await _get_engine_bounded()
    except HTTPException as exc:
        if exc.status_code == 503:
            raise
        engine = None
    except Exception:
        engine = None
    if engine:
        tools_result = await _invoke_governed_helper(engine.get_tools, deadline=10.0)
        tools = list(tools_result or [])[:_MAX_EXTERNAL_COLLECTION_ITEMS]
        bounded = _public_external_result(tools)
        return bounded if isinstance(bounded, list) else []

    # Fallback: extract tools from the pydantic-ai agent instance registered on the app state
    agent = getattr(request.app.state, 'agent', None)
    if agent and hasattr(agent, '_function_tools'):
        tools = [
            {
                'id': name,
                'name': name,
                'description': tool.description or '',
                'enabled': True,
                'type': 'builtin',
            }
            for name, tool in list(agent._function_tools.items())[
                :_MAX_EXTERNAL_COLLECTION_ITEMS
            ]
        ]
        bounded = _public_external_result(tools)
        return bounded if isinstance(bounded, list) else []
    return []


@router.post('/tools/graph/{tool_id}/toggle')
async def toggle_graph_tool(tool_id: str, request: Request) -> dict[str, Any]:
    """Toggle the enabled/disabled KG flag on an MCP tool.

    CONCEPT:WU-KG.compute.granular-resource-queries — Granular Resource Queries

    Args:
        tool_id: The identifier of the tool to toggle.

    Returns:
        The resulting state of the toggled tool.
    """
    tool_id = _validate_runtime_id(tool_id)
    try:
        engine = await _get_engine_bounded()
    except HTTPException as exc:
        if exc.status_code == 503:
            raise
        engine = None
    except Exception:
        engine = None
    if engine:
        try:
            result = await _invoke_governed_helper(
                engine.toggle_resource, tool_id, deadline=15.0
            )
            bounded = _public_external_result(result)
            if not isinstance(bounded, dict):
                raise HTTPException(status_code=422, detail='Invalid toggle result')
            return bounded
        except ValueError as e:
            raise HTTPException(status_code=404, detail=type(e).__name__) from e
    return {'status': 'disabled', 'detail': 'Intelligence Graph Engine not initialized'}


# ─────────────────────────────────────────────────────────────────────────
#  Sessions & Autonomous Goals Parity (TUI-20, ORCH-5.0)
# ─────────────────────────────────────────────────────────────────────────

import sqlite3
import uuid

from agent_utilities.models.goal import GoalIteration, GoalSpec, GoalStatus
from pydantic import BaseModel, Field


class StartGoalPayload(BaseModel):
    objective: str = Field(min_length=1, max_length=8192)
    max_iterations: int = Field(default=20, ge=1, le=100)
    validation_action: str = Field(default='none', max_length=64)
    validation_cmd: str = Field(default='', max_length=1024, exclude=True)
    constraints: list[str] = Field(default_factory=list)


_GOAL_VALIDATION_ACTIONS = frozenset(
    {'none', 'workspace-present', 'repository-present'}
)


# Global dictionary to track active/completed goal runs in memory
active_goals: dict[str, dict[str, Any]] = {}
background_goal_runs: dict[str, dict[str, Any]] = {}


def _is_gateway_active() -> bool:
    """Check if the port 8100 epistemic gateway is up and healthy."""
    try:
        from agent_utilities.core.http_client import create_http_client

        with create_http_client(timeout=0.2, follow_redirects=False) as client:
            with client.stream('GET', _loopback_gateway_url('/sessions')) as response:
                return response.status_code == 200
    except Exception:
        return False


async def _proxy_to_gateway(method: str, path: str, json_data: Any = None) -> Any:
    """Forward a bounded request to the loopback epistemic gateway."""

    from agent_utilities.core.http_client import create_async_http_client

    verb = method.upper()
    if verb not in {'GET', 'POST', 'DELETE', 'PUT'}:
        raise ValueError('Unsupported gateway method')
    if json_data is not None:
        encoded_request = json.dumps(json_data, separators=(',', ':')).encode('utf-8')
        if len(encoded_request) > _MAX_EXTERNAL_ARGUMENT_BYTES:
            raise ValueError('Gateway request exceeds its safety bound')

    async with create_async_http_client(timeout=30.0, follow_redirects=False) as client:
        body = bytearray()
        async with client.stream(
            verb,
            _loopback_gateway_url(path),
            json=json_data if verb in {'POST', 'PUT'} else None,
        ) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > _MAX_EXTERNAL_RESULT_BYTES:
                    raise ValueError('Gateway response exceeds its safety bound')
    return _public_external_result(json.loads(body))


def _get_db_path() -> Path:
    # Use the shared TUI location when available, otherwise the WebUI's XDG data
    # directory. Never materialize a process-relative database.
    try:
        from agent_terminal_ui.session_manager import DEFAULT_DB_PATH

        configured_db_path = Path(DEFAULT_DB_PATH).expanduser()
        if configured_db_path.is_symlink():
            raise RuntimeError('Refusing symbolic-link session database')
        db_path = configured_db_path.resolve()
    except ImportError:
        db_path = _WEBUI_DATA_DIR / 'agent_terminal_ui.db'

    if db_path.is_symlink():
        raise RuntimeError('Refusing symbolic-link session database')
    _private_directory(db_path.parent)

    # Initialize the SQLite schema and privacy migration fail-closed.
    conn = None
    try:
        import sqlite3

        conn = sqlite3.connect(str(db_path))
        conn.executescript("""
            PRAGMA secure_delete = ON;

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT DEFAULT '',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                model TEXT DEFAULT '',
                mode TEXT DEFAULT 'ask',
                workspace TEXT DEFAULT '',
                turn_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'active',
                background INTEGER DEFAULT 0,
                needs_input INTEGER DEFAULT 0,
                last_response_preview TEXT DEFAULT '',
                goal_id TEXT DEFAULT '',
                metadata_json TEXT DEFAULT '{}',
                owner TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS turns (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                turn_number INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT DEFAULT '',
                created_at REAL NOT NULL,
                status TEXT DEFAULT 'completed',
                usage_json TEXT DEFAULT '{}',
                duration_ms INTEGER DEFAULT 0,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS webui_schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)
        # `owner` (CONCEPT:AU-ECO.ui.session-owner-visibility) was added after this table
        # existed in the wild; CREATE TABLE IF NOT EXISTS does not retrofit a column onto
        # an already-created table, so migrate it explicitly. Idempotent: sqlite raises
        # "duplicate column name" on a DB that already has it.
        try:
            conn.execute("ALTER TABLE sessions ADD COLUMN owner TEXT DEFAULT ''")
        except sqlite3.OperationalError as exc:
            if 'duplicate column name' not in str(exc).lower():
                raise
        marker = conn.execute(
            "SELECT value FROM webui_schema_meta WHERE key = 'privacy_version'"
        ).fetchone()
        if marker is None or marker[0] != '1':
            _scrub_existing_session_rows(conn)
            conn.execute(
                "INSERT OR REPLACE INTO webui_schema_meta (key, value) VALUES ('privacy_version', '1')"
            )
        conn.commit()
        conn.close()
        os.chmod(db_path, 0o600)
    except Exception as e:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001 - preserve the primary failure
                pass
        _log_failure('session_database_initialization', e)
        raise RuntimeError('Session persistence is unavailable') from e
    return db_path


def _privacy_safe_json_text(raw: Any) -> str:
    """Sanitize JSON text without preserving malformed or opaque values."""

    try:
        decoded = json.loads(str(raw or '{}'))
    except (TypeError, ValueError):
        decoded = {}
    safe, _privacy_report = sanitize_for_persistence(decoded)
    return json.dumps(safe, separators=(',', ':'), sort_keys=True)


def _scrub_existing_session_rows(conn: Any) -> None:
    """One-time in-place privacy migration for legacy WebUI session rows."""

    session_cursor = conn.execute(
        'SELECT id, title, last_response_preview, metadata_json FROM sessions'
    )
    while rows := session_cursor.fetchmany(256):
        for session_id, title, preview, metadata_json in rows:
            safe_text, _privacy_report = sanitize_for_persistence(
                {'title': title or '', 'preview': preview or ''}
            )
            conn.execute(
                'UPDATE sessions SET title = ?, last_response_preview = ?, '
                "workspace = 'workspace://active', metadata_json = ? WHERE id = ?",
                (
                    str(safe_text.get('title') or ''),
                    str(safe_text.get('preview') or ''),
                    _privacy_safe_json_text(metadata_json),
                    session_id,
                ),
            )

    turn_cursor = conn.execute('SELECT id, content, usage_json FROM turns')
    while rows := turn_cursor.fetchmany(256):
        for turn_id, content, usage_json in rows:
            safe_content, _privacy_report = sanitize_for_persistence(str(content or ''))
            conn.execute(
                'UPDATE turns SET content = ?, usage_json = ? WHERE id = ?',
                (
                    str(safe_content),
                    _privacy_safe_json_text(usage_json),
                    turn_id,
                ),
            )


@router.get('/sessions')
async def get_all_sessions() -> list[dict[str, Any]]:
    """Retrieve durable sqlite-backed agent sessions (TUI-20).

    Cross-user visibility boundary (R9 / D-WUI-33): an `admin`-role caller sees
    every session; anyone else sees only sessions they own. This is a
    server-side data-layer scope, not a UI filter — `WebUIAuthorizationMiddleware`
    only decides whether the route may be reached at all (any authenticated
    `user`-tier caller, per `nav-registry.ts`'s `control-plane.sessions`
    `minRole`); which ROWS come back is decided here, every time, regardless of
    what the caller asks for.
    """
    is_admin = _current_webui_is_admin()
    if _is_gateway_active():
        try:
            proxied = await _proxy_to_gateway('GET', '/sessions')
        except Exception as e:
            _log_failure('proxy_get_all_sessions', e, level=logging.WARNING)
            proxied = None
        if proxied is not None:
            if is_admin:
                return proxied if isinstance(proxied, list) else []
            # The proxied epistemic-gateway session store carries no per-caller
            # ownership field (unlike the local store below), so a non-admin
            # caller's "own sessions" cannot be verified from this data. Fail
            # closed rather than show every session to every user (AU-OS
            # fail-closed rule: a degraded read must never grant permission).
            return []

    db_path = _get_db_path()
    if not db_path.exists():
        return []
    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if is_admin:
            cursor.execute(
                'SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?',
                (_MAX_SESSION_RECORDS,),
            )
        else:
            cursor.execute(
                'SELECT * FROM sessions WHERE owner = ? ORDER BY updated_at DESC LIMIT ?',
                (_actor_id_from_request(None), _MAX_SESSION_RECORDS),
            )
        rows = cursor.fetchall()
        res = []
        for row in rows:
            d = dict(row)
            d['background'] = bool(d.get('background', 0))
            d['needs_input'] = bool(d.get('needs_input', 0))
            res.append(d)
        conn.close()
        safe_sessions, _privacy_report = sanitize_for_persistence(res)
        return safe_sessions if isinstance(safe_sessions, list) else []
    except Exception as e:
        _log_failure('api_extension', e)
        return []


@router.get('/sessions/{session_id}')
async def get_session_details(session_id: str) -> dict[str, Any]:
    """Retrieve details and turn records for a specific session.

    Same cross-user boundary as `get_all_sessions`: a non-admin caller who
    guesses/reuses another user's session id gets 404, not their data —
    "not found" rather than "forbidden" so existence of another user's
    session is never disclosed either.
    """
    session_id = _validate_runtime_id(session_id)
    is_admin = _current_webui_is_admin()
    if _is_gateway_active():
        try:
            result = await _proxy_to_gateway('GET', f'/sessions/{session_id}')
            if not is_admin:
                # See get_all_sessions: the gateway store carries no ownership
                # field to verify against, so a non-admin caller cannot be
                # proven to own this session — fail closed.
                raise HTTPException(status_code=404, detail='Session not found')
            return result
        except HTTPException:
            raise
        except Exception as e:
            _log_failure('proxy_get_session_details', e, level=logging.WARNING)

    db_path = _get_db_path()
    if not db_path.exists():
        raise HTTPException(status_code=404, detail='Database not found')
    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
        sess_row = cursor.fetchone()
        if not sess_row:
            conn.close()
            raise HTTPException(status_code=404, detail='Session not found')
        if not is_admin and sess_row['owner'] != _actor_id_from_request(None):
            conn.close()
            raise HTTPException(status_code=404, detail='Session not found')

        sess_dict = dict(sess_row)
        sess_dict['background'] = bool(sess_dict.get('background', 0))
        sess_dict['needs_input'] = bool(sess_dict.get('needs_input', 0))

        cursor.execute(
            'SELECT * FROM turns WHERE session_id = ? ORDER BY turn_number ASC LIMIT ?',
            (session_id, _MAX_SESSION_TURNS),
        )
        turns = [dict(t) for t in cursor.fetchall()]
        sess_dict['turns'] = turns

        conn.close()
        safe_session, _privacy_report = sanitize_for_persistence(sess_dict)
        return safe_session if isinstance(safe_session, dict) else {}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__)


@router.delete('/sessions/{session_id}')
async def delete_session(session_id: str) -> dict[str, Any]:
    """Permanently remove a session and its turns from durable persistence.

    Same cross-user boundary as `get_session_details`: only the owning user
    (or an admin) may delete a session.
    """
    session_id = _validate_runtime_id(session_id)
    is_admin = _current_webui_is_admin()
    if _is_gateway_active():
        if not is_admin:
            # No ownership field to verify against on the gateway store; fail
            # closed rather than let any authenticated user delete any session.
            raise HTTPException(status_code=404, detail='Session not found')
        try:
            return await _proxy_to_gateway('DELETE', f'/sessions/{session_id}')
        except Exception as e:
            _log_failure('proxy_delete_session', e, level=logging.WARNING)

    db_path = _get_db_path()
    if not db_path.exists():
        raise HTTPException(status_code=404, detail='Database not found')
    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if not is_admin:
            owned = cursor.execute(
                'SELECT 1 FROM sessions WHERE id = ? AND owner = ?',
                (session_id, _actor_id_from_request(None)),
            ).fetchone()
            if not owned:
                conn.close()
                raise HTTPException(status_code=404, detail='Session not found')
        cursor.execute('DELETE FROM turns WHERE session_id = ?', (session_id,))
        cursor.execute('DELETE FROM sessions WHERE id = ?', (session_id,))
        conn.commit()
        conn.close()
        return {'status': 'success', 'message': f'Session {session_id} deleted.'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__)


@router.post('/sessions/{session_id}/reply')
async def submit_session_reply(
    session_id: str, payload: dict[str, Any]
) -> dict[str, Any]:
    """Submit an interactive user reply turn to a waiting agent session."""
    session_id = _validate_runtime_id(session_id)
    raw_content = payload.get('content', '')
    if not isinstance(raw_content, str):
        raise HTTPException(status_code=400, detail='Reply content must be text')
    if len(raw_content.encode('utf-8')) > _MAX_SESSION_REPLY_BYTES:
        raise HTTPException(status_code=400, detail='Reply content exceeds its limit')
    safe_content, _privacy_report = sanitize_for_persistence(raw_content)
    content = str(safe_content).strip()
    if not content:
        raise HTTPException(status_code=400, detail='Reply content cannot be empty')
    if _is_gateway_active():
        try:
            return await _proxy_to_gateway(
                'POST',
                f'/sessions/{session_id}/reply',
                {'content': content},
            )
        except Exception as e:
            _log_failure('proxy_submit_session_reply', e, level=logging.WARNING)

    db_path = _get_db_path()
    if not db_path.exists():
        raise HTTPException(status_code=404, detail='Database not found')

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        cursor.execute('SELECT turn_count FROM sessions WHERE id = ?', (session_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail='Session not found')

        turn_num = row[0]
        turn_id = str(uuid.uuid4())

        cursor.execute(
            'INSERT INTO turns (id, session_id, turn_number, role, content, created_at, status, usage_json, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (
                turn_id,
                session_id,
                turn_num + 1,
                'user',
                content,
                time.time(),
                'completed',
                '{}',
                0,
            ),
        )

        cursor.execute(
            'UPDATE sessions SET turn_count = turn_count + 1, needs_input = 0, updated_at = ? WHERE id = ?',
            (time.time(), session_id),
        )

        conn.commit()
        conn.close()

        # Wake up background runner if it is paused waiting for input
        if session_id in background_goal_runs:
            run = background_goal_runs[session_id]
            run['user_reply'] = content
            if run['event']:
                run['event'].set()

        return {'status': 'success', 'message': 'Reply submitted successfully.'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__)


@router.post('/sessions/{session_id}/cancel')
async def cancel_session_run(session_id: str) -> dict[str, Any]:
    """Cancel any active background or goal execution on this session."""
    session_id = _validate_runtime_id(session_id)
    if _is_gateway_active():
        try:
            return await _proxy_to_gateway('POST', f'/sessions/{session_id}/cancel')
        except Exception as e:
            _log_failure('proxy_cancel_session_run', e, level=logging.WARNING)

    cancelled = False
    for goal_id, run in list(background_goal_runs.items()):
        if run['session_id'] == session_id:
            task = run['task']
            if not task.done():
                task.cancel()
            background_goal_runs.pop(goal_id, None)
            if goal_id in active_goals:
                active_goals[goal_id]['status'] = GoalStatus.CANCELLED
            cancelled = True

    db_path = _get_db_path()
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE sessions SET status = 'cancelled', updated_at = ? WHERE id = ?",
            (time.time(), session_id),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        _log_failure('api_extension', e)
    return {'status': 'success', 'cancelled': cancelled}


async def run_goal_loop(
    session_id: str,
    goal_id: str,
    objective: str,
    validation_action: str,
    max_iterations: int,
    constraints: list[str],
):
    """Background asyncio worker loop implementing Concept ORCH-5.0."""
    db_path = _get_db_path()
    start_time = time.time()

    active_goals[goal_id] = {
        'goal_id': goal_id,
        'session_id': session_id,
        'status': GoalStatus.RUNNING,
        'iterations': [],
        'total_iterations': 0,
        'total_duration_ms': 0,
        'total_tool_calls': 0,
        'summary': '',
        'error': '',
    }

    iterations_run = 0
    success = False

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE sessions SET status = 'running', updated_at = ? WHERE id = ?",
            (time.time(), session_id),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        _log_failure('api_extension', e)
    while iterations_run < max_iterations and not success:
        iterations_run += 1
        iter_start = time.time()

        # Step action description
        action_desc = f'Executing bounded goal step {iterations_run}.'
        if validation_action != 'none':
            action_desc += ' Applying the configured validation action.'

        tool_calls_count = 2 if validation_action != 'none' else 1

        # Validation actions are bounded filesystem predicates. Arbitrary shell
        # commands are intentionally unsupported at this API trust boundary.
        validation_output = ''
        cmd_success = False
        if validation_action != 'none':
            try:
                workspace = DEFAULT_AGENT_DIR.resolve()
                if validation_action == 'workspace-present':
                    cmd_success = workspace.is_dir()
                elif validation_action == 'repository-present':
                    cmd_success = workspace.is_dir() and (workspace / '.git').exists()
                validation_output = (
                    'Validation action passed.'
                    if cmd_success
                    else 'Validation action did not pass.'
                )
            except Exception as e:
                validation_output = f'Validation failed: {type(e).__name__}'
        else:
            if iterations_run >= 3:
                cmd_success = True

        iter_duration = int((time.time() - iter_start) * 1000)

        # Build iteration step record
        iteration = GoalIteration(
            iteration=iterations_run,
            action=action_desc,
            result=f'Iteration step complete. Command success: {cmd_success}',
            validation_output=validation_output,
            is_complete=cmd_success,
            duration_ms=iter_duration,
            tool_calls=tool_calls_count,
            timestamp=time.time(),
        )

        active_goals[goal_id]['iterations'].append(iteration)
        active_goals[goal_id]['total_iterations'] = iterations_run
        active_goals[goal_id]['total_duration_ms'] += iter_duration
        active_goals[goal_id]['total_tool_calls'] += tool_calls_count

        # Synchronize back to SQLite turns to show dynamic console progress
        try:
            conn = sqlite3.connect(str(db_path))
            cursor = conn.cursor()

            cursor.execute(
                'SELECT turn_count FROM sessions WHERE id = ?', (session_id,)
            )
            tc_row = cursor.fetchone()
            turn_num = tc_row[0] if tc_row else 0

            turn_id = str(uuid.uuid4())
            content_md = f'### Iteration {iterations_run}\n**Action:** {iteration.action}\n**Result:** {iteration.result}\n'
            if validation_output:
                content_md += f'\n**Validation Output:**\n```\n{validation_output}\n```'

            cursor.execute(
                'INSERT INTO turns (id, session_id, turn_number, role, content, created_at, status, usage_json, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (
                    turn_id,
                    session_id,
                    turn_num + 1,
                    'assistant',
                    content_md,
                    time.time(),
                    'completed',
                    '{}',
                    iter_duration,
                ),
            )

            preview = f'Iteration {iterations_run} complete. Success: {cmd_success}'
            cursor.execute(
                'UPDATE sessions SET turn_count = turn_count + 1, last_response_preview = ?, updated_at = ? WHERE id = ?',
                (preview, time.time(), session_id),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            _log_failure('api_extension', e)
        if cmd_success:
            success = True
            break

        await asyncio.sleep(2)

    final_status = GoalStatus.COMPLETED if success else GoalStatus.FAILED
    active_goals[goal_id]['status'] = final_status
    active_goals[goal_id]['summary'] = (
        f'Goal finished with status: {final_status.value}. Iterations run: {iterations_run}.'
    )

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute(
            'UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?',
            (final_status.value, time.time(), session_id),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        _log_failure('api_extension', e)


@router.post('/goals')
async def create_goal(payload: StartGoalPayload, request: Request) -> dict[str, Any]:
    """Launch a new backgrounded autonomous goal execution loop (ORCH-5.0)."""
    if payload.validation_cmd:
        raise HTTPException(
            status_code=400,
            detail='Arbitrary validation commands are unsupported',
        )
    if payload.validation_action not in _GOAL_VALIDATION_ACTIONS:
        raise HTTPException(status_code=400, detail='Unsupported validation action')

    safe_request, _privacy_report = sanitize_for_persistence(
        {
            'objective': payload.objective,
            'constraints': payload.constraints,
        }
    )
    safe_objective = str(safe_request.get('objective') or '').strip()
    safe_constraints = [
        str(value)
        for value in safe_request.get('constraints', [])
        if str(value).strip()
    ]
    if len(safe_constraints) > 50 or any(
        len(value) > 1024 for value in safe_constraints
    ):
        raise HTTPException(status_code=400, detail='Goal constraints exceed limits')
    if not safe_objective:
        raise HTTPException(status_code=400, detail='Goal objective is required')

    if _is_gateway_active():
        try:
            return await _proxy_to_gateway(
                'POST',
                '/goals',
                {
                    'objective': safe_objective,
                    'max_iterations': payload.max_iterations,
                    'validation_action': payload.validation_action,
                    'constraints': safe_constraints,
                },
            )
        except Exception as e:
            _log_failure('proxy_create_goal', e, level=logging.WARNING)

    session_id = str(uuid.uuid4())
    goal_id = str(uuid.uuid4())

    spec = GoalSpec.parse_goal_input(safe_objective)
    spec.id = goal_id
    spec.session_id = session_id
    if payload.max_iterations:
        spec.max_iterations = payload.max_iterations
    spec.validation_cmd = ''
    if safe_constraints:
        spec.constraints = safe_constraints

    db_path = _get_db_path()
    owner = _actor_id_from_request(request)

    # Initialize session and initial turn record
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        cursor.execute(
            'INSERT INTO sessions (id, title, created_at, updated_at, model, mode, workspace, turn_count, status, background, needs_input, last_response_preview, goal_id, metadata_json, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (
                session_id,
                'Autonomous goal',
                time.time(),
                time.time(),
                'configured',
                'ask',
                'workspace://active',
                1,
                'running',
                1,
                0,
                'Goal loop initialized...',
                goal_id,
                '{}',
                owner,
            ),
        )

        cursor.execute(
            'INSERT INTO turns (id, session_id, turn_number, role, content, created_at, status, usage_json, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (
                str(uuid.uuid4()),
                session_id,
                1,
                'user',
                f'/goal {spec.objective}'
                + (f' until {spec.end_state}' if spec.end_state else ''),
                time.time(),
                'completed',
                '{}',
                0,
            ),
        )

        conn.commit()
        conn.close()
    except Exception as e:
        _log_failure('api_extension', e)
        raise HTTPException(
            status_code=500,
            detail=f'Database initialization failed: {type(e).__name__}',
        )

    task = asyncio.create_task(
        run_goal_loop(
            session_id=session_id,
            goal_id=goal_id,
            objective=spec.objective,
            validation_action=payload.validation_action,
            max_iterations=spec.max_iterations,
            constraints=spec.constraints,
        )
    )

    background_goal_runs[goal_id] = {
        'task': task,
        'session_id': session_id,
        'user_reply': None,
        'event': asyncio.Event(),
    }

    return {
        'status': 'success',
        'goal_id': goal_id,
        'session_id': session_id,
        'validation_action': payload.validation_action,
    }


@router.get('/goals')
async def list_goals() -> list[dict[str, Any]]:
    """Retrieve lists of active and completed autonomous goals."""
    if _is_gateway_active():
        try:
            return await _proxy_to_gateway('GET', '/goals')
        except Exception as e:
            _log_failure('proxy_list_goals', e, level=logging.WARNING)

    safe_goals, _privacy_report = sanitize_for_persistence(
        list(active_goals.values())[:_MAX_SESSION_RECORDS]
    )
    return safe_goals if isinstance(safe_goals, list) else []


@router.get('/goals/{goal_id}/iterations')
async def get_goal_iterations(goal_id: str) -> dict[str, Any]:
    """Retrieve live-updating iteration steps for a specific goal run."""
    goal_id = _validate_runtime_id(goal_id)
    if _is_gateway_active():
        try:
            return await _proxy_to_gateway('GET', f'/goals/{goal_id}/iterations')
        except Exception as e:
            _log_failure('proxy_get_goal_iterations', e, level=logging.WARNING)

    if goal_id not in active_goals:
        raise HTTPException(status_code=404, detail='Goal run not found')
    safe_goal, _privacy_report = sanitize_for_persistence(active_goals[goal_id])
    return safe_goal if isinstance(safe_goal, dict) else {}


@router.post('/goals/{goal_id}/cancel')
async def cancel_goal(goal_id: str) -> dict[str, Any]:
    """Cancel an active autonomous goal loop (ORCH-5.0)."""
    goal_id = _validate_runtime_id(goal_id)
    if _is_gateway_active():
        try:
            return await _proxy_to_gateway('POST', f'/goals/{goal_id}/cancel')
        except Exception as e:
            _log_failure('proxy_cancel_goal', e, level=logging.WARNING)

    if goal_id not in background_goal_runs:
        raise HTTPException(status_code=404, detail='Active goal run not found')

    run = background_goal_runs[goal_id]
    task = run['task']
    if not task.done():
        task.cancel()

    session_id = run['session_id']
    background_goal_runs.pop(goal_id, None)

    if goal_id in active_goals:
        active_goals[goal_id]['status'] = GoalStatus.CANCELLED
        active_goals[goal_id]['summary'] = 'Goal cancelled by user.'

    db_path = _get_db_path()
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE sessions SET status = 'cancelled', updated_at = ? WHERE id = ?",
            (time.time(), session_id),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        _log_failure('api_extension', e)
    return {'status': 'success', 'message': 'Goal cancelled successfully.'}


# ---------------------------------------------------------------------------
# Central config.json and prompt management endpoints
# ---------------------------------------------------------------------------


@router.get('/config')
async def get_config_file() -> dict[str, Any]:
    """Read the central AgentConfig document from its XDG config directory."""

    config_path = config_dir() / 'config.json'
    if not config_path.exists():
        return {
            'graph_timeout': '1200000',
            'log_level': 'INFO',
            'openai_api_key': '',
            'anthropic_api_key': '',
            'gemini_api_key': '',
            'github_token': '',
        }
    try:
        data = _read_bounded_json(config_path)
        if not isinstance(data, dict):
            return {}
        browser_view, _privacy_report = sanitize_for_persistence(
            _redact_inline_secrets(data)
        )
        return browser_view if isinstance(browser_view, dict) else {}
    except Exception as e:
        _log_failure('api_extension', e)
        return {}


_CONFIG_SECTION_MARKER = re.compile(r'^\s*#\s*-{3,}\s*(.+?)\s*-{3,}\s*$')
_CONFIG_FIELD_DECL = re.compile(r'^    (\w+)\s*:\s*[^=\n]+=\s*Field\(')
_config_field_groups_cache: dict[str, str] | None = None


def _config_field_groups() -> dict[str, str]:
    """Best-effort ``{field_name: section_title}`` map for every `AgentConfig` field.

    `agent_utilities/core/config.py` (D-AOBS-3) is ~7000 lines with 200+ typed
    settings fields organised under `# --- Section Title ---` comments — the
    ONLY grouping that already exists, authored by whoever added each field.
    Rather than inventing a second, drifting taxonomy in the WebUI, this reads
    the installed package's own source (already on disk as a normal Python
    dependency; nothing is fetched or executed) and attributes each field
    declaration to the nearest PRECEDING section marker. Metadata only — field
    names and section titles, never values — so this is safe to compute
    without a graph session even though the route sits behind the same
    `kg:admin`-gated `/api/enhanced/config` prefix as the values endpoint.
    Parsed once per process and cached: the installed source does not change
    while this process is running.
    """

    global _config_field_groups_cache
    if _config_field_groups_cache is not None:
        return _config_field_groups_cache

    groups: dict[str, str] = {}
    try:
        import inspect

        from agent_utilities.core.config import AgentConfig

        source_file = inspect.getsourcefile(AgentConfig)
        if source_file:
            path = Path(source_file)
            if path.is_symlink():
                raise RuntimeError('refusing symbolic-link source file')
            text = path.read_text(encoding='utf-8')
            if len(text) > 4 * 1024 * 1024:
                raise ValueError('config source exceeds the safety bound')
            current_section = 'General'
            in_class = False
            for line in text.splitlines():
                if line.startswith('class AgentConfig('):
                    in_class = True
                    continue
                if in_class and line.startswith('class '):
                    break  # AgentConfigProxy (or the next class) ends the body
                if not in_class:
                    continue
                marker = _CONFIG_SECTION_MARKER.match(line)
                if marker:
                    current_section = marker.group(1)
                    continue
                field = _CONFIG_FIELD_DECL.match(line)
                if field:
                    groups[field.group(1)] = current_section
    except Exception as e:  # noqa: BLE001 - best-effort; an empty map degrades to "Other"
        _log_failure('config_field_groups_parse', e, level=logging.WARNING)
        groups = {}
    _config_field_groups_cache = groups
    return groups


@router.get('/config/groups')
async def get_config_field_groups() -> dict[str, Any]:
    """Return the derived `{field_name: section_title}` grouping (D-AOBS-3).

    Read-only structural metadata for `ConfigurationView.tsx` to bucket the
    fields it already reads from `/config` into the SAME sections
    `agent_utilities/core/config.py` itself organizes them under, instead of
    one flat "everything else" list.

    `_config_field_groups()` parses the Python SOURCE, so it naturally keys
    its map by attribute name (`openai_api_key`). The persisted document
    (and `/config/schema`'s properties) are alias-keyed (`OPENAI_API_KEY`,
    the majority of fields declare an explicit `Field(alias=...)`) -- this
    route re-keys to match, otherwise every lookup against a real document
    key would miss and every field would fall into "Other".
    """

    from agent_utilities.core.config import AgentConfig

    groups = _config_field_groups()
    aliased: dict[str, str] = {}
    for attribute_name, section in groups.items():
        field_info = AgentConfig.model_fields.get(attribute_name)
        key = (
            field_info.alias
            if field_info is not None and field_info.alias
            else attribute_name
        )
        aliased[key] = section
    return {
        'fields': aliased,
        'field_count': len(aliased),
    }


# `chat_models`/`embedding_models` already have their own dedicated,
# schema-derived CRUD surface (`/llm/model-schema` + `/llm/models` +
# `/llm/embedding-models`, BUG-260, rendered by `LLMTemplatesView.tsx`).
# Rendering them a SECOND time here would be a second, divergent editor for
# the same two AgentConfig fields, so the 1:1 form excludes them by name and
# `/config/schema` reports the exclusion explicitly (never a silent drop).
_CONFIG_FORM_EXCLUDED_FIELDS = frozenset({'chat_models', 'embedding_models'})


@router.get('/config/schema')
async def get_agent_config_schema() -> dict[str, Any]:
    """Return AgentConfig's own `model_json_schema()` — the single source of
    truth `ConfigurationView.tsx`'s 1:1 form renders itself from.

    Every field AgentConfig accepts (~565 of them), its type, `enum` (for a
    `Literal` field — the frontend renders these as a real dropdown, never a
    free-text box), `default`, `description`, and required-ness all come
    straight from the Pydantic model; nothing here hand-lists a field name,
    so the form cannot drift the way a hand-maintained field list would the
    moment `agent_utilities/core/config.py` gains or changes a field.

    `secret_fields` names every property this route's sibling `/config` (via
    `_is_inline_secret_key`) treats as literal-secret-shaped rather than a
    `env://`/`secret://`/`vault://` reference — the SAME classification the
    redaction/round-trip-preservation logic uses, exposed once here instead
    of a second, drift-prone copy of that naming heuristic in TypeScript.
    `secret_clear_sentinel` is likewise the ONE definition of the explicit-
    clear value `PUT /config` (`_EXPLICIT_CLEAR_SENTINEL`) recognizes, so the
    frontend never hand-copies that literal string either.
    """

    from agent_utilities.core.config import AgentConfig

    # Default `by_alias=True`: AgentConfig (a `BaseSettings`) declares an
    # env-var `alias` (e.g. `OPENAI_API_KEY`) on nearly every field, and
    # `model_validate`/`model_dump` -- with no `populate_by_name` set --
    # recognize ONLY that alias, not the Python attribute name
    # (`openai_api_key`). The persisted `config.json` document (what `GET
    # /config` returns and `PUT /config` writes) is alias-keyed to match, so
    # this schema must be too, or the properties this form renders controls
    # for would never line up with the values `/config` actually holds.
    # `get_config_field_groups()` below re-keys its attribute-name-derived
    # map to the same alias vocabulary for the same reason.
    schema = AgentConfig.model_json_schema()
    properties = schema.get('properties')
    field_names = properties if isinstance(properties, dict) else {}
    secret_fields = sorted(name for name in field_names if _is_inline_secret_key(name))
    return {
        'schema': schema,
        'excluded_fields': sorted(_CONFIG_FORM_EXCLUDED_FIELDS),
        'secret_fields': secret_fields,
        'secret_clear_sentinel': _EXPLICIT_CLEAR_SENTINEL,
    }


@router.get('/config/secret-status')
async def get_config_secret_status() -> dict[str, Any]:
    """Presence-only signal for literal-secret-shaped AgentConfig fields.

    `/config` (GET) redacts every secret-shaped value to `''`
    (`_redact_inline_secrets`) so the browser never receives a stored
    secret — but that makes "never configured" and "configured, and
    correctly hidden" look identical in that response. This route answers
    ONLY "is a non-empty value currently persisted for this key" — a
    boolean, never the value itself — so the 1:1 form can render an honest
    "Configured (redacted)" vs. "Not set" badge instead of collapsing both
    states into the same blank input. A key absent from the returned map has
    no persisted value (treat as not-set), matching `/config`'s own
    "unset key is absent" convention.
    """

    document = _load_config_document()
    status = {
        key: value not in (None, '')
        for key, value in document.items()
        if _is_inline_secret_key(key)
    }
    return {'fields': status}


# The `/config` GET response redacts every secret-shaped field to `''`
# (`_redact_inline_secrets`) so a browser never sees a stored literal secret.
# Left unhandled, that makes an UNEDITED round-trip through the 1:1
# Configuration form indistinguishable from an explicit clear: the form loads
# `''`, the operator saves without touching that field, and the PUT below
# would blank a real secret it never should have touched. `_EXPLICIT_CLEAR_SENTINEL`
# gives the form an explicit way to say "clear this one on purpose"; any other
# blank/absent value for a secret-shaped key is treated as "left alone" and
# the previously-persisted value is carried forward instead.
_EXPLICIT_CLEAR_SENTINEL = '__agent_webui_clear_secret__'


def _preserve_unedited_secrets(new: Any, existing: Any, key: str = '') -> Any:
    """Resolve `_EXPLICIT_CLEAR_SENTINEL` and re-carry an untouched secret's
    previously-persisted value through a `/config` write (see comment above).
    Mirrors `_redact_inline_secrets`' own recursion so it covers the same
    shapes that route redacts."""

    if isinstance(new, dict):
        existing_dict = existing if isinstance(existing, dict) else {}
        return {
            k: _preserve_unedited_secrets(v, existing_dict.get(k), str(k))
            for k, v in new.items()
        }
    if isinstance(new, list):
        return new
    if _is_inline_secret_key(key):
        if new == _EXPLICIT_CLEAR_SENTINEL:
            return ''
        if new in (None, '') and existing not in (None, ''):
            return existing
    return new


@router.put('/config')
async def update_config_file(data: dict[str, Any]) -> dict[str, Any]:
    """Validate and atomically write the central AgentConfig document."""
    import json

    from agent_utilities.core.config import AgentConfig

    # No local `config_dir` import here (unlike some other handlers in this
    # file) -- it would shadow the module-level `config_dir` this function's
    # sibling `_load_config_document()`/`get_config_secret_status()` use,
    # which is exactly the name tests monkeypatch to redirect config I/O to
    # a temp directory. A local re-import silently bypasses that and writes
    # to the real XDG config path instead.

    def contains_inline_secret(value: Any, key: str = '') -> bool:
        if isinstance(value, dict):
            return any(contains_inline_secret(v, str(k)) for k, v in value.items())
        if isinstance(value, list):
            return any(contains_inline_secret(item, key) for item in value)
        if not _is_inline_secret_key(key) or value in (
            None,
            '',
            _EXPLICIT_CLEAR_SENTINEL,
        ):
            return False
        return True

    # This guard must run on the CALLER's raw payload, before
    # `_preserve_unedited_secrets` merges in whatever was already persisted
    # -- checking the merged document instead would reject every save of a
    # config that already has a legitimate literal secret on disk (the
    # preserved value itself would look like a "new" inline secret).
    if contains_inline_secret(data):
        raise HTTPException(
            status_code=400,
            detail='Inline secrets are not accepted; configure secret references',
        )
    document = _preserve_unedited_secrets(data, _load_config_document())
    try:
        AgentConfig.model_validate(document)
    except Exception as e:
        _log_failure('validate_agent_config', e)
        raise HTTPException(status_code=422, detail='Invalid AgentConfig') from e

    target_dir = _private_directory(config_dir())
    config_path = target_dir / 'config.json'
    try:
        payload = json.dumps(document, indent=2, sort_keys=True).encode('utf-8')
        if len(payload) > _MAX_EXTERNAL_RESULT_BYTES:
            raise ValueError('AgentConfig document exceeds its safety bound')
        _atomic_private_write(config_path, payload)
        return {'status': 'success'}
    except Exception as e:
        _log_failure('write_agent_config', e)
        raise HTTPException(status_code=500, detail='Failed to save config') from e


@router.get('/llm/models')
async def list_llm_models() -> list[dict[str, Any]]:
    """List the configured chat models for the LLM template composer (D-AOBS-4).

    Reads the live `AgentConfig.chat_models` registry (`core/config.py`'s
    `ChatModelConfig`) — the same registry `create_model` resolves against —
    rather than re-deriving a second model list. Only capability/identity
    fields are returned; `api_key_ref`/`oauth2`/`headers_ref` are runtime
    secret REFERENCES (never literal secrets — enforced by ChatModelConfig's
    own validator) but are still excluded here because they are wiring
    detail, not something a template author needs to pick a model.
    """
    try:
        from agent_utilities.core.config import config

        models = []
        for m in config.chat_models:
            models.append(
                {
                    'id': m.id,
                    'provider': m.provider,
                    'intelligence_level': m.intelligence_level,
                    'vision': m.vision,
                    'reasoning': m.reasoning,
                    'tools_enabled': m.tools_enabled,
                    'context_window': m.context_window,
                    'can_route': m.can_route,
                    'can_kg': m.can_kg,
                }
            )
        return models
    except Exception as e:
        _log_failure('api_extension', e)
        return []


@router.get('/llm/embedding-models')
async def list_embedding_models() -> list[dict[str, Any]]:
    """List the configured embedding models (BUG-260 sibling of `/llm/models`).

    Mirrors `list_llm_models` for `AgentConfig.embedding_models`
    (`core/config.py`'s `EmbeddingModelConfig`) — the LLM template composer's
    "embedding model" tab picks from this the same way it picks a chat model
    from `/llm/models`.
    """
    try:
        from agent_utilities.core.config import config

        models = []
        for m in config.embedding_models:
            models.append(
                {
                    'id': m.id,
                    'provider': m.provider,
                    'chunk_size': m.chunk_size,
                    'context_window': m.context_window,
                    'gpu_group': m.gpu_group,
                }
            )
        return models
    except Exception as e:
        _log_failure('api_extension', e)
        return []


# BUG-260: the LLM template composer used to hand-pick a handful of display
# fields (see the two list routes above) with no way to CREATE or EDIT a
# model, so operators could pick from AgentConfig's `chat_models`/
# `embedding_models` registries but never adjust the settings AgentConfig
# actually permits. `/llm/model-schema` derives the editable field set
# directly from `ChatModelConfig`/`EmbeddingModelConfig` (`.model_json_schema()`)
# so the frontend form is generated from the same Pydantic contract
# `create_model`/the embedding factory validate against -- it cannot drift
# from what AgentConfig accepts, because it IS what AgentConfig accepts.
_EDITABLE_MODEL_KINDS = ('chat', 'embedding')


def _flatten_model_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Resolve a Pydantic `model_json_schema()` root `$ref` (emitted for a
    self-referencing model — `EmbeddingModelConfig.fallback` points back at
    `EmbeddingModelConfig` itself) into one flat schema with real
    `properties`/`required` at the top level, so the frontend never needs its
    own `$defs`/`$ref` resolver just to read a field list.
    """
    root_ref = schema.get('$ref')
    if not isinstance(root_ref, str) or not root_ref.startswith('#/$defs/'):
        return schema
    defs = schema.get('$defs')
    if not isinstance(defs, dict):
        return schema
    resolved = defs.get(root_ref.removeprefix('#/$defs/'))
    return resolved if isinstance(resolved, dict) else schema


@router.get('/llm/model-schema')
async def get_llm_model_schema() -> dict[str, Any]:
    """Return the JSON Schema for both model kinds AgentConfig registers.

    `{"chat": <ChatModelConfig schema>, "embedding": <EmbeddingModelConfig
    schema>}` — each schema's `properties`/`required` is the CANONICAL,
    generated-not-hand-maintained field set the create/edit form in
    `LLMTemplatesView.tsx` renders itself from.
    """
    from agent_utilities.core.config import ChatModelConfig, EmbeddingModelConfig

    return {
        'chat': _flatten_model_schema(ChatModelConfig.model_json_schema()),
        'embedding': _flatten_model_schema(EmbeddingModelConfig.model_json_schema()),
    }


@router.get('/llm/model-detail')
async def get_llm_model_detail(kind: str, model_id: str) -> dict[str, Any]:
    """Return ONE model's full, editable field set (every field
    `/llm/model-schema` declares, including `api_key_ref`/`headers_ref` —
    runtime secret REFERENCES, not literal secrets, needed to actually edit a
    model's auth wiring).

    `model_id` is a query param, not a path segment: real model ids contain
    `/` (e.g. `qwen/qwen3.6-27b`), which a path param cannot carry safely.
    Deliberately separate from `/llm/models`/`/llm/embedding-models`, whose
    browse-list shape intentionally excludes secret references
    (`test_list_llm_models_reads_the_live_chat_models_registry_and_excludes_secrets`) —
    this route is only ever called to populate the edit form for a model the
    operator explicitly opened.
    """
    if kind not in _EDITABLE_MODEL_KINDS:
        raise HTTPException(status_code=400, detail='Unknown model kind')
    from agent_utilities.core.config import config

    registry = config.chat_models if kind == 'chat' else config.embedding_models
    for m in registry:
        if m.id == model_id:
            return m.model_dump(mode='json')
    raise HTTPException(status_code=404, detail='Model not found')


def _load_config_document() -> dict[str, Any]:
    config_path = config_dir() / 'config.json'
    if not config_path.exists():
        return {}
    data = _read_bounded_json(config_path)
    return data if isinstance(data, dict) else {}


def _write_model_registry(kind: str, models: list[dict[str, Any]]) -> None:
    """Validate *models* against the matching AgentConfig model type, merge
    them into the persisted document under the right registry key, validate
    the WHOLE resulting document, and write it atomically.

    Shared by the chat- and embedding-model upsert routes below so there is
    exactly one persistence path for both (mirrors `update_config_file`'s
    existing whole-document write, scoped to just the touched key so an
    editor for one registry can never clobber the rest of AgentConfig).
    """
    import json

    from agent_utilities.core.config import (
        AgentConfig,
        ChatModelConfig,
        EmbeddingModelConfig,
    )

    if kind not in _EDITABLE_MODEL_KINDS:
        raise HTTPException(status_code=400, detail='Unknown model kind')
    registry_key = 'chat_models' if kind == 'chat' else 'embedding_models'
    model_type = ChatModelConfig if kind == 'chat' else EmbeddingModelConfig

    if not isinstance(models, list) or len(models) > _MAX_EXTERNAL_COLLECTION_ITEMS:
        raise HTTPException(status_code=400, detail='Invalid model list')
    try:
        validated = [
            model_type.model_validate(m).model_dump(mode='json') for m in models
        ]
    except Exception as e:
        _log_failure(f'validate_{kind}_model', e)
        raise HTTPException(
            status_code=422, detail=f'Invalid {kind} model configuration'
        ) from e

    document = _load_config_document()
    document[registry_key] = validated
    try:
        AgentConfig.model_validate(document)
    except Exception as e:
        _log_failure('validate_agent_config', e)
        raise HTTPException(status_code=422, detail='Invalid AgentConfig') from e

    target_dir = _private_directory(config_dir())
    config_path = target_dir / 'config.json'
    try:
        payload = json.dumps(document, indent=2, sort_keys=True).encode('utf-8')
        if len(payload) > _MAX_EXTERNAL_RESULT_BYTES:
            raise ValueError('AgentConfig document exceeds its safety bound')
        _atomic_private_write(config_path, payload)
    except HTTPException:
        raise
    except Exception as e:
        _log_failure(f'write_{kind}_models', e)
        raise HTTPException(status_code=500, detail='Failed to save config') from e


@router.put('/llm/models')
async def update_llm_models(data: dict[str, Any]) -> dict[str, Any]:
    """Replace the persisted `chat_models` registry.

    `data['models']` is the FULL desired list (create = append a new entry,
    edit = resubmit the list with that entry changed) -- each entry is
    validated against `ChatModelConfig` (the same schema `/llm/model-schema`
    exposes) before anything is written.
    """
    models = data.get('models')
    if not isinstance(models, list):
        raise HTTPException(status_code=400, detail="'models' must be a list")
    _write_model_registry('chat', models)
    return {'status': 'success'}


@router.put('/llm/embedding-models')
async def update_embedding_models(data: dict[str, Any]) -> dict[str, Any]:
    """Replace the persisted `embedding_models` registry (BUG-260 sibling of
    `update_llm_models`, validated against `EmbeddingModelConfig`)."""
    models = data.get('models')
    if not isinstance(models, list):
        raise HTTPException(status_code=400, detail="'models' must be a list")
    _write_model_registry('embedding', models)
    return {'status': 'success'}


@router.get('/prompts')
async def list_prompts() -> list[dict[str, Any]]:
    """List all prompting JSON configs from agent_utilities/prompts/."""
    prompts_dir = get_prompts_dir()
    results = []
    if prompts_dir.exists() and prompts_dir.is_dir():
        for f in list(prompts_dir.glob('*.json'))[:_MAX_EXTERNAL_COLLECTION_ITEMS]:
            try:
                data = _read_bounded_json(f)
                title = (
                    data.get('identity', {}).get('role')
                    or data.get('title')
                    or f.stem.replace('_', ' ').title()
                )
                goal = (
                    data.get('identity', {}).get('goal')
                    or data.get('metadata', {}).get('description')
                    or data.get('goal', '')
                )
                core_directive = data.get('instructions', {}).get(
                    'core_directive'
                ) or data.get('core_directive', '')
                results.append(
                    {
                        'name': f.stem,
                        'title': title,
                        'goal': goal,
                        'core_directive': core_directive,
                        'file_path': f'prompt://{f.stem}',
                    }
                )
            except Exception as e:
                _log_failure('parse_prompt', e)
    public_results = _public_external_result(results)
    return public_results if isinstance(public_results, list) else []


@router.get('/prompts/{name}')
async def get_prompt_by_name(name: str) -> dict[str, Any]:
    """Retrieve details for a single prompt file."""
    f = resolve_prompt_file(name)
    if not f.exists():
        raise HTTPException(status_code=404, detail='Prompt not found')
    try:
        data = _read_bounded_json(f)
        # Flat-map nested properties for client-side form editor compatibility
        if 'title' not in data:
            data['title'] = data.get('identity', {}).get('role') or data.get(
                'task', name.replace('_', ' ').title()
            )
        if 'goal' not in data:
            data['goal'] = data.get('identity', {}).get('goal') or data.get(
                'metadata', {}
            ).get('description', '')
        if 'core_directive' not in data:
            data['core_directive'] = (
                data.get('instructions', {}).get('core_directive') or ''
            )
        public_data = _public_external_result(data)
        if not isinstance(public_data, dict):
            raise ValueError('Prompt document has an invalid shape')
        return public_data
    except Exception as e:
        _log_failure('parse_prompt', e)
        raise HTTPException(status_code=500, detail=type(e).__name__)


@router.put('/prompts/{name}')
async def update_prompt_by_name(name: str, data: dict[str, Any]) -> dict[str, Any]:
    """Update details for a single prompt file."""
    import json

    f = resolve_prompt_file(name)
    try:
        bounded_data = _bounded_external_value(data)
        if not isinstance(bounded_data, dict):
            raise ValueError('Prompt document has an invalid shape')
        safe_data, privacy_report = sanitize_for_persistence(bounded_data)
        if privacy_report.changed or not isinstance(safe_data, dict):
            raise HTTPException(
                status_code=400,
                detail='Prompt violates the persistence privacy boundary',
            )
        data = safe_data

        # Sync flat properties back to standard nested structure
        title = data.get('title')
        goal = data.get('goal')
        core_directive = data.get('core_directive')

        if title is not None:
            if 'identity' not in data or not isinstance(data['identity'], dict):
                data['identity'] = {}
            data['identity']['role'] = title

        if goal is not None:
            if 'identity' not in data or not isinstance(data['identity'], dict):
                data['identity'] = {}
            data['identity']['goal'] = goal
            if 'metadata' not in data or not isinstance(data['metadata'], dict):
                data['metadata'] = {}
            data['metadata']['description'] = goal

        if core_directive is not None:
            if 'instructions' not in data or not isinstance(data['instructions'], dict):
                data['instructions'] = {}
            data['instructions']['core_directive'] = core_directive

        payload = json.dumps(
            data,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        ).encode('utf-8')
        if len(payload) > _MAX_EXTERNAL_RESULT_BYTES:
            raise ValueError('Prompt document exceeds its safety bound')
        _atomic_private_write(f, payload)
        return {'status': 'success'}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('save_prompt', e)
        raise HTTPException(status_code=500, detail=type(e).__name__)


# ---------------------------------------------------------------------------
# Ecosystem Services & Dashboard Integration Gateways (ECO-006)
# ---------------------------------------------------------------------------


@router.get('/ecosystem/services')
async def list_ecosystem_services() -> list[str]:
    """Dynamically scan installed MCP servers and backend packages.

    This is the sole live-parity authority `src/lib/integrations-catalog.ts`
    composes against, and its own module docstring is explicit about the
    contract: "a package this endpoint does not report is never listed, and
    every package it DOES report gets an item, full stop." Previously this
    handler undermined that contract from the other direction -- after the
    real directory scan, it unconditionally appended eight hardcoded package
    names ("Guarantee standard services for validation / UI fallback") if
    they were not already present. On a deployment where one of those eight
    is genuinely not installed (a minimal profile, a partial checkout, a
    misconfigured `AGENT_PACKAGES_ROOT`), that fabricated a live-looking
    catalog entry for a package that does not exist -- the exact mirror of
    BUG-018 (which silently DROPPED unknown packages instead of fabricating
    known ones). Report only what the scan actually found.

    Raises 503 rather than returning an empty list when the packages root
    itself cannot be resolved, so a misconfigured deployment reads as
    "unavailable", not as "zero packages installed" -- the same empty-vs-
    unavailable distinction this catalog's design requires everywhere else.
    """
    agents_dir = get_agent_packages_dir() / 'agents'
    if not (agents_dir.exists() and agents_dir.is_dir()):
        raise HTTPException(
            status_code=503,
            detail=f'Agent packages directory not found at {agents_dir}',
        )

    services = []
    for index, p in enumerate(agents_dir.iterdir()):
        if index >= _MAX_EXTERNAL_COLLECTION_ITEMS:
            break
        if p.is_dir():
            services.append(p.name)

    return services[:_MAX_EXTERNAL_COLLECTION_ITEMS]


@router.get('/tunnel-manager/hosts')
async def get_tunnel_hosts() -> dict[str, Any]:
    """Retrieve opaque SSH inventory through a governed host adapter."""

    delegated_inventory = get_helper('list_tunnel_hosts')
    if delegated_inventory is None:
        raise HTTPException(
            status_code=501,
            detail='Governed tunnel inventory delegation is not configured',
        )
    try:
        raw_hosts = await _invoke_governed_helper(
            delegated_inventory,
            deadline=10.0,
        )
        raw_hosts = _public_external_result(raw_hosts)
        if isinstance(raw_hosts, dict):
            inventory = list(raw_hosts.items())[:_MAX_EXTERNAL_COLLECTION_ITEMS]
        elif isinstance(raw_hosts, list):
            inventory = list(enumerate(raw_hosts, start=1))[
                :_MAX_EXTERNAL_COLLECTION_ITEMS
            ]
        else:
            raise ValueError('Governed tunnel inventory returned an invalid shape')

        hosts = []
        for inventory_key, record in inventory:
            public = record if isinstance(record, dict) else {}
            identity = str(
                public.get('reference')
                or public.get('id')
                or public.get('alias')
                or inventory_key
            )
            hosts.append(
                {
                    'reference': _opaque_reference('host', identity),
                    'status': 'configured',
                    'port_configured': bool(public.get('port')),
                    'identity_configured': bool(public.get('identity_file')),
                    'password_configured': bool(public.get('password_configured')),
                }
            )
        return {'hosts': hosts}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('load_tunnel_hosts', e)
        raise HTTPException(
            status_code=502,
            detail=f'tunnel-manager host inventory unavailable: {type(e).__name__}',
        ) from e


@router.post('/tunnel-manager/hosts')
async def add_tunnel_host(payload: dict[str, Any]) -> dict[str, str]:
    """Delegate a bounded host registration containing no inline secrets."""

    delegated_registration = get_helper('configure_tunnel_host')
    if delegated_registration is None:
        raise HTTPException(
            status_code=501,
            detail='Governed tunnel configuration delegation is not configured',
        )
    try:
        forbidden = {'password', 'identity_file', 'proxy_command'} & set(payload)
        if forbidden:
            raise HTTPException(status_code=400, detail='Unsafe host fields')
        alias = str(payload['alias']).strip()
        hostname = str(payload['hostname']).strip()
        user = str(payload['user']).strip()
        password_ref = str(payload.get('password_ref') or '').strip() or None
        if not _SAFE_INVENTORY_TOKEN.fullmatch(alias):
            raise HTTPException(status_code=400, detail='Invalid host alias')
        if not _SAFE_HOSTNAME.fullmatch(hostname):
            raise HTTPException(status_code=400, detail='Invalid hostname')
        if not _SAFE_INVENTORY_TOKEN.fullmatch(user):
            raise HTTPException(status_code=400, detail='Invalid account identifier')
        if password_ref and (len(password_ref) > 512 or '\x00' in password_ref):
            raise HTTPException(status_code=400, detail='Invalid secret reference')
        try:
            port = int(payload.get('port', 22))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail='Invalid port') from exc
        if not 1 <= port <= 65535:
            raise HTTPException(status_code=400, detail='Invalid port')

        result = await _invoke_governed_helper(
            delegated_registration,
            deadline=15.0,
            alias=alias,
            hostname=hostname,
            user=user,
            port=port,
            password_ref=password_ref,
        )
        _public_external_result(result)
        return {
            'status': 'success',
            'message': 'Host registered',
            'reference': _opaque_reference('host', alias),
        }
    except HTTPException:
        raise
    except KeyError as e:
        raise HTTPException(
            status_code=400, detail='Missing required host field'
        ) from e
    except Exception as e:
        _log_failure('add_tunnel_host', e)
        raise HTTPException(
            status_code=502,
            detail='Failed to register host',
        ) from e


@router.get('/systems-manager/resources')
async def get_system_resources() -> dict[str, Any]:
    """Retrieve host machine load details (CPU, RAM, Disks)."""
    try:
        import psutil

        cpu = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        return {
            'cpu_percent': cpu,
            'memory': {
                'percent': mem.percent,
                'used_gb': round(mem.used / (1024**3), 2),
                'total_gb': round(mem.total / (1024**3), 2),
            },
            'disk': {
                'percent': disk.percent,
                'used_gb': round(disk.used / (1024**3), 2),
                'total_gb': round(disk.total / (1024**3), 2),
            },
        }
    except Exception as e:
        _log_failure('read_system_resources', e)
        raise HTTPException(
            status_code=503,
            detail=f'System resource metrics unavailable (psutil): {type(e).__name__}',
        ) from e


@router.get('/systems-manager/processes')
async def list_system_processes() -> list[dict[str, Any]]:
    """Return bounded, opaque process utilization without identities or PIDs."""
    try:
        import psutil

        processes = []
        for proc in psutil.process_iter(
            ['pid', 'name', 'username', 'cpu_percent', 'memory_percent']
        ):
            try:
                info = proc.info
                identity = f'{info["pid"]}:{info["name"]}:{info["username"]}'
                processes.append(
                    {
                        'reference': _opaque_reference('process', identity),
                        'cpu': round(info['cpu_percent'] or 0.0, 1),
                        'memory': round(info['memory_percent'] or 0.0, 1),
                    }
                )
            except Exception:
                continue
        # Sort by cpu/memory consumption
        return sorted(processes, key=lambda x: x['cpu'], reverse=True)[:50]
    except Exception as e:
        _log_failure('list_system_processes', e)
        raise HTTPException(
            status_code=503,
            detail=f'Process listing unavailable (psutil): {type(e).__name__}',
        ) from e


@router.get('/container-manager/containers')
async def list_docker_containers() -> list[dict[str, Any]]:
    """Return bounded container inventory through a governed host adapter.

    The WebUI intentionally has no direct access to a Docker/Podman socket.
    The host adapter owns daemon authorization, transport, credential, and
    audit policy; only opaque references and a short state cross this boundary.
    """

    delegated_inventory = get_helper('list_containers')
    if delegated_inventory is None:
        raise HTTPException(
            status_code=501,
            detail='Governed container inventory delegation is not configured',
        )
    try:
        raw_containers = await _invoke_governed_helper(
            delegated_inventory,
            deadline=10.0,
            include_stopped=True,
        )
        raw_containers = _public_external_result(raw_containers)
        if not isinstance(raw_containers, list):
            raise ValueError('Governed container inventory returned an invalid shape')
        results = []
        for index, container in enumerate(
            raw_containers[:_MAX_CONTAINER_RECORDS], start=1
        ):
            if not isinstance(container, dict):
                continue
            identity = str(
                container.get('reference')
                or container.get('id')
                or container.get('Id')
                or index
            )
            state = str(container.get('state') or container.get('State') or 'unknown')
            results.append(
                {
                    'reference': _opaque_reference('container', identity),
                    'state': state[:64],
                }
            )
        return results
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('container_inventory', e, level=logging.DEBUG)
        raise HTTPException(
            status_code=503,
            detail=f'Container inventory unavailable: {type(e).__name__}',
        ) from e


def discover_workspace_repositories() -> list[Path]:
    """Return real git repositories visible under the configured workspace."""
    workspace = get_workspace_dir().resolve()
    roots = [workspace / 'agent-packages', workspace]
    discovered: dict[Path, None] = {}
    for root in roots:
        if root.is_symlink() or not root.is_dir():
            continue
        if (root / '.git').exists():
            discovered[root] = None
        try:
            for child in root.iterdir():
                if len(discovered) >= _MAX_EXTERNAL_COLLECTION_ITEMS:
                    break
                if child.is_symlink() or not child.is_dir():
                    continue
                resolved = child.resolve()
                try:
                    resolved.relative_to(workspace)
                except ValueError:
                    continue
                if (resolved / '.git').exists():
                    discovered[resolved] = None
        except OSError as exc:
            _log_failure('api_extension', exc, level=logging.DEBUG)
    return sorted(discovered, key=lambda path: path.name.lower())[
        :_MAX_EXTERNAL_COLLECTION_ITEMS
    ]


@router.get('/repository-manager/repos')
async def list_workspace_repos() -> list[dict[str, Any]]:
    """Retrieve privacy-safe repository references and tracked-drift states."""
    import subprocess

    repos = []
    for index, repo_path in enumerate(discover_workspace_repositories(), start=1):
        reference = _opaque_reference('repo', str(repo_path))
        try:
            git_env = _git_probe_environment()
            branch_probe = subprocess.run(
                ['git', 'symbolic-ref', '--quiet', 'HEAD'],
                cwd=str(repo_path),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                env=git_env,
            )
            if branch_probe.returncode not in (0, 1):
                raise RuntimeError('repository branch-state probe failed')
            unstaged = subprocess.run(
                ['git', 'diff', '--quiet', '--no-ext-diff'],
                cwd=str(repo_path),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                env=git_env,
            )
            staged = subprocess.run(
                ['git', 'diff', '--cached', '--quiet', '--no-ext-diff'],
                cwd=str(repo_path),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                env=git_env,
            )
            if unstaged.returncode not in (0, 1) or staged.returncode not in (0, 1):
                raise RuntimeError('repository state probe failed')
            modified = unstaged.returncode == 1 or staged.returncode == 1
            repos.append(
                {
                    'reference': reference,
                    'label': f'Repository {index}',
                    'branch_state': (
                        'attached' if branch_probe.returncode == 0 else 'detached'
                    ),
                    'modified_count': 1 if modified else 0,
                    'status': 'modified' if modified else 'clean',
                }
            )
        except Exception as exc:
            _log_failure('api_extension', exc, level=logging.WARNING)
            repos.append(
                {
                    'reference': reference,
                    'label': f'Repository {index}',
                    'branch_state': 'unknown',
                    'modified_count': -1,
                    'status': 'unavailable',
                    'detail': type(exc).__name__,
                }
            )

    return repos


@router.post('/repository-manager/bulk')
async def trigger_workspace_bulk_actions(payload: dict[str, Any]) -> dict[str, Any]:
    """Run a bounded read-only status action across referenced workspace repos.

    Repository paths, names, commands, and command output never cross the API
    boundary. Mutating repository operations must use the governed repository
    manager delegation surface instead.
    """
    import subprocess

    action = payload.get('action', '')
    targets = payload.get('targets', [])
    if (
        not isinstance(action, str)
        or not isinstance(targets, list)
        or not action
        or not targets
        or len(targets) > 100
        or any(
            not isinstance(value, str) or not re.fullmatch(r'repo:[0-9a-f]{32}', value)
            for value in targets
        )
    ):
        raise HTTPException(status_code=400, detail='Missing action or targets list')

    # Map the high-level action to a concrete command. Only whitelisted,
    # non-destructive commands are dispatched.
    command_map: dict[str, list[str]] = {
        'status': ['git', 'diff', '--quiet', '--no-ext-diff'],
    }
    cmd = command_map.get(action)
    if cmd is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f'Unsupported bulk action {action!r}. Supported: {sorted(command_map)}'
            ),
        )

    repositories = {
        _opaque_reference('repo', str(path)): path
        for path in discover_workspace_repositories()
    }
    results: list[dict[str, Any]] = []
    for reference in targets:
        repo_path = repositories.get(str(reference))
        if repo_path is None:
            results.append({'status': 'error', 'detail': 'repo not found'})
            continue
        try:
            git_env = _git_probe_environment()
            proc = subprocess.run(
                cmd,
                cwd=str(repo_path),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                env=git_env,
            )
            staged = subprocess.run(
                ['git', 'diff', '--cached', '--quiet', '--no-ext-diff'],
                cwd=str(repo_path),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                env=git_env,
            )
            if proc.returncode not in (0, 1) or staged.returncode not in (0, 1):
                raise RuntimeError('repository state probe failed')
            results.append(
                {
                    'reference': str(reference),
                    'status': 'success',
                    'modified': proc.returncode == 1 or staged.returncode == 1,
                }
            )
        except Exception as e:  # noqa: BLE001 - report per-repo failure
            results.append({'status': 'error', 'detail': type(e).__name__})

    failures = [r for r in results if r['status'] != 'success']
    logger.info(
        f'Bulk {action} ran on {len(targets)} repos: '
        f'{len(targets) - len(failures)} ok, {len(failures)} failed.'
    )
    return {
        'status': 'success' if not failures else 'partial',
        'action': action,
        'results': results,
    }


@router.post('/voice/transcribe')
async def transcribe_voice_chunk(file: UploadFile = File(...)) -> dict[str, str]:
    """Delegate one bounded audio upload to a governed transcription sandbox."""
    max_upload_bytes = 25 * 1024 * 1024
    max_transcript_bytes = 2 * 1024 * 1024
    try:
        media_type = (file.content_type or '').split(';', 1)[0].strip().lower()
        if not (media_type.startswith('audio/') or media_type == 'video/webm'):
            raise HTTPException(status_code=400, detail='Unsupported audio media type')
        payload = bytearray()
        while chunk := await file.read(64 * 1024):
            payload.extend(chunk)
            if len(payload) > max_upload_bytes:
                raise HTTPException(status_code=413, detail='Upload too large')
        if not payload:
            raise HTTPException(status_code=400, detail='Audio upload is empty')

        transcriber = get_helper('transcribe_voice')
        if transcriber is None:
            raise HTTPException(
                status_code=501,
                detail='Governed transcription delegation is not configured',
            )

        result = await _invoke_governed_helper(
            transcriber,
            deadline=120.0,
            content=bytes(payload),
            content_type=media_type,
        )
        text = result.get('text', '') if isinstance(result, dict) else result
        if not isinstance(text, str):
            raise ValueError('Transcription result has an invalid shape')
        if len(text.encode('utf-8')) > max_transcript_bytes:
            raise ValueError('Transcription result exceeds its safety bound')
        public_result = _public_external_result({'text': text.strip()})
        return {'text': str(public_result.get('text') or '')}
    except HTTPException:
        raise
    except Exception as e:
        _log_failure('voice_transcription', e)
        raise HTTPException(status_code=500, detail='Transcription failed') from e
    finally:
        await file.close()


# ---------------------------------------------------------------------------
# Additional Lazy-Loaded Ecosystem Endpoints (ECO-007)
#
# Each endpoint queries the real upstream service over HTTP, with the base URL
# and any credentials taken from environment variables. When the relevant env
# vars are unset we return an honest ``status: 'not_configured'`` payload that
# names the missing config; when the service is set but unreachable we return
# ``status: 'error'`` with the real reason. We never fabricate records.
# ---------------------------------------------------------------------------


def _service_error(exc: Exception, **empty: Any) -> dict[str, Any]:
    """Honest payload when a configured service could not be reached."""
    return {
        'status': 'error',
        'source': 'unreachable',
        'detail': type(exc).__name__,
        **empty,
    }


def _capability_unavailable(reason: str, **empty: Any) -> dict[str, Any]:
    """Honest payload when no backend exists for a read (not a wiring gap).

    This means the underlying system genuinely exposes no API for the
    requested read, so there is nothing to wire. ``reason`` states exactly
    what is missing so it can be built if desired.
    """
    return {
        'status': 'capability_unavailable',
        'source': 'no_backend',
        'detail': reason,
        **empty,
    }


async def _call_mcp_tool(
    server_name: str,
    tool_name: str,
    arguments: dict[str, Any],
    *,
    timeout: float = 30.0,
) -> Any:
    """Invoke an MCP tool through the host's governed GraphOS delegation seam.

    The WebUI intentionally never reads launch commands, spawns registry
    entries, or composes child environments. The host injects ``call_mcp_tool``
    after applying its allowlist, actor policy, credential references, and
    audit envelope. Results cross a bounded privacy boundary before a route can
    inspect or return them.
    """
    bounded_arguments = _validate_delegation_call(server_name, tool_name, arguments)
    delegated_call = get_helper('call_mcp_tool')
    if delegated_call is None:
        raise RuntimeError('Governed MCP delegation is not configured')
    bounded_timeout = max(0.1, min(float(timeout), 30.0))
    result = await _invoke_governed_helper(
        delegated_call,
        deadline=bounded_timeout,
        server_name=server_name,
        tool_name=tool_name,
        arguments=bounded_arguments,
        timeout=bounded_timeout,
    )
    return _public_external_result(result)


@router.get('/ecosystem/atlassian/kanban')
async def get_atlassian_kanban(jql: str = 'ORDER BY updated DESC'):
    """Retrieve Jira issues grouped by status (Kanban format) via ``atlassian-mcp``.

    Dispatches ``atlassian_jira_issue``/``search_for_issues_using_jql`` against
    the configured Jira Cloud instance and buckets the returned issues into
    Kanban columns by their status name. ``jql`` selects the slice of work
    (defaults to most-recently-updated). Surfaces an honest error if the
    server or Jira is unreachable.
    """
    import json as _json

    if not jql.strip() or len(jql.encode('utf-8')) > 8192:
        raise HTTPException(status_code=400, detail='Invalid JQL query')

    try:
        resp = await _call_mcp_tool(
            'atlassian-mcp',
            'atlassian_jira_issue',
            {
                'action': 'search_for_issues_using_jql',
                'params_json': _json.dumps({'jql': jql, 'max_results': 100}),
            },
        )
    except Exception as e:  # noqa: BLE001
        return _service_error(e, columns=[])
    # The MCP tool returns {status_code, data}. Treat any non-2xx (e.g. the
    # Jira site being unavailable) as an honest backend error, not empty data.
    if isinstance(resp, dict):
        status_code = resp.get('status_code')
        if status_code is not None and not (200 <= int(status_code) < 300):
            return _service_error(
                RuntimeError(f'Jira returned HTTP {status_code}'), columns=[]
            )
        payload = resp.get('data', resp)
    else:
        payload = resp
    issues = payload.get('issues', []) if isinstance(payload, dict) else []
    columns: dict[str, dict[str, Any]] = {}
    for issue in issues[:100] if isinstance(issues, list) else []:
        if not isinstance(issue, dict):
            continue
        fields = issue.get('fields', {}) or {}
        status_name = (fields.get('status') or {}).get('name', 'Unknown')
        col = columns.setdefault(
            status_name, {'id': status_name, 'title': status_name, 'issues': []}
        )
        col['issues'].append(
            {
                'id': issue.get('key'),
                'title': fields.get('summary', ''),
                'priority': (fields.get('priority') or {}).get('name'),
                'assignee': (fields.get('assignee') or {}).get('displayName'),
            }
        )
    bounded = _public_external_result(
        {
            'status': 'success',
            'source': 'live',
            'columns': list(columns.values()),
        }
    )
    return bounded if isinstance(bounded, dict) else {'status': 'error'}


@router.get('/ecosystem/github/prs')
async def get_github_prs(repo: str | None = None):
    """Retrieve open PRs and recent Actions runs via the ``github-mcp`` server.

    ``repo`` is a required ``owner/name`` slug (falling back to the
    ``GITHUB_REPO`` env if set) — a PR list is inherently per-repository.
    Dispatches ``github_pulls``/``list`` and ``github_actions``/``list_runs``
    against the GitHub API with the token configured on that MCP server.
    Surfaces an honest error if the server or GitHub is unreachable.
    """
    import json as _json

    target_repo = repo or os.getenv('GITHUB_REPO')
    if not target_repo or not re.fullmatch(
        r'[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}', target_repo
    ):
        return {
            'status': 'needs_input',
            'source': 'live',
            'detail': (
                "Specify a target repository as 'owner/name' "
                '(query param ?repo=owner/name) to list its pull requests.'
            ),
            'prs': [],
            'workflows': [],
        }
    owner, _, name = target_repo.partition('/')
    params = _json.dumps({'owner': owner, 'repo': name, 'state': 'open'})
    try:
        pr_resp = await _call_mcp_tool(
            'github-mcp', 'github_pulls', {'action': 'list', 'params_json': params}
        )
    except Exception as e:  # noqa: BLE001
        return _service_error(e, prs=[], workflows=[])
    if isinstance(pr_resp, dict) and pr_resp.get('status', 200) >= 400:
        return _service_error(
            RuntimeError(pr_resp.get('error') or pr_resp), prs=[], workflows=[]
        )
    prs_raw = pr_resp.get('data', pr_resp) if isinstance(pr_resp, dict) else pr_resp
    prs = [
        {
            'id': p.get('number'),
            'title': p.get('title'),
            'author': (p.get('user') or {}).get('login'),
            'branch': (p.get('head') or {}).get('ref'),
            'status': p.get('state') or 'open',
            # BUG-012: GitHub never returns a per-check-run summary on the
            # pulls/list payload itself (that requires a separate
            # `/commits/{sha}/check-runs` call this endpoint does not make),
            # so there is no `checks` field here -- the frontend must not
            # render one either. `web_url` mirrors the field GitLab's MR
            # mapping already returns. NOTE: `_public_external_result` below
            # runs this whole dict through `sanitize_for_persistence`, whose
            # `_LOCATION_FIELDS` blanket-redacts ANY field named `web_url`
            # (this one included) to `"[REDACTED_LOCATION]"` regardless of
            # content -- resolving that for a genuinely public source link
            # is `GOC-27-W06` (security-review) scope; `EcosystemView.tsx`'s
            # `isRenderableUrl` guard is today's WebUI-side mitigation so
            # this never renders as a broken `<a href>`.
            'web_url': p.get('html_url'),
        }
        for p in (prs_raw[:100] if isinstance(prs_raw, list) else [])
        if isinstance(p, dict)
    ]
    workflows: list[dict[str, Any]] = []
    try:
        run_resp = await _call_mcp_tool(
            'github-mcp',
            'github_actions',
            {
                'action': 'list_runs',
                'params_json': _json.dumps({'owner': owner, 'repo': name}),
            },
        )
        runs_data = (
            run_resp.get('data', run_resp) if isinstance(run_resp, dict) else run_resp
        )
        if isinstance(runs_data, dict):
            runs_data = runs_data.get('workflow_runs', [])
        workflows = [
            {
                'id': r.get('id'),
                # BUG-012: the real GitHub Actions run object carries
                # `run_number` (the per-repository sequential run count the
                # UI has always rendered as `Run #{run_number}`); this
                # mapping used to drop it on the floor, so the field the
                # frontend declared and rendered never had a source --
                # `wf.run_number` always rendered blank.
                'run_number': r.get('run_number'),
                'name': r.get('name'),
                'status': r.get('status'),
                'conclusion': r.get('conclusion'),
            }
            for r in (runs_data[:100] if isinstance(runs_data, list) else [])
            if isinstance(r, dict)
        ]
    except Exception:  # noqa: BLE001
        # PRs already succeeded; a runs failure should not blank the response.
        workflows = []
    bounded = _public_external_result(
        {
            'status': 'success',
            'source': 'live',
            'repo': target_repo,
            'prs': prs,
            'workflows': workflows,
        }
    )
    return bounded if isinstance(bounded, dict) else {'status': 'error'}


@router.get('/ecosystem/gitlab/mrs')
async def get_gitlab_mrs():
    """Retrieve open GitLab merge requests via the ``gitlab-mcp`` fleet server.

    Dispatches ``api_request`` GET ``/merge_requests?scope=all&state=opened``
    (the token-scoped, project-agnostic MR list) against the configured GitLab
    instance, plus the latest pipeline per affected project. Surfaces an honest
    error if the server or GitLab is unreachable.
    """

    def _unwrap(resp: Any) -> Any:
        if isinstance(resp, dict):
            return resp.get('data', resp)
        return resp

    try:
        mr_resp = await _call_mcp_tool(
            'gitlab-mcp',
            'api_request',
            {
                'method': 'GET',
                'endpoint': '/merge_requests?scope=all&state=opened&per_page=30',
            },
        )
    except Exception as e:  # noqa: BLE001
        return _service_error(e, mrs=[], pipelines=[])
    mrs_raw = _unwrap(mr_resp)
    mrs = [
        {
            'id': m.get('iid'),
            'project_id': m.get('project_id'),
            'title': m.get('title'),
            'author': (m.get('author') or {}).get('username'),
            'target_branch': m.get('target_branch'),
            'status': m.get('state'),
            'web_url': m.get('web_url'),
        }
        for m in (mrs_raw[:30] if isinstance(mrs_raw, list) else [])
        if isinstance(m, dict)
    ]
    # Pull the latest pipeline for each distinct project referenced by an MR.
    pipelines: list[dict[str, Any]] = []
    seen_projects: set[Any] = set()
    for m in mrs:
        pid = m.get('project_id')
        if pid is None or pid in seen_projects:
            continue
        if not str(pid).isdigit() or len(str(pid)) > 20:
            continue
        if len(seen_projects) >= _MAX_DELEGATION_FANOUT:
            break
        seen_projects.add(pid)
        try:
            pipe_resp = await _call_mcp_tool(
                'gitlab-mcp',
                'api_request',
                {
                    'method': 'GET',
                    'endpoint': f'/projects/{pid}/pipelines?per_page=5',
                },
            )
        except Exception:  # noqa: BLE001
            continue
        pipe_rows = _unwrap(pipe_resp)
        for p in pipe_rows[:5] if isinstance(pipe_rows, list) else []:
            if not isinstance(p, dict):
                continue
            pipelines.append(
                {
                    'id': p.get('id'),
                    'project_id': pid,
                    'ref': p.get('ref'),
                    'status': p.get('status'),
                }
            )
    bounded = _public_external_result(
        {
            'status': 'success',
            'source': 'live',
            'mrs': mrs,
            'pipelines': pipelines,
        }
    )
    return bounded if isinstance(bounded, dict) else {'status': 'error'}


@router.get('/ecosystem/portainer/stacks')
async def get_portainer_stacks():
    """Retrieve real Portainer stacks via the ``portainer-mcp`` fleet server.

    Dispatches the ``portainer_stack``/``get_stacks`` tool, which talks to the
    live Portainer instance with the credentials configured on that MCP server.
    Surfaces an honest error if the server or Portainer is unreachable.
    """
    try:
        raw = await _call_mcp_tool(
            'portainer-mcp', 'portainer_stack', {'action': 'get_stacks'}
        )
    except Exception as e:  # noqa: BLE001
        return _service_error(e, stacks=[])
    items = raw.get('data', raw) if isinstance(raw, dict) else raw
    type_map: dict[Any, str] = {1: 'Swarm', 2: 'Compose'}
    status_map: dict[Any, str] = {1: 'active', 2: 'inactive'}
    stacks = [
        {
            'name': s.get('Name'),
            'status': status_map.get(s.get('Status'), 'unknown'),
            'type': type_map.get(s.get('Type'), 'unknown'),
            'endpoint_id': s.get('EndpointId'),
        }
        for s in (items if isinstance(items, list) else [])
        if isinstance(s, dict)
    ]
    return {'status': 'success', 'source': 'live', 'stacks': stacks}


@router.get('/ecosystem/datascience/training')
async def get_datascience_training():
    """Retrieve real trained-model metrics via the ``data-science-mcp`` server.

    Dispatches ``rank_models``, which returns every fitted/trained model in the
    live model registry ranked by test score. Returns an empty ``models`` list
    (not a fabricated run) when nothing has been trained yet, and surfaces an
    honest error if the server is unreachable.
    """
    try:
        data = await _call_mcp_tool('data-science-mcp', 'rank_models', {})
    except Exception as e:  # noqa: BLE001
        return _service_error(e, models=[])
    ranked = data.get('ranked_models', data) if isinstance(data, dict) else data
    models = ranked if isinstance(ranked, list) else []
    return {
        'status': 'success',
        'source': 'live',
        'models': models,
        'detail': 'no trained models registered' if not models else None,
    }


@router.get('/ecosystem/scholarx/papers')
async def get_scholarx_papers():
    """List downloaded publications via the ``scholarx-mcp`` fleet server.

    Dispatches ``sx_storage``/``stored`` which returns the real offline PDF
    library ScholarX has downloaded (id/title/authors/local_path/...). Surfaces
    an honest error if the server is unreachable.
    """
    try:
        raw = await _call_mcp_tool('scholarx-mcp', 'sx_storage', {'action': 'stored'})
    except Exception as e:  # noqa: BLE001
        return _service_error(e, papers=[])
    records = raw.get('papers', []) if isinstance(raw, dict) else raw
    papers = [
        {
            'id': p.get('id'),
            'title': p.get('title'),
            'author': p.get('authors') or p.get('author'),
            'category': (p.get('categories') or [None])[0]
            if isinstance(p.get('categories'), list)
            else p.get('category'),
            'url': p.get('url'),
            'path': p.get('local_path'),
            'status': 'downloaded' if p.get('exists') else 'queued',
        }
        for p in (records if isinstance(records, list) else [])
        if isinstance(p, dict)
    ]
    return {'status': 'success', 'source': 'live', 'papers': papers}


@router.get('/ecosystem/uptime/status')
async def get_uptime_status():
    """Retrieve real monitor states via the ``uptime-kuma-mcp`` fleet server.

    Dispatches ``uptime_kuma_monitors``/``get_monitors`` against the configured
    Uptime Kuma instance. Surfaces an honest error if the server or Kuma is
    unreachable.
    """
    try:
        raw = await _call_mcp_tool(
            'uptime-kuma-mcp',
            'uptime_kuma_monitors',
            {'action': 'get_monitors'},
            timeout=45.0,
        )
    except Exception as e:  # noqa: BLE001
        return _service_error(e, monitors=[])
    # Kuma returns either a list of monitors or an id->monitor mapping.
    if isinstance(raw, dict):
        mons = raw.get('monitors', raw.get('data', list(raw.values())))
    else:
        mons = raw
    monitors = []
    for mon in mons if isinstance(mons, list) else []:
        if not isinstance(mon, dict):
            continue
        monitors.append(
            {
                'id': mon.get('id'),
                'name': mon.get('name'),
                'url': mon.get('url'),
                'status': 'up' if mon.get('active') else 'paused',
                'type': mon.get('type'),
                'interval': mon.get('interval'),
            }
        )
    return {'status': 'success', 'source': 'live', 'monitors': monitors}


@router.get('/ecosystem/searxng/search')
async def get_searxng_search(q: str = 'agent-utilities'):
    """Run a real query via the ``searxng-mcp`` fleet server.

    Dispatches ``web_search`` against the configured privacy-respecting
    SearXNG metasearch instance. Surfaces an honest error if the server or the
    SearXNG instance is unreachable.
    """
    if not q.strip() or len(q.encode('utf-8')) > 8192:
        raise HTTPException(status_code=400, detail='Invalid search query')
    try:
        data = await _call_mcp_tool('searxng-mcp', 'web_search', {'query': q})
    except Exception as e:  # noqa: BLE001
        return _service_error(e, query=q, results=[])
    if isinstance(data, dict) and data.get('error'):
        return _service_error(RuntimeError(data['error']), query=q, results=[])
    raw_results = data.get('results', []) if isinstance(data, dict) else data
    results = [
        {
            'title': r.get('title'),
            'url': r.get('url'),
            'score': r.get('score'),
            'engine': r.get('engine') or r.get('engines'),
        }
        for r in (raw_results if isinstance(raw_results, list) else [])
        if isinstance(r, dict)
    ]
    bounded = _public_external_result(
        {
            'status': 'success',
            'source': 'live',
            'query': q,
            'results': results,
        }
    )
    return bounded if isinstance(bounded, dict) else {'status': 'error'}


@router.get('/ecosystem/homeassistant/devices')
async def get_homeassistant_devices():
    """Retrieve real entity states via the ``home-assistant-mcp`` fleet server.

    Dispatches ``home_assistant_states``/``list_states`` against the configured
    Home Assistant instance. Surfaces an honest error if the server or HA is
    unreachable.
    """
    try:
        states = await _call_mcp_tool(
            'home-assistant-mcp',
            'home_assistant_states',
            {'action': 'list_states'},
        )
    except Exception as e:  # noqa: BLE001
        return _service_error(e, devices=[])
    if isinstance(states, dict):
        states = states.get('states', states.get('data', []))
    devices = [
        {
            'entity_id': s.get('entity_id'),
            'friendly_name': (s.get('attributes') or {}).get('friendly_name'),
            'state': s.get('state'),
            'attributes': s.get('attributes'),
        }
        for s in (states if isinstance(states, list) else [])
        if isinstance(s, dict)
    ]
    return {'status': 'success', 'source': 'live', 'devices': devices}


@router.get('/ecosystem/nextcloud/events')
async def get_nextcloud_events():
    """Retrieve real Nextcloud calendars and their events via ``nextcloud-mcp``.

    Dispatches ``nextcloud_calendar``/``list_calendars`` against the configured
    Nextcloud instance, then enumerates each calendar's events via
    ``list_calendar_events``. Surfaces an honest error if the server or
    Nextcloud is unreachable.
    """
    import json as _json

    try:
        cals_raw = await _call_mcp_tool(
            'nextcloud-mcp', 'nextcloud_calendar', {'action': 'list_calendars'}
        )
    except Exception as e:  # noqa: BLE001
        return _service_error(e, calendars=[], events=[])
    calendars = (
        cals_raw.get('calendars', cals_raw) if isinstance(cals_raw, dict) else cals_raw
    )
    calendars = (
        calendars[:_MAX_DELEGATION_FANOUT] if isinstance(calendars, list) else []
    )

    events: list[dict[str, Any]] = []
    for cal in calendars:
        if len(events) >= _MAX_EXTERNAL_COLLECTION_ITEMS:
            break
        if not isinstance(cal, dict):
            continue
        cal_name = cal.get('name') or cal.get('id') or cal.get('display_name')
        if (
            not isinstance(cal_name, str)
            or not cal_name.strip()
            or len(cal_name.encode('utf-8')) > 512
        ):
            continue
        try:
            evs_raw = await _call_mcp_tool(
                'nextcloud-mcp',
                'nextcloud_calendar',
                {
                    'action': 'list_calendar_events',
                    'params_json': _json.dumps({'calendar_name': cal_name}),
                },
            )
        except Exception:  # noqa: BLE001
            # A single calendar failing must not fabricate or drop the rest.
            continue
        evs = evs_raw.get('events', evs_raw) if isinstance(evs_raw, dict) else evs_raw
        for ev in evs if isinstance(evs, list) else []:
            if len(events) >= _MAX_EXTERNAL_COLLECTION_ITEMS:
                break
            if not isinstance(ev, dict):
                continue
            events.append(
                {
                    'id': ev.get('uid') or ev.get('id'),
                    'calendar': cal_name,
                    'title': ev.get('summary') or ev.get('title'),
                    'start': ev.get('start') or ev.get('dtstart'),
                    'end': ev.get('end') or ev.get('dtend'),
                }
            )
    bounded = _public_external_result(
        {
            'status': 'success',
            'source': 'live',
            'calendars': [
                c.get('name') or c.get('id') for c in calendars if isinstance(c, dict)
            ],
            'events': events,
        }
    )
    return bounded if isinstance(bounded, dict) else {'status': 'error'}


@router.get('/ecosystem/microsoft/emails')
async def get_microsoft_emails():
    """Retrieve recent inbox messages via the ``microsoft-mcp`` fleet server.

    Dispatches ``microsoft_mail``/``list_mail_messages`` against Microsoft Graph
    using the credentials configured on that MCP server. Surfaces an honest
    error if the server or Graph is unreachable / unauthorized.
    """
    import json as _json

    try:
        data = await _call_mcp_tool(
            'microsoft-mcp',
            'microsoft_mail',
            {
                'action': 'list_mail_messages',
                'params_json': _json.dumps({'top': 10}),
            },
        )
    except Exception as e:  # noqa: BLE001
        return _service_error(e, emails=[])
    messages = data.get('value', data) if isinstance(data, dict) else data
    if isinstance(messages, dict):
        messages = messages.get('value', [])
    emails = [
        {
            'id': m.get('id'),
            'subject': m.get('subject'),
            'from': ((m.get('from') or {}).get('emailAddress') or {}).get('address'),
            'received': m.get('receivedDateTime'),
            'importance': m.get('importance'),
        }
        for m in (messages if isinstance(messages, list) else [])
        if isinstance(m, dict)
    ]
    return {'status': 'success', 'source': 'live', 'emails': emails}


@router.get('/ecosystem/mediadownloader/downloads')
async def get_mediadownloader_downloads():
    """Report that no live media-downloader queue backend exists.

    The fleet's ``media-downloader-mcp`` exposes only a fire-and-forget
    ``download_media(video_url, ...)`` action — it keeps no server-side queue
    or history that can be read back. There is therefore no real data source to
    wire for a "current downloads" view; we report that honestly instead of
    fabricating a queue. Building a real view requires the media-downloader to
    persist and expose a job/queue read API first.
    """
    return _capability_unavailable(
        'media-downloader-mcp exposes only download_media (no readable '
        'queue/history); a persistent download-job read API must be built '
        'before a live queue view is possible.',
        queue=[],
        downloads=[],
    )


@router.get('/ecosystem/qbittorrent/torrents')
async def get_qbittorrent_torrents():
    """Retrieve real torrent state via the ``qbittorrent-mcp`` fleet server.

    Dispatches ``qbittorrent_torrents``/``get_torrent_list`` against the
    configured qBittorrent WebUI. Surfaces an honest error if the server or
    qBittorrent is unreachable.
    """
    try:
        raw = await _call_mcp_tool(
            'qbittorrent-mcp',
            'qbittorrent_torrents',
            {'action': 'get_torrent_list'},
        )
    except Exception as e:  # noqa: BLE001
        return _service_error(e, torrents=[])
    if isinstance(raw, dict):
        raw = raw.get('torrents', raw.get('data', []))
    torrents = [
        {
            'name': t.get('name'),
            'size': t.get('size'),
            'progress': round((t.get('progress', 0) or 0) * 100, 1),
            'dl_speed': t.get('dlspeed'),
            'ul_speed': t.get('upspeed'),
            'status': t.get('state'),
        }
        for t in (raw if isinstance(raw, list) else [])
        if isinstance(t, dict)
    ]
    return {'status': 'success', 'source': 'live', 'torrents': torrents}


@router.get('/ecosystem/stirlingpdf/jobs')
async def get_stirlingpdf_jobs():
    """Report that Stirling-PDF maintains no readable job history.

    The fleet's ``stirlingpdf-mcp`` exposes only ``pdf_action`` (synchronous,
    one-shot PDF transforms). Stirling-PDF itself keeps no persistent job
    list — async jobs are transient and addressable only by an id the caller
    already holds. There is no real backend to enumerate, so we report that
    honestly instead of fabricating completed jobs.
    """
    return _capability_unavailable(
        'Stirling-PDF processes PDFs synchronously and keeps no persistent '
        'job history; stirlingpdf-mcp exposes only one-shot pdf_action. A '
        'durable job-tracking store must be built before a live jobs view is '
        'possible.',
        jobs=[],
    )


@router.get('/system')
async def get_system_prompt(request: Request) -> dict[str, str]:
    """Retrieve the current active agent's system prompt."""
    agent = getattr(request.app.state, 'agent', None)
    if agent:
        sys_prompt = _extract_system_prompt(agent)
        bounded = _public_external_result({'system_prompt': sys_prompt})
        return bounded if isinstance(bounded, dict) else {'system_prompt': ''}
    return {'system_prompt': 'No active agent loaded.'}


@router.post('/commands/execute')
async def execute_slash_command(payload: dict, request: Request):
    """Execute a slash command centrally inside the backend."""
    raw_command = payload.get('command', '')
    if not isinstance(raw_command, str) or len(raw_command.encode('utf-8')) > 8192:
        raise HTTPException(status_code=400, detail='Invalid slash command')
    command_str = raw_command.strip()

    if not command_str.startswith('/'):
        return {
            'response_markdown': 'Error: Command must start with a slash `/`.',
            'client_actions': [],
        }

    parts = command_str[1:].split(maxsplit=1)
    cmd_name = parts[0].lower() if parts else ''
    args = parts[1] if len(parts) > 1 else ''

    # Standardize cmd_name aliases
    if cmd_name == 'quit':
        cmd_name = 'exit'

    client_actions = []

    if cmd_name == 'help':
        response_md = (
            '### Available Commands:\n\n'
            '- `/help` - Show this help menu\n'
            '- `/clear` - Clear active chat session\n'
            '- `/model [model_id]` - View or change current LLM model\n'
            '- `/tools` - List all available MCP tools\n'
            '- `/skills` - List loaded custom skills\n'
            '- `/graph stats` - Display knowledge graph statistics\n'
            '- `/graph nodes [type]` - List graph nodes\n'
            '- `/graph search <query>` - Run semantic search on graph\n'
            '- `/graph impact <symbol>` - Run blast radius/impact analysis\n'
            '- `/kb list` - List connected knowledge bases\n'
            '- `/kb search <query>` - Query semantic knowledge base articles\n'
            '- `/kb ingest <url_or_path>` - Ingest folder/website to KB\n'
            '- `/sdd specs` - List active spec-driven specifications\n'
            '- `/sdd constitution` - Read spec governance rules\n'
            '- `/sdd sync` - Synchronize local files with KG specifications\n'
            '- `/cron calendar` - View scheduled background tasks\n'
            '- `/cron logs` - Check cron job execution logs\n'
            '- `/resources` - List spawned subagents and tasks\n'
            '- `/resources spawn <name>` - Deploy a new subagent\n'
        )
        return {'response_markdown': response_md, 'client_actions': []}

    elif cmd_name == 'clear':
        return {
            'response_markdown': 'Chat session cleared.',
            'client_actions': [{'action': 'clear_chat'}],
        }

    elif cmd_name == 'model':
        registry = getattr(request.app.state, 'model_registry', None)
        if not args:
            current_model = registry.get_default() if registry else None
            model_id = current_model.id if current_model else 'unknown'
            response_md = f'Current active model: `{model_id}`.\n\nUse `/model <model_id>` to change it.'
        else:
            client_actions.append({'action': 'set_model', 'value': args})
            response_md = f'Switched model to `{args}`.'
        return {'response_markdown': response_md, 'client_actions': client_actions}

    elif cmd_name == 'tools':
        agent = getattr(request.app.state, 'agent', None)
        tools = []
        if agent and hasattr(agent, '_tools'):
            for t in agent._tools:
                tools.append(f'- `{t.name}`: {t.description}')
        mcp_toolsets = getattr(request.app.state, 'mcp_toolsets', [])
        for toolset in mcp_toolsets:
            if hasattr(toolset, 'tools'):
                for t in toolset.tools:
                    tools.append(f'- `[{toolset.name}] {t.name}`: {t.description}')
        if not tools:
            response_md = 'No tools currently registered.'
        else:
            response_md = '### Registered Tools:\n\n' + '\n'.join(tools)
        return {'response_markdown': response_md, 'client_actions': []}

    elif cmd_name == 'skills':
        skills = []
        helpers_list = get_helper('list_skills')
        if helpers_list:
            try:
                skills_list = await _invoke_governed_helper(helpers_list, deadline=10.0)
                for s in skills_list:
                    skills.append(
                        f'- **{s["name"]}** (`{s["id"]}`): {s["description"]}'
                    )
            except Exception as e:
                skills.append(f'Error fetching skills: {type(e).__name__}')
        if not skills:
            response_md = 'No custom skills currently active.'
        else:
            response_md = '### Active Custom Skills:\n\n' + '\n'.join(skills)
        return {'response_markdown': response_md, 'client_actions': []}

    elif cmd_name == 'graph':
        sub_parts = args.split(maxsplit=1)
        sub = sub_parts[0].lower() if sub_parts else 'stats'
        rest = sub_parts[1] if len(sub_parts) > 1 else ''

        try:
            engine = await _get_engine_bounded()
        except Exception as e:
            return {
                'response_markdown': f'Error: Graph engine not active: {type(e).__name__}',
                'client_actions': [],
            }

        if sub in ('', 'stats'):
            try:
                num_nodes, num_edges = await _invoke_governed_helper(
                    lambda: (len(engine.graph.nodes), len(engine.graph.edges)),
                    deadline=15.0,
                )
                response_md = (
                    '### Knowledge Graph Statistics\n\n'
                    f'- **Total Nodes**: {num_nodes}\n'
                    f'- **Total Relationships**: {num_edges}\n'
                    f'- **Backend Status**: Online (LadybugDB)\n'
                )
            except Exception as e:
                response_md = f'Error querying graph stats: {type(e).__name__}'

        elif sub == 'nodes':
            node_type = rest.strip()
            try:
                nodes = []
                graph_nodes = await _invoke_governed_helper(
                    lambda: list(engine.graph.nodes(data=True)),
                    deadline=15.0,
                )
                for n, attrs in graph_nodes:
                    ntype = attrs.get('type', 'Unknown')
                    if not node_type or ntype.lower() == node_type.lower():
                        nodes.append(
                            f'- `{n}` ({ntype}): {attrs.get("description", "No description")}'
                        )
                if not nodes:
                    response_md = f'No nodes of type `{node_type}` found.'
                else:
                    response_md = (
                        f'### Graph Nodes ({node_type or "All"}):\n\n'
                        + '\n'.join(nodes[:50])
                    )
            except Exception as e:
                response_md = f'Error listing nodes: {type(e).__name__}'

        elif sub == 'search':
            if not rest:
                response_md = 'Usage: `/graph search <query>`'
            else:
                try:
                    hits = []
                    graph_nodes = await _invoke_governed_helper(
                        lambda: list(engine.graph.nodes(data=True)),
                        deadline=15.0,
                    )
                    for n, attrs in graph_nodes:
                        if (
                            rest.lower() in n.lower()
                            or rest.lower() in attrs.get('description', '').lower()
                        ):
                            hits.append(
                                f'- **{n}** ({attrs.get("type", "Node")}): {attrs.get("description", "")}'
                            )
                    if not hits:
                        response_md = f'No search results for query `{rest}`.'
                    else:
                        response_md = (
                            f'### Graph Search Results for `{rest}`:\n\n'
                            + '\n'.join(hits[:10])
                        )
                except Exception as e:
                    response_md = f'Error searching graph: {type(e).__name__}'

        elif sub == 'impact':
            if not rest:
                response_md = 'Usage: `/graph impact <symbol>`'
            else:
                try:
                    impact_set = await _invoke_governed_helper(
                        engine.query_impact,
                        rest,
                        deadline=30.0,
                    )
                except Exception as e:  # noqa: BLE001
                    impact_set = None
                    response_md = f'Error running impact analysis for `{rest}`: {type(e).__name__}'
                if impact_set is not None:
                    if not impact_set:
                        response_md = (
                            f'### Blast Radius Impact Analysis for `{rest}`\n\n'
                            f'No impacted nodes found (symbol not in graph or has '
                            f'no dependents).'
                        )
                    else:
                        lines = [
                            f'### Blast Radius Impact Analysis for `{rest}`\n',
                            f'**{len(impact_set)} item(s) affected:**\n',
                        ]
                        for item in impact_set[:50]:
                            if isinstance(item, dict):
                                ident = (
                                    item.get('id')
                                    or item.get('name')
                                    or item.get('symbol')
                                    or str(item)
                                )
                                sev = item.get('severity') or item.get('impact')
                                lines.append(
                                    f'- `{ident}`' + (f' ({sev})' if sev else '')
                                )
                            else:
                                lines.append(f'- `{item}`')
                        response_md = '\n'.join(lines)
        else:
            response_md = f'Unknown `/graph` subcommand: `{sub}`'

        return {'response_markdown': response_md, 'client_actions': []}

    elif cmd_name == 'kb':
        sub_parts = args.split(maxsplit=1)
        sub = sub_parts[0].lower() if sub_parts else 'list'
        rest = sub_parts[1] if len(sub_parts) > 1 else ''

        try:
            engine = await _get_engine_bounded()
            kb_engine = await _invoke_governed_helper(
                KBIngestionEngine,
                engine.graph,
                engine.backend,
                deadline=10.0,
            )
        except Exception as e:  # noqa: BLE001
            return {
                'response_markdown': (f'KB backend not available: {type(e).__name__}'),
                'client_actions': [],
            }

        if sub == 'list':
            try:
                bases = await _invoke_governed_helper(
                    kb_engine.list_knowledge_bases,
                    deadline=15.0,
                )
            except Exception as e:  # noqa: BLE001
                bases = None
                response_md = f'Error listing knowledge bases: {type(e).__name__}'
            if bases is not None:
                if not bases:
                    response_md = 'No knowledge bases found.'
                else:
                    lines = ['### Connected Knowledge Bases:\n']
                    for b in list(bases)[:_MAX_EXTERNAL_COLLECTION_ITEMS]:
                        if isinstance(b, dict):
                            name = b.get('id') or b.get('name', 'unknown')
                            desc = b.get('description') or b.get('name', '')
                            count = b.get('article_count')
                            suffix = f' ({count} articles)' if count is not None else ''
                            lines.append(f'- `{name}` {desc}{suffix}')
                        else:
                            lines.append(f'- `{b}`')
                    response_md = '\n'.join(lines)
        elif sub == 'search':
            if not rest:
                response_md = 'Usage: `/kb search <query>`'
            else:
                try:
                    hits = await _invoke_governed_helper(
                        kb_engine.search,
                        rest,
                        deadline=30.0,
                    )
                except Exception as e:  # noqa: BLE001
                    hits = None
                    response_md = f'Error searching knowledge base: {type(e).__name__}'
                if hits is not None:
                    if not hits:
                        response_md = f'No KB results for `{rest}`.'
                    else:
                        lines = [f'### KB Search Results for `{rest}`:\n']
                        for h in hits[:10]:
                            if isinstance(h, dict):
                                title = h.get('title') or h.get('id', 'Untitled')
                                score = h.get('score') or h.get('relevance')
                                snippet = (h.get('content') or h.get('snippet') or '')[
                                    :160
                                ]
                                score_s = (
                                    f' (score: {score})' if score is not None else ''
                                )
                                lines.append(f'- **{title}**{score_s}')
                                if snippet:
                                    lines.append(f'  > {snippet}')
                            else:
                                lines.append(f'- {h}')
                        response_md = '\n'.join(lines)
        elif sub == 'ingest':
            if not rest:
                response_md = 'Usage: `/kb ingest <url_or_path>`'
            else:
                try:
                    result = await _invoke_governed_helper(
                        kb_engine.ingest,
                        deadline=120.0,
                        kb_id='workspace-docs',
                        source=_workspace_ingestion_source(rest),
                        name='workspace-docs',
                    )
                    job_id = result.get('job_id') if isinstance(result, dict) else None
                    response_md = (
                        f'Started KB ingestion of `{rest}` into `workspace-docs`'
                        + (f' (job `{job_id}`).' if job_id else '.')
                    )
                except Exception as e:  # noqa: BLE001
                    response_md = f'Failed to ingest `{rest}`: {type(e).__name__}'
        else:
            response_md = f'Unknown `/kb` subcommand: `{sub}`'

        return {'response_markdown': response_md, 'client_actions': []}

    elif cmd_name == 'sdd':
        sub = args.strip().lower() or 'specs'
        try:
            manager = SDDManager(DEFAULT_AGENT_DIR)
        except Exception as e:  # noqa: BLE001
            return {
                'response_markdown': (f'SDD backend not available: {type(e).__name__}'),
                'client_actions': [],
            }

        if sub == 'specs':
            try:
                specs = manager.list_specs()
            except Exception as e:  # noqa: BLE001
                specs = None
                response_md = f'Error listing specs: {type(e).__name__}'
            if specs is not None:
                if not specs:
                    response_md = 'No specifications found under `.specify/specs`.'
                else:
                    lines = ['### Active Spec-Driven Specifications:\n']
                    for s in list(specs)[:_MAX_EXTERNAL_COLLECTION_ITEMS]:
                        sd = s.model_dump() if hasattr(s, 'model_dump') else s
                        sid = sd.get('id') if isinstance(sd, dict) else str(s)
                        title = sd.get('title', '') if isinstance(sd, dict) else ''
                        status = sd.get('status', '') if isinstance(sd, dict) else ''
                        lines.append(
                            f'- **{sid}**: {title}'
                            + (f' (Status: `{status}`)' if status else '')
                        )
                    response_md = '\n'.join(lines)
        elif sub == 'constitution':
            try:
                constitution = manager.get_constitution()
            except Exception as e:  # noqa: BLE001
                constitution = None
                response_md = f'Error reading constitution: {type(e).__name__}'
            else:
                if not constitution:
                    response_md = (
                        'No constitution found at `.specify/memory/constitution.md`.'
                    )
                elif isinstance(constitution, dict):
                    body = (
                        constitution.get('content')
                        or constitution.get('text')
                        or str(constitution)
                    )
                    response_md = f'### Project Constitution\n\n{body}'
                else:
                    response_md = f'### Project Constitution\n\n{constitution}'
        elif sub == 'sync':
            try:
                engine = await _get_engine_bounded()
                manager.sync_to_memory(engine)
                response_md = (
                    'Synchronized local specifications with the Knowledge Graph.'
                )
            except Exception as e:  # noqa: BLE001
                response_md = f'SDD sync failed: {type(e).__name__}'
        else:
            response_md = f'Unknown `/sdd` subcommand: `{sub}`'

        return {'response_markdown': response_md, 'client_actions': []}

    elif cmd_name == 'cron':
        sub = args.strip().lower() or 'calendar'
        if sub == 'calendar':
            try:
                from agent_utilities.core.scheduler import get_cron_tasks

                registry = get_cron_tasks()
                tasks = list(registry.tasks)
            except Exception as e:  # noqa: BLE001
                tasks = None
                response_md = f'Cron scheduler not available: {type(e).__name__}'
            if tasks is not None:
                if not tasks:
                    response_md = 'No scheduled background tasks registered.'
                else:
                    lines = ['### Scheduled Background Tasks:\n']
                    for t in tasks[:_MAX_EXTERNAL_COLLECTION_ITEMS]:
                        lines.append(
                            f'- `{t.name or t.id}`: every '
                            f'{t.interval_minutes} min '
                            f'(last run: {t.last_run or "never"})'
                        )
                    response_md = '\n'.join(lines)
        elif sub == 'logs':
            try:
                from agent_utilities.core.scheduler import get_cron_logs

                entries = list(get_cron_logs().entries)
            except Exception as e:  # noqa: BLE001
                entries = None
                response_md = f'Cron logs not available: {type(e).__name__}'
            if entries is not None:
                if not entries:
                    response_md = 'No cron execution logs recorded yet.'
                else:
                    lines = ['### Cron Job Execution Logs (recent):\n']
                    for entry in entries[-10:]:
                        lines.append(
                            f'- `{entry.timestamp}` - '
                            f'`{entry.task_name or entry.task_id}` - '
                            f'{entry.status}: {entry.message}'
                        )
                    response_md = '\n'.join(lines)
        else:
            response_md = f'Unknown `/cron` subcommand: `{sub}`'

        return {'response_markdown': response_md, 'client_actions': []}

    elif cmd_name == 'resources':
        sub_parts = args.split(maxsplit=1)
        sub = sub_parts[0].lower() if sub_parts else 'list'
        rest = sub_parts[1] if len(sub_parts) > 1 else ''

        try:
            engine = await _get_engine_bounded()
        except Exception as e:  # noqa: BLE001
            return {
                'response_markdown': (
                    f'Resource backend not available: {type(e).__name__}'
                ),
                'client_actions': [],
            }

        if sub in ('', 'list'):
            try:
                rows = await _invoke_governed_helper(
                    engine.backend.execute,
                    f'MATCH (r:CallableResource) RETURN r '
                    f'LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}',
                    deadline=15.0,
                )
                resources = [
                    row.get('r', {})
                    for row in rows
                    if isinstance(row.get('r', {}), dict)
                ]
            except Exception as e:  # noqa: BLE001
                resources = None
                response_md = f'Error listing resources: {type(e).__name__}'
            if resources is not None:
                if not resources:
                    response_md = 'No active subagents or callable resources.'
                else:
                    lines = ['### Spawned Subagents and Callable Resources:\n']
                    for r in resources:
                        rid = r.get('id') or r.get('name', 'unknown')
                        rtype = r.get('type') or r.get('kind', 'resource')
                        rstatus = r.get('status', 'unknown')
                        lines.append(
                            f'- **`{rid}`** - Type: `{rtype}` - Status: `{rstatus}`'
                        )
                    response_md = '\n'.join(lines)
        elif sub == 'spawn':
            if not rest:
                response_md = 'Usage: `/resources spawn <name>`'
            else:
                try:
                    agent = await _invoke_governed_helper(
                        engine.spawn_specialized_agent,
                        deadline=30.0,
                        name=rest,
                    )
                    agent_data = (
                        agent.model_dump()
                        if hasattr(agent, 'model_dump')
                        else {'name': rest}
                    )
                    spawned_id = agent_data.get('id') or agent_data.get('name') or rest
                    response_md = f'Spawned subagent **`{spawned_id}`**.'
                except Exception as e:  # noqa: BLE001
                    response_md = (
                        f'Failed to spawn subagent `{rest}`: {type(e).__name__}'
                    )
        else:
            response_md = f'Unknown `/resources` subcommand: `{sub}`'

        return {'response_markdown': response_md, 'client_actions': []}

    else:
        return {
            'response_markdown': f'Unknown slash command: `/{cmd_name}`. Type `/help` for a list of available commands.',
            'client_actions': [],
        }


@router.get('/commands/autocomplete')
async def autocomplete_slash_command(query: str = ''):
    """Provide autocomplete dynamic options for client interfaces."""
    if len(query.encode('utf-8')) > 1024:
        raise HTTPException(status_code=400, detail='Autocomplete query is too long')
    commands_list = [
        '/help',
        '/clear',
        '/model',
        '/tools',
        '/skills',
        '/graph stats',
        '/graph nodes',
        '/graph search',
        '/graph impact',
        '/kb list',
        '/kb search',
        '/kb ingest',
        '/sdd specs',
        '/sdd constitution',
        '/sdd sync',
        '/cron calendar',
        '/cron logs',
        '/resources list',
        '/resources spawn',
    ]
    if not query:
        return {'suggestions': commands_list}

    suggestions = [cmd for cmd in commands_list if cmd.startswith(query.lower())]
    return {'suggestions': suggestions}


# ---------------------------------------------------------------------------
# Visual Workflow Editor (D9)
#
# These endpoints back the node-based workflow editor in the web UI. They
# round-trip the canonical ``WorkflowSpec`` ({name, steps, orchestrates}) and
# persist the editor's exact canvas (nodes/edges/layout) so it can be restored
# verbatim on reload. Imports of the orchestration stack are lazy/guarded so
# this module still imports if orchestration is unavailable.
# ---------------------------------------------------------------------------


def _canvas_node_id(name: str) -> str:
    """Stable canvas-sidecar node id for a given workflow id/name."""
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return f'workflowcanvas:{slug}'


@router.get('/workflows')
async def list_workflows() -> list[dict[str, Any]]:
    """List saved workflows from the Knowledge Graph.

    Returns a list of ``{id, name, steps, orchestrates, canvas}`` dicts. The
    canvas (editor node/edge/layout JSON) is loaded from the sibling
    ``:WorkflowCanvas`` node when present so the editor round-trips exactly.
    A genuinely empty graph returns ``[]``; a backend failure (D-W5WR-4)
    raises ``HTTPException(503)`` instead of masquerading as ``[]``.
    """
    import json

    try:
        engine = await _get_engine_bounded()
        rows = await _invoke_governed_helper(
            engine.backend.execute,
            f'MATCH (w:Workflow) RETURN w LIMIT {_MAX_WORKFLOW_RECORDS}',
            deadline=15.0,
        )
        workflows: list[dict[str, Any]] = []
        for row in rows:
            wdata = row.get('w', {})
            if not isinstance(wdata, dict):
                continue
            wid = str(wdata.get('id') or f'workflow:{wdata.get("name", "")}')
            if len(wid.encode('utf-8')) > _MAX_WORKFLOW_ID_BYTES:
                continue
            name = wdata.get('name', '')
            steps_raw = wdata.get('steps', '')
            steps = (
                [s for s in steps_raw.split(',') if s]
                if isinstance(steps_raw, str)
                else list(steps_raw or [])
            )
            # Resolve orchestrates via ORCHESTRATES edges.
            orchestrates: list[str] = []
            try:
                erows = await _invoke_governed_helper(
                    engine.backend.execute,
                    'MATCH (w:Workflow)-[:ORCHESTRATES]->(t) '
                    'WHERE w.id = $workflow_id RETURN t '
                    f'LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}',
                    {'workflow_id': wid},
                    deadline=15.0,
                )
                for er in erows:
                    target = er.get('t', {})
                    if isinstance(target, dict) and target.get('id'):
                        orchestrates.append(target['id'])
            except HTTPException:
                raise
            except Exception as edge_err:  # noqa: BLE001
                _log_failure(
                    'resolve_workflow_orchestration', edge_err, level=logging.DEBUG
                )

            # Load persisted canvas sidecar if present.
            canvas: Any = None
            try:
                crows = await _invoke_governed_helper(
                    engine.backend.execute,
                    'MATCH (c:WorkflowCanvas) '
                    'WHERE c.workflow_id = $workflow_id RETURN c LIMIT 1',
                    {'workflow_id': wid},
                    deadline=15.0,
                )
                if crows:
                    cdata = crows[0].get('c', {})
                    raw = cdata.get('canvas') if isinstance(cdata, dict) else None
                    if raw and isinstance(raw, str):
                        if len(raw.encode('utf-8')) <= _MAX_EXTERNAL_RESULT_BYTES:
                            canvas = _bounded_external_value(json.loads(raw))
            except HTTPException:
                raise
            except Exception as canvas_err:  # noqa: BLE001
                _log_failure('load_workflow_canvas', canvas_err, level=logging.DEBUG)

            workflows.append(
                {
                    'id': wid,
                    'name': name,
                    'steps': steps,
                    'orchestrates': orchestrates,
                    'canvas': canvas,
                }
            )
        return workflows
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        # D-W5WR-4 / D-WD-7: this used to swallow ANY backend failure --
        # including the authorization rejection (`PlacementAuthorityError`)
        # confirmed live once D-WD-7 wired this route to the real engine --
        # into a bare `[]`, indistinguishable from a genuinely empty
        # Workflows list to both this route's caller and to
        # WorkflowEditorView.tsx (same class of bug D-W6-10 already fixed
        # for `/graph/nodes` and `/graph/relationships`). Raise instead, so
        # the frontend's `loadWorkflowList` can show a typed error instead of
        # silently rendering an empty canvas that looks identical to "no
        # workflows saved yet".
        _log_failure('list_workflows', e)
        raise HTTPException(
            status_code=503,
            detail='Knowledge Graph workflow query failed',
        ) from e


@router.get('/workflows/capabilities')
async def workflow_capabilities() -> dict[str, list[dict[str, Any]]]:
    """Return the palette catalog (agents/tools/skills) in a single call.

    Sources agents and tools/skills from the same queries used by ``/agents``
    and ``/tools`` so the editor palette stays consistent with the rest of the
    UI. Degrades gracefully (empty lists) on error.
    """
    agents: list[dict[str, Any]] = []
    tools: list[dict[str, Any]] = []
    skills: list[dict[str, Any]] = []

    # Agents from the KG.
    try:
        engine = await _get_engine_bounded()
        rows = await _invoke_governed_helper(
            engine.backend.execute,
            f'MATCH (a:Agent) RETURN a LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}',
            deadline=15.0,
        )
        for row in rows:
            a = row.get('a', {})
            if not isinstance(a, dict):
                continue
            agents.append(
                {
                    'id': a.get('id') or a.get('name', ''),
                    'name': a.get('name', a.get('id', '')),
                    'system_prompt': a.get('system_prompt'),
                    'tools': (
                        a.get('tools', '').split(',')
                        if isinstance(a.get('tools'), str) and a.get('tools')
                        else a.get('tools')
                    ),
                }
            )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
    # Tools + skills reuse the categorized /tools catalog.
    try:
        catalog = await list_all_tools()
        for t in catalog.get('mcp_tools', []) + catalog.get('builtin_tools', []):
            tools.append({'id': t.get('name', ''), 'name': t.get('name', '')})
        for s in catalog.get('skills', []) + catalog.get('skill_graphs', []):
            skills.append(
                {
                    'id': s.get('id', s.get('name', '')),
                    'name': s.get('name', ''),
                    'description': s.get('description', ''),
                }
            )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('workflow_capabilities', e)

    return {'agents': agents, 'tools': tools, 'skills': skills}


@router.post('/workflows')
async def save_workflow(request: Request) -> dict[str, Any]:
    """Persist a workflow as a canonical ``WorkflowSpec`` + canvas sidecar.

    Body: ``{name, steps:[str], orchestrates:[str], nodes?, edges?, layout?,
    canvas?}``. Builds a ``WorkflowSpec`` and persists it via the canonical
    ``workflow_to_batch`` path, then stores the editor's node/edge/layout JSON
    on a sibling ``:WorkflowCanvas`` node keyed by the workflow id so the
    canvas round-trips exactly. Returns ``{id, saved}``.
    """
    import json

    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail='Workflow body must be an object')
    name = body.get('name') or 'Untitled Workflow'
    steps = body.get('steps') or []
    orchestrates = body.get('orchestrates') or []
    canvas = body.get('canvas')
    if canvas is None and ('nodes' in body or 'edges' in body):
        canvas = {
            'nodes': body.get('nodes', []),
            'edges': body.get('edges', []),
            'layout': body.get('layout'),
        }
    if not isinstance(name, str) or not name.strip() or len(name.encode('utf-8')) > 512:
        raise HTTPException(status_code=400, detail='Invalid workflow name')
    if (
        not isinstance(steps, list)
        or not isinstance(orchestrates, list)
        or len(steps) > _MAX_EXTERNAL_COLLECTION_ITEMS
        or len(orchestrates) > _MAX_EXTERNAL_COLLECTION_ITEMS
        or not all(
            isinstance(item, str) and len(item.encode('utf-8')) <= 2048
            for item in steps
        )
        or not all(
            isinstance(item, str)
            and len(item.encode('utf-8')) <= _MAX_WORKFLOW_ID_BYTES
            for item in orchestrates
        )
    ):
        raise HTTPException(status_code=400, detail='Invalid workflow steps')
    if canvas is not None:
        try:
            canvas = _bounded_external_value(canvas)
            canvas_payload = json.dumps(
                canvas,
                separators=(',', ':'),
                ensure_ascii=False,
                allow_nan=False,
            )
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=400, detail='Invalid workflow canvas'
            ) from exc
        if len(canvas_payload.encode('utf-8')) > _MAX_EXTERNAL_RESULT_BYTES:
            raise HTTPException(status_code=400, detail='Workflow canvas is too large')

    try:
        from agent_utilities.knowledge_graph.enrichment.orchestration import (
            WorkflowSpec,
            workflow_to_batch,
        )
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        raise HTTPException(
            status_code=503,
            detail=f'Workflow orchestration unavailable: {type(e).__name__}',
        ) from e

    spec = WorkflowSpec(name=name, steps=steps, orchestrates=orchestrates)

    try:
        engine = await _get_engine_bounded()

        # Build the canonical batch, then persist via the engine's node/edge API
        # (the engine exposes add_node/link_nodes rather than a raw write_batch).
        def persist_workflow() -> None:
            batch = workflow_to_batch(spec)
            for node in batch.nodes:
                engine.add_node(node.id, node.type, dict(node.props or {}))
            for edge in batch.edges:
                engine.link_nodes(edge.source, edge.target, edge.rel_type)

        await _invoke_governed_helper(persist_workflow, deadline=30.0)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('save_workflow', e)
        raise HTTPException(
            status_code=500, detail=f'Failed to persist workflow: {type(e).__name__}'
        ) from e

    # Persist the canvas sidecar so the editor restores exactly on reload.
    if canvas is not None:
        try:
            canvas_id = _canvas_node_id(spec.id)
            await _invoke_governed_helper(
                engine.add_node,
                canvas_id,
                'WorkflowCanvas',
                {
                    'workflow_id': spec.id,
                    'name': name,
                    'canvas': canvas_payload,
                    'updated_at': datetime.now(timezone.utc).isoformat(),
                },
                deadline=15.0,
            )
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            # Non-fatal: the spec is saved even if the canvas sidecar fails.
            _log_failure('api_extension', e, level=logging.WARNING)
    return {'id': spec.id, 'saved': True}


@router.post('/workflows/{wid:path}/run')
async def run_workflow(wid: str, request: Request) -> dict[str, Any]:
    """Run a saved workflow by dispatching it through the orchestration engine.

    Loads the workflow, builds a ``WorkflowSpec`` and dispatches it via
    ``AgentOrchestrationEngine(...).dispatch(task=spec, mode="workflow")``.
    Wraps failures so an error returns ``{status: "error", error}`` instead of
    a 500. Returns ``{run_id, status, result/summary}``.
    """
    import uuid

    if not wid or '\x00' in wid or len(wid.encode('utf-8')) > _MAX_WORKFLOW_ID_BYTES:
        raise HTTPException(status_code=400, detail='Invalid workflow identifier')
    run_id = uuid.uuid4().hex[:12]

    # Resolve the spec — prefer the live KG record, fall back to request body.
    name = wid
    steps: list[str] = []
    orchestrates: list[str] = []
    try:
        engine = await _get_engine_bounded()
        rows = await _invoke_governed_helper(
            engine.backend.execute,
            'MATCH (w:Workflow) WHERE w.id = $workflow_id RETURN w LIMIT 1',
            {'workflow_id': wid},
            deadline=15.0,
        )
        if rows:
            wdata = rows[0].get('w', {})
            if isinstance(wdata, dict):
                name = wdata.get('name', wid)
                steps_raw = wdata.get('steps', '')
                steps = (
                    [s for s in steps_raw.split(',') if s]
                    if isinstance(steps_raw, str)
                    else list(steps_raw or [])
                )
        erows = await _invoke_governed_helper(
            engine.backend.execute,
            'MATCH (w:Workflow)-[:ORCHESTRATES]->(t) '
            'WHERE w.id = $workflow_id RETURN t '
            f'LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}',
            {'workflow_id': wid},
            deadline=15.0,
        )
        for er in erows:
            target = er.get('t', {})
            if isinstance(target, dict) and target.get('id'):
                orchestrates.append(target['id'])
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e, level=logging.WARNING)
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    if not steps:
        steps = body.get('steps', [])
    if not orchestrates:
        orchestrates = body.get('orchestrates', [])

    try:
        from agent_utilities.knowledge_graph.enrichment.orchestration import (
            WorkflowSpec,
        )
        from agent_utilities.orchestration.engine import AgentOrchestrationEngine
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        return {
            'run_id': run_id,
            'status': 'error',
            'error': f'Workflow orchestration unavailable: {type(e).__name__}',
        }

    spec = WorkflowSpec(name=name, steps=steps, orchestrates=orchestrates)

    try:
        orch = await _invoke_governed_helper(
            AgentOrchestrationEngine,
            engine=await _get_engine_bounded(),
            deadline=10.0,
        )
        result = await _invoke_governed_helper(
            orch.dispatch,
            task=spec,
            mode='workflow',
            deadline=120.0,
        )
        if isinstance(result, dict):
            status = result.get('status', 'completed')
            return {
                'run_id': run_id,
                'status': status,
                'result': result,
                'summary': result.get('summary'),
            }
        return {'run_id': run_id, 'status': 'completed', 'result': result}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        return {'run_id': run_id, 'status': 'error', 'error': type(e).__name__}


# ---------------------------------------------------------------------------
# Ontology Endpoints (Palantir-Foundry-parity ontology system)
#
# Surfaces the agent_utilities OntologySystem (kg.ontology) to the web UI:
# object/property/interface types, ObjectSet search/search-around/pivot/
# aggregate, per-object view (props + links + derived + markings + edit
# history), durable edits + revert, typed function invocation, derived-
# property compute, document processing, and stored/standard object views.
#
# Relationship to the canonical gateway routes (drift policy):
#
# * The canonical KG REST surface (/api/graph/*, /api/ontology/*, /api/object/*
#   — agent_utilities.mcp.kg_server._mount_rest_routes) is mounted VERBATIM on
#   this app by server.py via gateway.graph_api.register_graph_routes, so
#   anything the gateway serves, this backend serves from the same code.
# * Routes here that have a 1:1 canonical tool twin dispatch through
#   kg_server's REGISTERED_TOOLS (see _canonical_kg_tool) instead of
#   reimplementing the logic — /ontology/function/invoke and /ontology/derive.
# * The remaining routes are UI compositions the canonical action-routed
#   surface cannot express: permission-enforced row materialization for
#   object-set search/search-around, id-scoped pivot/aggregate, saved/shared
#   object sets, the ActionRegistry listing + governed bulk action with HITL
#   approval, the full per-object view (props+links+derived+markings+history),
#   edit/revert with durable-ledger rehydration, document processing that
#   returns the materialized nodes, and ObjectView layout persistence. They
#   stay here, but compose the same kg.ontology library the canonical tools
#   call, so the underlying semantics are shared.
#
# All routes bind a real KnowledgeGraph facade to the SAME live store/compute
# the IntelligenceGraphEngine uses, so they drive the real ontology end to end
# (no stubs). Read routes pass results through the fine-grained permissioning
# gate (kg.ontology.permissioning.enforce).
# ---------------------------------------------------------------------------


async def _canonical_kg_tool(tool_name: str, **kwargs: Any) -> Any:
    """Dispatch a call through the canonical KG tool surface.

    ``agent_utilities.mcp.kg_server.REGISTERED_TOOLS`` holds the single
    canonical implementation behind both the graph-os MCP tools and the API
    gateway's action-routed REST twins. Routes here that mirror one of those
    tools 1:1 must dispatch through it — never reimplement the body — so the
    webui surface cannot drift from what gateway/MCP clients observe.

    Returns the tool's decoded JSON payload (tools return JSON strings).
    """
    import json

    from agent_utilities.mcp import kg_server

    kg_server.ensure_tools_registered()
    raw = await kg_server._execute_tool(tool_name, **kwargs)
    return json.loads(raw) if isinstance(raw, str) else raw


def _raise_canonical_error(result: Any, status_code: int = 500) -> None:
    """Surface a canonical tool's ``{'error': ...}`` envelope as an HTTP error."""
    if isinstance(result, dict) and set(result.keys()) == {'error'}:
        raise HTTPException(status_code=status_code, detail=str(result['error']))


# Process-level cache of the KnowledgeGraph facade keyed by the live engine's
# backend object. The facade (and the OntologySystem + EditLedger it composes)
# is stateful — the durable edit ledger keeps an in-process mirror that backs
# history/revert/as_of — so it must be a singleton bound to the singleton engine
# rather than rebuilt per request, otherwise edit history would not survive
# across stateless HTTP calls. A WeakKeyDictionary auto-evicts the entry when
# the backend is replaced/garbage-collected (avoiding id() reuse hazards).
import weakref as _weakref

_ontology_kg_cache: '_weakref.WeakKeyDictionary[Any, Any]' = (
    _weakref.WeakKeyDictionary()
)
_ontology_kg_cache_lock = threading.Lock()


def get_ontology_kg() -> Any:
    """Return the process-singleton KnowledgeGraph facade bound to the live engine.

    Reuses :func:`get_engine` (the same helper the ``/graph/*`` routes use) so
    the ontology layer resolves against the exact same backend the rest of the
    UI reads/writes — never a second, divergent graph. The facade is cached per
    engine backend so the composed :class:`OntologySystem` (and its durable edit
    ledger) is stateful across requests, matching the singleton engine.

    Raises:
        HTTPException: 501 when the engine cannot be initialized, or when the
            ontology layer is unavailable in this environment.
    """
    from agent_utilities.knowledge_graph.facade import KnowledgeGraph

    engine = get_engine()
    backend = engine.backend
    with _ontology_kg_cache_lock:
        try:
            cached = _ontology_kg_cache.get(backend)
        except TypeError:
            # Backend not weak-referenceable — fall back to a fresh facade.
            cached = None
        if cached is not None:
            kg = cached
        else:
            kg = KnowledgeGraph()
            # Bind to the live store; the facade derives compute from the store graph.
            kg._store = backend
            try:
                _ontology_kg_cache[backend] = kg
            except TypeError:
                pass
        ontology = kg.ontology
    if ontology is None:
        raise HTTPException(status_code=501, detail='Ontology layer unavailable')
    return kg, ontology


async def _get_ontology_kg_bounded() -> Any:
    """Resolve the live ontology without blocking the event loop unboundedly."""

    return await _invoke_governed_helper(get_ontology_kg, deadline=10.0)


def _ontology_facade_for(engine: Any, scoped_engine: Any) -> tuple[Any, Any] | None:
    """Resolve the `(kg, ontology)` facade pair for one `_rows_per_accessible_graph`
    call-site: the tenant-pinned singleton (`get_ontology_kg()`) when
    `scoped_engine` is the ambient (unscoped) `engine` itself, else a
    throwaway facade over `scoped_engine.backend` (a graph-scoped view
    `_rows_per_accessible_graph` already retargeted the ambient session onto
    -- see `_graph_union_executor`'s docstring for why both moves are
    required together). Returns `None` when the ontology layer is
    unavailable for that graph, so callers can degrade a single graph rather
    than raise.
    """
    if scoped_engine is engine:
        return get_ontology_kg()
    from agent_utilities.knowledge_graph.facade import KnowledgeGraph

    kg = KnowledgeGraph()
    kg._store = scoped_engine.backend
    ontology = kg.ontology
    if ontology is None:
        return None
    return kg, ontology


def _actor_id_from_request(request: Request | None) -> str:
    """Return only the server-minted ambient actor, never caller headers/body."""

    del request
    from agent_utilities.security.brain_context import current_actor

    return _durable_actor_reference(current_actor().actor_id)


def _durable_actor_reference(value: Any) -> str:
    """Normalize durable principal identities to stable opaque references."""

    text = str(value or '').strip()
    if not text or text in {'system', 'admin'}:
        return text or 'system'
    return persistence_reference('principal', text, namespace='webui')


def _current_webui_is_admin() -> bool:
    """True when the ambient caller holds the WebUI `admin` role (R9 ladder).

    Reuses the SAME `rbac.resolve_webui_role`/`role_at_least` ladder
    `WebUIAuthorizationMiddleware` already enforces at the route level
    (`server.py`'s `_role_requirement`) — this is a second, additive READ of
    that one ladder for row-level data scoping (which sessions a caller may
    see), not a parallel authorization mechanism. Fails closed: any error
    resolving the ambient actor is treated as non-admin.
    """

    try:
        from agent_utilities.security.brain_context import current_actor

        from .rbac import resolve_webui_role, role_at_least

        actor = current_actor()
        webui_role = resolve_webui_role(
            tuple(getattr(actor, 'roles', ()) or ()),
            authenticated=bool(getattr(actor, 'authenticated', False)),
        )
        return role_at_least(webui_role, 'admin')
    except Exception:  # noqa: BLE001 - fail closed: unresolved role is never admin
        return False


def _actor_context(request: Request | None) -> Any:
    """Return the server-minted actor with trusted KG capability aliases."""

    del request
    from agent_utilities.security.brain_context import current_actor

    actor = current_actor()
    roles = set(actor.roles)
    if 'kg:admin' in roles:
        roles.update({'admin', 'kg_admin', 'kg_write', 'kg_read'})
    elif 'kg:write' in roles:
        roles.update({'kg_write', 'kg_read'})
    elif 'kg:read' in roles:
        roles.add('kg_read')
    if roles == set(actor.roles):
        return actor
    return replace(actor, roles=tuple(sorted(roles)))


def _serialize_property_type(name: str, pt: Any) -> dict[str, Any]:
    """Serialize a PropertyType to JSON-safe dict (its ``type`` fields are unsafe).

    ``python_type``/``element_type`` hold Python ``type`` objects which are not
    JSON serializable, so they are rendered as their type names.
    """
    from agent_utilities.knowledge_graph.ontology import column_type_for

    py = getattr(pt, 'python_type', None)
    elem = getattr(pt, 'element_type', None)
    try:
        column_type = column_type_for(name)
    except Exception:  # noqa: BLE001
        column_type = ''
    return {
        'name': getattr(pt, 'name', name),
        'description': getattr(pt, 'description', ''),
        'xsd_iri': getattr(pt, 'xsd_iri', ''),
        'python_type': getattr(py, '__name__', None) if py is not None else None,
        'storage_hint': getattr(pt, 'storage_hint', ''),
        'is_complex': bool(getattr(pt, 'is_complex', False)),
        'element_type': (
            getattr(elem, 'name', getattr(elem, '__name__', str(elem)))
            if elem is not None
            else None
        ),
        'dimension': getattr(pt, 'dimension', None),
        'column_type': column_type,
    }


def _node_properties(backend: Any, object_id: str) -> dict[str, Any]:
    """Read a node's full property map from the live store via Cypher."""
    try:
        rows = backend.execute(
            'MATCH (n {id: $id}) RETURN n LIMIT 1', {'id': object_id}
        )
    except Exception:  # noqa: BLE001
        rows = []
    if not rows:
        return {}
    node = rows[0].get('n', {})
    return dict(node) if isinstance(node, dict) else {}


def _node_links(backend: Any, object_id: str) -> dict[str, list[dict[str, Any]]]:
    """Read in/out typed links for a node from the live store."""
    out_links: list[dict[str, Any]] = []
    in_links: list[dict[str, Any]] = []
    try:
        out_rows = backend.execute(
            'MATCH (n {id: $id})-[r]->(m) '
            f'RETURN type(r) as type, m.id as target '
            f'LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}',
            {'id': object_id},
        )
        for row in out_rows or []:
            out_links.append(
                {'type': row.get('type', ''), 'target': row.get('target', '')}
            )
    except Exception:  # noqa: BLE001
        out_links = []
    try:
        in_rows = backend.execute(
            'MATCH (m)-[r]->(n {id: $id}) '
            f'RETURN type(r) as type, m.id as source '
            f'LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}',
            {'id': object_id},
        )
        for row in in_rows or []:
            in_links.append(
                {'type': row.get('type', ''), 'source': row.get('source', '')}
            )
    except Exception:  # noqa: BLE001
        in_links = []
    return {'out': out_links, 'in': in_links}


def _session_scoped_to(session: Any, graph_name: str | None) -> Any:
    """Context manager retargeting the ambient session onto ``graph_name``.

    A no-op (`contextlib.nullcontext`) when there is no ambient session or
    ``graph_name`` already matches it -- otherwise `use_session` +
    `session.with_graph` (the same dual-retarget `_rows_per_accessible_graph`
    /`_graph_union_executor` already use). Needed by `get_ontology_object`/
    `derive_ontology_property`, which locate an object's home graph ONCE
    (`_locate_object_graph`) and then must run every remaining store/ontology
    read in that same scope -- see `_graph_union_executor`'s docstring for why
    a scoped backend view and a retargeted session are required TOGETHER.
    """
    if session is None or graph_name is None or graph_name == session.graph:
        return contextlib.nullcontext()
    from agent_utilities.knowledge_graph.core.session import use_session

    return use_session(session.with_graph(graph_name))


def _locate_object_graph(
    engine: Any, object_id: str
) -> tuple[str | None, Any, dict[str, Any]] | None:
    """Resolve which accessible graph holds ``object_id``.

    An object's edges never cross a GOC-61 graph boundary, so at most one
    accessible graph legitimately holds a given id. Fans `_node_properties`
    out across every graph this actor may read via
    `_rows_per_accessible_graph` and returns the first non-empty match in
    `_accessible_graphs` order (tenant graph first) -- on the impossible case
    of more than one graph matching, tenant wins, the same semantic
    `read_union`'s own de-dup already applies on a duplicate id. Returns
    ``(graph_name, scoped_engine, props)``, or ``None`` when no accessible
    graph holds the object. Falls back to the plain `session.graph`-only
    lookup when there is no verified ambient session, matching every other
    union helper in this file.
    """
    from agent_utilities.knowledge_graph.core.session import current_session

    def _call(scoped_engine: Any) -> dict[str, Any]:
        return _node_properties(scoped_engine.backend, object_id)

    session = current_session()
    result = _rows_per_accessible_graph(engine, _call)
    if result is None:
        props = _call(engine)
        if not props:
            return None
        return (session.graph if session is not None else None), engine, props
    per_graph, _degraded = result
    for graph_name, props in per_graph:
        if props:
            scoped_engine = (
                engine
                if session is not None and graph_name == session.graph
                else engine.for_graph(graph_name)
            )
            return graph_name, scoped_engine, props
    return None


@router.get('/ontology/object-types')
async def list_object_types() -> list[dict[str, Any]]:
    """List ontology object/node types (registry types + interface implementers).

    Returns the distinct object-type values known to the ontology: every concrete
    type that implements a registered interface, unioned with the live node
    labels present in the store. Each entry carries the interfaces it implements.
    """
    try:
        _kg, ontology = await _get_ontology_kg_bounded()

        # Concrete types declared as interface implementers (programmatic targets).
        implementers_by_type: dict[str, list[str]] = {}
        for iface in ontology.interfaces.list_interfaces():
            try:
                for t in ontology.interfaces.find_implementers(iface.name):
                    implementers_by_type.setdefault(t, []).append(iface.name)
            except Exception:  # noqa: BLE001
                continue

        # Live node labels present in the store. FIX LANE Priority 1: unioned
        # across every graph this actor may read (`_read_union_cypher`), not
        # `backend.execute`/`kg.store` alone -- otherwise the commons-only
        # catalog types (`Tool`, `Skill`, ...) never appear in the Object
        # Explorer's type list at all. The commons READ catalog restriction is
        # pushed into the query text automatically by `_graph_union_executor`
        # (see its docstring) so a foreign tenant's count here is already
        # scoped to `COMMONS_SHAREABLE_NODE_TYPES`.
        live_types: dict[str, int] = {}
        try:
            engine = await _get_engine_bounded()
            rows, _source_graphs = await _read_union_cypher(
                engine,
                'MATCH (n) RETURN labels(n) as labels, count(n) as count',
                None,
                deadline=15.0,
            )
            for row in rows or []:
                labels = row.get('labels') or []
                if isinstance(labels, str):
                    labels = [labels]
                for label in labels:
                    if label and not str(label).startswith('_'):
                        live_types[label] = live_types.get(label, 0) + int(
                            row.get('count', 0) or 0
                        )
        except Exception:  # noqa: BLE001
            live_types = {}

        names = set(implementers_by_type) | set(live_types)
        return [
            {
                'name': name,
                'implements': sorted(implementers_by_type.get(name, [])),
                'count': int(live_types.get(name, 0)),
            }
            for name in sorted(names)[:_MAX_EXTERNAL_COLLECTION_ITEMS]
        ]
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('list_object_types', e)
        return []


@router.get('/ontology/property-types')
async def list_ontology_property_types() -> list[dict[str, Any]]:
    """Return the ontology property-type registry (KG-2.47)."""
    try:
        _kg, ontology = await _get_ontology_kg_bounded()
        return [
            _serialize_property_type(name, pt)
            for name, pt in sorted(ontology.property_types.items())
        ][:_MAX_EXTERNAL_COLLECTION_ITEMS]
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('list_property_types', e)
        return []


@router.get('/ontology/interfaces')
async def list_ontology_interfaces() -> list[dict[str, Any]]:
    """List ontology interfaces with their implementers (KG-2.38)."""
    try:
        _kg, ontology = await _get_ontology_kg_bounded()
        out: list[dict[str, Any]] = []
        for iface in ontology.interfaces.list_interfaces()[
            :_MAX_EXTERNAL_COLLECTION_ITEMS
        ]:
            data = iface.model_dump(mode='json')
            try:
                data['implementers'] = ontology.interfaces.find_implementers(
                    iface.name
                )[:_MAX_EXTERNAL_COLLECTION_ITEMS]
            except Exception:  # noqa: BLE001
                data['implementers'] = []
            out.append(data)
        return out
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        return []


@router.get('/ontology/interfaces/{name}/implementers')
async def get_interface_implementers(name: str) -> dict[str, Any]:
    """Resolve the concrete object types that implement interface ``name``."""
    if not _SAFE_DELEGATION_TOKEN.fullmatch(name):
        raise HTTPException(status_code=400, detail='Invalid interface name')
    try:
        _kg, ontology = await _get_ontology_kg_bounded()
        implementers = ontology.interfaces.find_implementers(name)[
            :_MAX_EXTERNAL_COLLECTION_ITEMS
        ]
        return {'interface': name, 'implementers': implementers}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=type(e).__name__) from e
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


def _object_set_rows(
    ontology: Any, object_set: Any, actor: Any, *, limit: int = 200
) -> list[dict[str, Any]]:
    """Materialize an ObjectSet to permission-enforced summary rows."""
    from agent_utilities.knowledge_graph.ontology.permissioning import enforce

    ids = object_set.ids()[:limit]
    rows: list[dict[str, Any]] = []
    for nid in ids:
        try:
            props = object_set._view.props(nid)
        except Exception:  # noqa: BLE001
            props = {'id': nid}
        props.setdefault('id', nid)
        rows.append(dict(props))
    return enforce(rows, actor)


@router.post('/ontology/object-set/search')
async def ontology_object_set_search(
    data: dict[str, Any], request: Request
) -> dict[str, Any]:
    """Search an object set and return permission-enforced summary rows.

    Body: ``{query, filters, kind}`` — ``kind`` is an object type / interface to
    scope to (omit for a graph-wide search); ``filters`` is an optional list of
    ``{property, op, value}`` typed predicates; ``query`` is the search string.
    """
    try:
        _kg, ontology = await _get_ontology_kg_bounded()
        actor = _actor_context(request)
        query = str(data.get('query', '') or '')
        kind = data.get('kind')
        limit = int(data.get('limit', 50) or 50)
        raw_filters = data.get('filters') or []
        if (
            len(query.encode('utf-8')) > 8192
            or not 1 <= limit <= _MAX_EXTERNAL_COLLECTION_ITEMS
        ):
            raise HTTPException(status_code=400, detail='Invalid object search bounds')
        if kind is not None and (
            not isinstance(kind, str) or len(kind.encode('utf-8')) > 128
        ):
            raise HTTPException(status_code=400, detail='Invalid object kind')
        if not isinstance(raw_filters, list) or len(raw_filters) > 64:
            raise HTTPException(status_code=400, detail='Invalid object filters')
        try:
            _bounded_external_value(raw_filters)
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail='Invalid object filters'
            ) from exc

        from agent_utilities.knowledge_graph.ontology.object_set import PropertyFilter

        filters = []
        for f in raw_filters:
            if isinstance(f, dict) and (f.get('property') or f.get('field')):
                filters.append(
                    PropertyFilter(
                        field=str(f.get('property') or f.get('field')),
                        op=str(f.get('op', 'eq')),
                        value=f.get('value'),
                    )
                )

        # FIX LANE Priority 1: fanned out across every graph this actor may
        # read (`_union_engine_call` -- `_rows_per_accessible_graph` under a
        # per-graph `(kg, ontology)` facade, `_ontology_facade_for`) and
        # merged by object id -- the ontology layer has no Cypher seam
        # (`_read_union_cypher` does not apply), so this is the "call the
        # engine once per accessible graph and merge" case. `limit` is pushed
        # down to EACH graph's `.search(...)` call (not fetched unbounded then
        # sliced); the merge is re-trimmed to `limit` below since the union of
        # two `limit`-bounded per-graph results can exceed it.
        engine = await _get_engine_bounded()

        def execute_search(scoped_engine: Any) -> list[dict[str, Any]]:
            facade = _ontology_facade_for(engine, scoped_engine)
            if facade is None:
                return []
            _scoped_kg, scoped_ontology = facade
            remaining_filters = filters
            if kind:
                base = scoped_ontology.object_set_of_type(str(kind))
            elif filters:
                base = scoped_ontology.dynamic_object_set(filters=filters)
                remaining_filters = []  # already applied to the base set
            else:
                # Graph-wide: a dynamic set over a permissive predicate.
                base = scoped_ontology.dynamic_object_set(lambda props: True)
            result = base.search(
                query,
                filters=remaining_filters or None,
                limit=limit,
            )
            return _object_set_rows(scoped_ontology, result, actor, limit=limit)

        rows, _source_graphs, _degraded = await _invoke_governed_helper(
            _union_engine_call, engine, actor, execute_search, deadline=30.0
        )
        rows = rows[:limit]
        return _public_external_result(
            {
                'ids': [r.get('id') for r in rows],
                'rows': rows,
                'count': len(rows),
            }
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/ontology/object-set/search-around')
async def ontology_object_set_search_around(
    data: dict[str, Any], request: Request
) -> dict[str, Any]:
    """Traverse a typed link from a seed id set to the related object set.

    Body: ``{ids, link_type, hops, cap, direction}``.
    """
    try:
        actor = _actor_context(request)
        ids = _bounded_identifier_list(data.get('ids'), required=True)
        link_type = data.get('link_type')
        hops = int(data.get('hops', 1) or 1)
        cap = int(
            data.get('cap', _MAX_EXTERNAL_COLLECTION_ITEMS)
            or _MAX_EXTERNAL_COLLECTION_ITEMS
        )
        direction = str(data.get('direction', 'out') or 'out')
        if not 1 <= hops <= 10 or not 1 <= cap <= _MAX_EXTERNAL_COLLECTION_ITEMS:
            raise HTTPException(status_code=400, detail='Invalid traversal bounds')
        if direction not in {'in', 'out', 'both'}:
            raise HTTPException(status_code=400, detail='Invalid traversal direction')
        if link_type is not None and (
            not isinstance(link_type, str) or len(link_type.encode('utf-8')) > 128
        ):
            raise HTTPException(status_code=400, detail='Invalid link type')

        # FIX LANE Priority 1: fanned out per accessible graph and merged by
        # object id, same reasoning as `ontology_object_set_search` above. A
        # seed id only resolves related objects in the ONE graph it (and its
        # links) physically live in (GOC-61: edges never cross a graph
        # boundary) -- the other graph(s) cheaply return `[]` for a seed id
        # they don't hold, not an error.
        engine = await _get_engine_bounded()

        def execute_search_around(scoped_engine: Any) -> list[dict[str, Any]]:
            facade = _ontology_facade_for(engine, scoped_engine)
            if facade is None:
                return []
            _scoped_kg, scoped_ontology = facade
            base = scoped_ontology.object_set(ids)
            related = base.search_around(
                link_type,
                hops=hops,
                direction=direction,
                cap=cap,
            )
            return _object_set_rows(scoped_ontology, related, actor, limit=cap)

        rows, _source_graphs, _degraded = await _invoke_governed_helper(
            _union_engine_call, engine, actor, execute_search_around, deadline=30.0
        )
        rows = rows[:cap]
        return _public_external_result(
            {
                'ids': [r.get('id') for r in rows],
                'rows': rows,
                'count': len(rows),
            }
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


def _ids_present_in_graph(backend: Any, ids: list[str]) -> set[str]:
    """Return the subset of ``ids`` that exist as nodes in ``backend``'s graph.

    A single batched existence check. A STATIC :class:`ObjectSet`'s
    ``ids()``/``objects()`` returns every id verbatim regardless of
    existence -- a nonexistent id still yields a ``{"id": nid}`` stub -- so
    fanning `/ontology/object-set/aggregate` out per accessible graph with
    the SAME full ``ids`` list unfiltered would double/triple-count any id
    that only lives in ONE of those graphs (each graph's run would count
    every id, present or not). Narrowing to the ids each graph actually
    holds first avoids that.
    """
    if not ids:
        return set()
    try:
        rows = backend.execute(
            'MATCH (n) WHERE n.id IN $ids RETURN n.id AS id', {'ids': ids}
        )
    except Exception:  # noqa: BLE001
        return set()
    present: set[str] = set()
    for row in rows or []:
        node_id = row.get('id') if isinstance(row, dict) else None
        if isinstance(node_id, str):
            present.add(node_id)
    return present


@router.post('/ontology/object-set/pivot')
async def ontology_object_set_pivot(data: dict[str, Any]) -> dict[str, Any]:
    """Pivot an object set across a link type, grouping the linked set.

    Body: ``{ids, link_type, group_by, direction}``.

    FIX LANE Priority 1: fanned out per accessible graph (same seed-id
    reasoning as `/ontology/object-set/search-around` -- a seed id only
    resolves linked objects in the ONE graph it and its links physically
    live in, GOC-61, so a graph that doesn't hold a given seed id cheaply
    contributes an empty pivot rather than an error) and the group buckets
    merged by group value, deduped by linked-object id (tenant wins on a
    duplicate id, matching every other union merge in this file).
    """
    try:
        _kg, _ontology = await _get_ontology_kg_bounded()
        ids = _bounded_identifier_list(data.get('ids'))
        link_type = data.get('link_type')
        group_by = str(data.get('group_by', '') or '')
        direction = str(data.get('direction', 'out') or 'out')
        if not group_by or len(group_by.encode('utf-8')) > 128:
            raise HTTPException(status_code=422, detail='group_by is required')
        if direction not in {'in', 'out', 'both'}:
            raise HTTPException(status_code=400, detail='Invalid pivot direction')
        if link_type is not None and (
            not isinstance(link_type, str) or len(link_type.encode('utf-8')) > 128
        ):
            raise HTTPException(status_code=400, detail='Invalid link type')

        engine = await _get_engine_bounded()

        def execute_pivot(scoped_engine: Any) -> Any:
            facade = _ontology_facade_for(engine, scoped_engine)
            if facade is None:
                return None
            _scoped_kg, scoped_ontology = facade
            return scoped_ontology.object_set(ids).pivot(
                link_type,
                group_by,
                direction=direction,
            )

        def _run() -> list[tuple[str | None, Any]]:
            result = _rows_per_accessible_graph(engine, execute_pivot)
            if result is None:
                return [(None, execute_pivot(engine))]
            per_graph, _degraded = result
            return [(graph_name, value) for graph_name, value in per_graph]

        per_graph = await _invoke_governed_helper(_run, deadline=30.0)

        resolved_link_type = link_type or '*'
        merged_groups: dict[Any, list[str]] = {}
        seen: set[str] = set()
        for _graph_name, pivot in per_graph:
            if pivot is None:
                continue
            resolved_link_type = pivot.link_type
            for key, member_ids in pivot.groups.items():
                bucket = merged_groups.setdefault(key, [])
                for member_id in member_ids:
                    if member_id in seen:
                        continue
                    seen.add(member_id)
                    bucket.append(member_id)

        return _public_external_result(
            {
                'link_type': resolved_link_type,
                'group_by': group_by,
                'groups': {str(k): v for k, v in merged_groups.items()},
            }
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/ontology/object-set/aggregate')
async def ontology_object_set_aggregate(data: dict[str, Any]) -> dict[str, Any]:
    """Aggregate an object set (count/sum/avg/min/max), optionally grouped.

    Body: ``{ids, group_by, metric, field}``.

    FIX LANE Priority 1: an id in ``ids`` lives in at most one accessible
    graph (GOC-61 -- edges never cross a graph boundary), so this fans the
    aggregate out per accessible graph (`_rows_per_accessible_graph`, via a
    per-graph ``(kg, ontology)`` facade, `_ontology_facade_for`) over ONLY
    the ids that graph actually holds (`_ids_present_in_graph` -- a STATIC
    ObjectSet's ``.aggregate()`` counts every id verbatim whether it exists
    in that graph or not, so an unfiltered full-``ids`` fan-out would
    double-count), then merges the per-graph ``AggregationResult``s:

    * ``count``/``sum`` -- SUM the per-graph group values; independent
      partitions of the same set sum correctly by definition.
    * ``min``/``max`` -- merge directly (min-of-mins / max-of-maxes); these
      ARE reconstructable from independent partitions, unlike avg, so
      scoping them to only the tenant graph (as a prior pass here did)
      was over-cautious.
    * ``avg`` -- requested as its ``sum``+``count`` components per graph and
      divided AFTER merging, because ``AggregationResult`` exposes only the
      final per-group value, not the underlying sum/count a correct avg
      merge needs (a plain average-of-averages would be wrong whenever the
      per-graph group sizes differ).
    """
    try:
        _kg, _ontology = await _get_ontology_kg_bounded()
        ids = _bounded_identifier_list(data.get('ids'))
        metric = str(data.get('metric', 'count') or 'count')
        group_by = data.get('group_by')
        field = data.get('field')
        if metric not in {'count', 'sum', 'avg', 'min', 'max'}:
            raise HTTPException(
                status_code=422, detail=f'unsupported metric {metric!r}'
            )
        if metric != 'count' and not field:
            raise HTTPException(
                status_code=422, detail=f'metric {metric!r} requires a numeric field'
            )

        engine = await _get_engine_bounded()
        # avg needs its components (sum + count), not the final per-group
        # average, to merge correctly across graphs.
        component_metrics = ('sum', 'count') if metric == 'avg' else (metric,)

        def execute_aggregate(scoped_engine: Any) -> Any:
            facade = _ontology_facade_for(engine, scoped_engine)
            if facade is None:
                return None
            _scoped_kg, scoped_ontology = facade
            present = _ids_present_in_graph(scoped_engine.backend, ids)
            if not present:
                return None
            scoped_ids = [i for i in ids if i in present]
            object_set = scoped_ontology.object_set(scoped_ids)
            return {
                m: object_set.aggregate(m, field=field, group_by=group_by)
                for m in component_metrics
            }

        def _run() -> list[tuple[str | None, Any]]:
            result = _rows_per_accessible_graph(engine, execute_aggregate)
            if result is None:
                return [(None, execute_aggregate(engine))]
            per_graph, _degraded = result
            return [(graph_name, value) for graph_name, value in per_graph]

        per_graph = await _invoke_governed_helper(_run, deadline=30.0)

        total_objects = 0
        groups: dict[Any, float] = {}
        sums: dict[Any, float] = {}
        counts: dict[Any, float] = {}
        for _graph_name, agg_map in per_graph:
            if not agg_map:
                continue
            if metric == 'avg':
                sum_res = agg_map['sum']
                count_res = agg_map['count']
                total_objects += sum_res.total_objects
                for k, v in sum_res.groups.items():
                    sums[k] = sums.get(k, 0.0) + v
                for k, v in count_res.groups.items():
                    counts[k] = counts.get(k, 0.0) + v
            else:
                agg = agg_map[metric]
                total_objects += agg.total_objects
                for k, v in agg.groups.items():
                    if metric in ('count', 'sum'):
                        groups[k] = groups.get(k, 0.0) + v
                    elif metric == 'min':
                        groups[k] = v if k not in groups else min(groups[k], v)
                    elif metric == 'max':
                        groups[k] = v if k not in groups else max(groups[k], v)

        if metric == 'avg':
            for k, s in sums.items():
                c = counts.get(k, 0.0)
                if c:
                    groups[k] = s / c

        value = None if group_by is not None else groups.get(None)
        return _public_external_result(
            {
                'metric': metric,
                'field': field,
                'group_by': group_by,
                'groups': {str(k): v for k, v in groups.items()},
                'value': value,
                'total_objects': total_objects,
            }
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=type(e).__name__) from e
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


def _resolve_object_set_ids(
    ontology: Any,
    data: dict[str, Any],
    *,
    limit: int = _MAX_EXTERNAL_COLLECTION_ITEMS,
) -> tuple[list[str], str]:
    """Resolve an ObjectSet spec ``{ids|filter|query, kind}`` to concrete ids.

    Mirrors the ``/object-set/search`` resolution: an explicit ``ids`` list wins;
    otherwise a ``kind`` (type/interface) and/or ``filter`` predicates and/or a
    ``query`` string materialise the set through the real OntologySystem. Returns
    ``(ids, kind)`` where ``kind`` echoes the scoping type/interface (or '').
    """
    from agent_utilities.knowledge_graph.ontology.object_set import PropertyFilter

    kind = str(data.get('kind') or '')
    if len(kind.encode('utf-8')) > 128:
        raise HTTPException(status_code=400, detail='Invalid object kind')
    limit = max(1, min(int(limit), _MAX_EXTERNAL_COLLECTION_ITEMS))
    explicit = data.get('ids')
    if explicit is not None:
        ids = _bounded_identifier_list(explicit)[:limit]
        return ids, kind

    raw_filters = data.get('filter') or data.get('filters') or []
    if not isinstance(raw_filters, list) or len(raw_filters) > 64:
        raise HTTPException(status_code=400, detail='Invalid object filters')
    try:
        _bounded_external_value(raw_filters)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail='Invalid object filters') from exc
    filters = []
    for f in raw_filters:
        if isinstance(f, dict) and (f.get('property') or f.get('field')):
            filters.append(
                PropertyFilter(
                    field=str(f.get('property') or f.get('field')),
                    op=str(f.get('op', 'eq')),
                    value=f.get('value'),
                )
            )

    if kind:
        base = ontology.object_set_of_type(kind)
    elif filters:
        base = ontology.dynamic_object_set(filters=filters)
        filters = []
    else:
        base = ontology.dynamic_object_set(lambda props: True)

    query = str(data.get('query', '') or '')
    if len(query.encode('utf-8')) > 8192:
        raise HTTPException(status_code=400, detail='Invalid object query')
    if query or filters:
        base = base.search(query, filters=filters or None, limit=limit)
    return [str(i) for i in base.ids()[:limit]], kind


def _object_set_store_path() -> Path:
    """Path to the JSON store of saved (named) ObjectSets."""
    try:
        from agent_utilities.core.paths import data_dir

        base = Path(data_dir())
    except Exception:  # noqa: BLE001
        base = DEFAULT_AGENT_DIR
    base = _private_directory(base)
    return base / 'ontology_object_sets.json'


def _load_object_sets() -> dict[str, Any]:
    """Load the saved ObjectSet definitions (JSON), keyed by saved-set id."""
    path = _object_set_store_path()
    if not path.exists():
        return {}
    try:
        value = _read_bounded_json(path)
        return value if isinstance(value, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _save_object_sets(sets: dict[str, Any]) -> None:
    """Persist the saved ObjectSet definitions (JSON)."""
    import json

    path = _object_set_store_path()
    normalized_sets = {
        key: {
            **record,
            'actor': _durable_actor_reference(record.get('actor', 'system')),
        }
        if isinstance(record, dict)
        else record
        for key, record in sets.items()
    }
    safe_sets, _privacy_report = sanitize_for_persistence(normalized_sets)
    payload = json.dumps(safe_sets, indent=2, sort_keys=True).encode('utf-8')
    if len(payload) > _MAX_EXTERNAL_RESULT_BYTES:
        raise ValueError('ObjectSet store exceeds its safety bound')
    _atomic_private_write(path, payload)


def _persist_object_set_node(backend: Any, record: dict[str, Any]) -> bool:
    """Persist a saved set as a durable ``object_set`` KG node. Best-effort.

    Materialises the named set as a node carrying its member ids + metadata, so
    a saved/shared set survives independently of the JSON mirror and is queryable
    on the live store. Returns whether the node was persisted.
    """
    import json

    if backend is None:
        return False
    try:
        safe_record, _privacy_report = sanitize_for_persistence(record)
        safe_record['actor'] = _durable_actor_reference(record.get('actor'))
        backend.execute(
            "MERGE (n {id: $id}) SET n.type = 'object_set', n.name = $name, "
            'n.kind = $kind, n.shared = $shared, n.count = $count, '
            'n.member_ids = $member_ids, n.created_at = $created_at, '
            'n.actor = $actor',
            {
                'id': safe_record['id'],
                'name': safe_record['name'],
                'kind': safe_record.get('kind', ''),
                'shared': bool(safe_record.get('shared', False)),
                'count': int(safe_record.get('count', 0)),
                'member_ids': json.dumps(safe_record.get('ids', [])),
                'created_at': safe_record.get('created_at', 0.0),
                'actor': safe_record.get('actor', 'system'),
            },
        )
        return True
    except Exception as exc:  # noqa: BLE001 — persistence is best-effort
        logger.debug('Operation failed: error_type=%s', type(exc).__name__)
        return False


@router.post('/ontology/object-set/save')
async def ontology_object_set_save(
    data: dict[str, Any], request: Request
) -> dict[str, Any]:
    """Persist a named ObjectSet so it can be revisited / shared.

    Body: ``{name, ids|filter|query, kind, shared?}`` — the Palantir
    'save / share object set' primitive. The set is materialised to concrete
    member ids and persisted **durably** as an ``object_set`` KG node on the live
    store (with a JSON mirror so it survives offline backends). Returns
    ``{id, name, count, kind}``.
    """
    import time
    import uuid

    try:
        kg, ontology = await _get_ontology_kg_bounded()
        backend = kg.store
        name = str(data.get('name') or '').strip()
        if not name or len(name.encode('utf-8')) > 512:
            raise HTTPException(status_code=422, detail='name is required')

        ids, kind = await _invoke_governed_helper(
            _resolve_object_set_ids,
            ontology,
            data,
            deadline=30.0,
        )
        actor = _actor_id_from_request(request)
        set_id = f'object_set:{uuid.uuid4().hex[:12]}'
        record = {
            'id': set_id,
            'name': name,
            'kind': kind,
            'shared': bool(data.get('shared', False)),
            'ids': ids,
            'count': len(ids),
            'created_at': time.time(),
            'actor': actor,
        }

        record['persisted'] = await _invoke_governed_helper(
            _persist_object_set_node,
            backend,
            record,
            deadline=15.0,
        )
        sets = _load_object_sets()
        sets[set_id] = record
        _save_object_sets(sets)

        return {
            'id': set_id,
            'name': name,
            'count': len(ids),
            'kind': kind,
        }
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('save_object_set', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.get('/ontology/object-set/list')
async def ontology_object_set_list(request: Request) -> dict[str, Any]:
    """List saved ObjectSets for the Explorer 'saved sets' panel.

    Merges the durable ``object_set`` KG nodes with the JSON mirror so a set
    saved by any worker is visible. A non-shared set is only listed for its
    owning actor (or for an admin/system actor); shared sets are visible to all.
    """
    import json

    try:
        kg, _ontology = await _get_ontology_kg_bounded()
        backend = kg.store
        actor = _actor_context(request)
        actor_id = _durable_actor_reference(actor.actor_id)
        actor_is_admin = bool(
            set(actor.roles).intersection({'admin', 'system', 'kg:admin'})
        )

        merged: dict[str, dict[str, Any]] = {}
        for rec in list(_load_object_sets().values())[:_MAX_EXTERNAL_COLLECTION_ITEMS]:
            if isinstance(rec, dict) and rec.get('id'):
                merged[rec['id']] = rec

        try:
            rows = await _invoke_governed_helper(
                backend.execute,
                f"MATCH (n {{type: 'object_set'}}) RETURN n "
                f'LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}',
                {},
                deadline=15.0,
            )
        except Exception:  # noqa: BLE001
            rows = []
        for row in rows or []:
            node = row.get('n', {}) if isinstance(row, dict) else {}
            if not isinstance(node, dict) or not node.get('id'):
                continue
            raw_ids = node.get('member_ids')
            try:
                member_ids = (
                    json.loads(raw_ids) if isinstance(raw_ids, str) else (raw_ids or [])
                )
            except Exception:  # noqa: BLE001
                member_ids = []
            merged.setdefault(
                node['id'],
                {
                    'id': node['id'],
                    'name': node.get('name', ''),
                    'kind': node.get('kind', ''),
                    'shared': bool(node.get('shared', False)),
                    'ids': member_ids,
                    'count': int(node.get('count', len(member_ids))),
                    'created_at': node.get('created_at', 0.0),
                    'actor': _durable_actor_reference(node.get('actor', 'system')),
                },
            )

        visible = [
            {
                'id': r['id'],
                'name': r.get('name', ''),
                'kind': r.get('kind', ''),
                'shared': bool(r.get('shared', False)),
                'count': int(r.get('count', len(r.get('ids', []) or []))),
                'created_at': r.get('created_at', 0.0),
                'actor': _durable_actor_reference(r.get('actor', 'system')),
            }
            for r in merged.values()
            if r.get('shared')
            or _durable_actor_reference(r.get('actor', 'system')) == actor_id
            or actor_is_admin
        ]
        visible.sort(key=lambda r: r.get('created_at') or 0.0, reverse=True)
        visible = visible[:_MAX_EXTERNAL_COLLECTION_ITEMS]
        return {'sets': visible, 'count': len(visible)}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('list_object_sets', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.get('/ontology/actions')
async def ontology_actions(object_type: str | None = None) -> list[dict[str, Any]]:
    """List the REAL registered ontology actions, optionally scoped to a type.

    Backs the Object Explorer's bulk-action menu so every offered action is a
    genuinely registered :class:`OntologyAction` routed through the governed
    executor — no hardcoded/fake verbs. When ``object_type`` is supplied the
    list is narrowed via :meth:`ActionRegistry.actions_for_type` (the actions
    whose ``acts_on`` covers that type); otherwise the full registry is returned
    via :meth:`ActionRegistry.list_actions`. Each entry carries ``name``,
    ``verb``, ``description``, ``produces_effect`` and ``required_capability``
    so the client can filter to mutation/external-effect actions.
    """
    try:
        from agent_utilities.knowledge_graph.actions import DEFAULT_REGISTRY

        if object_type:
            actions = DEFAULT_REGISTRY.actions_for_type(object_type)
        else:
            actions = DEFAULT_REGISTRY.list_actions()

        return [
            {
                'name': a.name,
                'verb': a.verb,
                'description': a.description,
                'produces_effect': getattr(
                    a.produces_effect, 'value', str(a.produces_effect)
                ),
                'required_capability': a.required_capability,
                'acts_on': list(a.acts_on or []),
            }
            for a in list(actions)[:_MAX_EXTERNAL_COLLECTION_ITEMS]
        ]
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        return []


@router.post('/ontology/object-set/action')
async def ontology_object_set_action(
    data: dict[str, Any], request: Request
) -> dict[str, Any]:
    """Apply a bulk OntologyAction over selected objects via the governed executor.

    Body: ``{ids, action_name, params, actor?}`` — Palantir 'bulk Actions with
    writeback'. Each target is run through the governed
    :class:`ActionExecutor` (authorize → escalate → validate → run → audit →
    persist), with side-effects journaled in the live-store-bound Edit Ledger so
    every writeback is durable + revertible. Permissioning is enforced: an actor
    lacking the action's ``required_capability`` is DENIED per target. Returns
    ``{applied, results:[{id, status, edit_ids}], errors}``.
    """
    try:
        from agent_utilities.knowledge_graph.actions import (
            DEFAULT_REGISTRY,
            ActionExecutor,
            ActionStatus,
        )

        _kg, ontology = await _get_ontology_kg_bounded()
        ids = _bounded_identifier_list(data.get('ids'), required=True)
        action_name = str(data.get('action_name') or '').strip()
        if not action_name or not _SAFE_DELEGATION_TOKEN.fullmatch(action_name):
            raise HTTPException(status_code=422, detail='action_name is required')
        params = _bounded_query_params(data.get('params') or {})

        ambient_actor = _actor_context(request)
        actor_id = _durable_actor_reference(ambient_actor.actor_id)
        actor = replace(ambient_actor, actor_id=actor_id)

        # Bind the executor's ledger to the SAME live-store ledger the object
        # view reads, so bulk writeback edits are durable and surface in history.
        executor = ActionExecutor(DEFAULT_REGISTRY, ledger=ontology.edits)

        # A mutating bulk action is a HIGH-risk verb that the HITL escalation
        # gate (CONCEPT:AU-OS.observability.empty-derive-from-effect) pauses for human approval — without a decision
        # it auto-denies, never silently writes. When the caller supplies an
        # explicit ``approve`` payload (the operator pressing 'approve' in the
        # bulk-action dialog), wire it as the gate's decision_provider so the
        # writeback proceeds under a recorded, role-checked approval.
        approve = data.get('approve')
        decision_provider = None
        if approve:
            if not isinstance(approve, dict):
                raise HTTPException(status_code=400, detail='Invalid approval payload')
            if not set(actor.roles).intersection({'admin', 'kg:admin'}):
                raise HTTPException(status_code=403, detail='Admin approval required')
            approver = actor_id
            approver_role = 'admin'
            reason = (approve.get('reason')) or 'bulk action approved by operator'
            if not isinstance(reason, str) or len(reason.encode('utf-8')) > 2048:
                raise HTTPException(status_code=400, detail='Invalid approval reason')
            reason, _privacy_report = sanitize_for_persistence(reason)

            def decision_provider(_request: Any) -> dict[str, Any]:
                return {
                    'approved': True,
                    'approver': approver,
                    'approver_role': approver_role,
                    'reason': reason,
                }

        # The per-target object id must reach the action's templated side-effects
        # (e.g. ``target: "$concept_id"``). Resolve the action's required ``*_id``
        # parameter once so each iteration binds the loop's target id to it when
        # the caller did not pin it explicitly.
        action_def = DEFAULT_REGISTRY.get(action_name)
        id_param = ''
        if action_def is not None:
            declared = {p.name for p in action_def.parameters}
            for p in action_def.parameters:
                if p.required and p.name.endswith('_id') and p.name not in params:
                    id_param = p.name
                    break
            # Only a declared ``target_id`` param may receive the fallback —
            # validate_params rejects unknown keys.
            if not id_param and 'target_id' in declared and 'target_id' not in params:
                id_param = 'target_id'

        results: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        applied = 0
        for target_id in ids:
            # Bind the loop's target id under the action's declared ``*_id``
            # parameter so single-target $-templates resolve per object.
            call_params = dict(params)
            if id_param:
                call_params[id_param] = target_id
            inv = await _invoke_governed_helper(
                executor.execute,
                action_name,
                actor,
                call_params,
                target_id=target_id,
                decision_provider=decision_provider,
                deadline=120.0,
            )
            status = str(inv.status)
            edit_ids = list(getattr(inv, 'edit_ids', []) or [])
            edit_ids = edit_ids[:_MAX_EXTERNAL_COLLECTION_ITEMS]
            results.append({'id': target_id, 'status': status, 'edit_ids': edit_ids})
            if inv.status == ActionStatus.SUCCESS:
                applied += 1
            elif inv.status in (ActionStatus.ERROR, ActionStatus.DENIED):
                errors.append(
                    {
                        'id': target_id,
                        'status': status,
                        'error': getattr(inv, 'error', '')
                        or getattr(inv, 'result_summary', ''),
                    }
                )

        return _public_external_result(
            {'applied': applied, 'results': results, 'errors': errors}
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


def _durable_edit_history(backend: Any, object_id: str) -> list[dict[str, Any]]:
    """Read an object's durable edit history from the store's ``object_edit`` nodes.

    The :class:`EditLedger` persists each edit as an ``object_edit`` node (with
    ``EDITS`` → target edges) but serves :meth:`history` from an in-process
    mirror that does not survive across stateless HTTP requests. This reads the
    durable nodes directly so the object view shows the full audit trail
    regardless of which worker recorded the edit.
    """
    import json

    try:
        rows = backend.execute(
            f"MATCH (n {{object_id: $id, type: 'object_edit'}}) RETURN n "
            f'LIMIT {_MAX_EXTERNAL_COLLECTION_ITEMS}',
            {'id': object_id},
        )
    except Exception:  # noqa: BLE001
        return []
    edits: list[dict[str, Any]] = []
    for row in rows or []:
        node = row.get('n', {})
        if not isinstance(node, dict):
            continue

        def _loads(raw: Any) -> Any:
            if isinstance(raw, str):
                try:
                    return json.loads(raw)
                except Exception:  # noqa: BLE001
                    return raw
            return raw or {}

        edits.append(
            {
                'id': node.get('id', ''),
                'actor': _durable_actor_reference(node.get('actor', '')),
                'edit_type': node.get('edit_type', ''),
                'object_id': node.get('object_id', object_id),
                'before': _loads(node.get('before')),
                'after': _loads(node.get('after')),
                'link_source': node.get('link_source', ''),
                'link_label': node.get('link_label', ''),
                'link_target': node.get('link_target', ''),
                'provenance': node.get('provenance', ''),
                'invocation_ref': node.get('invocation_ref', ''),
                'timestamp': node.get('timestamp', 0.0),
            }
        )
    edits.sort(key=lambda e: e.get('timestamp') or 0.0)
    return edits


@router.get('/ontology/object/{object_id}')
async def get_ontology_object(
    object_id: str, request: Request, layout: str = 'standard'
) -> dict[str, Any]:
    """Full object view: properties, in/out links, derived props, markings, history.

    The properties are passed through the fine-grained permissioning gate
    (``enforce``) for the requesting actor; a fully-redacted/denied object yields
    a 404.

    ``layout`` selects the widget composition returned under ``view``:
    ``standard`` (default) derives the layout from the object type's interface
    schema; ``configured`` returns the stored :func:`ObjectView` widget
    composition for that type when one has been saved (falling back to standard
    when none exists). The selection is a real change in the returned payload —
    the same affordance the Explorer's layout toggle reaches.

    FIX LANE Priority 1: locates which accessible graph holds the object
    (`_locate_object_graph`) ONCE, then re-scopes every remaining read
    (links, derived properties, edit history) to that SAME graph
    (`_ontology_facade_for` + `_session_scoped_to`) -- otherwise a
    commons-resident object would come back with right properties but
    wrong-graph (empty) links/derived/history, worse than the tenant-only
    status quo.
    """
    object_id = _validate_runtime_id(object_id)
    if layout not in {'standard', 'configured'}:
        raise HTTPException(status_code=400, detail='Invalid object layout')
    try:
        from agent_utilities.knowledge_graph.core.session import current_session
        from agent_utilities.knowledge_graph.ontology.permissioning import (
            enforce,
            markings_for,
        )

        engine = await _get_engine_bounded()
        located = await _invoke_governed_helper(
            _locate_object_graph, engine, object_id, deadline=15.0
        )
        if located is None:
            raise HTTPException(status_code=404, detail='Object not found or denied')
        graph_name, scoped_engine, props = located
        facade = _ontology_facade_for(engine, scoped_engine)
        if facade is None:
            raise HTTPException(status_code=501, detail='Ontology layer unavailable')
        _scoped_kg, ontology = facade
        backend = scoped_engine.backend
        actor = _actor_context(request)
        session = current_session()

        with _session_scoped_to(session, graph_name):
            props.setdefault('id', object_id)
            enforced = enforce([props], actor)
            if not enforced:
                raise HTTPException(
                    status_code=404, detail='Object not found or denied'
                )
            view_props = enforced[0]

            object_type = (
                view_props.get('type')
                or view_props.get('_type')
                or view_props.get('object_type')
            )
            try:
                derived = await _invoke_governed_helper(
                    ontology.derive_all,
                    view_props,
                    object_type=object_type,
                    actor_id=actor.actor_id,
                    deadline=30.0,
                )
            except Exception:  # noqa: BLE001
                derived = {}
            try:
                markings = sorted(markings_for(object_id))
            except Exception:  # noqa: BLE001
                markings = []
            # Prefer the durable, cross-request audit trail from the store;
            # fall back to the in-process ledger mirror when nothing was
            # persisted.
            history = await _invoke_governed_helper(
                _durable_edit_history, backend, object_id, deadline=15.0
            )
            if not history:
                try:
                    fallback_history = await _invoke_governed_helper(
                        ontology.history,
                        object_id,
                        deadline=15.0,
                    )
                    history = [e.model_dump(mode='json') for e in fallback_history]
                except Exception:  # noqa: BLE001
                    history = []

            # Resolve the requested layout into a concrete view payload.
            # ``configured`` serves the stored ObjectView widget composition
            # for this type (when one exists); ``standard`` derives the
            # layout from the type's interface schema. The selection
            # genuinely changes the returned ``view``.
            layout_choice = (layout or 'standard').strip().lower()
            view: dict[str, Any] = {}
            if object_type:
                configured = (
                    _load_object_views().get(str(object_type))
                    if layout_choice == 'configured'
                    else None
                )
                if configured is not None:
                    view = {
                        'object_type': object_type,
                        'view_type': 'configured',
                        **configured,
                    }
                else:
                    view = _standard_object_view(ontology, str(object_type))

            links = await _invoke_governed_helper(
                _node_links, backend, object_id, deadline=15.0
            )

        return _public_external_result(
            {
                'id': object_id,
                'object_type': object_type,
                'properties': view_props,
                'links': links,
                'derived': derived,
                'markings': markings[:_MAX_EXTERNAL_COLLECTION_ITEMS],
                'history': history[:_MAX_EXTERNAL_COLLECTION_ITEMS],
                'layout': view.get('view_type', 'standard') if view else layout_choice,
                'view': view,
            }
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/ontology/object/{object_id}/edit')
async def edit_ontology_object(
    object_id: str, data: dict[str, Any], request: Request
) -> dict[str, Any]:
    """Record a durable edit on an object and return the edit + updated object.

    Body: ``{edit_type, property|properties, value, link_type, target, actor}``.
    ``edit_type`` is one of ``property_set`` / ``link_add`` / ``link_remove``.
    """
    object_id = _validate_runtime_id(object_id)
    try:
        kg, ontology = await _get_ontology_kg_bounded()
        backend = kg.store
        actor = _actor_id_from_request(request)
        edit_type = str(data.get('edit_type', 'property_set') or 'property_set')

        if edit_type == 'property_set':
            properties = data.get('properties')
            if not isinstance(properties, dict):
                prop = data.get('property')
                if not prop:
                    raise HTTPException(
                        status_code=422,
                        detail='property_set requires properties or property+value',
                    )
                properties = {str(prop): data.get('value')}
            properties = _bounded_query_params(properties)
            edit = await _invoke_governed_helper(
                ontology.set_property_edit,
                object_id,
                properties,
                actor=actor,
                deadline=30.0,
            )
        elif edit_type == 'link_add':
            target = data.get('target') or data.get('link_target')
            label = str(data.get('link_type') or data.get('link') or 'related')
            if not target:
                raise HTTPException(status_code=422, detail='link_add requires target')
            target = _validate_runtime_id(str(target))
            if not _SAFE_DELEGATION_TOKEN.fullmatch(label):
                raise HTTPException(status_code=400, detail='Invalid link type')
            edit = await _invoke_governed_helper(
                ontology.edits.add_link,
                object_id,
                target,
                label,
                actor=actor,
                deadline=30.0,
            )
        elif edit_type == 'link_remove':
            target = data.get('target') or data.get('link_target')
            label = str(data.get('link_type') or data.get('link') or 'related')
            if not target:
                raise HTTPException(
                    status_code=422, detail='link_remove requires target'
                )
            target = _validate_runtime_id(str(target))
            if not _SAFE_DELEGATION_TOKEN.fullmatch(label):
                raise HTTPException(status_code=400, detail='Invalid link type')
            edit = await _invoke_governed_helper(
                ontology.edits.remove_link,
                object_id,
                target,
                label,
                actor=actor,
                deadline=30.0,
            )
        else:
            raise HTTPException(
                status_code=422, detail=f'unsupported edit_type: {edit_type}'
            )

        return _public_external_result(
            {
                'edit': edit.model_dump(mode='json'),
                'object': {
                    'id': object_id,
                    'properties': await _invoke_governed_helper(
                        _node_properties, backend, object_id, deadline=15.0
                    ),
                    'links': await _invoke_governed_helper(
                        _node_links, backend, object_id, deadline=15.0
                    ),
                },
            }
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/ontology/object/{object_id}/revert')
async def revert_ontology_edit(
    object_id: str, data: dict[str, Any], request: Request
) -> dict[str, Any]:
    """Revert a recorded edit, recording a durable compensating edit.

    Body: ``{edit_id, actor}``.
    """
    object_id = _validate_runtime_id(object_id)
    try:
        from agent_utilities.knowledge_graph.ontology.edits import Edit, EditType

        kg, ontology = await _get_ontology_kg_bounded()
        backend = kg.store
        actor = _actor_id_from_request(request)
        edit_id = data.get('edit_id')
        if not isinstance(edit_id, str) or not _SAFE_DELEGATION_TOKEN.fullmatch(
            edit_id
        ):
            raise HTTPException(status_code=422, detail='edit_id is required')

        # The in-process ledger mirror does not survive across stateless HTTP
        # requests, so rehydrate the original edit from its durable store node
        # and register it on the ledger before reverting.
        if ontology.edits.get(str(edit_id)) is None:
            durable_history = await _invoke_governed_helper(
                _durable_edit_history, backend, object_id, deadline=15.0
            )
            for hist in durable_history:
                if hist.get('id') == str(edit_id):
                    rehydrated = Edit(
                        id=hist['id'],
                        actor=_durable_actor_reference(hist.get('actor', 'system')),
                        edit_type=EditType(hist['edit_type']),
                        object_id=hist.get('object_id', object_id),
                        before=hist.get('before') or {},
                        after=hist.get('after') or {},
                        link_source=hist.get('link_source', ''),
                        link_label=hist.get('link_label', ''),
                        link_target=hist.get('link_target', ''),
                        provenance=hist.get('provenance', ''),
                        invocation_ref=hist.get('invocation_ref', ''),
                        timestamp=hist.get('timestamp', 0.0) or 0.0,
                    )
                    await _invoke_governed_helper(
                        ontology.edits.rehydrate,
                        rehydrated,
                        deadline=15.0,
                    )
                    break

        compensating = await _invoke_governed_helper(
            ontology.revert_edit,
            str(edit_id),
            actor=actor,
            deadline=30.0,
        )
        return _public_external_result(
            {
                'edit': compensating.model_dump(mode='json'),
                'object': {
                    'id': object_id,
                    'properties': await _invoke_governed_helper(
                        _node_properties, backend, object_id, deadline=15.0
                    ),
                    'links': await _invoke_governed_helper(
                        _node_links, backend, object_id, deadline=15.0
                    ),
                },
            }
        )
    except HTTPException:
        raise
    except KeyError as e:
        raise HTTPException(status_code=404, detail=type(e).__name__) from e
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/ontology/function/invoke')
async def invoke_ontology_function(
    data: dict[str, Any], request: Request
) -> dict[str, Any]:
    """Invoke a typed, versioned ontology function via the audited runtime.

    Body: ``{name, version, params}``. Dispatches through the canonical
    ``ontology_function`` tool — the same implementation behind the gateway's
    ``POST /ontology/function`` — so invocation semantics cannot drift.
    """
    import json

    try:
        name = data.get('name')
        if not isinstance(name, str) or not _SAFE_DELEGATION_TOKEN.fullmatch(name):
            raise HTTPException(status_code=422, detail='name is required')
        params = _bounded_query_params(data.get('params') or {})
        version = data.get('version') or ''
        if not isinstance(version, str) or len(version.encode('utf-8')) > 128:
            raise HTTPException(status_code=400, detail='Invalid function version')
        actor_id = _actor_id_from_request(request)

        result = await _invoke_governed_helper(
            _canonical_kg_tool,
            deadline=30.0,
            tool_name='ontology_function',
            action='invoke',
            name=name,
            params=json.dumps(params, separators=(',', ':'), allow_nan=False),
            version=version,
            actor=str(actor_id),
        )
        _raise_canonical_error(result)
        bounded = _public_external_result(result)
        if not isinstance(bounded, dict):
            raise HTTPException(status_code=422, detail='Invalid function result')
        return bounded
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/ontology/derive')
async def derive_ontology_property(data: dict[str, Any]) -> dict[str, Any]:
    """Compute a single derived property for an object.

    Body: ``{object_id, derived_name, object_type}``. Resolves the object's
    live property map from the store (a UI convenience — the canonical tool
    takes the object dict).

    FIX LANE Priority 1: locates which accessible graph holds the object
    (`_locate_object_graph`) and computes the derived property against a
    facade bound to THAT graph (`_ontology_facade_for`). This bypasses the
    canonical ``ontology_derive`` tool dispatch this route previously used --
    that tool always resolves its OWN unscoped, tenant-fixed
    ``kg_server._ontology_system()``, so a CYPHER-backed derived property
    (``derived_properties.py``: evaluated through the facade's "tenant-
    scoped" ``KnowledgeGraph.query`` read path) can never be re-scoped to a
    commons-resident object through it -- retargeting only the ambient
    session while the tool keeps calling its own pinned engine reproduces
    the exact masked failure `_graph_union_executor` documents
    (``PermissionError: "A graph-scoped view cannot retarget the verified
    GraphSession"``), or worse, silently computes against the wrong graph.
    ``ontology.derive()`` is the SAME primitive the tool itself calls
    (``ont.derive(obj, name, object_type=otype)``), just bound to the
    correct graph.
    """
    import json

    try:
        object_id = data.get('object_id')
        derived_name = data.get('derived_name')
        if not isinstance(object_id, str) or not isinstance(derived_name, str):
            raise HTTPException(
                status_code=422, detail='object_id and derived_name are required'
            )
        object_id = _validate_runtime_id(object_id)
        if not _SAFE_DELEGATION_TOKEN.fullmatch(derived_name):
            raise HTTPException(status_code=400, detail='Invalid derived property')

        from agent_utilities.knowledge_graph.core.session import current_session

        engine = await _get_engine_bounded()
        located = await _invoke_governed_helper(
            _locate_object_graph, engine, str(object_id), deadline=15.0
        )
        if located is None:
            raise HTTPException(status_code=404, detail='Object not found')
        graph_name, scoped_engine, props = located
        facade = _ontology_facade_for(engine, scoped_engine)
        if facade is None:
            raise HTTPException(status_code=501, detail='Ontology layer unavailable')
        _scoped_kg, ontology = facade

        props.setdefault('id', str(object_id))
        object_type = (
            data.get('object_type')
            or props.get('type')
            or props.get('_type')
            or props.get('object_type')
        )
        bounded_props = _bounded_query_params(props)
        session = current_session()
        with _session_scoped_to(session, graph_name):
            result = await _invoke_governed_helper(
                ontology.derive,
                bounded_props,
                derived_name,
                object_type=str(object_type or '') or None,
                deadline=30.0,
            )
        bounded = _public_external_result(
            json.loads(json.dumps(result.model_dump(), default=str))
        )
        if not isinstance(bounded, dict):
            raise HTTPException(status_code=422, detail='Invalid derived result')
        return bounded
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('derive_property', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/ontology/document/process')
async def process_ontology_document(data: dict[str, Any]) -> dict[str, Any]:
    """Process a document into Document + Chunk objects (KG-2.48).

    Body: ``{text|path, chunk_size, overlap, title, doc_type, source}``.
    """
    try:
        kg, ontology = await _get_ontology_kg_bounded()
        text = data.get('text')
        path = data.get('path')
        if not text and not path:
            raise HTTPException(status_code=422, detail='text or path is required')
        if text is not None:
            if (
                not isinstance(text, str)
                or len(text.encode('utf-8')) > _MAX_EXTERNAL_RESULT_BYTES
            ):
                raise HTTPException(
                    status_code=400, detail='Document text exceeds its limit'
                )
        if path is not None:
            path = _workspace_ingestion_source(path)

        chunk_size = int(data.get('chunk_size', 800) or 800)
        overlap = int(data.get('overlap', 120) or 120)
        if not 64 <= chunk_size <= 16_384 or not 0 <= overlap < chunk_size:
            raise HTTPException(
                status_code=400, detail='Invalid document chunking bounds'
            )
        kwargs: dict[str, Any] = {}
        for key in ('title', 'doc_type', 'source', 'document_id'):
            if data.get(key) is not None:
                value = data[key]
                if not isinstance(value, str) or len(value.encode('utf-8')) > 2048:
                    raise HTTPException(
                        status_code=400, detail='Invalid document metadata'
                    )
                kwargs[key] = value
        if data.get('metadata') is not None:
            kwargs['metadata'] = _bounded_query_params(data['metadata'])
        if text and path:
            kwargs.setdefault('text', text)

        document = path if path else text
        result = await _invoke_governed_helper(
            ontology.process_document,
            deadline=30.0,
            document=document,
            chunk_size=chunk_size,
            overlap=overlap,
            **kwargs,
        )
        chunks = list(result.get('chunk_nodes', []) or [])
        edges = list(result.get('edges', []) or [])
        if (
            len(chunks) > _MAX_EXTERNAL_COLLECTION_ITEMS
            or len(edges) > _MAX_EXTERNAL_COLLECTION_ITEMS
        ):
            raise HTTPException(
                status_code=422, detail='Document result exceeds its limit'
            )
        response = {
            'document': result.get('document_node'),
            'chunks': chunks,
            'edges': edges,
        }
        return _public_external_result(response)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('api_extension', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


def _object_view_store_path() -> Path:
    """Path to the JSON store of configured ObjectView definitions."""
    try:
        from agent_utilities.core.paths import data_dir

        base = Path(data_dir())
    except Exception:  # noqa: BLE001
        base = DEFAULT_AGENT_DIR
    base = _private_directory(base)
    return base / 'ontology_object_views.json'


def _load_object_views() -> dict[str, Any]:
    """Load the stored configured ObjectView definitions (JSON)."""
    path = _object_view_store_path()
    if not path.exists():
        return {}
    try:
        value = _read_bounded_json(path)
        return value if isinstance(value, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _save_object_views(views: dict[str, Any]) -> None:
    """Persist privacy-safe configured ObjectView definitions atomically."""
    import json

    path = _object_view_store_path()
    safe_views, _privacy_report = sanitize_for_persistence(views)
    payload = json.dumps(safe_views, indent=2, sort_keys=True).encode('utf-8')
    if len(payload) > _MAX_EXTERNAL_RESULT_BYTES:
        raise ValueError('ObjectView store exceeds its safety bound')
    _atomic_private_write(path, payload)


def _standard_object_view(ontology: Any, object_type: str) -> dict[str, Any]:
    """Derive a standard ObjectView from an object type's interface schema.

    The standard view is auto-composed from the property/link contracts of every
    interface the type implements — a deterministic widget layout (property table
    + per-link panels) with no stored configuration.
    """
    property_widgets: list[dict[str, Any]] = []
    link_widgets: list[dict[str, Any]] = []
    seen_props: set[str] = set()
    seen_links: set[str] = set()
    implements: list[str] = []

    for iface in ontology.interfaces.list_interfaces():
        try:
            impls = ontology.interfaces.find_implementers(iface.name)
        except Exception:  # noqa: BLE001
            impls = []
        if object_type not in impls:
            continue
        implements.append(iface.name)
        for prop in iface.properties:
            if prop.name in seen_props:
                continue
            seen_props.add(prop.name)
            property_widgets.append(
                {
                    'kind': 'property',
                    'property': prop.name,
                    'type_ref': prop.type_ref,
                    'required': prop.required,
                    'label': prop.name,
                }
            )
        for lc in iface.link_constraints:
            if lc.name in seen_links:
                continue
            seen_links.add(lc.name)
            link_widgets.append(
                {
                    'kind': 'link',
                    'name': lc.name,
                    'edge_type': str(lc.edge_type),
                    'target_type': lc.target_type,
                    'label': lc.name,
                }
            )

    return {
        'object_type': object_type,
        'view_type': 'standard',
        'implements': implements,
        'widgets': property_widgets + link_widgets,
    }


@router.get('/ontology/object-view/{object_type}')
async def get_ontology_object_view(object_type: str) -> dict[str, Any]:
    """Get the ObjectView for a type: stored (configured) else standard (schema)."""
    try:
        _kg, ontology = await _get_ontology_kg_bounded()
        configured = _load_object_views().get(object_type)
        if configured is not None:
            return {
                'object_type': object_type,
                'view_type': 'configured',
                **configured,
            }
        return _standard_object_view(ontology, object_type)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('get_object_view', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e


@router.post('/ontology/object-view/{object_type}')
async def save_ontology_object_view(
    object_type: str, data: dict[str, Any]
) -> dict[str, Any]:
    """Save a configured ObjectView definition (widget composition) for a type."""
    try:
        # Validate the ontology is reachable before persisting.
        await _get_ontology_kg_bounded()
        views = _load_object_views()
        definition = {
            'widgets': data.get('widgets', []),
            'title': data.get('title', object_type),
        }
        views[object_type] = definition
        _save_object_views(views)
        return {
            'status': 'success',
            'object_type': object_type,
            'view_type': 'configured',
            **definition,
        }
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        _log_failure('save_object_view', e)
        raise HTTPException(status_code=500, detail=type(e).__name__) from e
