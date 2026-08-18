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

    principal = TenantPrincipal(agent_id=agent_id)
    try:
        result = run_tenant_admission(tenant_slug, [principal], apply=True)
    except Exception as exc:  # noqa: BLE001 - converted to our own error type
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
            if not _tenant_role_exists(tenant_slug):
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

    await asyncio.to_thread(_sync_ensure, tenant_slug, agent_id)
