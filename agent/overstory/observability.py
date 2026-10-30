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

* Correlation ids come from ``meristem.observability.correlation`` —
  the SAME cross-agent trace-correlation module the rest of the ecosystem
  uses to tie a request to its downstream arbora/engine calls. This module
  never mints its own id scheme; it binds the shared contextvar for the
  lifetime of one request/connection so every inner layer (authorization,
  identity, route handlers, and any outbound call the request triggers)
  observes and logs the same id.
* Text redaction reuses ``meristem.core.log_privacy.sanitize_log_text``
  (the same regex-based endpoint/path/host:port/email scrubber
  ``install_log_privacy_boundary`` applies to ``meristem.*`` loggers)
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

Configuration follows this repo's existing ``OVERSTORY_*`` bare-``os.getenv``
convention (see ``server.py``'s ``OVERSTORY_LOGFIRE_ENABLED`` /
``OVERSTORY_ACCESS_LOG_POLICY``) rather than adding a field to the shared
``meristem.core.config.AgentConfig`` — these flags are overstory
specific and meristem' own configuration-discipline rule reserves
``AgentConfig`` fields for values IT reads.

* ``OVERSTORY_LOG_LEVEL`` — ``DEBUG``/``INFO``/``WARNING``/``ERROR``/
  ``CRITICAL`` (default ``INFO``).
* ``OVERSTORY_LOG_FORMAT`` — ``json`` (default; one JSON object per line,
  fit for Loki/Alloy ingestion) or ``text`` (human-readable, for local dev).
"""

from __future__ import annotations

import json
import logging
import os
import re
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

_PACKAGE_LOGGER_NAME = 'overstory'
_LOG_LEVEL_ENV = 'OVERSTORY_LOG_LEVEL'
_LOG_FORMAT_ENV = 'OVERSTORY_LOG_FORMAT'
_HANDLER_MARKER = '_overstory_structured_handler'

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


_REDACTIONS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r'[a-zA-Z][a-zA-Z0-9+.-]*://[^\s\'"<>]+'), '<url>'),
    (re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+'), '<email>'),
    (re.compile(r'\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b'), '<host>'),
    (re.compile(r'\b[\w-]+(?:\.[\w-]+)+:\d{2,5}\b'), '<host>'),
    (re.compile(r'(?<![\w.])/(?:[\w.@-]+/)+[\w.@-]*'), '<path>'),
)


def sanitize_text(value: str) -> str:
    """Redact URL, email, host:port, IP and path-shaped text before logging."""
    text = str(value)
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


def current_correlation_id() -> str | None:
    """Return the ambient correlation id, if a request has bound one."""
    from .host import get_correlation_id

    return get_correlation_id()


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
    request to its server-side handling and to any downstream arbora
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

    @staticmethod
    def _record_extras(record: logging.LogRecord) -> dict[str, Any]:
        return {
            key: value
            for key, value in record.__dict__.items()
            if key not in _RESERVED_RECORD_ATTRS and not key.startswith('_')
        }

    @staticmethod
    def _record_exception_text(record: logging.LogRecord) -> str | None:
        if not record.exc_info:
            return None
        return sanitize_text(''.join(traceback.format_exception(*record.exc_info)))

    @staticmethod
    def _format_json(
        *,
        timestamp: str,
        record: logging.LogRecord,
        message: str,
        correlation_id: str | None,
        extras: dict[str, Any],
        exception_text: str | None,
    ) -> str:
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

    @staticmethod
    def _format_text(
        *,
        timestamp: str,
        record: logging.LogRecord,
        message: str,
        correlation_id: str | None,
        extras: dict[str, Any],
        exception_text: str | None,
    ) -> str:
        line = (
            f'{timestamp} {record.levelname:<8} {record.name} '
            f'correlation_id={correlation_id or "-"} {message}'
        )
        if extras:
            line += ' ' + ' '.join(f'{key}={value}' for key, value in extras.items())
        if exception_text:
            line += '\n' + exception_text
        return line

    def format(self, record: logging.LogRecord) -> str:
        message = record.getMessage()
        correlation_id = current_correlation_id()
        extras = self._record_extras(record)
        exception_text = self._record_exception_text(record)
        timestamp = self.formatTime(record, '%Y-%m-%dT%H:%M:%S')

        render = self._format_json if self._json_mode else self._format_text
        return render(
            timestamp=timestamp,
            record=record,
            message=message,
            correlation_id=correlation_id,
            extras=extras,
            exception_text=exception_text,
        )


def configure_logging() -> None:
    """Install one stdout handler on the ``overstory`` logger namespace.

    Idempotent — safe to call from every process entry point (module import,
    ``main()``, tests). Deliberately scoped to the ``overstory`` logger
    (not the root logger), so it never reformats uvicorn's own logging or
    ``meristem.*``'s privacy-boundary-covered logging — each keeps its
    own configuration; this only fixes overstory's own previously-silent
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
