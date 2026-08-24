# CONCEPT:AU-OS.identity.webui-principal-admission - Dynamic Engine Principal Admission
"""Admit a freshly minted WebUI ``GraphSession`` principal into the engine's
own RBAC store — the missing half of authenticated-identity enforcement.

Why this module exists
-----------------------
``agent_webui.graph_identity.mint_frontend_graph_session`` projects an
already-verified OIDC actor into a ``GraphSession`` — a purely AU-side
construct (JWT scopes, tenant claim, policy revision). The epistemic-graph
ENGINE gates every Cypher/SQL read and write behind a **second, independent**
check, ``IsolationLayer::check_access`` (``epistemic-graph/crates/eg-core/src/
isolation.rs``), which consults only its own durable, engine-local RBAC store
and explicitly discards the graph's recorded ``owner``. Minting a
``GraphSession`` has never registered the underlying principal with that
store, so every real WebUI end user has been denied there — the live
incident: 855 ``CypherEngineError`` reads plus ``RuntimeError:
ACCESS_DENIED: verified principal lacks Write access to graph
'tenant__homelab____commons__'`` (``agent_utilities/orchestration/
agent_runner.py:4098``), with the AU-side scope check passing every time.

WebUI principals are minted dynamically, one per signed-in OIDC user — there
is no static roster to enroll ahead of time, so admission has to happen at
first contact, not at deploy time. This module is that runtime bridge; it
does **not** invent a new admission mechanism — it drives the same,
already-landed machinery deploy tooling uses for the WebUI's own service
account (``scripts/provision_identity.py``'s ``tier2-admission`` stage):

* :func:`agent_utilities.security.tenant_admission_cli.run_tenant_admission`
  (→ :func:`agent_utilities.security.tenant_rbac_admission.provision_tenant_access`)
  registers the principal and enrolls it in the tenant's durable
  ``tenant:<slug>`` RBAC role. It authorizes itself with an explicit,
  already-admitted **provisioner** signer credential (resolved from the
  configured secrets backend, key ``engine-admission/provisioner`` — the
  SAME provisioner identity Tier-2 admission already uses), never the calling
  request's own ambient authority. That is precisely why this is safe to call
  from inside request handling: the RPC's authorization does not depend on,
  and is not weakened or strengthened by, the still-being-admitted end user's
  own (deliberately non-admin) session.
* :func:`agent_utilities.knowledge_graph.maintenance.graph_ownership_apply.
  resolve_rbac_admin_client` (``.existing_roles()``) reads whether the
  tenant's role has ever been provisioned at all, so a tenant with no graph
  yet (and therefore no ``tenant:<slug>`` role — that role is created only as
  a side effect of the engine's own ``CreateGraph`` auto-provisioning) fails
  **closed** with a distinct, actionable error instead of silently
  registering a principal into a role that grants nothing — see
  :class:`TenantNotProvisionedError`.

Do NOT work around the gate. This module never calls ``from_ambient()``,
never synthesizes a session, and never grants ``System``/admin authority to
an ordinary principal (:class:`~agent_utilities.security.tenant_rbac_admission.
TenantPrincipal` refuses ``role="System"`` outright) — the principal gains
access by being properly registered and granted, nothing else.

Cheap and idempotent (READ BEFORE changing the caching shape)
---------------------------------------------------------------
A full admission round trip on every request would violate this repo's own
"cheap" requirement, so :func:`ensure_tenant_admission` is a **check-first,
cache-after** design:

* **Positive outcome** — cached in-process, forever (for this process's
  lifetime), keyed by ``(tenant_slug, agent_id)``. A returning user's next
  mint is a dict lookup, never a round trip.
* **Negative outcome** (tenant not provisioned yet, or the engine could not
  be reached) — cached for :data:`_FAILURE_BACKOFF_SECONDS` so a still-broken
  precondition does not re-attempt on every single request either; the next
  request after the backoff window retries automatically, so an operator's
  fix (or a recovered engine) is picked up without a WebUI restart.
* **Concurrent requests for the same brand-new principal** collapse onto one
  admission attempt via a per-``(tenant, agent_id)`` lock (double-checked
  against the cache once the lock is held) — ``register_identity`` is an
  upsert and is safe to call twice, but there is no reason to pay for it
  twice.
* The whole check-and-admit path runs off the event loop
  (``asyncio.to_thread``): the underlying engine client is a synchronous
  facade, and this is the one path that may need a real network round trip.

Known limitation (inherited from ``provision_tenant_access`` itself, not
introduced here): the engine exposes no "read one identity back" RPC, so a
re-admission (e.g. after a WebUI restart clears this process's in-memory
cache) re-registers the principal with **only** the tenant role — it does
not preserve some other role/team the identity may have gained through a
completely separate admission path in the meantime. Acceptable for this
WebUI's single-tenant deployment shape; see that module's own docstring for
the full reasoning.

The pre-flight role-existence probe is not the authorization boundary
--------------------------------------------------------------------
:func:`_tenant_role_exists` (below) reads the engine's RBAC policy via
``RbacAdmin{op:"List"}`` (``rbac.list()``), which the engine gates on the
``security:admin`` capability — a Tier-2 admin read. :func:`_admit`'s
``RegisterIdentity`` RPC is authorized completely differently: the engine's
own ``verify_register_identity_signature`` (``epistemic-graph``'s
``src/server/auth.rs``) checks only that the signer equals the calling
principal and that the signer's ``allowed_roles`` pattern covers the
requested role (``registry.authorize_grant``) — it never consults, and is
never gated by, ``security:admin``. So a deployment's service principal can
legitimately hold enough authority to admit a tenant (``allowed_roles:
["tenant:*"]``) while lacking the unrelated, more-privileged authority to
*list* the RBAC policy — this is exactly the shape the live 503 outage had.

Consequently, :func:`_sync_ensure` treats the probe's failure modes
differently:

* **The engine/RPC itself is unreachable or erroring** (anything other than
  the admin-capability denial specifically) — fails closed exactly as
  before: :class:`EngineAdmissionUnavailableError`, :func:`_admit` is never
  attempted.
* **The probe is denied for insufficient privilege** (the engine's
  ``"...lacks admin capability..."`` denial, matched against the exception
  chain by :func:`_admin_capability_denied`) — this means "I can't look",
  not "I can't admit". :func:`_sync_ensure` proceeds straight to
  :func:`_admit` and lets the engine's own, independent
  ``verify_register_identity_signature``/``authorize_grant`` check be the
  authority on whether the grant is allowed. This removes a redundant,
  over-privileged pre-flight; it does not weaken authorization; because that
  pre-flight's boolean result was never itself part of the engine's grant
  decision.

  One consequence worth naming: ``RegisterIdentity`` performs **no**
  role-existence validation of its own (confirmed by reading
  ``crates/eg-core/src/isolation.rs::try_register_agent_from_request`` — it
  is a bare upsert into the identity map, and ``provision_tenant_access``'s
  own docstring already documents this as a "legitimate no-op ordering" for
  a tenant with no graph yet). So when the probe cannot run, admitting a
  principal into a *genuinely* unprovisioned tenant is no longer detected at
  admission time the way it is when the probe succeeds and finds the role
  missing (:class:`TenantNotProvisionedError`) — it will instead surface
  later, from the engine itself, the first time that principal actually
  reads or writes a graph. This is not a new gap this change introduces:
  it is the same gap :class:`TenantNotProvisionedError` already existed to
  paper over when the probe *can* run; when it cannot, there is no
  privileged-enough read left in this deployment to detect it earlier.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

__all__ = [
    'EngineAdmissionUnavailableError',
    'TenantNotProvisionedError',
    'ensure_tenant_admission',
]

#: How long a NEGATIVE outcome (tenant not provisioned, or the engine/
#: provisioner credential unreachable) is remembered before the next mint
#: retries the check. Bounds the RPC cost of a still-broken precondition
#: without requiring an operator to restart the WebUI once it is fixed.
_FAILURE_BACKOFF_SECONDS = 30.0


class EngineAdmissionUnavailableError(RuntimeError):
    """Admission could not be attempted or confirmed.

    Distinct from :class:`TenantNotProvisionedError` on purpose: this means
    the engine, the provisioner credential, or the admission RPC itself
    failed — an infrastructure problem — not that the tenant is missing its
    RBAC role. An operator reading this message should look at engine
    reachability / the ``engine-admission/provisioner`` secret, not at
    tenant provisioning.
    """


class TenantNotProvisionedError(RuntimeError):
    """The engine has never provisioned this tenant's RBAC role.

    ``tenant:<slug>`` is created only as a side effect of the engine's own
    ``CreateGraph`` auto-provisioning (``IsolationLayer::
    provision_tenant_graph_access``) — never by this module, which is
    deliberately read-only with respect to role/grant creation. Enrolling a
    principal into a role that does not exist yet would succeed at the
    identity layer (``RegisterIdentity`` does not validate its ``roles``
    against the RBAC role table) while leaving every future graph read/write
    ACCESS_DENIED — exactly the silent-failure shape this module exists to
    avoid. Raised instead, naming what is missing, so the fix is "an
    operator provisions the tenant" and never "this module invents a role".

    Only ever raised from a probe that actually ran and returned ``False`` —
    see the module docstring's "The pre-flight role-existence probe is not
    the authorization boundary" section for what happens when the probe
    itself cannot run (denied for insufficient privilege rather than found
    the role missing): admission is attempted anyway and the engine becomes
    the authority, so this error is not raised on that path even for a
    genuinely unprovisioned tenant.
    """


# Per-process admission cache. Never expires on success (see module
# docstring); a failure entry expires after `_FAILURE_BACKOFF_SECONDS`.
_ADMITTED: dict[tuple[str, str], float] = {}
_FAILURES: dict[tuple[str, str], tuple[float, Exception]] = {}
_STATE_LOCK = threading.Lock()
_KEY_LOCKS: dict[tuple[str, str], threading.Lock] = {}


def _lock_for(key: tuple[str, str]) -> threading.Lock:
    with _STATE_LOCK:
        lock = _KEY_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _KEY_LOCKS[key] = lock
        return lock


#: Substring of the engine's admin-capability denial
#: (``epistemic-graph``'s ``src/server/access.rs::
#: require_admin_capability_with_policy``: ``"ACCESS_DENIED: verified
#: principal lacks admin capability required for '{action}'"`` — the same
#: text a live pod reproduced for this exact probe: ``rbac.list() ->
#: RuntimeError: ACCESS_DENIED: verified principal lacks admin capability
#: required for 'security:admin'``). Matched literally against the raised
#: exception chain, never guessed at, so the privilege-denial fallback below
#: fires ONLY for this specific denial — a network failure, an unreachable
#: engine, or any other ``EngineAdmissionUnavailableError`` must still fail
#: closed. Mirrors ``knowledge_graph.core.placement_catalog``'s
#: ``_ADMIN_CAPABILITY_DENIAL``/``_admin_capability_denied`` (same substring,
#: same reasoning, same chain-walk shape) rather than importing that
#: module-private helper across an unrelated subsystem.
_ADMIN_CAPABILITY_DENIAL = 'lacks admin capability'


def _admin_capability_denied(exc: BaseException | None) -> bool:
    """True when ``exc`` (or a chained cause) is the engine's admin-capability
    denial specifically — never a network error, an unrelated ACCESS_DENIED
    (e.g. a scope failure, a different message entirely), or any other
    reason the probe could not run. The denial is wrapped twice before it
    reaches :func:`_tenant_role_exists`'s caller (``LiveRbacAdminClient.
    existing_roles`` -> ``GrantApplicationError``, then this module's own
    :class:`EngineAdmissionUnavailableError`), so the check walks the full
    ``__cause__`` chain rather than the outermost message alone.
    """

    seen: set[int] = set()
    current = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if _ADMIN_CAPABILITY_DENIAL in str(current):
            return True
        current = current.__cause__
    return False


def _tenant_role_exists(tenant_slug: str) -> bool:
    """Read-only check: has the engine ever provisioned ``tenant:<slug>``?

    Reuses :func:`~agent_utilities.knowledge_graph.maintenance.
    graph_ownership_apply.resolve_rbac_admin_client` — the same
    ``RbacAdminClient`` this repo's deploy tooling already uses to read the
    engine's policy — rather than inventing a second RBAC-listing path.
    """

    from agent_utilities.knowledge_graph.maintenance.graph_ownership_apply import (
        resolve_rbac_admin_client,
    )
    from agent_utilities.security.tenant_rbac_admission import tenant_role_name

    role = tenant_role_name(tenant_slug)
    try:
        client = resolve_rbac_admin_client()
        return role in client.existing_roles()
    except Exception as exc:  # noqa: BLE001 - any failure here is "can't verify"
        raise EngineAdmissionUnavailableError(
            f'could not verify engine RBAC role {role!r}: {exc}'
        ) from exc


def _admission_route_debug() -> str:
    """Describe the engine view and ambient session the admission RPC used.

    Diagnostic only: never raises, never touches a credential, and is read
    exclusively from an exception path.
    """

    try:
        from agent_utilities.knowledge_graph.core.graph_compute import (
            GraphComputeEngine,
        )
        from agent_utilities.knowledge_graph.core.session import current_session

        engine = GraphComputeEngine.get_active()
        client = getattr(engine, 'client', None)
        session = current_session()
        return (
            f'engine.graph_name={getattr(engine, "graph_name", None)!r} '
            f'client._fixed_graph={getattr(client, "_fixed_graph", None)!r} '
            f'client._graph_name={getattr(client, "_graph_name", None)!r} '
            f'session.graph={getattr(session, "graph", None)!r}'
        )
    except Exception as exc:  # noqa: BLE001 - diagnostics never mask the real error
        return f'route-debug unavailable: {exc!r}'


def _admit(tenant_slug: str, agent_id: str) -> None:
    """Enroll ``agent_id`` in ``tenant_slug``'s durable RBAC role.

    Delegates entirely to :func:`~agent_utilities.security.
    tenant_admission_cli.run_tenant_admission` with ``apply=True`` — the
    already-landed deployment-tooling bridge for
    :func:`~agent_utilities.security.tenant_rbac_admission.
    provision_tenant_access`. It resolves its own provisioner authority from
    the configured secrets backend; this function never touches a
    credential itself.
    """

    from agent_utilities.security.tenant_admission_cli import run_tenant_admission
    from agent_utilities.security.tenant_rbac_admission import TenantPrincipal

    # `existing_roles=()` is an affirmative statement, not a default: a WebUI
    # principal is a signed-in human whose authorization comes from their OIDC
    # claims (kg:read / kg:write / kg:admin, normalized by
    # `agent_utilities.security.request_identity`), NOT from the engine's own
    # RBAC identity store. The only engine-side role such a principal ever
    # holds is its tenant membership, which is exactly what this call grants.
    # So there is no prior engine role set for `RegisterIdentity` to drop.
    #
    # This is deliberately NOT the same claim as "this principal is new". The
    # one principal that DOES carry other engine roles is graph-os's own
    # service identity (it holds `control:system`), and admitting that one is
    # short-circuited in `provision_tenant_access` before this value is read
    # -- see `tenant_rbac_admission`'s self-admission skip. Passing `()` here
    # is therefore safe for every principal that actually reaches this line.
    principal = TenantPrincipal(agent_id=agent_id, existing_roles=())
    try:
        result = run_tenant_admission(tenant_slug, [principal], apply=True)
    except Exception as exc:  # noqa: BLE001 - converted to our own error type
        # The wrapped message alone has repeatedly proven un-actionable: it
        # names the tenant but not WHICH engine view refused, nor what graph
        # the ambient session carried. Log the full chain plus both graph
        # bindings once, at the only point where all three are in scope.
        logger.exception(
            'engine tenant admission FAILED: agent_id=%s tenant=%s %s',
            agent_id,
            tenant_slug,
            _admission_route_debug(),
        )
        raise EngineAdmissionUnavailableError(
            f'engine admission failed for {agent_id!r} in tenant {tenant_slug!r}: {exc}'
        ) from exc
    if not result.all_admitted:
        raise EngineAdmissionUnavailableError(
            f'engine admission did not confirm {agent_id!r} in tenant {tenant_slug!r}'
        )
    logger.info(
        'engine tenant admission: agent_id=%s tenant=%s admitted',
        agent_id,
        tenant_slug,
    )


def _sync_ensure(tenant_slug: str, agent_id: str) -> None:
    """The blocking check-and-admit critical section. Runs off the event loop."""

    key = (tenant_slug, agent_id)
    with _STATE_LOCK:
        if key in _ADMITTED:
            return

    lock = _lock_for(key)
    with lock:
        with _STATE_LOCK:
            if key in _ADMITTED:
                return
            failure = _FAILURES.get(key)
        if failure is not None:
            attempted_at, cached_exc = failure
            if time.monotonic() - attempted_at < _FAILURE_BACKOFF_SECONDS:
                raise cached_exc

        try:
            try:
                role_missing = not _tenant_role_exists(tenant_slug)
            except EngineAdmissionUnavailableError as probe_exc:
                if not _admin_capability_denied(probe_exc):
                    # Engine unreachable / RPC erroring — an infrastructure
                    # problem, not a privilege problem. Fail closed exactly
                    # as before; never attempt admission on unverified
                    # engine health.
                    raise
                # "I can't look" is not "I can't admit" — proceed and let the
                # engine's own, independently-authorized RegisterIdentity
                # decide (see the module docstring). Do NOT synthesize a
                # role_missing verdict from an unanswered question.
                logger.warning(
                    'tenant role probe for %r denied for insufficient '
                    'privilege (agent_id=%s); proceeding directly to '
                    'admission and letting the engine authorize it: %s',
                    tenant_slug,
                    agent_id,
                    probe_exc,
                )
                role_missing = False
            if role_missing:
                raise TenantNotProvisionedError(
                    f'tenant role for {tenant_slug!r} does not exist yet — an '
                    'operator must provision this tenant (create its first '
                    f'graph, which auto-provisions tenant:{tenant_slug!r}, or '
                    'run tenant RBAC admission) before principals can be '
                    'admitted'
                )
            _admit(tenant_slug, agent_id)
        except (TenantNotProvisionedError, EngineAdmissionUnavailableError) as exc:
            with _STATE_LOCK:
                _FAILURES[key] = (time.monotonic(), exc)
            raise

        with _STATE_LOCK:
            _ADMITTED[key] = time.monotonic()
            _FAILURES.pop(key, None)


_SERVICE_SESSION: Any = None
_SERVICE_SESSION_LOCK = threading.Lock()


def _service_authority() -> Any:
    """This deployment's own verified graph authority, minted once per process.

    Mirrors `kg_server._mint_process_session`: the identity provider issues a
    bounded-expiry process token, which becomes the actor and session that
    control-plane work runs under. Cached because minting it is a network round
    trip and admission is on the connection path.

    A failure here is an admission failure, not a silent downgrade to the
    caller's identity -- falling back to the user's session is precisely the bug
    this replaced, and it fails closed for every user rather than visibly for the
    operator.
    """

    global _SERVICE_SESSION
    with _SERVICE_SESSION_LOCK:
        if _SERVICE_SESSION is not None:
            return _SERVICE_SESSION

        # In-process under graph-os, the ambient authority IS the right one and
        # minting a second would be actively wrong.
        #
        # This dashboard runs as a graph-os co-service, on a thread that carries
        # graph-os's verified actor and GraphSession for its whole lifetime. That
        # principal is the one the engine's signer registry trusts, and the engine
        # requires an admission's signer to BE the calling principal
        # (`verify_register_identity_signature`, else SIGNER_TRUST_DENIED). So
        # replacing it with a separately-minted broker identity would swap the one
        # credential that can sign admission for one that cannot.
        #
        # The broker path below remains for a standalone deployment, where there is
        # no ambient process authority to inherit.
        from agent_utilities.knowledge_graph.core.session import current_session

        ambient = current_session()
        if ambient is not None and getattr(
            getattr(ambient, 'actor', None), 'authenticated', False
        ):
            logger.debug(
                'tenant admission will use the ambient process authority '
                '(actor=%s); no separate broker identity is minted',
                getattr(ambient.actor, 'actor_id', None),
            )
            _SERVICE_SESSION = ambient
            return _SERVICE_SESSION

        from agent_utilities.core.config import config
        from agent_utilities.security.request_identity import (
            acquire_process_identity_token,
            mint_actor_from_token_sync,
            mint_graph_session,
        )

        # The ADMIN BROKER credential, not a second process identity.
        #
        # `KG_ADMIN_BROKER_OAUTH2` is already provisioned for this deployment and
        # exists precisely to let a frontend perform admin-capability work under
        # its own principal instead of the caller's
        # (CONCEPT:AU-OS.identity.idp-role-to-engine-capability-bridge). Using it
        # here grants nothing new -- the alternative, `KG_AUTH_TOKEN_REF`/
        # `KG_IDENTITY_OAUTH2`, is not configured for this pod at all, so a
        # generic process identity would just fail differently.
        #
        # `_BrokerConfigView` mirrors `placement_catalog._broker_authority`: the
        # broker's OAuth2 block rides the SAME `acquire_process_identity_token`
        # resolver every other external process identity uses, so this is not a
        # parallel trust mechanism.
        oauth2 = getattr(config, 'kg_admin_broker_oauth2', None)
        if not oauth2:
            raise EngineAdmissionUnavailableError(
                'no admin broker identity is configured for this deployment '
                '(KG_ADMIN_BROKER_OAUTH2); tenant admission cannot be verified '
                'without one'
            )

        class _BrokerConfigView:
            kg_auth_token_ref = None
            kg_identity_oauth2 = oauth2

        token = acquire_process_identity_token(_BrokerConfigView())
        actor = mint_actor_from_token_sync(token)
        session = mint_graph_session(actor)
        session.engine_verified_context()
        _SERVICE_SESSION = session
        return session


async def ensure_tenant_admission(actor: Any, session: Any) -> None:
    """Ensure ``actor``'s principal is admitted into ``session``'s tenant.

    Called once per newly minted :class:`~agent_utilities.knowledge_graph.
    core.session.GraphSession`, before it is bound as the request's ambient
    session — see :mod:`agent_webui.server`'s identity middleware. A
    returning, already-admitted principal never leaves this function without
    an engine round trip (see module docstring, "Cheap and idempotent").

    Raises :class:`TenantNotProvisionedError` or
    :class:`EngineAdmissionUnavailableError` — never silently proceeds to a
    request that the engine's own RBAC would deny far less legibly later.
    """

    agent_id = str(getattr(actor, 'actor_id', '') or '').strip()
    tenant_slug = str(getattr(session, 'tenant', '') or '').strip()
    if not agent_id or not tenant_slug:
        # mint_frontend_graph_session already refuses these; treated as
        # "nothing to admit" here rather than duplicating that validation.
        return

    key = (tenant_slug, agent_id)
    with _STATE_LOCK:
        if key in _ADMITTED:
            return

    # Admission runs under THIS SERVICE's identity, never the caller's.
    #
    # Two reasons, and the second is why the caller's session cannot work at all:
    #
    # 1. Admission is a control-plane decision about the caller. Performing it as
    #    the caller is backwards -- the subject of an authorization decision
    #    should not be the one authorized to make it.
    # 2. The engine round trip inside `_sync_ensure` resolves a placement route,
    #    which the engine gates on `cluster:placement-read`. A browser session can
    #    never hold that scope: `mint_frontend_graph_session` intersects the
    #    actor's roles with `_GRAPH_AUTH_SCOPES`, which is exactly
    #    {kg:read, kg:write, kg:admin}. So running this as the caller failed for
    #    EVERY user, always, with "could not verify engine RBAC role ...: engine
    #    rbac.list() failed" -- a message describing a role problem when the real
    #    condition was that the probe had no authority to look.
    #
    # The service identity is the same process authority graph-os itself mints
    # (`acquire_process_identity_token` -> `mint_actor_from_token_sync` ->
    # `mint_graph_session`), so this grants nothing new: it uses the credential
    # this deployment already holds, instead of borrowing the user's.
    #
    # `asyncio.to_thread` copies the current context into the worker thread, so
    # binding here (not inside `_sync_ensure`, which only ever receives strings)
    # is what reaches the engine call.
    service_session = _service_authority()
    from agent_utilities.knowledge_graph.core.session import use_session
    from agent_utilities.security.brain_context import use_actor

    with use_actor(service_session.actor), use_session(service_session):
        await asyncio.to_thread(_sync_ensure, tenant_slug, agent_id)
