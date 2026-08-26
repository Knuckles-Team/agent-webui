"""Contract tests for the WebUI's unrouted graph-session minter.

The point of these tests is drift: :func:`agent_webui.graph_identity.
mint_frontend_graph_session` deliberately restates the *authority* half of
``agent_utilities.security.request_identity._mint_graph_session`` while
dropping its engine placement round-trip. If the shared minter ever changes how
it derives tenant, graph, scopes, policy revision or audience, the equivalence
test below must fail rather than let the two silently diverge.
"""

from __future__ import annotations

import logging

import pytest
from agent_utilities.knowledge_graph.core import placement_catalog as _placement_catalog
from agent_utilities.knowledge_graph.core.shard_topology import (
    default_graph_name,
    tenant_graph_name,
)
from agent_utilities.security import request_identity as _shared
from agent_utilities.security.brain_context import ActorContext
from agent_webui.graph_identity import (
    frontend_accessible_graphs,
    mint_frontend_graph_session,
)

AUDIENCE = 'agent-services'
POLICY = 'homelab-v1'


@pytest.fixture(autouse=True)
def _server_authority(monkeypatch: pytest.MonkeyPatch) -> None:
    """Supply the server-side audience/policy inputs both minters read."""

    from agent_utilities.core.config import config

    monkeypatch.setattr(config, 'auth_jwt_audience', AUDIENCE, raising=False)
    monkeypatch.setattr(config, 'mcp_jwt_audience', '', raising=False)
    monkeypatch.setattr(config, 'kg_policy_version', POLICY, raising=False)
    # An EXPLICIT engine topology, so the shared minter takes its connect-only
    # path instead of trying to autostart a local engine. The endpoint is never
    # dialled: every test either stubs ``resolve_placement`` or never reaches it.
    monkeypatch.setattr(
        config, 'graph_service_endpoints', ['tls://engine.invalid:9100'], raising=False
    )


def _actor(
    *roles: str, tenant: str = 'homelab', subject: str = 'subject-1'
) -> ActorContext:
    return ActorContext(
        actor_id=subject,
        tenant_id=tenant,
        roles=frozenset(roles),
        authenticated=True,
    )


