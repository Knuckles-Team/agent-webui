"""Unit tests for :mod:`agent_webui.graph_admission`.

Covers the ordering/failure-mode/idempotency contract the module docstring
promises: a returning principal never re-triggers a round trip, a missing
tenant role fails closed with a distinct error, an unreachable engine fails
closed with a *different* distinct error, and concurrent admission attempts
for the same brand-new principal collapse into one admission call.
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Any

import pytest
from agent_webui import graph_admission
from agent_webui.graph_admission import (
    EngineAdmissionUnavailableError,
    TenantNotProvisionedError,
    ensure_tenant_admission,
)


class _FakeActor:
    def __init__(self, actor_id: str, *, authenticated: bool = False) -> None:
        self.actor_id = actor_id
        self.authenticated = authenticated

    def ensure_credential_current(self) -> None:
        """No-op: these fakes carry no expiring credential to revalidate."""


class _FakeSession:
    def __init__(self, tenant: str, *, actor: _FakeActor | None = None) -> None:
        self.tenant = tenant
        self.actor = actor
        self.graph = f'tenant__{tenant}____commons__'

    # `use_session`/`use_actor` revalidate at the ambient boundary, so a fake
    # bound there must answer the same two hooks a real GraphSession does.
    def __post_init__(self) -> None:
        """No-op: nothing to revalidate on a test double."""

    def ensure_authority_current(self, *, minimum_ttl_seconds: int = 0) -> None:
        """No-op: this fake's authority never expires.

        Accepts ``minimum_ttl_seconds`` (unused) to match the real
        `GraphSession.ensure_authority_current` signature, since
        `_service_authority`'s proactive renewal check calls it that way.
        """


class _FakeExpiringActor(_FakeActor):
    """A `_FakeActor` that also carries a controllable bounded expiry, the
    way a real service-authority actor does."""

    def __init__(
        self,
        actor_id: str,
        *,
        authenticated: bool = True,
        credential_expires_at: float | None = None,
    ) -> None:
        super().__init__(actor_id, authenticated=authenticated)
        self.credential_expires_at = credential_expires_at


class _FakeExpiringSession(_FakeSession):
    """A session whose `ensure_authority_current` actually enforces an
    expiry against a caller-controlled clock, the way the real
    `GraphSession` enforces it against `actor.credential_expires_at` --
    unlike `_FakeSession`, which never expires. Used by the
    `_service_authority` renewal tests below; ``now`` is an injected clock
    reading rather than the real one, so these tests need no real sleeping.
    """

    def __init__(self, tenant: str, *, actor: _FakeExpiringActor, now: float) -> None:
        super().__init__(tenant, actor=actor)
        # `_FakeSession.actor` is typed `_FakeActor | None`; keep a narrowly
        # typed reference to the actual `_FakeExpiringActor` here so
        # `credential_expires_at` type-checks without a cast/getattr.
        self._expiring_actor = actor
        self._now = now

    def ensure_authority_current(self, *, minimum_ttl_seconds: int = 0) -> None:
        from agent_utilities.knowledge_graph.core.session import (
            SessionExpiredError,
        )

        expiry = self._expiring_actor.credential_expires_at
        if expiry is not None and self._now + minimum_ttl_seconds >= expiry:
            raise SessionExpiredError('expired')


def _expiring_session(
    *, now: float, expires_at: float | None, tenant: str = 'homelab'
) -> _FakeExpiringSession:
    actor = _FakeExpiringActor('service-authority', credential_expires_at=expires_at)
    return _FakeExpiringSession(tenant, actor=actor, now=now)


@pytest.fixture(autouse=True)
def _reset_module_state():
    """Every test gets a clean cache and the in-process authority.

    The module-level dicts are process-lifetime state, so tests must not see
    each other's admissions. The ambient session is part of that reset: this
    dashboard runs as a graph-os co-service, whose thread carries graph-os's
    verified actor, and `_service_authority()` prefers exactly that — so the
    ambient authority IS the primary path under test, not a stand-in for one.
    """

    from agent_utilities.knowledge_graph.core import session as session_module

    graph_admission._ADMITTED.clear()
    graph_admission._FAILURES.clear()
    graph_admission._KEY_LOCKS.clear()
    graph_admission._SERVICE_SESSION = None

    ambient = _FakeSession(
        'homelab', actor=_FakeActor('graph-os:process', authenticated=True)
    )
    token = session_module._current.set(ambient)
    try:
        yield ambient
    finally:
        session_module._current.reset(token)
        graph_admission._ADMITTED.clear()
        graph_admission._FAILURES.clear()
        graph_admission._KEY_LOCKS.clear()
        graph_admission._SERVICE_SESSION = None


def _stub_role_exists(monkeypatch: pytest.MonkeyPatch, *, exists: bool) -> list[str]:
    calls: list[str] = []

    def _fake(tenant_slug: str) -> bool:
        calls.append(tenant_slug)
        return exists

    monkeypatch.setattr(graph_admission, '_tenant_role_exists', _fake)
    return calls


def _stub_admit(
    monkeypatch: pytest.MonkeyPatch, *, error: Exception | None = None
) -> list[tuple[str, str]]:
    calls: list[tuple[str, str]] = []

    def _fake(tenant_slug: str, agent_id: str) -> None:
        calls.append((tenant_slug, agent_id))
        if error is not None:
            raise error

    monkeypatch.setattr(graph_admission, '_admit', _fake)
    return calls


@pytest.mark.asyncio
async def test_new_principal_is_admitted_once(monkeypatch: pytest.MonkeyPatch) -> None:
    role_calls = _stub_role_exists(monkeypatch, exists=True)
    admit_calls = _stub_admit(monkeypatch)

    actor = _FakeActor('user-1')
    session = _FakeSession('homelab')

    await ensure_tenant_admission(actor, session)

    assert role_calls == ['homelab']
    assert admit_calls == [('homelab', 'user-1')]
    assert ('homelab', 'user-1') in graph_admission._ADMITTED


@pytest.mark.asyncio
async def test_returning_principal_never_round_trips_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The whole point of the cache: a second mint for the same principal
    does not touch the role-check or admission RPC at all."""

    role_calls = _stub_role_exists(monkeypatch, exists=True)
    admit_calls = _stub_admit(monkeypatch)

    actor = _FakeActor('user-1')
    session = _FakeSession('homelab')

    await ensure_tenant_admission(actor, session)
    await ensure_tenant_admission(actor, session)
    await ensure_tenant_admission(actor, session)

    assert role_calls == ['homelab']
    assert admit_calls == [('homelab', 'user-1')]


