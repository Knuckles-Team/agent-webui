"""Wiring test: ``get_engine()``'s auto-init fallback must construct through the
one sanctioned seam, never a hand-rolled backend.

CONCEPT:AU-ECO.ui.one-engine-authority

This pins the fix for D-WD-7: ``agent_webui.api_extensions.get_engine()``'s lazy
fallback used to call ``create_backend(backend_type='ladybug', db_path=...)``
directly and construct ``IntelligenceGraphEngine(...)`` itself — a SECOND
engine-construction path that, whenever it raced ahead of the MCP server's own
bootstrap (``kg_server._start_engine_bootstrap``) and won the process-wide
singleton, silently handed every webui route a disconnected, empty local
LadybugDB instead of the real operational graph. "Workflows shows nothing" was
the symptom; the divergent construction was the cause.

The test does not (and cannot, in a sandboxed unit run) assert that a full
engine stands up successfully — that would require live epistemic-graph
infrastructure and belongs to live-path validation, not this suite. What it
proves, per the Wire-First taxonomy, is the *edge*: the fallback branch reaches
``IntelligenceGraphEngine.get_or_create()`` (the same seam ``kg_server``'s own
bootstrap and every other sanctioned caller uses) and never reaches the
divergent ``create_backend(backend_type='ladybug', ...)`` path again — using a
pass-through wrap (``wraps=``) so the real implementation still runs, per *never
mock the seam you are validating*.
"""

from __future__ import annotations

import sys

import pytest
from fastapi import HTTPException


@pytest.fixture(autouse=True)
def _reset_active_engine():
    """Isolate the process-wide singleton so this test's fallback branch is
    actually exercised, regardless of what earlier tests in the same session
    left active."""
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine

    previous = IntelligenceGraphEngine.get_active()
    IntelligenceGraphEngine.set_active(None)
    try:
        yield
    finally:
        IntelligenceGraphEngine.set_active(previous)


def test_get_engine_fallback_reaches_get_or_create(monkeypatch):
    """The auto-init fallback must call ``IntelligenceGraphEngine.get_or_create()``.

    ``get_engine()`` special-cases a pytest/mocked environment and raises 501
    without attempting construction at all (so tests never accidentally stand
    up a real engine) — that guard is itself keyed off ``'pytest' in
    sys.modules``, which is unconditionally true inside this suite. To exercise
    the branch under test we lift that guard for the duration of one call, the
    same way production (which never imports pytest) sees it.
    """
    from agent_utilities.knowledge_graph.backends import create_backend
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine
    from agent_webui import api_extensions

    calls: list[tuple[tuple, dict]] = []
    real_get_or_create = IntelligenceGraphEngine.get_or_create.__func__

    def _recording_get_or_create(cls, *args, **kwargs):
        calls.append((args, kwargs))
        return real_get_or_create(cls, *args, **kwargs)

    monkeypatch.setattr(
        IntelligenceGraphEngine,
        'get_or_create',
        classmethod(_recording_get_or_create),
    )

    backend_type_calls: list[object] = []
    real_create_backend = create_backend

    def _recording_create_backend(*args, **kwargs):
        backend_type_calls.append(kwargs.get('backend_type', args[0] if args else None))
        return real_create_backend(*args, **kwargs)

    monkeypatch.setattr(
        'agent_utilities.knowledge_graph.backends.create_backend',
        _recording_create_backend,
    )

    monkeypatch.delitem(sys.modules, 'pytest', raising=False)
    try:
        try:
            api_extensions.get_engine()
        except HTTPException:
            # Construction may legitimately fail in this sandboxed unit run
            # (no live epistemic-graph infra) -- that is downstream of the
            # seam under test, per `past_the_seam`. The assertions below are
            # what this test actually pins.
            pass
    finally:
        sys.modules['pytest'] = pytest

    assert calls, (
        'get_engine() fallback did NOT reach IntelligenceGraphEngine.get_or_create() '
        '-- it regressed to a divergent, hand-rolled construction path (D-WD-7).'
    )
    assert calls[0][1].get('defer_background_start') is True, (
        'get_engine() must defer background start, matching every other '
        'sanctioned get_or_create() caller (D-03) -- omitting it would win the '
        'singleton race without the deferred-start invariant.'
    )
    assert 'ladybug' not in backend_type_calls, (
        'get_engine() fallback must never explicitly request a ladybug backend '
        '-- that is the exact divergence (a disconnected local LadybugDB standing '
        'in for the real operational graph) D-WD-7 was about.'
    )
