"""Tests for the Decisions endpoints (EH-046/047): list/detail/provenance and
the calibration aggregate over epistemic-graph's committed decision log
(`agent/agent_webui/api_extensions.py`'s Decisions section).

These call the route handler functions directly (`agent_webui.api_extensions
.list_decisions(...)` etc.) rather than driving them through `TestClient` +
the full app -- the same deliberate choice `test_agent_library_endpoints.py`
documents and justifies (no configured `WEBUI_OIDC_*` verifier in this
environment; that boundary is owned by a sibling lane and already pinned by
`test_identity_middleware_boundary.py`).

Two read paths, per the 2026-09-24 ruling (`uql-followups` lane, EG commit
`8efed824e` reverted decide-consumers' own `DecisionLog.query` op, EH-066;
read `/var/tmp/l9/finish/uql-followups/STATE.md` and
`src/server/handlers/decide/stat_view.rs` on that worktree for the full
story):

* `list_decisions`/`get_decision_provenance` now read the reserved
  `decisions`/`decision_evaluations`/`decision_resolutions` relations
  through the general `EpistemicGraphClient.query.sql` method -- ALREADY on
  the installed EG wheel (confirmed: `epistemic_graph/client.py:11432`,
  `async def sql`), so these two are tested against the real method
  signature, no `sys.modules` stub needed.
* `get_decision`/`get_decision_aggregate` still use `DecisionLog`'s `Get`/
  `Aggregate` ops (unaffected by the reversal -- only `Query` was dropped),
  reached through `epistemic_graph.decision_client`, which is NOT yet on the
  installed EG wheel (decide-consumers' own new module, lands with this
  train). `_install_fake_decision_client` stubs it into `sys.modules` with
  the exact call shape read directly from its source
  (`epistemic_graph/decision_client.py` on the decide-consumers worktree)
  so these two are tested against the real call shape today and keep
  passing, unchanged, once the module lands.
"""

import asyncio
import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _patched_engine(engine):
    return patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=engine,
    )


def _patched_session(
    tenant='tenant-a', graph='tenant-a__graph', roles=('admin:decision-eval',)
):
    if tenant is None:
        return patch(
            'agent_utilities.knowledge_graph.core.session.current_session',
            return_value=None,
        )
    session = MagicMock()
    session.tenant = tenant
    session.graph = graph
    session.actor.roles = roles
    return patch(
        'agent_utilities.knowledge_graph.core.session.current_session',
        return_value=session,
    )


class _FakeDecisionClient:
    """Stands in for `epistemic_graph.decision_client.DecisionClient`."""

    def __init__(self, client, graph=None):
        self.client = client
        self.graph = graph

    async def log(self, op):
        _FAKE_LOG_CALLS.append(op)
        return _FAKE_RESPONDER[0](op)


_FAKE_LOG_CALLS: list = []
_FAKE_RESPONDER = [lambda op: None]


def _install_fake_decision_client(responder):
    """Patch `epistemic_graph.decision_client` into `sys.modules` for the
    duration of the context; `responder(op) -> Any` decides each call's
    return payload (the raw dict a generated sender's `.payload` carries).
    Only `get_op`/`aggregate_op` are provided -- `query_op` was reverted
    (EH-066) and no longer exists on the real module either."""

    _FAKE_LOG_CALLS.clear()
    _FAKE_RESPONDER[0] = responder
    fake_module = types.SimpleNamespace(
        DecisionClient=_FakeDecisionClient,
        get_op=lambda tenant_id, record_id: {
            'op': 'get',
            'tenant_id': tenant_id,
            'record_id': record_id,
        },
        aggregate_op=lambda tenant_id, window, question_id=None: {
            'op': 'aggregate',
            'tenant_id': tenant_id,
            'window': {'from_ms': window[0], 'to_ms': window[1]},
            'question_id': question_id,
        },
    )
    return patch.dict(sys.modules, {'epistemic_graph.decision_client': fake_module})


def run(coro):
    return asyncio.run(coro)


def _without_decision_client():
    """A pre-decide-consumers EG: importing `epistemic_graph.decision_client`
    raises `ImportError` whatever EG build the test environment carries."""
    return patch.dict(sys.modules, {'epistemic_graph.decision_client': None})


@pytest.fixture
def mock_engine():
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine

    engine = MagicMock(spec=IntelligenceGraphEngine)
    engine.backend = MagicMock()
    engine.backend._graph.client = MagicMock()
    engine.backend._graph.client.query.sql = AsyncMock(return_value=[])
    return engine


