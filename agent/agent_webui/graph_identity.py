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

``GraphSession.graph`` is one physical graph, deliberately (D-TGS-1)
----------------------------------------------------------------------
``session.graph`` is pinned byte-for-byte equal to the shared minter's own
``session.graph`` (``test_authority_matches_the_shared_minter``) because it is
also the **write target** — the tenant's own physical shard
(``tenant_graph_name(tenant, base=default_graph_name())``,
``shard_topology.py``). Retargeting it at ``__commons__`` to "fix" catalog
visibility would misroute every write this session makes and would be wrong
for the same reason a blanket removal of tenant scoping would be wrong: org
membership is the platform's physical isolation boundary
(``agent_utilities/knowledge_graph/core/tenant_sharing.py`` — "Org = the
physical isolation boundary").

That physical-isolation design already accounts for shared catalog data,
though: ``tenant_sharing.py``'s own module docstring calls the default graph
"the COMMONS. It is readable across orgs", and its
``COMMONS_SHAREABLE_NODE_TYPES`` constant lists exactly the fleet/tool catalog
classes measured missing from the WebUI's view (``Tool``, ``NativeTool``,
``ToolMetadata``, ``CallableResource`` with ``resource_type == "AGENT_SKILL"``,
``Skill``, ``MCPServer``, ``Server``, ``WorkflowDefinition``, ``Prompt``,
``SystemPrompt``, ``LanguageModel``, ``EmbeddingModel``) — confirmed by source,
not inferred. A 2026-08-09 owner ruling (GOC-61) already wired the read-side
half of this at the canonical query chokepoint
(``knowledge_graph/orchestration/engine_query.py``'s ``QueryMixin.query_cypher``
calls ``tenant_sharing.filter_commons_catalog`` /
``apply_commons_catalog_restriction``, keyed off the *physical* bound graph,
not ``session.graph``) — that is why the MCP surface, which reaches the
commons graph through the raw process-engine singleton
(``mcp/kg_server.py::_get_engine``), sees the catalog plus its own tenant's
rows, filtered, safely. The WebUI never reaches that graph at all, because
every request is confined to ``session.graph`` alone.

The matching read-side union was *also* already designed and built —
``tenant_sharing.accessible_graphs`` / ``tenant_sharing.read_union`` return and
query "org (+ ancestors) then commons, de-duplicated, merged" — but as of this
fix it had zero callers anywhere in the codebase outside its own module. It is
the correct fix for the WebUI's under-scoped reads (case (c): both graphs are
legitimate; the fix is an explicit union, not a widened ``session.graph``).
:func:`frontend_accessible_graphs` below is the seam this module exposes for
a query executor (owned by a parallel lane; this module does not execute
queries) to consume that existing mechanism instead of reading only
``session.graph`` — so the safety boundary is the one already audited in
``tenant_sharing.py``, not a new one invented here.

Default scope + durable admin elevation (AUTHZ LANE B)
--------------------------------------------------------
Before this section's changes, a verified human whose token carried no
``kg:*`` role at all (the common case for a first sign-in: the tenant claim
is present, but nothing populates ``realm_access.roles`` with a KG scope)
minted a session with **empty** ``scopes``. ``WebUIActorIdentityMiddleware``
(`server.py`) denies every GET route unless ``'kg:read' in session.scopes``
-- see ``oidc_session.py``'s own note, *"a user without ``kg:read`` cannot
even load the SPA"* -- so that human saw 0 tools, 0 skills, and a
heavily-filtered graph, indistinguishable from a misconfigured account.

Two changes fix this, both scoped to `mint_frontend_graph_session` alone:

1. **Default to ``kg:read``, never to nothing.** A verified, tenant-scoped
   human with no ``kg:*`` claim now gets the floor every other authenticated
   surface in this file already assumes exists: ordinary GET/view access to
   the WebUI's own ``/api/enhanced/*`` routes and dashboards. It does **not**
   grant ``kg:write`` (mutations) or reach ``kg:admin``-gated admin routes --
   see `WebUIAuthorizationMiddleware`/`rbac.resolve_webui_role`, both
   untouched by this module. This mirrors ``rbac.resolve_webui_role``'s own
   independent, pre-existing default (any authenticated identity with no
   matching claim -> the WebUI page role ``'reader'``) -- this file's default
   is the graph-authority-scope sibling of that same "never zero, never more
   than read" posture, not a new one invented here.

