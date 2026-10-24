"""Isolated fixture only: real installed HTTP/pipeline/fleet discovery.

Load with importlib.util.spec_from_file_location. In the existing fixture's
GatewayApplicationPort.mount_rest_routes call mount_fleet_discovery(app, prefix).
Keep its real JWKS/JWT setup; mint the fixture token with mcp:discover explicitly.
No auth override, server startup, production configuration, or endpoint mock.
Synthetic catalog, health, client context, policy and audit are NOT live-provider
qualification. Only the two read operations are registered; effects fail closed.
"""

from contextlib import contextmanager

from arbora.api.http.app import create_api_application
from arbora.api.http.auth import (
    AmbientHTTPAuthenticator,
    verified_bearer_session_for_request,
)
from arbora.api.invoke.executor import BoundOperationRuntime
from arbora.api.invoke.pipeline import InvokeServices, invoke
from arbora.api.mcp.caller import caller_from_session
from arbora.api.ops.fleet import operations
from arbora.api.registry import Registry
from arbora.fleet.catalog_items import CatalogItem, FleetCatalog
from arbora.fleet.gateway_ops import FleetGateway
from arbora.fleet.multiplexer_ops import MultiplexerOps
from arbora.fleet.session_loads import SessionLoads

READ_IDS = frozenset({'fleet.status', 'fleet.catalog.list'})


async def refused(*args, **kwargs):
    raise PermissionError('Synthetic discovery fixture has no effect authority')


class NoPlans:
    issue = staticmethod(refused)
    validate = staticmethod(refused)
    consume = staticmethod(refused)


class FixtureClient:
    """Synthetic context carrier only; provides no engine methods."""

    @contextmanager
    def use_verified_context(self, claims):
        if (
            claims.get('tenant') != 'synthetic'
            or claims.get('principal') != 'catalog-reader'
        ):
            raise PermissionError('Outside synthetic discovery identity')
        yield self


class FixturePolicy:
    async def check_op(self, op, caller):
        return (
            op.id in READ_IDS
            and caller.authenticated
            and caller.tenant == 'synthetic'
            and caller.principal == 'catalog-reader'
            and 'mcp:discover' in caller.effective_scopes
        )


async def verify_current(caller):
    # Re-project current verified session, including credential expiration and
    # authority checks. Never manufacture or add grants from request parameters.
    return caller_from_session(
        caller.session,
        credential_kind=caller.credential_kind,
        request_id=caller.request_id,
        mfa_at_ms=caller.mfa_at_ms,
    )


async def caller_client(tenant):
    if tenant != 'synthetic':
        raise PermissionError('Outside synthetic tenant')
    return FixtureClient()


async def source():
    return (
        CatalogItem(
            id='tool:catalog-registered:inspect',
            kind='tool',
            name='inspect',
            server='catalog-registered',
            description='Synthetic read-only inspection descriptor',
        ),
        CatalogItem(
            id='skill:catalog-registered:review',
            kind='skill',
            name='review',
            server='catalog-registered',
            description='Synthetic review skill descriptor',
        ),
    )


async def visible(item, caller):
    return (
        caller.tenant == 'synthetic'
        and caller.principal == 'catalog-reader'
        and 'mcp:discover' in caller.effective_scopes
    )


AUDIT_EVENTS: list[tuple[str, tuple[object, ...]]] = []


async def audit_preflight(*args):
    # Explicit in-memory fixture audit; never evidence of production durability.
    AUDIT_EVENTS.append(('preflight', args))
    return 'synthetic-audit'


async def audit_write(*args):
    AUDIT_EVENTS.append(('write', args))


def build_fleet_application():
    catalog = FleetCatalog((source,), visible)
    ops = MultiplexerOps(
        catalog=catalog,
        sessions=SessionLoads(),
        loadable=refused,
        mount=refused,
        notify=refused,
        invoke=refused,
        health=lambda: {'catalog-registered': {'state': 'up', 'sessions': 1}},
        session_key_for=lambda caller: None,
    )
    gateway = FleetGateway(
        tool_for=refused, policy_check=refused, delegated_call=refused, catalog_ops=ops
    )
    runtime = BoundOperationRuntime(
        caller_client=caller_client,
        verify_current=verify_current,
        service_client=refused,
        service_claims=refused,
        check_access=refused,
        eg_dispatch=refused,
        service_scopes=frozenset(),
        service_principal='synthetic-unused-service',
        bindings={'fleet_gateway': gateway},
    )
    policy = FixturePolicy()
    registry = Registry(op for op in operations() if op.id in READ_IDS)
    services = InvokeServices(
        registry=registry,
        runtime=runtime,
        plans=NoPlans(),
        policy_gate=policy,
        audit_preflight=audit_preflight,
        audit_write=audit_write,
    )
    authenticator = AmbientHTTPAuthenticator(
        session_for_request=verified_bearer_session_for_request
    )
    return create_api_application(
        services=services,
        visibility=policy.check_op,
        authenticator=authenticator,
        invoke=invoke,
    )


def mount_fleet_discovery(app, *, prefix='/api'):
    app.mount(prefix.rstrip('/') + '/v1', build_fleet_application())