def _mock_sql(engine, responder):
    """Wire `engine.backend._graph.client.query.sql` to `responder(sql_text)
    -> list[dict]`, matching `EpistemicGraphClient.query.sql`'s real return
    shape (already-zipped row dicts, not a `{columns, rows}` envelope)."""

    mock = AsyncMock(side_effect=lambda sql: responder(sql))
    engine.backend._graph.client.query.sql = mock
    return mock


# --------------------------------------------------------------------- list


def test_list_decisions_returns_rows(mock_engine):
    from agent_webui.api_extensions import list_decisions

    sql_mock = _mock_sql(
        mock_engine,
        lambda sql: [
            {
                'record_id': 'decision:abc',
                'outcome': 'solved',
                'committed_at_ms': 1700000000000,
            }
        ],
    )
    with _patched_engine(mock_engine), _patched_session():
        rows = run(list_decisions())
    assert rows == [
        {
            'record_id': 'decision:abc',
            'outcome': 'solved',
            'committed_at_ms': 1700000000000,
        }
    ]
    sent_sql = sql_mock.call_args.args[0]
    assert 'FROM decisions' in sent_sql
    assert 'decision_evaluations' not in sent_sql


def test_list_decisions_clamps_the_row_limit(mock_engine):
    from agent_webui.api_extensions import list_decisions

    sql_mock = _mock_sql(mock_engine, lambda sql: [])
    with _patched_engine(mock_engine), _patched_session():
        run(list_decisions(limit=999999))
    assert 'LIMIT 200' in sql_mock.call_args.args[0]


def test_list_decisions_filters_by_question_id(mock_engine):
    from agent_webui.api_extensions import list_decisions

    sql_mock = _mock_sql(mock_engine, lambda sql: [])
    with _patched_engine(mock_engine), _patched_session():
        run(list_decisions(question_id='assemble'))
    assert "question_id = 'assemble'" in sql_mock.call_args.args[0]


def test_list_decisions_rejects_an_unsafe_question_filter(mock_engine):
    from agent_webui.api_extensions import list_decisions
    from fastapi import HTTPException

    with _patched_engine(mock_engine), _patched_session():
        with pytest.raises(HTTPException) as exc:
            run(list_decisions(question_id="'; DROP TABLE decisions; --"))
    assert exc.value.status_code == 400


def test_list_decisions_requires_a_tenant_session(mock_engine):
    from agent_webui.api_extensions import list_decisions
    from fastapi import HTTPException

    with _patched_engine(mock_engine), _patched_session(tenant=None):
        with pytest.raises(HTTPException) as exc:
            run(list_decisions())
    assert exc.value.status_code == 401


def test_list_decisions_reports_no_client_as_unavailable(mock_engine):
    mock_engine.backend._graph.client = None
    from agent_webui.api_extensions import list_decisions
    from fastapi import HTTPException

    with _patched_engine(mock_engine), _patched_session():
        with pytest.raises(HTTPException) as exc:
            run(list_decisions())
    assert exc.value.status_code == 501


def test_list_decisions_reports_transport_failure(mock_engine):
    from agent_webui.api_extensions import list_decisions
    from fastapi import HTTPException

    def _boom(_sql):
        raise RuntimeError('engine unreachable')

    _mock_sql(mock_engine, _boom)
    with _patched_engine(mock_engine), _patched_session():
        with pytest.raises(HTTPException) as exc:
            run(list_decisions())
    assert exc.value.status_code == 503
    assert 'engine unreachable' not in str(exc.value.detail)


# ------------------------------------------------------------------- detail


def test_get_decision_returns_the_record(mock_engine):
    from agent_webui.api_extensions import get_decision

    record = {'record_id': 'decision:abc', 'evidence_class': 'claim', 'premises': []}
    with (
        _patched_engine(mock_engine),
        _patched_session(),
        _install_fake_decision_client(lambda op: record),
    ):
        result = run(get_decision('decision:abc'))
    assert result['record_id'] == 'decision:abc'
    assert _FAKE_LOG_CALLS[0] == {
        'op': 'get',
        'tenant_id': 'tenant-a',
        'record_id': 'decision:abc',
    }


def test_get_decision_reports_a_missing_record_as_not_found(mock_engine):
    from agent_webui.api_extensions import get_decision
    from fastapi import HTTPException

    with (
        _patched_engine(mock_engine),
        _patched_session(),
        _install_fake_decision_client(lambda op: None),
    ):
        with pytest.raises(HTTPException) as exc:
            run(get_decision('decision:missing'))
    assert exc.value.status_code == 404


