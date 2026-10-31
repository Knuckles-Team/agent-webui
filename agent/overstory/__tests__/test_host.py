"""The host seam: settings, request grant, bearer parsing, served operations."""

from __future__ import annotations

from typing import Any

import pytest
from overstory import host
from overstory.orchestrator_model import build_orchestrator_model
from pydantic_ai.messages import ModelRequest, UserPromptPart
from pydantic_ai.models.function import AgentInfo


def _actor(**overrides: Any) -> host.ActorContext:
    fields: dict[str, Any] = {
        'actor_id': 'alice',
        'tenant_id': 'acme',
        'authenticated': True,
    }
    fields.update(overrides)
    return host.ActorContext(**fields)


class _FakeTransport:
    def __init__(self, result: dict[str, Any]) -> None:
        self.result = result
        self.calls: list[tuple[str, dict[str, Any], str | None]] = []

    async def invoke(self, op_id, params, *, idempotency_key=None):
        self.calls.append((op_id, dict(params), idempotency_key))
        return self.result


def test_settings_read_environment_and_accept_overrides(monkeypatch) -> None:
    monkeypatch.setenv('MAX_UPLOAD_SIZE', '2048')
    monkeypatch.setenv('GATEWAY_RATE_LIMIT', 'not-a-number')
    assert host.config.max_upload_size == 2048
    assert host.config.gateway_rate_limit == 0.0
    host.config.gateway_rate_limit = 5.0
    assert host.config.gateway_rate_limit == 5.0
    with pytest.raises(AttributeError):
        host.config.no_such_field = 1


@pytest.mark.parametrize(
    ('roles', 'admins', 'expected'),
    [
        ((), '', {'kg:read'}),
        (('kg:write',), '', {'kg:read', 'kg:write'}),
        (('kg:admin',), '', {'kg:read', 'kg:write', 'kg:admin'}),
        ((), 'alice', {'kg:read', 'kg:write', 'kg:admin'}),
        (('unrelated',), 'bob', {'kg:read'}),
    ],
)
def test_grant_scopes_are_hierarchical(monkeypatch, roles, admins, expected) -> None:
    monkeypatch.setenv('KG_ADMIN_PRINCIPAL_IDS', admins)
    grant = host.grant_for(_actor(roles=roles))
    assert grant.scopes == expected
    assert grant.tenant == 'acme'


@pytest.mark.parametrize(
    'actor',
    [
        _actor(authenticated=False),
        _actor(tenant_id=''),
        _actor(credential_expires_at=1),
    ],
)
def test_grant_refuses_unverified_actors(actor) -> None:
    with pytest.raises(PermissionError):
        host.grant_for(actor)


@pytest.mark.parametrize(
    ('headers', 'expected'),
    [
        ([], None),
        ([b'Bearer abc.def'], 'abc.def'),
        ([b'bearer x'], 'x'),
    ],
)
def test_bearer_parsing_accepts_one_credential(headers, expected) -> None:
    assert host.parse_bearer_authorization(headers) == expected


@pytest.mark.parametrize(
    'headers',
    [[b'Bearer a', b'Bearer b'], [b'Basic abc'], [b'Bearer '], [b'Bearer x' + b'\x7f']],
)
def test_bearer_parsing_refuses_ambiguous_credentials(headers) -> None:
    with pytest.raises(PermissionError):
        host.parse_bearer_authorization(headers)


def test_actor_from_claims_projects_identity() -> None:
    actor = host.actor_from_claims(
        {
            'sub': 'alice',
            'tid': 'acme',
            'email': 'alice@example.invalid',
            'scope': 'kg:write extra',
            'groups': ['ops'],
            'realm_access': {'roles': ['kg:read']},
            'exp': 4_102_444_800,
        },
        credential='token',
    )
    assert (actor.actor_id, actor.tenant_id, actor.actor_type) == (
        'alice',
        'acme',
        'human',
    )
    assert {'kg:write', 'kg:read', 'ops'} <= set(actor.roles)
    assert actor.groups == ('ops',)
    assert actor.credential == 'token'
    with pytest.raises(ValueError):
        host.actor_from_claims({'tid': 'acme'})


def test_current_actor_fails_closed_without_binding() -> None:
    with pytest.raises(host.IdentityRequiredError):
        host.current_actor()
    with host.use_actor(_actor()) as bound:
        assert host.current_actor() is bound


async def test_verify_bearer_refuses_without_configured_verifier(monkeypatch) -> None:
    monkeypatch.delenv('AUTH_JWT_JWKS_URI', raising=False)
    host.config.reset()
    with pytest.raises(host.TokenValidationError):
        await host.verify_bearer('token')


def test_unavailable_is_a_501_naming_the_operation() -> None:
    error = host.unavailable('Graph browser', 'graph.nodes.list')
    assert error.status_code == 501
    assert error.detail['error'] == 'not_available'
    assert error.detail['needs_operation'] == 'graph.nodes.list'


async def test_invoke_operation_passes_the_idempotency_key() -> None:
    transport = _FakeTransport({'value': {}})
    await host.invoke_operation(
        'agents.tasks.list', {'limit': 5}, transport=transport, idempotency_key='k1'
    )
    assert transport.calls == [('agents.tasks.list', {'limit': 5}, 'k1')]


async def test_chat_turn_runs_through_served_agent_operation() -> None:
    calls: list[tuple[str, dict[str, Any], str | None]] = []

    async def invoke(op_id, params, *, idempotency_key=None):
        calls.append((op_id, params, idempotency_key))
        return {
            'value': {
                'status': {'message': {'parts': [{'kind': 'text', 'text': 'hi'}]}}
            }
        }

    model = build_orchestrator_model(agent_name='helper', invoke=invoke)
    messages = [ModelRequest(parts=[UserPromptPart(content='hello')])]
    info = AgentInfo(
        function_tools=[],
        allow_text_output=True,
        output_tools=[],
        model_settings=None,
        model_request_parameters=None,
        instructions='be brief',
    )
    response = await model.function(messages, info)
    assert response.parts[0].content == 'hi'
    op_id, params, key = calls[0]
    assert op_id == 'agents.run' and key
    assert params['message']['parts'] == [{'kind': 'text', 'text': 'hello'}]
    assert params['message']['metadata']['agent'] == 'helper'