@pytest.mark.parametrize(
    'roles',
    [
        ('kg:read',),
        ('kg:write',),
        ('kg:admin',),
        ('kg:read', 'kg:write'),
        ('kg:read', 'unrelated-application-role'),
    ],
)
def test_authority_matches_the_shared_minter(
    roles: tuple[str, ...], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every authority field is identical; only the route differs."""

    def _fake_resolve_placement(
        *_args: object, **_kwargs: object
    ) -> _placement_catalog.PlacementResult:
        return _placement_catalog.PlacementResult(
            endpoint='tls://engine.invalid:9100',
            epoch=7,
            group=3,
            fencing_token=3,
            placed=True,
        )

    monkeypatch.setattr(
        _placement_catalog, 'resolve_placement', _fake_resolve_placement
    )

    actor = _actor(*roles)
    shared = _shared.mint_graph_session(actor)
    frontend = mint_frontend_graph_session(actor)

    assert frontend.actor is shared.actor
    assert frontend.tenant == shared.tenant
    assert frontend.scopes == shared.scopes
    assert frontend.graph == shared.graph
    assert frontend.policy_version == shared.policy_version
    assert frontend.audience == shared.audience
    assert frontend.trace_context  # correlation id is always populated


def test_frontend_session_binds_no_engine_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The whole point: no placement RPC, and no route on the session."""

    def _explode(*_args: object, **_kwargs: object) -> None:
        raise AssertionError(
            'a thin frontend must not resolve engine placement to authenticate'
        )

    monkeypatch.setattr(_placement_catalog, 'resolve_placement', _explode)

    session = mint_frontend_graph_session(_actor('kg:read', 'kg:write'))

    assert session.endpoint is None
    assert session.placement_group is None
    assert session.catalog_epoch is None


def test_scope_hierarchy_is_expanded() -> None:
    assert mint_frontend_graph_session(_actor('kg:admin')).scopes == frozenset(
        {'kg:admin', 'kg:write', 'kg:read'}
    )
    assert mint_frontend_graph_session(_actor('kg:write')).scopes == frozenset(
        {'kg:write', 'kg:read'}
    )
    assert mint_frontend_graph_session(_actor('kg:read')).scopes == frozenset(
        {'kg:read'}
    )


def test_non_graph_roles_never_become_scopes() -> None:
    """A generic ``admin`` realm role is deliberately NOT equivalent to the
    explicit ``kg:admin`` capability (this file's own established
    distinction — see ``_GRAPH_AUTH_SCOPES``'s docstring). This actor still
    lands on the AUTHZ LANE B default floor (``kg:read``) because it has no
    ``kg:*`` claim at all — never zero, and never more than read."""

    session = mint_frontend_graph_session(_actor('admin', 'offline_access'))
    assert session.scopes == frozenset({'kg:read'})


# --- AUTHZ LANE B: default kg:read + durable admin elevation --------------


def test_authority_diverges_from_shared_minter_only_in_default_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The one deliberate divergence from the shared minter: a verified
    human with no ``kg:*`` claim at all gets ``kg:read`` here (never
    nothing), while the shared (routed) minter is untouched by this lane and
    still produces empty scopes for the same input. Every OTHER authority
    field still matches exactly."""

    def _fake_resolve_placement(
        *_args: object, **_kwargs: object
    ) -> _placement_catalog.PlacementResult:
        return _placement_catalog.PlacementResult(
            endpoint='tls://engine.invalid:9100',
            epoch=7,
            group=3,
            fencing_token=3,
            placed=True,
        )

    monkeypatch.setattr(
        _placement_catalog, 'resolve_placement', _fake_resolve_placement
    )

    actor = _actor()  # no roles at all
    shared = _shared.mint_graph_session(actor)
    frontend = mint_frontend_graph_session(actor)

    assert shared.scopes == frozenset(), 'the shared minter is unchanged by this lane'
    assert frontend.scopes == frozenset({'kg:read'})
    assert frontend.tenant == shared.tenant
    assert frontend.graph == shared.graph
    assert frontend.policy_version == shared.policy_version
    assert frontend.audience == shared.audience


def test_default_scope_for_verified_human_with_no_special_claims() -> None:
    """Requirement 1: a verified human is admitted with `kg:read`, not a
    role that grants nothing — never admin."""

    session = mint_frontend_graph_session(_actor())
    assert session.scopes == frozenset({'kg:read'})
    assert 'kg:admin' not in session.scopes
    assert 'kg:write' not in session.scopes


def test_admin_claim_from_token_is_the_intended_long_term_path() -> None:
    """A real IdP `kg:admin` realm role already flows through with no
    allowlist involved — path (a) in the module docstring."""

    session = mint_frontend_graph_session(_actor('kg:admin'))
    assert session.scopes == frozenset({'kg:admin', 'kg:read', 'kg:write'})
    assert 'kg:admin' in session.actor.roles


def test_configured_allowlist_elevates_the_named_principal_to_admin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Requirement 3: the one specific principal in the configured allowlist
    is admitted WITH admin — via the bootstrap escape hatch, path (b)."""

    monkeypatch.setenv(
        'KG_ADMIN_PRINCIPAL_IDS', '9343d67e-369b-4e09-bf9d-50bb80565fe4, other-id'
    )

    session = mint_frontend_graph_session(
        _actor(subject='9343d67e-369b-4e09-bf9d-50bb80565fe4')
    )

    assert session.scopes == frozenset({'kg:admin', 'kg:read', 'kg:write'})
    # Both gates must see it: `rbac.resolve_webui_role` reads the actor's raw
    # roles directly, independent of `session.scopes` — see the module
    # docstring on why the effective actor is augmented, not just the scopes.
    assert 'kg:admin' in session.actor.roles


def test_configured_allowlist_never_touches_the_verified_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The augmentation is WebUI-local: the original actor object passed in
    is never mutated (it's frozen) and other roles the token DID carry
    survive alongside the added `kg:admin`."""

    monkeypatch.setenv('KG_ADMIN_PRINCIPAL_IDS', 'admin-principal')

    original = _actor('some-other-claim', subject='admin-principal')
    session = mint_frontend_graph_session(original)

    assert original.roles == frozenset({'some-other-claim'})  # untouched
    assert 'some-other-claim' in session.actor.roles
    assert 'kg:admin' in session.actor.roles
    assert session.actor is not original  # a new, augmented copy was used


def test_principal_not_in_allowlist_and_without_claim_never_becomes_admin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Requirement: never admin unless allowlisted or genuinely claimed —
    including when the allowlist is configured for a DIFFERENT principal."""

    monkeypatch.setenv('KG_ADMIN_PRINCIPAL_IDS', 'some-other-principal')

    session = mint_frontend_graph_session(_actor(subject='not-the-admin'))

    assert session.scopes == frozenset({'kg:read'})
    assert 'kg:admin' not in session.actor.roles


def test_unconfigured_allowlist_never_grants_admin_to_anyone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv('KG_ADMIN_PRINCIPAL_IDS', raising=False)

    session = mint_frontend_graph_session(
        _actor(subject='9343d67e-369b-4e09-bf9d-50bb80565fe4')
    )

    assert session.scopes == frozenset({'kg:read'})
    assert 'kg:admin' not in session.actor.roles


def test_forged_claim_on_a_non_allowlisted_principal_is_not_admin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A non-``kg:admin`` claim that merely LOOKS privileged (e.g. an
    attacker-controlled string that happens to read 'admin') must never be
    treated as the explicit `kg:admin` capability, and the allowlist check
    is keyed on the verified `actor_id` alone — never on anything else the
    actor carries."""

    monkeypatch.setenv('KG_ADMIN_PRINCIPAL_IDS', 'the-real-admin')

    forged = _actor('admin', 'kg-admin', 'KG:ADMIN', subject='attacker-id')
    session = mint_frontend_graph_session(forged)

    assert 'kg:admin' not in session.scopes
    assert 'kg:admin' not in session.actor.roles
    assert session.scopes == frozenset({'kg:read'})


def test_admin_elevation_is_durable_across_repeated_minting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """THE LOAD-BEARING DURABILITY TEST.

    `graph_admission.py`'s engine-side admission is vulnerable to
    `RegisterIdentity` replacing a principal's whole role set on
    re-registration, because it treats a grant as something to persist and
    later trust back. This module's admin elevation cannot suffer that
    failure mode BY CONSTRUCTION: it is derived fresh from the verified
    actor + live config on every single call, never cached, never read back
    from a mutable store. Simulate two independent "sign-ins" (repeated
    calls, as a re-registration/restart/cache-clear would produce) and
    prove the elevation survives identically both times — with nothing in
    between that could have "preserved" it, because nothing was stored.
    """

    monkeypatch.setenv('KG_ADMIN_PRINCIPAL_IDS', '9343d67e-369b-4e09-bf9d-50bb80565fe4')
    subject = '9343d67e-369b-4e09-bf9d-50bb80565fe4'

    first = mint_frontend_graph_session(_actor(subject=subject))
    # A brand-new ActorContext each time, exactly like a fresh sign-in would
    # produce — nothing here shares state with `first`.
    second = mint_frontend_graph_session(_actor(subject=subject))

    for session in (first, second):
        assert session.scopes == frozenset({'kg:admin', 'kg:read', 'kg:write'})
        assert 'kg:admin' in session.actor.roles


def test_unauthenticated_actor_is_refused() -> None:
    actor = ActorContext(actor_id='subject-1', tenant_id='homelab', authenticated=False)
    with pytest.raises(PermissionError):
        mint_frontend_graph_session(actor)


def test_missing_tenant_claim_is_refused() -> None:
    actor = ActorContext(actor_id='subject-1', tenant_id='', authenticated=True)
    with pytest.raises(PermissionError):
        mint_frontend_graph_session(actor)


def test_missing_subject_is_refused() -> None:
    actor = ActorContext(actor_id='   ', tenant_id='homelab', authenticated=True)
    with pytest.raises(PermissionError):
        mint_frontend_graph_session(actor)


def test_missing_server_policy_revision_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agent_utilities.core.config import config

    monkeypatch.setattr(config, 'kg_policy_version', '', raising=False)
    with pytest.raises(PermissionError):
        mint_frontend_graph_session(_actor('kg:read'))


def test_missing_server_audience_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    from agent_utilities.core.config import config

    monkeypatch.setattr(config, 'auth_jwt_audience', '', raising=False)
    monkeypatch.setattr(config, 'mcp_jwt_audience', '', raising=False)
    with pytest.raises(PermissionError):
        mint_frontend_graph_session(_actor('kg:read'))


# --- D-TGS-1: tenant-graph-scoping divergence (webui REST vs MCP) ----------
#
# Regression coverage for the measured divergence: same bearer, same moment,
# `MATCH (n) RETURN count(n)` returned 25,116 over the webui REST session but
# 56,853 over MCP; `MATCH (t:Tool) RETURN count(t)` returned 0 vs 2,941. Root
# cause: `session.graph` is (correctly) pinned to the actor's own tenant
# shard, a physically distinct graph from the shared `__commons__` catalog
# graph the fleet's :Tool/:CallableResource nodes live in by design
# (`agent_utilities/knowledge_graph/core/tenant_sharing.py`). These tests
# prove three things: (1) the write-target graph is untouched — still one
# tenant shard, identical to the shared minter's own resolution: tenant
# isolation for genuinely tenant-owned data is not weakened; (2) a second
# tenant's shard is never reachable from the new read-graph seam — cross-
# tenant isolation holds; (3) the new seam's read-graph set includes the
# shared commons graph, so a query executor built on it (owned by a parallel
# lane; not this module) reads the divergence case consistently instead of
# silently narrowing to zero.


def test_session_graph_remains_the_tenant_shard_write_target() -> None:
    """The write target is unchanged: still the caller's own physical shard."""

    session = mint_frontend_graph_session(_actor('kg:write', tenant='homelab'))
    assert session.graph == tenant_graph_name('homelab', base=default_graph_name())
    assert session.graph != default_graph_name()  # never silently widened to commons


def test_two_tenants_mint_distinct_write_target_graphs() -> None:
    """Two tenants' sessions must never be pinned to the same physical shard."""

    homelab = mint_frontend_graph_session(_actor('kg:read', tenant='homelab'))
    other = mint_frontend_graph_session(_actor('kg:read', tenant='other-co'))
    assert homelab.graph != other.graph
    assert homelab.tenant != other.tenant


def test_frontend_accessible_graphs_never_reaches_a_second_tenants_shard() -> None:
    """A second tenant's genuinely-owned data must stay invisible.

    `frontend_accessible_graphs` is the seam a union-read executor is meant to
    consume instead of `session.graph` alone. If it ever leaked a sibling
    tenant's own shard into that set, a query executor built on it would read
    another org's private data — exactly the tenant data-leak the brief warns
    a wrong call here would create. Assert it never does, for two distinct
    tenants in both directions.
    """

    homelab_graphs = frontend_accessible_graphs(_actor('kg:read', tenant='homelab'))
    other_graphs = frontend_accessible_graphs(_actor('kg:read', tenant='other-co'))

    homelab_shard = tenant_graph_name('homelab', base=default_graph_name())
    other_shard = tenant_graph_name('other-co', base=default_graph_name())

    assert homelab_shard in homelab_graphs
    assert other_shard not in homelab_graphs  # homelab never sees other-co's shard

    assert other_shard in other_graphs
    assert homelab_shard not in other_graphs  # other-co never sees homelab's shard


def test_frontend_accessible_graphs_includes_commons_last() -> None:
    """The read-graph set reaches the shared catalog graph, ordered after the
    actor's own shard — this is what resolves the measured divergence: a
    union read across this set (owned by a parallel lane) sees the fleet's
    :Tool/:CallableResource catalog the same way the MCP surface already
    does, instead of the webui's previous single-shard read seeing none of
    it."""

    graphs = frontend_accessible_graphs(_actor('kg:read', tenant='homelab'))
    assert graphs[-1] == default_graph_name()
    assert graphs[0] == tenant_graph_name('homelab', base=default_graph_name())
    assert len(set(graphs)) == len(graphs)  # de-duplicated


def test_frontend_accessible_graphs_requires_verified_tenant() -> None:
    actor = ActorContext(actor_id='subject-1', tenant_id='', authenticated=True)
    with pytest.raises(PermissionError):
        frontend_accessible_graphs(actor)


def test_mint_logs_the_resolved_scope_for_observability(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A session confined to one physical shard must never look, from the
    logs, identical to one that can see everything — the observability
    requirement this fix must satisfy in every case. Assert the mint emits a
    record naming the resolved graph and whether it is the shared commons.

    BUG-PE-061: ``caplog``'s own handler is attached to the ROOT logger, but
    ``observability.configure_structured_logging`` sets ``propagate =
    False`` on the ``agent_webui`` package logger once the app has been
    constructed (``agent_webui.observability``, ``package_logger.propagate =
    False``) -- so any test that builds the app first (order-dependent)
    stops this module's records from ever reaching root, and
    ``caplog.records`` sees nothing. ``caplog.at_level(..., logger=...)``
    only adjusts levels, it does not attach the handler to a non-root
    logger. Attach ``caplog.handler`` directly to this module's own logger
    for the scope of the call instead -- records are then captured exactly
    where they are emitted, before any ancestor's ``propagate = False``
    would stop them, independent of whatever the app-construction test
    order happens to be. Added/removed within this test only; no shared
    fixture state is mutated.
    """

    target_logger = logging.getLogger('agent_webui.graph_identity')
    target_logger.addHandler(caplog.handler)
    try:
        with caplog.at_level(logging.INFO, logger='agent_webui.graph_identity'):
            session = mint_frontend_graph_session(_actor('kg:read', tenant='homelab'))
    finally:
        target_logger.removeHandler(caplog.handler)

    records = [
        r for r in caplog.records if 'frontend graph session minted' in r.message
    ]
    assert records, 'expected an observable log record for the minted graph scope'
    record = records[-1]
    assert record.tenant == 'homelab'
    assert record.graph == session.graph
    assert record.is_commons_graph is False
    assert record.commons_graph == default_graph_name()