def test_get_decision_rejects_an_unsafe_record_id(mock_engine):
    from agent_webui.api_extensions import get_decision
    from fastapi import HTTPException

    with _patched_engine(mock_engine), _patched_session():
        with pytest.raises(HTTPException) as exc:
            run(get_decision('not a valid id'))
    assert exc.value.status_code == 400


def test_get_decision_reports_no_decide_module_as_unavailable(mock_engine):
    """No `epistemic_graph.decision_client` at all (a pre-decide-consumers EG
    build) -- the guarded single import point in `_decision_client_module`
    must convert that `ImportError` to a clean 501, never let it propagate as
    an unhandled `ModuleNotFoundError`."""
    from agent_webui.api_extensions import get_decision
    from fastapi import HTTPException

    with _patched_engine(mock_engine), _patched_session(), _without_decision_client():
        with pytest.raises(HTTPException) as exc:
            run(get_decision('decision:abc'))
    assert exc.value.status_code == 501


# --------------------------------------------------------------- provenance


def test_get_decision_provenance_returns_both_relations(mock_engine):
    from agent_webui.api_extensions import get_decision_provenance

    def _responder(sql):
        if 'FROM decision_evaluations' in sql:
            return [{'evaluation_id': 'eval-1', 'success': True}]
        assert 'FROM decision_resolutions' in sql
        return [{'resolution_id': 'res-1', 'option_id': 'opt-a'}]

    sql_mock = _mock_sql(mock_engine, _responder)
    with _patched_engine(mock_engine), _patched_session():
        result = run(get_decision_provenance('decision:abc'))
    assert result['evaluations'] == [{'evaluation_id': 'eval-1', 'success': True}]
    assert result['resolutions'] == [{'resolution_id': 'res-1', 'option_id': 'opt-a'}]
    assert sql_mock.await_count == 2


def test_get_decision_provenance_escapes_the_record_id(mock_engine):
    from agent_webui.api_extensions import get_decision_provenance
    from fastapi import HTTPException

    # A record id containing a single quote is syntactically valid under
    # `_SAFE_DELEGATION_TOKEN` (colons/dots/dashes/underscores only) -- this
    # asserts the id token itself simply cannot carry one, closing the
    # question without relying on string-escaping alone.
    with _patched_engine(mock_engine), _patched_session():
        with pytest.raises(HTTPException) as exc:
            run(get_decision_provenance("decision:abc' OR '1'='1"))
    assert exc.value.status_code == 400


# ---------------------------------------------------------------- aggregate


def test_get_decision_aggregate_returns_rows(mock_engine):
    from agent_webui.api_extensions import get_decision_aggregate

    aggregate = {
        'schema_version': 1,
        'min_support': 10,
        'rows': [
            {
                'option_id': 'agent:writer',
                'question_id': 'assemble',
                'trials': 40,
                'successes': 32,
                'refused': 2,
                'by_fidelity': {
                    'full_step': 30,
                    'tool_calls': 8,
                    'final_output': 2,
                    'censored': 0,
                },
                'pooled_rate': None,
            }
        ],
    }
    with (
        _patched_engine(mock_engine),
        _patched_session(),
        _install_fake_decision_client(lambda op: aggregate),
    ):
        result = run(get_decision_aggregate())
    assert result['min_support'] == 10
    assert result['rows'][0]['option_id'] == 'agent:writer'
    assert _FAKE_LOG_CALLS[0]['op'] == 'aggregate'


def test_get_decision_aggregate_rejects_an_inverted_window(mock_engine):
    from agent_webui.api_extensions import get_decision_aggregate
    from fastapi import HTTPException

    with _patched_engine(mock_engine), _patched_session():
        with pytest.raises(HTTPException) as exc:
            run(get_decision_aggregate(from_ms=2_000, to_ms=1_000))
    assert exc.value.status_code == 400


def test_get_decision_aggregate_reports_no_decide_module_as_unavailable(mock_engine):
    from agent_webui.api_extensions import get_decision_aggregate
    from fastapi import HTTPException

    with _patched_engine(mock_engine), _patched_session(), _without_decision_client():
        with pytest.raises(HTTPException) as exc:
            run(get_decision_aggregate())
    assert exc.value.status_code == 501