2. **Admin elevation is DERIVED, never stored — so it survives
   ``RegisterIdentity``'s role-set replacement by construction.**
   ``plans/auth-unification/AUTH-UNIFICATION-DESIGN.md`` S3 specifies the
   subject set a grant should evaluate against as *"org roles from the
   verified token"* -- re-derived on every sign-in, never persisted as a
   separate grant a later admission could blindly overwrite.
   ``graph_admission.py``'s own docstring documents exactly that hazard for
   the ENGINE's identity store: ``RegisterIdentity`` replaces a principal's
   *whole* role set, so an out-of-band grant is silently wiped the next time
   that module re-admits the principal. This module's admin elevation is
   immune to that hazard **because it never calls `RegisterIdentity` (or any
   engine RPC) at all** -- `mint_frontend_graph_session` is a pure
   claims-to-session projection, re-run from scratch on every request/
   sign-in, so "durable across re-registration" is automatic here: there is
   nothing to wipe, because nothing is ever stored.

   Two ways a principal is elevated, evaluated in this order:

   a. **The intended long-term mechanism — an IdP realm role.** A Keycloak
      ``kg:admin`` realm role already flows into ``actor.roles`` via
      :func:`agent_utilities.security.identity.base_capabilities` with no
      code change here (the same union this file's own scope-hierarchy
      expansion below already reads). Per this module's own established
      distinction (see `_GRAPH_AUTH_SCOPES`'s docstring in
      ``request_identity.py``): only the **explicit** ``kg:admin`` capability
      counts; a generic realm role literally named ``admin`` is deliberately
      NOT treated as equivalent -- this file does not weaken that boundary.
   b. **The bootstrap escape hatch — a configured allowlist.**
      :func:`_configured_admin_principal_ids` reads an operator-configured,
      non-secret list of principal ids (``KG_ADMIN_PRINCIPAL_IDS``) that are
      admin regardless of their realm roles. This exists ONLY because
      Keycloak may not be editable from this lane; it is a bootstrap, not a
      replacement for (a) -- an operator should migrate a listed principal to
      a real ``kg:admin`` realm role and drop it from the allowlist as soon
      as Keycloak access allows. No principal id is ever hardcoded in this
      module; the allowlist is entirely configuration.

   Path (b) needs one more step beyond scopes: ``rbac.resolve_webui_role``
   (the WebUI's *page*-role ladder, a separate axis `server.py` enforces
   independently of ``session.scopes``) reads the actor's raw,
   un-filtered ``roles`` directly -- not the ``kg:*``-filtered
   ``GraphSession.scopes`` this function produces. So an allowlisted
   principal's effective actor carries an AUGMENTED ``roles`` tuple (`kg:
   admin` appended via ``dataclasses.replace`` -- the exact idiom
   ``request_identity.py`` already uses to produce a derived
   ``ActorContext``), not just augmented scopes, so both gates agree. This
   augmentation is WebUI-local: it changes nothing about the verified JWT
   itself, and it never reaches the ENGINE's own RBAC identity store --
   ``crates/eg-core/src/isolation.rs::check_access`` authorizes graph
   Read/Write against its OWN durable, ``RegisterIdentity``-populated
   identity map, keyed only by ``agent_id``, and never consults a per-request
   ``roles``/``scopes`` claim for that decision (confirmed by reading that
   function) -- so this elevation cannot, by construction, grant this
   principal any additional DATA access at the engine beyond what
   `graph_admission.py` already provisions identically for every tenant
   member (Read+Write on the tenant's own graphs). It only changes which
   WebUI pages/routes this principal's browser session may reach.

   **Trust boundary, stated plainly:** every input this elevation logic
   reads (``actor.roles``, ``actor.actor_id``, ``actor.authenticated``) is
   populated ONLY by this WebUI's OWN server-side JWT validation
   (``WebUIActorIdentityMiddleware`` / ``ActorIdentityMiddleware``, verified
   against ``AUTH_JWT_JWKS_URI``/``AUTH_JWT_ISSUER``) before this function is
   ever called -- never from request JSON, headers, or any other
   caller-supplied value. That boundary is independent of, and unaffected
   by, the ENGINE's own (currently disabled, per
   ``AUTH-UNIFICATION-DESIGN.md`` Workstream A) ``EPISTEMIC_GRAPH_REQUIRE_OIDC``
   / ``EPISTEMIC_GRAPH_OIDC_JWT_ISSUER`` -- that flag gates the Rust engine's
   OWN independent re-verification of the ``eg2.`` wire envelope between
   graph-os and the engine, a different hop this module never reaches. If a
   future change (Workstream B) teaches the engine to evaluate per-request
   claims directly for `check_access` rather than only its durable identity
   store, THAT mechanism's trustworthiness would depend on
   `EPISTEMIC_GRAPH_REQUIRE_OIDC` being on; today's engine does not do that,
   so it does not apply to the elevation implemented here.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - typing only
    from agent_utilities.knowledge_graph.core.session import GraphSession

logger = logging.getLogger(__name__)

__all__ = [
    'frontend_accessible_graphs',
    'mint_frontend_graph_session',
]

#: Bootstrap escape hatch for AUTHZ LANE B requirement 3 (see the module
#: docstring, "Admin elevation is DERIVED, never stored"). A comma-separated
#: list of principal ids (OIDC ``sub`` values, i.e. ``ActorContext.actor_id``)
#: that are treated as holding ``kg:admin`` regardless of their realm roles.
#: The INTENDED long-term mechanism is a Keycloak ``kg:admin`` realm role
#: (see the module docstring) -- this allowlist exists only because Keycloak
#: may not be reachable from every deployment lane. No principal id is ever
#: hardcoded here; an operator configures this via ``KG_ADMIN_PRINCIPAL_IDS``
#: (env var / XDG ``config.json`` -- see ``core/config.py``'s
#: "Configuration discipline").
_ADMIN_PRINCIPAL_IDS_SETTING = 'KG_ADMIN_PRINCIPAL_IDS'


def _configured_admin_principal_ids() -> frozenset[str]:
    """Read the bootstrap admin allowlist fresh from config on every call.

    Deliberately NOT cached at import/module scope: this must observe a
    config change (env var, or XDG ``config.json`` edit + reload) without a
    process restart, exactly like every other live ``config.setting(...)``
    read in this codebase. Returns an empty set (denies everyone via this
    path) when unset -- never guesses, never widens on a malformed value.
    """

    from agent_utilities.core.config import setting

    raw = str(setting(_ADMIN_PRINCIPAL_IDS_SETTING, '') or '')
    return frozenset(item.strip() for item in raw.split(',') if item.strip())


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
    actor_id = str(getattr(actor, 'actor_id', '') or '').strip()
    if not actor_id:
        raise PermissionError('Verified identity is missing its subject')

    token_scopes = frozenset(str(role) for role in actor.roles) & _GRAPH_AUTH_SCOPES

    # AUTHZ LANE B — admin elevation, re-derived on EVERY mint (never stored;
    # see the module docstring, "Admin elevation is DERIVED, never stored").
    if 'kg:admin' in token_scopes:
        # (a) The intended long-term mechanism: an IdP `kg:admin` realm role
        # already flows into `actor.roles` with no code here.
        effective_actor = actor
    elif actor_id in _configured_admin_principal_ids():
        # (b) The configured bootstrap escape hatch. Augment the ROLES this
        # session's actor carries (not the verified token) so that both this
        # function's scope hierarchy below AND `rbac.resolve_webui_role`
        # (which reads `session.actor.roles` directly, independent of
        # `session.scopes`) agree the principal is admin — see the module
        # docstring for why both must see it, and why this augmentation
        # cannot widen ENGINE-side data access.
        effective_actor = replace(actor, roles=tuple({*actor.roles, 'kg:admin'}))
        logger.info(
            'admin elevation applied via configured allowlist: actor_id=%s',
            actor_id,
        )
    else:
        effective_actor = actor

    scopes = frozenset(str(role) for role in effective_actor.roles) & _GRAPH_AUTH_SCOPES
    # Coarse KG scopes are hierarchical: an administrator implies write+read and
    # a writer implies the authorization-safe precondition reads it must make.
    # Expanded here exactly as the shared minter expands it.
    if 'kg:admin' in scopes:
        scopes |= frozenset({'kg:read', 'kg:write'})
    elif 'kg:write' in scopes:
        scopes |= frozenset({'kg:read'})
    elif not scopes:
        # Default for a verified human with no `kg:*` claim at all: READ, not
        # nothing (AUTHZ LANE B requirement 1) — see the module docstring,
        # "Default scope + durable admin elevation".
        scopes = frozenset({'kg:read'})

    actor = effective_actor
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

    commons_graph = default_graph_name()
    graph = tenant_graph_name(tenant, base=commons_graph)
    session = GraphSession(
        actor=actor,
        tenant=tenant,
        scopes=scopes,
        graph=graph,
        policy_version=policy_version,
        trace_context=correlation.ensure_correlation_id(),
        audience=audience,
    )

    # Observability (D-TGS-1): a session confined to one physical shard must
    # never be silently indistinguishable from one that sees everything. Log
    # the resolved graph and, explicitly, whether it is the shared commons or
    # a narrower per-tenant shard, on every mint — so a divergence like the
    # one this module was fixed for (WebUI reads scoped to
    # ``tenant__homelab____commons__`` while the commons catalog holding the
    # fleet's :Tool/:CallableResource nodes went unread) shows up in logs
    # keyed by trace/tenant instead of requiring a fleet-wide count diff to
    # notice. This module never executes a query itself, so a log line is the
    # strongest signal it can emit on its own; a query executor that also
    # surfaces ``graph``/``accessible_graphs`` in its response payload (see
    # :func:`frontend_accessible_graphs`) is the complementary, response-side
    # half of this requirement, owned by whichever lane executes the query.
    logger.info(
        'frontend graph session minted: tenant=%s graph=%s is_commons=%s trace=%s',
        tenant,
        graph,
        graph == commons_graph,
        session.trace_context,
        extra={
            'tenant': tenant,
            'graph': graph,
            'commons_graph': commons_graph,
            'is_commons_graph': graph == commons_graph,
            'trace_context': session.trace_context,
        },
    )
    return session


def frontend_accessible_graphs(actor: Any) -> list[str]:
    """Ordered, de-duplicated graphs ``actor`` may READ — not just write to.

    ``mint_frontend_graph_session`` binds ``GraphSession.graph`` to exactly
    ONE physical graph: the actor's own tenant shard (see the module
    docstring, "``GraphSession.graph`` is one physical graph, deliberately").
    That is correct for a write target, but a caller that reads only
    ``session.graph`` never reaches the shared commons graph — where the
    fleet/tool catalog (``agent_utilities.knowledge_graph.core.tenant_sharing
    .COMMONS_SHAREABLE_NODE_TYPES`` — ``Tool``, ``CallableResource`` with
    ``resource_type == "AGENT_SKILL"``, ``Skill``, ``MCPServer``, ``Prompt``,
    ...) is deliberately written and meant to be visible to every tenant.

    This returns the same ordered set
    :func:`agent_utilities.knowledge_graph.core.tenant_sharing.accessible_graphs`
    already defines — the actor's tenant graph first (most specific, where its
    own writes land and where it wins on a duplicate id), any registered
    tenant ancestors, then the commons graph last — for a query executor to
    run a :func:`~agent_utilities.knowledge_graph.core.tenant_sharing.read_union`
    across, instead of a single-graph read. It does not itself run a query,
    widen ``GraphSession.graph``, or invent a new safety boundary: the
    cross-tenant restriction on what a UNION read may surface from the
    commons graph is enforced by ``tenant_sharing.filter_commons_catalog`` /
    ``apply_commons_catalog_restriction`` at the query layer, unchanged by
    this function.

    Args:
        actor: The same verified ``ActorContext`` passed to
            :func:`mint_frontend_graph_session`.

    Returns:
        The ordered graph names an authenticated read should union across.

    Raises:
        PermissionError: If ``actor`` is not authenticated or has no verified
            tenant claim — the same precondition :func:`mint_frontend_graph_session`
            enforces (via ``tenant_sharing``'s own actor validation).
    """

    from agent_utilities.knowledge_graph.core.tenant_sharing import accessible_graphs

    return accessible_graphs(actor)
