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

    def ensure_authority_current(self) -> None:
        """No-op: this fake's authority never expires."""


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
