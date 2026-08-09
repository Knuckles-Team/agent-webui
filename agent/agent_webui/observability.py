#!/usr/bin/python
"""Structured logging, HTTP access logging, and error-capture plumbing.

Motivating gap (LANE F): while debugging a live 403, ``kubectl logs`` on the
running pod showed ONLY WebSocket lines — the app logged no HTTP requests at
all, and browser-reported failures (503s, a "shape violation", a 405) were
invisible server-side. This module is the fix: every HTTP/WS request gets one
access-log line (method, path, status, duration, correlation id), every
unhandled exception is captured with a traceback and a stable id the UI can
show back to the user, and every log record is JSON-capable so it lands in
the existing LGTM/Loki stack as structured data instead of prose.

**Reuse, not reinvention:**

* Correlation ids come from ``agent_utilities.observability.correlation`` —
  the SAME cross-agent trace-correlation module the rest of the ecosystem
  uses to tie a request to its downstream graph-os/engine calls. This module
  never mints its own id scheme; it binds the shared contextvar for the
  lifetime of one request/connection so every inner layer (authorization,
  identity, route handlers, and any outbound call the request triggers)
  observes and logs the same id.
* Text redaction reuses ``agent_utilities.core.log_privacy.sanitize_log_text``
  (the same regex-based endpoint/path/host:port/email scrubber
  ``install_log_privacy_boundary`` applies to ``agent_utilities.*`` loggers)
  — but ONLY on exception tracebacks, not on the message or ``extra`` fields.
  That split is deliberate, not an oversight: ``sanitize_log_text``'s
  filesystem-path heuristic cannot distinguish ``/etc/passwd`` from
  ``/api/dashboard/health`` — it redacts BOTH to ``<path>`` — so running it
  over the message would silently defeat item 1's entire purpose (an access
  log that shows the request path, verbatim, measured empirically: it turned
  every access-log line's path into the literal string ``<path>``). The
  fields this module puts in a message/``extra`` (HTTP method/path,
  origin/host/scheme, resolved scope/role NAMES, status, duration,
  correlation id) are fully curated by THIS package's own call sites and are
  never a filesystem path or a secret, so they are logged as-is. A
  traceback, by contrast, can originate from anywhere in the call stack —
  third-party libraries included — so it stays sanitized as defense in
  depth, matching this ecosystem's stated policy that deployment-specific
  filesystem paths are sensitive.

**What is never logged:** tokens, secrets, cookie values, or full
Authorization headers. Call sites in this package pass only metadata shaped
for diagnosis — origin/host/scheme, resolved scope/role NAMES, status codes,
durations, correlation ids — never a credential value.

Configuration follows this repo's existing ``AGENT_WEBUI_*`` bare-``os.getenv``
convention (see ``server.py``'s ``AGENT_WEBUI_LOGFIRE_ENABLED`` /
``AGENT_WEBUI_ACCESS_LOG_POLICY``) rather than adding a field to the shared
``agent_utilities.core.config.AgentConfig`` — these flags are agent-webui
specific and agent-utilities' own configuration-discipline rule reserves
``AgentConfig`` fields for values IT reads.

* ``AGENT_WEBUI_LOG_LEVEL`` — ``DEBUG``/``INFO``/``WARNING``/``ERROR``/
  ``CRITICAL`` (default ``INFO``).
* ``AGENT_WEBUI_LOG_FORMAT`` — ``json`` (default; one JSON object per line,
  fit for Loki/Alloy ingestion) or ``text`` (human-readable, for local dev).
"""

from __future__ import annotations

import json
import logging
import os
import sys
import traceback
import uuid
from typing import Any

__all__ = [
    'CORRELATION_RESPONSE_HEADER',
    'StructuredLogFormatter',
    'configure_logging',
    'current_correlation_id',
    'new_error_id',
    'sanitize_text',
]

_PACKAGE_LOGGER_NAME = 'agent_webui'
_LOG_LEVEL_ENV = 'AGENT_WEBUI_LOG_LEVEL'
_LOG_FORMAT_ENV = 'AGENT_WEBUI_LOG_FORMAT'
_HANDLER_MARKER = '_agent_webui_structured_handler'

#: Header carrying the correlation id back to the browser, so a user-reported
#: failure (or a captured HAR/network log) can be grepped straight to its
#: server-side log lines. Lower-case, matching every other header comparison
#: in this codebase (ASGI headers are compared case-insensitively).
CORRELATION_RESPONSE_HEADER = 'x-correlation-id'