def test_evaluation_receipts_bind_tenant_and_bound_page(mock_engine):
    from agent_webui.api_extensions import list_decision_evaluation_receipts

    sender = AsyncMock(
        return_value=types.SimpleNamespace(payload={'receipts': [], 'next_after': None})
    )
    with (
        _patched_engine(mock_engine),
        _patched_session(tenant='verified-tenant'),
        patch('epistemic_graph.generated.coordination.send_decision_eval', sender),
    ):
        result = run(list_decision_evaluation_receipts(limit=2))
    assert result == {'receipts': [], 'next_after': None}
    assert sender.await_args is not None
    assert sender.await_args.args[1] == {
        'op': {
            'op': 'receipts',
            'request': {'tenant_id': 'verified-tenant', 'after': None, 'limit': 2},
        }
    }


def test_evaluation_receipts_reject_bad_cursor_before_engine(mock_engine):
    from agent_webui.api_extensions import list_decision_evaluation_receipts
    from fastapi import HTTPException

    with _patched_engine(mock_engine), _patched_session():
        with pytest.raises(HTTPException) as exc:
            run(list_decision_evaluation_receipts(after='not-a-digest'))
    assert exc.value.status_code == 400


def test_evaluation_receipts_reject_verified_reader_without_admin_scope(mock_engine):
    from agent_webui.api_extensions import list_decision_evaluation_receipts
    from fastapi import HTTPException

    sender = AsyncMock()
    with (
        _patched_engine(mock_engine),
        _patched_session(roles=('kg:read',)),
        patch('epistemic_graph.generated.coordination.send_decision_eval', sender),
    ):
        with pytest.raises(HTTPException) as exc:
            run(list_decision_evaluation_receipts())
    assert exc.value.status_code == 403
    sender.assert_not_awaited()


def test_evaluation_receipts_real_browser_route_requires_verified_admin(
    mock_agent, mock_workspace_helpers, authenticated_client_factory, mock_engine
):
    from agent_webui.server import create_agent_web_app
    from fastapi.testclient import TestClient

    app = create_agent_web_app(mock_agent, mock_workspace_helpers)
    bare = TestClient(app, raise_server_exceptions=False)
    assert bare.get('/api/enhanced/decisions/evaluation-receipts').status_code == 401

    sender = AsyncMock(
        return_value=types.SimpleNamespace(payload={'receipts': [], 'next_after': None})
    )
    with (
        _patched_engine(mock_engine),
        patch('epistemic_graph.generated.coordination.send_decision_eval', sender),
    ):
        reader = authenticated_client_factory(
            app, scope='kg:read', raise_server_exceptions=False
        )
        assert (
            reader.get('/api/enhanced/decisions/evaluation-receipts').status_code == 403
        )
        admin = authenticated_client_factory(
            app, scope='kg:read admin:decision-eval', raise_server_exceptions=False
        )
        response = admin.get('/api/enhanced/decisions/evaluation-receipts')
    assert response.status_code == 200
    assert response.json() == {'receipts': [], 'next_after': None}
    assert sender.await_args is not None
    assert sender.await_args.args[1]['op']['request']['tenant_id'] == 'test-tenant'


def test_evaluation_timeline_uses_server_time_cursor_and_verified_tenant(mock_engine):
    from agent_webui.api_extensions import list_decision_evaluation_timeline

    cursor = '00000001700000000000:sha256:' + 'a' * 64
    page = {
        'entries': [
            {
                'submitted_at_ms': 1700000000000,
                'receipt': {'receipt_digest': 'sha256:' + 'b' * 64},
                'threshold_alert': {
                    'policy_digest': 'sha256:' + 'c' * 64,
                    'insufficient_support': False,
                    'coverage_below_policy': True,
                    'act_risk_above_policy': None,
                },
            }
        ],
        'next_after': None,
    }
    sender = AsyncMock(return_value=types.SimpleNamespace(payload=page))
    with (
        _patched_engine(mock_engine),
        _patched_session(tenant='verified-tenant'),
        patch('epistemic_graph.generated.coordination.send_decision_eval', sender),
    ):
        result = run(list_decision_evaluation_timeline(after=cursor, limit=2))
    assert result == page
    assert sender.await_args is not None
    assert sender.await_args.args[1]['op'] == {
        'op': 'timeline',
        'request': {'tenant_id': 'verified-tenant', 'after': cursor, 'limit': 2},
    }


def test_evaluation_timeline_rejects_unverified_cursor_before_engine(mock_engine):
    from agent_webui.api_extensions import list_decision_evaluation_timeline
    from fastapi import HTTPException

    with _patched_engine(mock_engine), _patched_session():
        with pytest.raises(HTTPException) as exc:
            run(list_decision_evaluation_timeline(after='sha256:' + 'a' * 64))
    assert exc.value.status_code == 400
