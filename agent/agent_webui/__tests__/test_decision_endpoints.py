"""Tests for the Decisions endpoints (EH-046/047): list/detail/provenance and
the calibration aggregate over epistemic-graph's committed `DecisionLog`
(`agent/agent_webui/api_extensions.py`'s Decisions section).

These call the route handler functions directly (`agent_webui.api_extensions
.list_decisions(...)` etc.) rather than driving them through `TestClient` +
the full app -- the same deliberate choice `test_agent_library_endpoints.py`
documents and justifies (no configured `WEBUI_OIDC_*` verifier in this
environment; that boundary is owned by a sibling lane and already pinned by
`test_identity_middleware_boundary.py`).

`epistemic_graph.decision_client` -- the generated Python client the
decide-consumers lane built for exactly this surface -- is not yet on the
EG wheel this repo's environment installs (it lands with that lane in this
same train; see `/var/tmp/l9/finish/MAIN-MOVES.md` and
`/var/tmp/l9/finish/decide-consumers/WRAPUP.md`). `_install_fake_decision_client`
stubs it into `sys.modules` with the exact call shape read directly from
its source (`epistemic_graph/decision_client.py` on the decide-consumers
worktree: `DecisionClient(client, graph=None).log(op)`, `get_op`/`query_op`/
`aggregate_op` building `{"op": ..., "tenant_id": ..., ...}` dicts) so these
tests exercise this lane's own route logic today and keep passing, unchanged,
once the real module lands.
"""

import asyncio
import sys
import types
from unittest.mock import MagicMock, patch

import pytest


def _patched_engine(engine):
    return patch(
        'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
        return_value=engine,
    )


def _patched_session(tenant='tenant-a', graph='tenant-a__graph'):
    if tenant is None:
        return patch(
            'agent_utilities.knowledge_graph.core.session.current_session',
            return_value=None,
        )
    session = MagicMock()
    session.tenant = tenant
    session.graph = graph
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
    return payload (the raw dict a generated sender's `.payload` carries)."""

    _FAKE_LOG_CALLS.clear()
    _FAKE_RESPONDER[0] = responder
    fake_module = types.SimpleNamespace(
        DecisionClient=_FakeDecisionClient,
        get_op=lambda tenant_id, record_id: {
            'op': 'get',
            'tenant_id': tenant_id,
            'record_id': record_id,
        },
        query_op=lambda tenant_id, sql: {'op': 'query', 'tenant_id': tenant_id, 'sql': sql},
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


@pytest.fixture
def mock_engine():
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine

    engine = MagicMock(spec=IntelligenceGraphEngine)
    engine.backend = MagicMock()
    engine.backend._graph.async_client = MagicMock()
    return engine


def _rows_payload(columns, rows):
    """One `DecisionLogRows`-shaped payload: `rows` is a list of plain
    Python values, wrapped as the engine's `{"cell": ..., "value": ...}`
    tagged cells in column order."""

    kinds = {str: 'text', bool: 'bool', int: 'int', type(None): 'null'}
    return {
        'schema_version': 1,
        'columns': list(columns),
        'rows': [[{'cell': kinds[type(v)], 'value': v} for v in row] for row in rows],
    }


# --------------------------------------------------------------------- list


def test_list_decisions_returns_rows(mock_engine):
    from agent_webui.api_extensions import list_decisions

    payload = _rows_payload(
        ['record_id', 'outcome', 'committed_at_ms'],
        [['decision:abc', 'solved', 1700000000000]],
    )
    with (
        _patched_engine(mock_engine),
        _patched_session(),
        _install_fake_decision_client(lambda op: payload),
    ):
        rows = run(list_decisions())
    assert rows == [{'record_id': 'decision:abc', 'outcome': 'solved', 'committed_at_ms': 1700000000000}]
    assert _FAKE_LOG_CALLS[0]['op'] == 'query'
    assert _FAKE_LOG_CALLS[0]['tenant_id'] == 'tenant-a'
    assert 'FROM decisions' in _FAKE_LOG_CALLS[0]['sql']


def test_list_decisions_clamps_the_row_limit(mock_engine):
    from agent_webui.api_extensions import list_decisions

    with (
        _patched_engine(mock_engine),
        _patched_session(),
        _install_fake_decision_client(lambda op: _rows_payload(['record_id'], [])),
    ):
        run(list_decisions(limit=999999))
    assert 'LIMIT 200' in _FAKE_LOG_CALLS[0]['sql']


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


def test_list_decisions_reports_no_engine_as_unavailable(mock_engine):
    from agent_webui.api_extensions import list_decisions
    from fastapi import HTTPException

    mock_engine.backend._graph.async_client = None
    with _patched_engine(mock_engine), _patched_session():
        with pytest.raises(HTTPException) as exc:
            run(list_decisions())
    assert exc.value.status_code == 501


def test_list_decisions_reports_transport_failure(mock_engine):
    from agent_webui.api_extensions import list_decisions
    from fastapi import HTTPException

    def _boom(_op):
        raise RuntimeError('engine unreachable')

    with _patched_engine(mock_engine), _patched_session(), _install_fake_decision_client(_boom):
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

    with _patched_engine(mock_engine), _patched_session(), _install_fake_decision_client(lambda op: None):
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


# --------------------------------------------------------------- provenance


def test_get_decision_provenance_returns_both_relations(mock_engine):
    from agent_webui.api_extensions import get_decision_provenance

    def _responder(op):
        if 'FROM evaluations' in op['sql']:
            return _rows_payload(['evaluation_id', 'success'], [['eval-1', True]])
        return _rows_payload(['resolution_id', 'option_id'], [['res-1', 'opt-a']])

    with _patched_engine(mock_engine), _patched_session(), _install_fake_decision_client(_responder):
        result = run(get_decision_provenance('decision:abc'))
    assert result['evaluations'] == [{'evaluation_id': 'eval-1', 'success': True}]
    assert result['resolutions'] == [{'resolution_id': 'res-1', 'option_id': 'opt-a'}]
    assert len(_FAKE_LOG_CALLS) == 2


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
                'by_fidelity': {'full_step': 30, 'tool_calls': 8, 'final_output': 2, 'censored': 0},
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


# --------------------------------------------------------------- unit-level


def test_view_cell_reads_the_value_field():
    from agent_webui.api_extensions import _view_cell

    assert _view_cell({'cell': 'text', 'value': 'x'}) == 'x'
    assert _view_cell({'cell': 'null'}) is None
    assert _view_cell('already-plain') == 'already-plain'


def test_decision_rows_to_dicts_zips_columns_and_cells():
    from agent_webui.api_extensions import _decision_rows_to_dicts

    payload = _rows_payload(['a', 'b'], [[1, 'x'], [2, 'y']])
    assert _decision_rows_to_dicts(payload) == [{'a': 1, 'b': 'x'}, {'a': 2, 'b': 'y'}]
    assert _decision_rows_to_dicts({'not': 'a rows payload'}) == []
    assert _decision_rows_to_dicts(None) == []
