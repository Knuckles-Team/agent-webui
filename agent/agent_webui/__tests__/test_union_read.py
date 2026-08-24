"""FIX LANE Priority 1: the commons/tenant union read.

``tenant_sharing.accessible_graphs()``/``read_union()`` existed with zero
callers anywhere in the codebase before this lane -- the webui only ever read
``session.graph`` (the tenant shard), so it never reached the commons graph
where the fleet/tool catalog is deliberately written
(``tenant_sharing.COMMONS_SHAREABLE_NODE_TYPES``). These tests exercise the
wiring this lane added in ``api_extensions.py``: ``_read_union_cypher``,
``_read_union_scalar_sum``, and ``_read_union_sql_group_counts``.

Unlike the full HTTP round trip through ``TestClient``, these construct a
``GraphSession``/``ActorContext`` directly and use ``use_session`` (the same
pattern ``test_security_boundaries.py``/``test_ws_dashboard_denial_diagnostics
.py`` already use) so the set of accessible graphs is deterministic and
under the test's own control, rather than whatever the ambient identity
middleware's test fixture happens to resolve.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import agent_webui.api_extensions as api_extensions
import pytest
from agent_utilities.knowledge_graph.core.session import (
    GraphSession,
    current_session,
    use_session,
)
from agent_utilities.security.brain_context import ActorContext

_TENANT_GRAPH = 'tenant__acme____commons__'
_COMMONS_GRAPH = '__commons__'
_OTHER_TENANT_GRAPH = 'tenant__other-org____commons__'


def _actor(tenant: str = 'acme') -> ActorContext:
    return ActorContext(
        actor_id='subject-1',
        tenant_id=tenant,
        roles=('kg:read',),
        authenticated=True,
    )


def _session(*, graph: str = _TENANT_GRAPH) -> GraphSession:
    return GraphSession(
        actor=_actor(),
        tenant='acme',
        scopes=frozenset({'kg:read'}),
        graph=graph,
    )


@pytest.fixture(autouse=True)
def _patch_accessible_graphs(monkeypatch: pytest.MonkeyPatch):
    """Deterministic, test-controlled ``accessible_graphs`` -- exactly the
    tenant shard then the commons graph, never a second tenant's shard.
    Isolation itself is `tenant_sharing.accessible_graphs`'s own audited
    contract; these tests prove THIS lane's wiring never reaches beyond
    whatever that function returns.
    """

    def _fake(actor):
        assert actor is not None
        return [_TENANT_GRAPH, _COMMONS_GRAPH]

    monkeypatch.setattr(api_extensions, '_accessible_graphs', _fake)
    yield


class TestReadUnionCypher:
    def test_merges_commons_rows_a_tenant_only_read_would_miss(self):
        """A `:Tool` row that lives ONLY in the commons graph must appear in
        the union even though it is absent from the tenant shard -- the
        concrete acceptance criterion this lane was asked to satisfy."""

        engine = MagicMock()

        def _query_cypher(cypher, params=None):
            graph = current_session().graph
            if graph == _TENANT_GRAPH:
                return [{'id': 'n1', 'name': 'tenant-node'}]
            if graph == _COMMONS_GRAPH:
                return [{'id': 't1', 'name': 'Tool-A'}]
            raise AssertionError(f'unexpected graph queried: {graph}')

        engine.query_cypher.side_effect = _query_cypher

        async def _run():
            with use_session(_session()):
                return await api_extensions._read_union_cypher(
                    engine,
                    'MATCH (t:Tool) RETURN t.id as id, t.name as name',
                    None,
                    deadline=5.0,
                )

        import asyncio

        rows, source_graphs = asyncio.run(_run())

        ids = {row['id'] for row in rows}
        assert ids == {'n1', 't1'}
        assert set(source_graphs) == {_TENANT_GRAPH, _COMMONS_GRAPH}

    def test_never_visits_a_graph_outside_accessible_graphs(self):
        """The isolation proof for THIS lane's integration: the set of
        graphs actually queried is exactly `_accessible_graphs()`'s return
        value -- never wider (e.g. a second tenant's shard), never narrower.
        """

        engine = MagicMock()
        visited: list[str] = []

        def _query_cypher(cypher, params=None):
            visited.append(current_session().graph)
            return []

        engine.query_cypher.side_effect = _query_cypher

        async def _run():
            with use_session(_session()):
                return await api_extensions._read_union_cypher(
                    engine, 'MATCH (n) RETURN n.id as id', None, deadline=5.0
                )

        import asyncio

        asyncio.run(_run())

        assert set(visited) == {_TENANT_GRAPH, _COMMONS_GRAPH}
        assert _OTHER_TENANT_GRAPH not in visited

    def test_falls_back_to_single_graph_read_with_no_ambient_session(self):
        """No verified ambient authority -> exactly today's single-graph
        behavior (one call, no union), never a raise and never a fabricated
        wider read."""

        engine = MagicMock()
        engine.query_cypher.return_value = [{'id': 'x'}]

        async def _run():
            assert current_session() is None
            return await api_extensions._read_union_cypher(
                engine, 'MATCH (n) RETURN n.id as id', None, deadline=5.0
            )

        import asyncio

        rows, source_graphs = asyncio.run(_run())

        assert rows == [{'id': 'x'}]
        assert source_graphs == []
        assert engine.query_cypher.call_count == 1

    def test_write_target_is_restored_after_a_union_read(self):
        """READS ONLY: after `_read_union_cypher` runs (which internally
        retargets the ambient session to the commons graph for one leg of
        the union), the ambient session's `graph` -- the write target --
        must be back to the tenant shard, unchanged, for any write a caller
        issues afterward."""

        engine = MagicMock()
        engine.query_cypher.return_value = []

        async def _run():
            session = _session()
            with use_session(session):
                await api_extensions._read_union_cypher(
                    engine, 'MATCH (n) RETURN n.id as id', None, deadline=5.0
                )
                assert current_session() is session
                assert current_session().graph == _TENANT_GRAPH

        import asyncio

        asyncio.run(_run())


class TestReadUnionScalarSum:
    def test_sums_counts_across_graphs_rather_than_deduping(self):
        """An aggregate row carries no per-row node id -- `read_union`'s
        id-dedup does not apply, and the correct merge of independent
        per-graph totals (physically partitioned graphs never share a node
        id, GOC-61) is a SUM."""

        engine = MagicMock()

        def _query_cypher(cypher, params=None):
            graph = current_session().graph
            if graph == _TENANT_GRAPH:
                return [{'count': 25116}]
            if graph == _COMMONS_GRAPH:
                return [{'count': 31737}]
            raise AssertionError(graph)

        engine.query_cypher.side_effect = _query_cypher

        async def _run():
            with use_session(_session()):
                return await api_extensions._read_union_scalar_sum(
                    engine,
                    'MATCH (n) RETURN count(n) as count',
                    None,
                    field='count',
                    deadline=5.0,
                )

        import asyncio

        total, source_graphs = asyncio.run(_run())

        assert total == 25116 + 31737
        assert set(source_graphs) == {_TENANT_GRAPH, _COMMONS_GRAPH}


class TestReadUnionSqlGroupCounts:
    def test_merges_by_summing_counts_per_key(self):
        engine = MagicMock()

        def _sql_exec(statement):
            graph = current_session().graph
            if graph == _TENANT_GRAPH:
                return [{'type': 'Memory', 'n': 20}, {'type': 'Tool', 'n': 0}]
            if graph == _COMMONS_GRAPH:
                return [
                    {'type': 'Tool', 'n': 2941},
                    {'type': 'CallableResource', 'n': 361},
                ]
            raise AssertionError(graph)

        engine.graph_compute.sql_exec.side_effect = _sql_exec

        async def _run():
            with use_session(_session()):
                return await api_extensions._read_union_sql_group_counts(
                    engine,
                    'SELECT type, COUNT(*) AS n FROM nodes GROUP BY type',
                    key='type',
                    count_field='n',
                    deadline=5.0,
                )

        import asyncio

        counts, source_graphs = asyncio.run(_run())

        assert counts == {'Memory': 20, 'Tool': 2941, 'CallableResource': 361}
        assert set(source_graphs) == {_TENANT_GRAPH, _COMMONS_GRAPH}

    def test_a_genuine_zero_is_representable_not_dropped(self):
        """Unlike the retired hardcoded allowlist's `if count > 0`, a real
        zero-count type must survive the merge."""

        engine = MagicMock()
        engine.graph_compute.sql_exec.return_value = [{'type': 'Article', 'n': 0}]

        async def _run():
            with use_session(_session()):
                return await api_extensions._read_union_sql_group_counts(
                    engine,
                    'SELECT type, COUNT(*) AS n FROM nodes GROUP BY type',
                    key='type',
                    count_field='n',
                    deadline=5.0,
                )

        import asyncio

        counts, _source_graphs = asyncio.run(_run())

        assert counts['Article'] == 0