#: Standard ``logging.LogRecord`` attributes. Anything else present on a
#: record (set via ``logger.info(..., extra={...})``) is application-supplied
#: structured payload and gets included in the rendered record.
_RESERVED_RECORD_ATTRS = frozenset(
    {
        'name',
        'msg',
        'args',
        'levelname',
        'levelno',
        'pathname',
        'filename',
        'module',
        'exc_info',
        'exc_text',
        'stack_info',
        'lineno',
        'funcName',
        'created',
        'msecs',
        'relativeCreated',
        'thread',
        'threadName',
        'processName',
        'process',
        'taskName',
        'message',
    }
)


def sanitize_text(value: str) -> str:
    """Redact endpoint/path/host:port/email-shaped text before it is logged.

    Delegates to ``agent_utilities.core.log_privacy.sanitize_log_text`` —
    reused, not reimplemented. Falls back to the raw text if agent_utilities
    is unavailable for any reason, so logging itself never breaks a request.
    """
    try:
        from agent_utilities.core.log_privacy import sanitize_log_text

        return sanitize_log_text(value)
    except Exception:  # noqa: BLE001 — logging must never fail the request
        return value


def current_correlation_id() -> str | None:
    """Return the ambient correlation id, if a request has bound one."""
    try:
        from agent_utilities.observability.correlation import get_correlation_id

        return get_correlation_id()
    except Exception:  # noqa: BLE001 — best-effort; never fails the caller
        return None


def new_error_id() -> str:
    """Mint a short, non-secret id for a captured error.

    Only used when no correlation id is bound (the correlation id IS the
    error id whenever one is available, so a caller reporting either value
    finds the same log lines — see ``server.py``'s unhandled-exception
    handler).
    """
    return uuid.uuid4().hex[:12]


class StructuredLogFormatter(logging.Formatter):
    """Render one JSON object (or a readable line) per record.

    Every record carries the ambient correlation id (item 2: ties a browser
    request to its server-side handling and to any downstream graph-os
    call), plus whatever structured fields the call site passed via
    ``extra=``. Exception tracebacks are preserved (never stripped) so
    unhandled errors are diagnosable from logs alone — the whole point of
    item 4. The message and ``extra`` fields are logged VERBATIM (not run
    through the filesystem-path scrubber) — see the module docstring for why
    that scrubber is applied only to exception text here.
    """

    def __init__(self, *, json_mode: bool) -> None:
        super().__init__()
        self._json_mode = json_mode

    def format(self, record: logging.LogRecord) -> str:
        message = record.getMessage()
        correlation_id = current_correlation_id()
        extras = {
            key: value
            for key, value in record.__dict__.items()
            if key not in _RESERVED_RECORD_ATTRS and not key.startswith('_')
        }
        exception_text = None
        if record.exc_info:
            exception_text = sanitize_text(
                ''.join(traceback.format_exception(*record.exc_info))
            )
        timestamp = self.formatTime(record, '%Y-%m-%dT%H:%M:%S')

        if self._json_mode:
            payload: dict[str, Any] = {
                'timestamp': timestamp,
                'level': record.levelname,
                'logger': record.name,
                'message': message,
                'correlation_id': correlation_id,
            }
            payload.update(extras)
            if exception_text:
                payload['exception'] = exception_text
            return json.dumps(payload, default=str)

        line = (
            f'{timestamp} {record.levelname:<8} {record.name} '
            f'correlation_id={correlation_id or "-"} {message}'
        )
        if extras:
            line += ' ' + ' '.join(f'{key}={value}' for key, value in extras.items())
        if exception_text:
            line += '\n' + exception_text
        return line


def configure_logging() -> None:
    """Install one stdout handler on the ``agent_webui`` logger namespace.

    Idempotent — safe to call from every process entry point (module import,
    ``main()``, tests). Deliberately scoped to the ``agent_webui`` logger
    (not the root logger), so it never reformats uvicorn's own logging or
    ``agent_utilities.*``'s privacy-boundary-covered logging — each keeps its
    own configuration; this only fixes agent-webui's own previously-silent
    namespace.
    """
    package_logger = logging.getLogger(_PACKAGE_LOGGER_NAME)

    level_name = (os.getenv(_LOG_LEVEL_ENV) or 'INFO').strip().upper()
    level = getattr(logging, level_name, None)
    if not isinstance(level, int):
        level = logging.INFO

    format_mode = (os.getenv(_LOG_FORMAT_ENV) or 'json').strip().lower()
    json_mode = format_mode != 'text'

    already_installed = any(
        getattr(handler, _HANDLER_MARKER, False) for handler in package_logger.handlers
    )
    if not already_installed:
        handler = logging.StreamHandler(stream=sys.stdout)
        handler.setFormatter(StructuredLogFormatter(json_mode=json_mode))
        setattr(handler, _HANDLER_MARKER, True)
        package_logger.addHandler(handler)
        # This package owns its own formatting; without this a record would
        # also hit the root logger's handler (if any embedder configures
        # one) and print twice.
        package_logger.propagate = False

    package_logger.setLevel(level)