@pytest.mark.asyncio
async def test_distinct_principals_are_admitted_independently(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    role_calls = _stub_role_exists(monkeypatch, exists=True)
    admit_calls = _stub_admit(monkeypatch)

    await ensure_tenant_admission(_FakeActor('user-1'), _FakeSession('homelab'))
    await ensure_tenant_admission(_FakeActor('user-2'), _FakeSession('homelab'))

    assert role_calls == ['homelab', 'homelab']
    assert sorted(admit_calls) == [('homelab', 'user-1'), ('homelab', 'user-2')]


@pytest.mark.asyncio
async def test_missing_tenant_role_fails_closed_distinctly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Never silently registers a principal into a role that grants nothing."""

    _stub_role_exists(monkeypatch, exists=False)
    admit_calls = _stub_admit(monkeypatch)

    with pytest.raises(TenantNotProvisionedError, match='homelab'):
        await ensure_tenant_admission(_FakeActor('user-1'), _FakeSession('homelab'))

    assert admit_calls == [], (
        'must never call register_identity for an unprovisioned role'
    )


@pytest.mark.asyncio
async def test_engine_unreachable_at_role_check_is_a_distinct_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _boom(_tenant_slug: str) -> bool:
        raise EngineAdmissionUnavailableError('engine unreachable')

    monkeypatch.setattr(graph_admission, '_tenant_role_exists', _boom)
    admit_calls = _stub_admit(monkeypatch)

    with pytest.raises(EngineAdmissionUnavailableError):
        await ensure_tenant_admission(_FakeActor('user-1'), _FakeSession('homelab'))

    assert admit_calls == []


@pytest.mark.asyncio
async def test_probe_denied_for_insufficient_privilege_falls_through_to_admit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The live-diagnosed shape: the probe (``rbac.list()``) is gated on
    ``security:admin``, which this deployment's principal does not hold, even
    though it CAN perform the admission itself. 'I can't look' must not be
    treated as 'I can't admit' — admission is attempted anyway and succeeds."""

    def _denied(_tenant_slug: str) -> bool:
        # Reproduces the exact wrapped shape `_tenant_role_exists` produces:
        # an `EngineAdmissionUnavailableError` whose `__cause__` chain (not
        # its own top-level message) carries the engine's admin-capability
        # denial text.
        cause = RuntimeError(
            'ACCESS_DENIED: verified principal lacks admin capability '
            "required for 'security:admin'"
        )
        wrapped = EngineAdmissionUnavailableError(
            "could not verify engine RBAC role 'tenant:homelab': "
            'engine rbac.list() failed'
        )
        wrapped.__cause__ = cause
        raise wrapped

    monkeypatch.setattr(graph_admission, '_tenant_role_exists', _denied)
    admit_calls = _stub_admit(monkeypatch)

    await ensure_tenant_admission(_FakeActor('user-1'), _FakeSession('homelab'))

    assert admit_calls == [('homelab', 'user-1')]
    assert ('homelab', 'user-1') in graph_admission._ADMITTED


def test_admin_capability_denied_matches_only_the_specific_denial() -> None:
    """Never matches a network error, an unrelated ACCESS_DENIED (a scope
    failure is a DIFFERENT message from a DIFFERENT check), or a bare
    message with no chain — only the engine's specific admin-capability
    text, anywhere in the `__cause__` chain."""

    admin_denied = RuntimeError(
        'ACCESS_DENIED: verified principal lacks admin capability required '
        "for 'security:admin'"
    )
    wrapped = EngineAdmissionUnavailableError('could not verify engine RBAC role')
    wrapped.__cause__ = admin_denied
    assert graph_admission._admin_capability_denied(wrapped) is True

    unreachable = EngineAdmissionUnavailableError('engine unreachable')
    unreachable.__cause__ = ConnectionError('connection refused')
    assert graph_admission._admin_capability_denied(unreachable) is False

    scope_denied = EngineAdmissionUnavailableError('denied')
    scope_denied.__cause__ = RuntimeError('lacks required scope')
    assert graph_admission._admin_capability_denied(scope_denied) is False

    assert graph_admission._admin_capability_denied(None) is False


@pytest.mark.asyncio
async def test_probe_denied_for_privilege_then_admit_fails_is_still_actionable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the probe cannot run and the fallback admission itself fails
    (standing in for a genuinely unprovisioned tenant, or any other admit
    failure), the error must stay specific — naming the tenant and agent —
    never collapse into an unhelpful generic failure."""

    def _denied(_tenant_slug: str) -> bool:
        cause = RuntimeError(
            'ACCESS_DENIED: verified principal lacks admin capability '
            "required for 'security:admin'"
        )
        wrapped = EngineAdmissionUnavailableError('could not verify engine RBAC role')
        wrapped.__cause__ = cause
        raise wrapped

    monkeypatch.setattr(graph_admission, '_tenant_role_exists', _denied)
    _stub_admit(
        monkeypatch,
        error=EngineAdmissionUnavailableError(
            "engine admission failed for 'user-1' in tenant 'homelab': "
            'ACCESS_DENIED: unknown tenant'
        ),
    )

    with pytest.raises(EngineAdmissionUnavailableError, match='user-1') as excinfo:
        await ensure_tenant_admission(_FakeActor('user-1'), _FakeSession('homelab'))

    assert 'homelab' in str(excinfo.value)
    assert ('homelab', 'user-1') not in graph_admission._ADMITTED
    # And the failure is cached/backed off exactly like any other failure.
    key = ('homelab', 'user-1')
    assert key in graph_admission._FAILURES


@pytest.mark.asyncio
async def test_probe_denied_for_privilege_respects_cache_and_backoff(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The privilege-denial fallback must not bypass the existing cache/
    backoff contract: a successful admission is still cached forever, and a
    failed one still backs off rather than re-probing every request."""

    probe_calls: list[str] = []

    def _denied(tenant_slug: str) -> bool:
        probe_calls.append(tenant_slug)
        cause = RuntimeError(
            'ACCESS_DENIED: verified principal lacks admin capability '
            "required for 'security:admin'"
        )
        wrapped = EngineAdmissionUnavailableError('could not verify engine RBAC role')
        wrapped.__cause__ = cause
        raise wrapped

    monkeypatch.setattr(graph_admission, '_tenant_role_exists', _denied)
    admit_calls = _stub_admit(monkeypatch)

    actor = _FakeActor('user-1')
    session = _FakeSession('homelab')
    await ensure_tenant_admission(actor, session)
    await ensure_tenant_admission(actor, session)
    await ensure_tenant_admission(actor, session)

    assert probe_calls == ['homelab'], 'a cached success must never re-probe'
    assert admit_calls == [('homelab', 'user-1')]


@pytest.mark.asyncio
async def test_engine_unreachable_at_admit_is_a_distinct_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _stub_role_exists(monkeypatch, exists=True)
    _stub_admit(monkeypatch, error=EngineAdmissionUnavailableError('down'))

    with pytest.raises(EngineAdmissionUnavailableError):
        await ensure_tenant_admission(_FakeActor('user-1'), _FakeSession('homelab'))

    assert ('homelab', 'user-1') not in graph_admission._ADMITTED


@pytest.mark.asyncio
async def test_failure_is_backed_off_not_retried_every_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A still-broken precondition must not cost a round trip on every
    request — see the module's 'cheap' requirement."""

    role_calls = _stub_role_exists(monkeypatch, exists=False)
    actor = _FakeActor('user-1')
    session = _FakeSession('homelab')

    with pytest.raises(TenantNotProvisionedError):
        await ensure_tenant_admission(actor, session)
    with pytest.raises(TenantNotProvisionedError):
        await ensure_tenant_admission(actor, session)

    assert role_calls == ['homelab'], (
        'second attempt must be served from the backoff cache'
    )


@pytest.mark.asyncio
async def test_failure_backoff_expires_and_retries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    role_calls = _stub_role_exists(monkeypatch, exists=False)
    actor = _FakeActor('user-1')
    session = _FakeSession('homelab')

    with pytest.raises(TenantNotProvisionedError):
        await ensure_tenant_admission(actor, session)

    # Simulate the backoff window having elapsed.
    key = ('homelab', 'user-1')
    attempted_at, exc = graph_admission._FAILURES[key]
    graph_admission._FAILURES[key] = (
        attempted_at - graph_admission._FAILURE_BACKOFF_SECONDS - 1,
        exc,
    )

    with pytest.raises(TenantNotProvisionedError):
        await ensure_tenant_admission(actor, session)

    assert role_calls == ['homelab', 'homelab']


@pytest.mark.asyncio
async def test_concurrent_admission_for_new_principal_collapses_to_one_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two requests racing for the same brand-new principal must not both
    pay for a role-check + admission round trip."""

    role_calls: list[str] = []
    admit_calls: list[tuple[str, str]] = []
    barrier = threading.Barrier(2, timeout=5)
    entered = threading.Event()

    def _fake_role_exists(tenant_slug: str) -> bool:
        # Only the first caller through the lock reaches here; prove that
        # by making the second caller's arrival (if it got in concurrently)
        # observable via the barrier below.
        entered.set()
        role_calls.append(tenant_slug)
        return True

    def _fake_admit(tenant_slug: str, agent_id: str) -> None:
        admit_calls.append((tenant_slug, agent_id))

    monkeypatch.setattr(graph_admission, '_tenant_role_exists', _fake_role_exists)
    monkeypatch.setattr(graph_admission, '_admit', _fake_admit)

    actor = _FakeActor('user-1')
    session = _FakeSession('homelab')

    await asyncio.gather(
        ensure_tenant_admission(actor, session),
        ensure_tenant_admission(actor, session),
    )

    assert role_calls == ['homelab']
    assert admit_calls == [('homelab', 'user-1')]
    _ = barrier


@pytest.mark.asyncio
async def test_missing_actor_id_is_a_no_op(monkeypatch: pytest.MonkeyPatch) -> None:
    role_calls = _stub_role_exists(monkeypatch, exists=True)
    admit_calls = _stub_admit(monkeypatch)

    await ensure_tenant_admission(_FakeActor(''), _FakeSession('homelab'))

    assert role_calls == []
    assert admit_calls == []


@pytest.mark.asyncio
async def test_missing_tenant_is_a_no_op(monkeypatch: pytest.MonkeyPatch) -> None:
    role_calls = _stub_role_exists(monkeypatch, exists=True)
    admit_calls = _stub_admit(monkeypatch)

    await ensure_tenant_admission(_FakeActor('user-1'), _FakeSession(''))

    assert role_calls == []
    assert admit_calls == []


def test_tenant_role_exists_wraps_unexpected_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The real (non-stubbed) implementation must convert ANY failure from
    the engine client into EngineAdmissionUnavailableError — never let a raw
    engine/transport exception escape this module's boundary."""

    class _ExplodingClient:
        def existing_roles(self) -> set[str]:
            raise RuntimeError('socket error')

    monkeypatch.setattr(
        'agent_utilities.knowledge_graph.maintenance.graph_ownership_apply.'
        'resolve_rbac_admin_client',
        lambda: _ExplodingClient(),
    )

    with pytest.raises(EngineAdmissionUnavailableError):
        graph_admission._tenant_role_exists('homelab')


def test_admit_wraps_unexpected_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError('no provisioner credential')

    monkeypatch.setattr(
        'agent_utilities.security.tenant_admission_cli.run_tenant_admission',
        _boom,
    )

    with pytest.raises(EngineAdmissionUnavailableError):
        graph_admission._admit('homelab', 'user-1')


def test_admit_fails_closed_when_result_reports_incomplete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _IncompleteResult:
        all_admitted = False

    monkeypatch.setattr(
        'agent_utilities.security.tenant_admission_cli.run_tenant_admission',
        lambda *_a, **_k: _IncompleteResult(),
    )

    with pytest.raises(EngineAdmissionUnavailableError):
        graph_admission._admit('homelab', 'user-1')


def test_tenant_role_exists_delegates_to_rbac_admin_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Wiring proof: the real implementation reuses the established
    ``resolve_rbac_admin_client``/``existing_roles`` precedent rather than a
    second hand-rolled RBAC read."""

    class _Client:
        def existing_roles(self) -> set[str]:
            return {'tenant:homelab', 'some-other-role'}

    monkeypatch.setattr(
        'agent_utilities.knowledge_graph.maintenance.graph_ownership_apply.'
        'resolve_rbac_admin_client',
        lambda: _Client(),
    )

    assert graph_admission._tenant_role_exists('homelab') is True
    assert graph_admission._tenant_role_exists('some-other-tenant') is False


def test_admit_delegates_to_run_tenant_admission_with_apply_true(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    class _Result:
        all_admitted = True

    def _fake_run_tenant_admission(
        tenant_slug: str, principals: list[Any], *, apply: bool = False
    ) -> Any:
        calls.append(
            {
                'tenant_slug': tenant_slug,
                'agent_ids': [p.agent_id for p in principals],
                'roles': [p.role for p in principals],
                'apply': apply,
            }
        )
        return _Result()

    monkeypatch.setattr(
        'agent_utilities.security.tenant_admission_cli.run_tenant_admission',
        _fake_run_tenant_admission,
    )

    graph_admission._admit('homelab', 'user-1')

    assert calls == [
        {
            'tenant_slug': 'homelab',
            'agent_ids': ['user-1'],
            'roles': ['Agent'],
            'apply': True,
        }
    ]


# ---------------------------------------------------------------------------
# LANE 8: `_service_authority` proactive/reactive renewal + concurrency.
#
# `_reset_module_state` already binds a fake ambient session for every test
# above, which is why those tests never touch `_service_authority`'s renewal
# path at all (the ambient branch of `_mint_service_authority` short-circuits
# before any credential/expiry logic runs). The tests below drive
# `_service_authority`/`ensure_tenant_admission` directly against a
# controllable, expiring session so the renewal behavior itself is covered
# independent of which branch of `_mint_service_authority` produced it.
# ---------------------------------------------------------------------------


def test_service_authority_remints_a_session_past_its_expiry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A cached session whose bounded credential has already run out (or is
    within the renewal margin) is replaced, not reused."""

    stale = _expiring_session(now=1_000_000, expires_at=1_000_000 - 1)
    fresh = _expiring_session(now=1_000_000, expires_at=1_000_000 + 3_600)
    graph_admission._SERVICE_SESSION = stale

    mint_calls: list[None] = []

    def _fake_mint() -> Any:
        mint_calls.append(None)
        return fresh

    monkeypatch.setattr(graph_admission, '_mint_service_authority', _fake_mint)

    result = graph_admission._service_authority()

    assert result is fresh
    assert len(mint_calls) == 1


def test_service_authority_remints_when_within_the_renewal_margin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Proactive renewal fires BEFORE the hard expiry, once fewer than
    `_SERVICE_AUTHORITY_RENEWAL_MARGIN_SECONDS` remain -- not only after the
    credential has actually expired."""

    margin = graph_admission._SERVICE_AUTHORITY_RENEWAL_MARGIN_SECONDS
    about_to_expire = _expiring_session(
        now=1_000_000, expires_at=1_000_000 + (margin - 1)
    )
    fresh = _expiring_session(now=1_000_000, expires_at=1_000_000 + 3_600)
    graph_admission._SERVICE_SESSION = about_to_expire

    mint_calls: list[None] = []

    def _fake_mint() -> Any:
        mint_calls.append(None)
        return fresh

    monkeypatch.setattr(graph_admission, '_mint_service_authority', _fake_mint)

    assert graph_admission._service_authority() is fresh
    assert len(mint_calls) == 1


def test_service_authority_reuses_a_session_comfortably_within_ttl(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A session with plenty of TTL left is reused as-is -- proving the fix
    does not replace the old always-cache bug with a mint-storm on every
    call."""

    current = _expiring_session(now=1_000_000, expires_at=1_000_000 + 3_600)
    graph_admission._SERVICE_SESSION = current

    def _must_not_mint() -> Any:
        raise AssertionError(
            'must not mint while the cached session is still comfortably current'
        )

    monkeypatch.setattr(graph_admission, '_mint_service_authority', _must_not_mint)

    for _ in range(5):
        assert graph_admission._service_authority() is current


def test_service_authority_concurrent_expired_callers_mint_exactly_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """N callers racing an expired cached session must produce exactly one
    mint, with every caller ending up on the SAME fresh session -- not one
    mint per racing thread.

    Real `threading.Thread`s (not asyncio tasks) so the module's actual
    `threading.Lock` is what is under test, not cooperative scheduling.
    """

    stale = _expiring_session(now=1_000_000, expires_at=1_000_000 - 1)
    fresh = _expiring_session(now=1_000_000, expires_at=1_000_000 + 3_600)
    graph_admission._SERVICE_SESSION = stale

    mint_calls: list[None] = []
    mint_calls_lock = threading.Lock()

    def _slow_mint() -> Any:
        # A real network mint is slow; sleeping here (releasing the GIL)
        # gives every other blocked thread a chance to queue up on
        # `_SERVICE_SESSION_LOCK` while this one is "in flight" -- if the
        # lock did not serialize them, more than one would reach here.
        time.sleep(0.02)
        with mint_calls_lock:
            mint_calls.append(None)
        return fresh

    monkeypatch.setattr(graph_admission, '_mint_service_authority', _slow_mint)

    results: list[Any] = []
    results_lock = threading.Lock()

    def _call() -> None:
        session = graph_admission._service_authority()
        with results_lock:
            results.append(session)

    threads = [threading.Thread(target=_call) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)

    assert len(mint_calls) == 1, 'concurrent expired callers must mint exactly once'
    assert len(results) == 8
    assert all(result is fresh for result in results)


def test_session_expired_cause_matches_only_session_expiry() -> None:
    """Mirrors `test_admin_capability_denied_matches_only_the_specific_denial`
    for the reactive-retry gate: only a `SessionExpiredError` anywhere in the
    chain counts, never a network error or a genuine authorization denial."""

    from agent_utilities.knowledge_graph.core.session import SessionExpiredError

    expired = EngineAdmissionUnavailableError('engine admission failed')
    expired.__cause__ = SessionExpiredError('expired')
    assert graph_admission._session_expired_cause(expired) is True

    denied = EngineAdmissionUnavailableError('engine admission failed')
    denied.__cause__ = RuntimeError(
        'ACCESS_DENIED: verified principal lacks Write access to graph '
        "'tenant__homelab____commons__'"
    )
    assert graph_admission._session_expired_cause(denied) is False

    unreachable = EngineAdmissionUnavailableError('engine unreachable')
    unreachable.__cause__ = ConnectionError('connection refused')
    assert graph_admission._session_expired_cause(unreachable) is False

    assert graph_admission._session_expired_cause(None) is False


@pytest.mark.asyncio
async def test_genuine_denial_is_not_retried_into_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A real ACCESS_DENIED from the engine (never a `SessionExpiredError`)
    must propagate as a failure -- it must never be mistaken for a
    stale-session race and silently retried into a false success."""

    _stub_role_exists(monkeypatch, exists=True)

    denial = EngineAdmissionUnavailableError("engine admission failed for 'user-1'")
    denial.__cause__ = RuntimeError(
        'ACCESS_DENIED: verified principal lacks Write access to graph '
        "'tenant__homelab____commons__'"
    )
    admit_calls = _stub_admit(monkeypatch, error=denial)

    with pytest.raises(EngineAdmissionUnavailableError):
        await ensure_tenant_admission(_FakeActor('user-1'), _FakeSession('homelab'))

    assert admit_calls == [('homelab', 'user-1')], (
        'a genuine denial must be attempted exactly once, never retried'
    )
    assert ('homelab', 'user-1') not in graph_admission._ADMITTED


@pytest.mark.asyncio
async def test_session_expired_failure_is_retried_once_and_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The reactive fallback: a `SessionExpiredError`-caused failure re-mints
    the service authority and retries the SAME admission attempt once,
    bypassing the negative-outcome backoff cache for that one retry -- the
    failure reflects OUR stale credential, not the tenant's or engine's
    state, so it must not be treated like a genuine provisioning/infra
    failure (which would otherwise make the retry immediately re-raise the
    very exception it exists to recover from)."""

    from agent_utilities.knowledge_graph.core.session import SessionExpiredError

    _stub_role_exists(monkeypatch, exists=True)

    attempts: list[None] = []

    def _flaky_admit(tenant_slug: str, agent_id: str) -> None:
        attempts.append(None)
        if len(attempts) == 1:
            wrapped = EngineAdmissionUnavailableError('engine admission failed')
            wrapped.__cause__ = SessionExpiredError('expired mid-call')
            raise wrapped
        # Second attempt (after the re-mint below) succeeds.

    monkeypatch.setattr(graph_admission, '_admit', _flaky_admit)

    sessions = [
        _FakeSession(
            'homelab', actor=_FakeActor('graph-os:process', authenticated=True)
        ),
        _FakeSession(
            'homelab', actor=_FakeActor('graph-os:process', authenticated=True)
        ),
    ]
    mint_calls: list[None] = []

    def _fake_mint() -> Any:
        mint_calls.append(None)
        return sessions[len(mint_calls) - 1]

    monkeypatch.setattr(graph_admission, '_mint_service_authority', _fake_mint)

    await ensure_tenant_admission(_FakeActor('user-1'), _FakeSession('homelab'))

    assert len(attempts) == 2, 'must retry exactly once after a session-expiry failure'
    assert len(mint_calls) == 2, 'must re-mint before the retry'
    assert ('homelab', 'user-1') in graph_admission._ADMITTED


@pytest.mark.asyncio
async def test_session_expired_retry_happens_at_most_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A retry that ALSO fails on session expiry must propagate rather than
    loop -- proves this is a single bounded retry, not a retry-until-success
    loop that could hide a persistently broken renewal path."""

    from agent_utilities.knowledge_graph.core.session import SessionExpiredError

    _stub_role_exists(monkeypatch, exists=True)

    attempts: list[None] = []

    def _always_expired(tenant_slug: str, agent_id: str) -> None:
        attempts.append(None)
        wrapped = EngineAdmissionUnavailableError('engine admission failed')
        wrapped.__cause__ = SessionExpiredError('expired mid-call')
        raise wrapped

    monkeypatch.setattr(graph_admission, '_admit', _always_expired)

    # One mint feeds the FIRST `ensure_tenant_admission` attempt (module cache
    # starts empty per-test); the reactive fallback then mints exactly once
    # more for its single retry. If the retry itself looped, this would be
    # called a third time.
    mint_calls: list[None] = []

    def _fake_mint() -> Any:
        mint_calls.append(None)
        return _FakeSession(
            'homelab', actor=_FakeActor('graph-os:process', authenticated=True)
        )

    monkeypatch.setattr(graph_admission, '_mint_service_authority', _fake_mint)

    with pytest.raises(EngineAdmissionUnavailableError):
        await ensure_tenant_admission(_FakeActor('user-1'), _FakeSession('homelab'))

    assert len(attempts) == 2, 'the initial attempt plus exactly one retry, never more'
    assert len(mint_calls) == 2, (
        'the initial mint plus exactly one re-mint for the retry, never a loop'
    )
    assert ('homelab', 'user-1') not in graph_admission._ADMITTED
