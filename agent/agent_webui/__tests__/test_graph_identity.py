"""Contract tests for the WebUI's unrouted graph-session minter.

The point of these tests is drift: :func:`agent_webui.graph_identity.
mint_frontend_graph_session` deliberately restates the *authority* half of
``agent_utilities.security.request_identity._mint_graph_session`` while
dropping its engine placement round-trip. If the shared minter ever changes how
it derives tenant, graph, scopes, policy revision or audience, the equivalence
test below must fail rather than let the two silently diverge.
"""

from __future__ import annotations

import pytest

pytest.importorskip('agent_utilities.security.request_identity')

from agent_utilities.knowledge_graph.core import (  # noqa: E402
    placement_catalog as _placement_catalog,
)
from agent_utilities.security import request_identity as _shared  # noqa: E402
from agent_utilities.security.brain_context import ActorContext  # noqa: E402
from agent_webui.graph_identity import mint_frontend_graph_session  # noqa: E402

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


def _actor(*roles: str, tenant: str = 'homelab', subject: str = 'subject-1') -> ActorContext:
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
        (),
    ],
)
def test_authority_matches_the_shared_minter(
    roles: tuple[str, ...], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every authority field is identical; only the route differs."""

    def _fake_resolve_placement(graph, endpoints, config, **kwargs):  # noqa: ANN001, ANN202
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

    def _explode(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
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
    session = mint_frontend_graph_session(_actor('admin', 'offline_access'))
    assert session.scopes == frozenset()


def test_unauthenticated_actor_is_refused() -> None:
    actor = ActorContext(
        actor_id='subject-1', tenant_id='homelab', authenticated=False
    )
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
