# CONCEPT:AU-OS.identity.authenticated-identity-enforcement - Authenticated Identity Enforcement
"""The Agent WebUI's own graph-session minter: verified authority, no engine route.

Why this module exists
----------------------
``agent_utilities.security.request_identity.mint_graph_session`` projects a
verified actor into a graph session **and then binds an engine placement
route** to it (``_mint_graph_session`` → ``placement_catalog.resolve_placement``).
That last step is a live RPC to the epistemic-graph engine, and in the engine's
capability ledger ``PlacementRoute`` declares
``authz_action = "admin:cluster-read"``
(``epistemic-graph/crates/eg-capabilities/src/lib.rs:2274``). ``src/server/
dispatch.rs`` enforces that action twice:

1. ``verified_context.allows_method("admin:cluster-read", false)``
   (``dispatch.rs:2185``) — the caller's token must carry ``kg:admin`` (or
   ``admin:cluster-read``) as a scope; and
2. ``require_admin_capability(&s.isolation, req.agent_id, action)``
   (``dispatch.rs:2199`` → ``src/server/access.rs:858``) — the caller's
   *principal* must additionally be registered in the engine's own
   ``IsolationLayer`` with admin capability (``System`` role or an explicit
   RBAC ``Admin`` grant). That is engine-side identity state; **no JWT claim
   can satisfy it.**

So the shared minter makes *cluster-administrator authority a precondition for
authenticating a request at all*. graph-os survives it only because its service
principal happens to be an engine cluster admin. Any other agent-utilities
frontend — this one included — fails closed with ``PlacementAuthorityError``
inside the identity middleware, which surfaces to the browser as a blanket
HTTP 500 on every authenticated route (deferred item ``D-WA-3``).

Why dropping the route is correct, not a workaround
---------------------------------------------------
The Agent WebUI is a **thin entrypoint**, not a second data plane
(``agent-packages/AGENTS.md`` — *Universal capability: ONE core, thin
entrypoints*). It reaches the knowledge graph through graph-os, which already
resolves placement in-process with a principal that legitimately holds cluster
authority. A frontend holding its own engine connection is the exact
duplication that rule exists to prevent.

Even for a process that *is* an engine client, the mint-time route is not what
routes anything: ``agent_utilities.knowledge_graph.core.graph_compute`` re-runs
``resolve_placement`` per call at the actual data-plane call site
(``graph_compute.py:540``), and skips it entirely when no route config /
endpoints are configured (``graph_compute.py:522``). The mint-time resolution
is an eager pre-fetch whose answer is re-derived later anyway.

What is deliberately unchanged
------------------------------
Everything that constitutes *authority*: the verified actor, the tenant claim,
the graph name, the scope set and its hierarchy expansion, the policy revision,
the audience, and the trace correlation are derived exactly as the shared
minter derives them, and the same ``PermissionError`` contract is raised for
the same inputs — so the identity middleware's 401/403 behaviour is untouched.
Only ``endpoint`` / ``placement_group`` / ``catalog_epoch`` are left unbound.
``tests/test_graph_identity.py`` pins that equivalence against the shared
minter so the two cannot drift.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - typing only
    from agent_utilities.knowledge_graph.core.session import GraphSession
    from agent_utilities.security.brain_context import ActorContext

__all__ = ['mint_frontend_graph_session']


def mint_frontend_graph_session(actor: Any) -> GraphSession:
    """Project one already-verified actor into an unrouted graph session.

    Args:
        actor: The ``ActorContext`` minted by the shared identity boundary from
            a validated bearer credential.

    Returns:
        A ``GraphSession`` carrying the full verified authority of ``actor``
        with no engine placement route bound.

    Raises:
        PermissionError: If ``actor`` was not created from validated
            credentials, has no subject, has no verified tenant claim, or if
            the server is missing its audience / policy-revision configuration
            — the same four conditions, with the same exception type, as
            ``agent_utilities.security.request_identity._mint_graph_session``.
    """

    from agent_utilities.core.config import config
    from agent_utilities.knowledge_graph.core.session import GraphSession
    from agent_utilities.knowledge_graph.core.shard_topology import (
        default_graph_name,
        tenant_graph_name,
    )
    from agent_utilities.observability import correlation

    # Imported rather than restated so the graph-scope vocabulary can only ever
    # be the shared one.
    from agent_utilities.security.request_identity import _GRAPH_AUTH_SCOPES

    if not getattr(actor, 'authenticated', False):
        raise PermissionError(
            'A GraphSession can only be minted from authenticated identity'
        )
    if not str(getattr(actor, 'actor_id', '') or '').strip():
        raise PermissionError('Verified identity is missing its subject')

    scopes = frozenset(str(role) for role in actor.roles) & _GRAPH_AUTH_SCOPES
    # Coarse KG scopes are hierarchical: an administrator implies write+read and
    # a writer implies the authorization-safe precondition reads it must make.
    # Expanded here exactly as the shared minter expands it.
    if 'kg:admin' in scopes:
        scopes |= frozenset({'kg:read', 'kg:write'})
    elif 'kg:write' in scopes:
        scopes |= frozenset({'kg:read'})

    tenant = str(getattr(actor, 'tenant_id', '') or '').strip()
    if not tenant:
        raise PermissionError(
            'Authenticated graph requests require a verified tenant claim'
        )

    audience = str(config.auth_jwt_audience or config.mcp_jwt_audience or '').strip()
    policy_version = str(config.kg_policy_version or '').strip()
    if not audience or not policy_version:
        raise PermissionError(
            'Verified graph authority is missing audience or policy revision'
        )

    return GraphSession(
        actor=actor,
        tenant=tenant,
        scopes=scopes,
        graph=tenant_graph_name(tenant, base=default_graph_name()),
        policy_version=policy_version,
        trace_context=correlation.ensure_correlation_id(),
        audience=audience,
    )
