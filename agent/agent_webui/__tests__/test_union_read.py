"""FIX LANE Priority 1: the commons/tenant union read.

``tenant_sharing.accessible_graphs()``/``read_union()`` existed with zero
callers anywhere in the codebase before this lane -- the webui only ever read
``session.graph`` (the tenant shard), so it never reached the commons graph
where the fleet/tool catalog is deliberately written
(``tenant_sharing.COMMONS_SHAREABLE_NODE_TYPES``). These tests exercise the
wiring this lane added in ``api_extensions.py``: ``_read_union_cypher``,
``_read_union_scalar_sum``, ``_read_union_sql_group_counts``, and
``_rows_per_accessible_graph``.

Unlike the full HTTP round trip through ``TestClient``, these construct a
``GraphSession``/``ActorContext`` directly and use ``use_session`` (the same
pattern ``test_security_boundaries.py``/``test_ws_dashboard_denial_diagnostics
.py`` already use) so the set of accessible graphs is deterministic and
under the test's own control, rather than whatever the ambient identity
middleware's test fixture happens to resolve.

=== FIX LANE `fix/union-read-backend-view` (root-cause verified live in-pod) ===

The FIRST version of these tests used a bare ``MagicMock()`` as the fake
engine, with ``.query_cypher.side_effect`` branching on
``current_session().graph`` -- i.e. the fake happily answered for WHATEVER
graph the ambient session claimed, no matter which Python object
(``engine`` vs a correctly-retargeted graph-scoped view) the code under test
actually called the method on. That is exactly the gap that let the real
bug ship: production `engine`/`engine.backend` is itself a graph-scoped view
already pinned to the caller's OWN graph
(`EpistemicGraphBackend.graph_name` / `_SessionRoutedAsyncClient
._fixed_graph`); retargeting only the ambient `GraphSession` while
continuing to call methods on that pinned object raises `PermissionError:
"A graph-scoped view cannot retarget the verified GraphSession"` --
verified live against the cluster engine, and reproduced by
``_PinnedGraphEngine`` below. Every fake engine in this file is now that
double, not a permissive `MagicMock()`.
"""

from __future__ import annotations

from typing import Any

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


class _PinnedGraphEngine:
    """Test double mirroring the REAL production view-pinning guard
    (``graph_compute.GraphComputeEngine._send_routed``): a graph-scoped
    view's backend is fixed to exactly one graph
    (``self.graph_name``/``_fixed_graph``), and any read issued while the
    ambient ``GraphSession`` points somewhere else raises ``PermissionError``
    -- word-for-word the live error this lane root-caused: "A graph-scoped
    view cannot retarget the verified GraphSession".

    ``for_graph(graph_name)`` mirrors the real
    ``IntelligenceGraphEngine.for_graph`` seam: a NEW view pinned to
    ``graph_name`` (identity for the no-op case, `graph_name ==
    self.graph_name`), never a mutation of ``self``.

    Consequence for these tests: code that (bug-for-bug) retargets only the
    ambient session and keeps calling the ORIGINAL, still-pinned engine
    object reproduces the real 503 here. Code that correctly obtains
    ``engine.for_graph(graph_name)`` before calling does not. This double
    would have caught the shipped defect; the old permissive ``MagicMock()``
    could not.
    """

    def __init__(
        self,
        pinned_graph: str,
        cypher_data: dict[str, list[dict[str, Any]]] | None = None,
        sql_data: dict[str, list[dict[str, Any]]] | None = None,
        fail_graphs: frozenset[str] = frozenset(),
        visited: list[str] | None = None,
    ) -> None:
        self.graph_name = pinned_graph
        self._cypher_data = cypher_data or {}
        self._sql_data = sql_data or {}
        self._fail_graphs = fail_graphs
        self._visited = visited if visited is not None else []
        self.graph_compute = _PinnedGraphCompute(self)

    def for_graph(self, graph_name: str) -> _PinnedGraphEngine:
        if graph_name == self.graph_name:
            return self
        return _PinnedGraphEngine(
            graph_name,
            self._cypher_data,
            self._sql_data,
            self._fail_graphs,
            visited=self._visited,
        )

    def _assert_pinned_and_record(self) -> None:
        session = current_session()
        if session is None or session.graph != self.graph_name:
            raise PermissionError(
                'A graph-scoped view cannot retarget the verified GraphSession'
            )
        self._visited.append(self.graph_name)
        if self.graph_name in self._fail_graphs:
            raise RuntimeError(f'simulated backend failure: {self.graph_name}')

    def query_cypher(
        self, cypher: str, params: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        self._assert_pinned_and_record()
        return self._cypher_data.get(self.graph_name, [])


class _PinnedGraphCompute:
    """``engine.graph_compute.sql_exec`` half of ``_PinnedGraphEngine`` --
    same pinning guard, separate namespace (mirrors the real
    ``IntelligenceGraphEngine.graph_compute`` attribute)."""

    def __init__(self, owner: _PinnedGraphEngine) -> None:
        self._owner = owner

    def sql_exec(self, statement: str) -> list[dict[str, Any]]:
        self._owner._assert_pinned_and_record()
        return self._owner._sql_data.get(self._owner.graph_name, [])


class TestReadUnionCypher:
    def test_merges_commons_rows_a_tenant_only_read_would_miss(self):
        """A `:Tool` row that lives ONLY in the commons graph must appear in
        the union even though it is absent from the tenant shard -- the
        concrete acceptance criterion this lane was asked to satisfy."""

        engine = _PinnedGraphEngine(
            _TENANT_GRAPH,
            cypher_data={
                _TENANT_GRAPH: [{'id': 'n1', 'name': 'tenant-node'}],
                _COMMONS_GRAPH: [{'id': 't1', 'name': 'Tool-A'}],
            },
        )

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
        Data is planted for `_OTHER_TENANT_GRAPH` too (the double WOULD
        happily answer for it if asked) -- proving isolation requires
        showing it is never even attempted, not merely absent from the
        result.
        """

        visited: list[str] = []
        engine = _PinnedGraphEngine(
            _TENANT_GRAPH,
            cypher_data={
                _TENANT_GRAPH: [{'id': 'n1'}],
                _COMMONS_GRAPH: [{'id': 't1'}],
                _OTHER_TENANT_GRAPH: [{'id': 'leaked'}],
            },
            visited=visited,
        )

        async def _run():
            with use_session(_session()):
                return await api_extensions._read_union_cypher(
                    engine, 'MATCH (n) RETURN n.id as id', None, deadline=5.0
                )

        import asyncio

        rows, _source_graphs = asyncio.run(_run())

        assert set(visited) == {_TENANT_GRAPH, _COMMONS_GRAPH}
        assert _OTHER_TENANT_GRAPH not in visited
        assert 'leaked' not in {row['id'] for row in rows}

    def test_falls_back_to_single_graph_read_with_no_ambient_session(self):
        """No verified ambient authority -> exactly today's single-graph
        behavior (one call, no union), never a raise and never a fabricated
        wider read."""

        # No ambient session at all -> _read_union_cypher must call
        # engine.query_cypher directly rather than through _accessible_graphs
        # (there is no session.graph to pin against here).
        class _UnpinnedEngine:
            def __init__(self) -> None:
                self.calls = 0

            def query_cypher(self, cypher, params=None):
                self.calls += 1
                return [{'id': 'x'}]

        engine = _UnpinnedEngine()

        async def _run():
            assert current_session() is None
            return await api_extensions._read_union_cypher(
                engine, 'MATCH (n) RETURN n.id as id', None, deadline=5.0
            )

        import asyncio

        rows, source_graphs = asyncio.run(_run())

        assert rows == [{'id': 'x'}]
        assert source_graphs == []
        assert engine.calls == 1

    def test_write_target_is_restored_after_a_union_read(self):
        """READS ONLY: after `_read_union_cypher` runs (which internally
        retargets the ambient session to the commons graph for one leg of
        the union), the ambient session's `graph` -- the write target --
        must be back to the tenant shard, unchanged, for any write a caller
        issues afterward."""

        engine = _PinnedGraphEngine(
            _TENANT_GRAPH,
            cypher_data={_TENANT_GRAPH: [], _COMMONS_GRAPH: []},
        )

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

        engine = _PinnedGraphEngine(
            _TENANT_GRAPH,
            cypher_data={
                _TENANT_GRAPH: [{'count': 25116}],
                _COMMONS_GRAPH: [{'count': 31737}],
            },
        )

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

        total, source_graphs, degraded_graphs = asyncio.run(_run())

        assert total == 25116 + 31737
        assert set(source_graphs) == {_TENANT_GRAPH, _COMMONS_GRAPH}
        assert degraded_graphs == []

    def test_a_pinned_view_that_is_never_retargeted_would_have_failed_here(self):
        """Regression guard for the actual shipped defect: if the code under
        test reverted to calling the ORIGINAL (still tenant-pinned) engine
        object for the commons leg instead of `engine.for_graph(graph_name)`,
        `_PinnedGraphEngine` raises `PermissionError` exactly like the live
        cluster did -- proving this suite would catch the regression, unlike
        the permissive `MagicMock()` it replaces."""

        engine = _PinnedGraphEngine(
            _TENANT_GRAPH,
            cypher_data={
                _TENANT_GRAPH: [{'count': 1}],
                _COMMONS_GRAPH: [{'count': 1}],
            },
        )

        # Sanity: calling the ORIGINAL (tenant-pinned) object's query_cypher
        # while the ambient session points at commons is exactly the bug.
        async def _bugged_call():
            with use_session(_session(graph=_COMMONS_GRAPH)):
                engine.query_cypher('MATCH (n) RETURN count(n) as count')

        import asyncio

        with pytest.raises(PermissionError, match='cannot retarget'):
            asyncio.run(_bugged_call())

    def test_degrades_per_graph_instead_of_failing_the_whole_read(self):
        """FIX LANE Priority 2 (Defect 2): `tenant_sharing.read_union`
        documents "a missing commons graph degrades to org-only, never an
        error" -- `_read_union_scalar_sum` must match that contract instead
        of letting one graph's exception 503 the whole caller. The degraded
        graph must be reported explicitly, not silently dropped, so a
        partial total is never indistinguishable from a complete one."""

        engine = _PinnedGraphEngine(
            _TENANT_GRAPH,
            cypher_data={_TENANT_GRAPH: [{'count': 25116}]},
            fail_graphs=frozenset({_COMMONS_GRAPH}),
        )

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

        total, source_graphs, degraded_graphs = asyncio.run(_run())

        assert total == 25116
        assert source_graphs == [_TENANT_GRAPH]
        assert degraded_graphs == [_COMMONS_GRAPH]

    def test_never_visits_a_graph_outside_accessible_graphs(self):
        """Same isolation proof as `_read_union_cypher`'s, for the
        aggregate-sum path (`_rows_per_accessible_graph`)."""

        visited: list[str] = []
        engine = _PinnedGraphEngine(
            _TENANT_GRAPH,
            cypher_data={
                _TENANT_GRAPH: [{'count': 1}],
                _COMMONS_GRAPH: [{'count': 1}],
                _OTHER_TENANT_GRAPH: [{'count': 999}],
            },
            visited=visited,
        )

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

        total, _source_graphs, _degraded = asyncio.run(_run())

        assert set(visited) == {_TENANT_GRAPH, _COMMONS_GRAPH}
        assert _OTHER_TENANT_GRAPH not in visited
        assert total == 2  # 1 + 1, never the planted 999 from the other tenant


class TestReadUnionSqlGroupCounts:
    def test_merges_by_summing_counts_per_key(self):
        engine = _PinnedGraphEngine(
            _TENANT_GRAPH,
            sql_data={
                _TENANT_GRAPH: [
                    {'node_type': 'Memory', 'n': 20},
                    {'node_type': 'Tool', 'n': 0},
                ],
                _COMMONS_GRAPH: [
                    {'node_type': 'Tool', 'n': 2941},
                    {'node_type': 'CallableResource', 'n': 361},
                ],
            },
        )

        async def _run():
            with use_session(_session()):
                return await api_extensions._read_union_sql_group_counts(
                    engine,
                    'SELECT node_type, COUNT(*) AS n FROM nodes GROUP BY node_type',
                    key='node_type',
                    count_field='n',
                    deadline=5.0,
                )

        import asyncio

        counts, source_graphs, degraded_graphs = asyncio.run(_run())

        assert counts == {'Memory': 20, 'Tool': 2941, 'CallableResource': 361}
        assert set(source_graphs) == {_TENANT_GRAPH, _COMMONS_GRAPH}
        assert degraded_graphs == []

    def test_a_genuine_zero_is_representable_not_dropped(self):
        """Unlike the retired hardcoded allowlist's `if count > 0`, a real
        zero-count type must survive the merge."""

        engine = _PinnedGraphEngine(
            _TENANT_GRAPH,
            sql_data={_TENANT_GRAPH: [{'node_type': 'Article', 'n': 0}]},
        )

        async def _run():
            with use_session(_session()):
                return await api_extensions._read_union_sql_group_counts(
                    engine,
                    'SELECT node_type, COUNT(*) AS n FROM nodes GROUP BY node_type',
                    key='node_type',
                    count_field='n',
                    deadline=5.0,
                )

        import asyncio

        counts, _source_graphs, _degraded = asyncio.run(_run())

        assert counts['Article'] == 0

    def test_degrades_per_graph_instead_of_failing_the_whole_read(self):
        """FIX LANE Priority 2 (Defect 2), SQL half: a `by_type` breakdown
        failure on one graph (e.g. that graph's `nodes` projection lacking
        the queried column, or a live `PARTIAL_MATERIALIZATION` rebuild --
        both observed against the real cluster) must degrade to the
        surviving graphs' data, with the failure surfaced, not a 503."""

        engine = _PinnedGraphEngine(
            _TENANT_GRAPH,
            sql_data={_TENANT_GRAPH: [{'node_type': 'Memory', 'n': 20}]},
            fail_graphs=frozenset({_COMMONS_GRAPH}),
        )

        async def _run():
            with use_session(_session()):
                return await api_extensions._read_union_sql_group_counts(
                    engine,
                    'SELECT node_type, COUNT(*) AS n FROM nodes GROUP BY node_type',
                    key='node_type',
                    count_field='n',
                    deadline=5.0,
                )

        import asyncio

        counts, source_graphs, degraded_graphs = asyncio.run(_run())

        assert counts == {'Memory': 20}
        assert source_graphs == [_TENANT_GRAPH]
        assert degraded_graphs == [_COMMONS_GRAPH]


class TestRowsPerAccessibleGraph:
    """Direct unit coverage of the shared per-graph fan-out helper both
    aggregate union readers above are built on."""

    def test_returns_none_with_no_ambient_session(self):
        engine = _PinnedGraphEngine(_TENANT_GRAPH)

        assert current_session() is None
        result = api_extensions._rows_per_accessible_graph(
            engine, lambda scoped: scoped.query_cypher('x')
        )
        assert result is None

    def test_own_graph_is_called_without_a_for_graph_retarget(self):
        """The actor's own (`session.graph`) leg is answered by `engine`
        itself -- no `.for_graph()` view needed (mirrors production: the
        engine is already correctly pinned to the caller's own graph)."""

        engine = _PinnedGraphEngine(
            _TENANT_GRAPH, cypher_data={_TENANT_GRAPH: [{'id': 'n1'}]}
        )
        # Only accessible graph is the tenant's own -- forces the "own
        # graph" branch exclusively.
        import agent_webui.api_extensions as ext

        original = ext._accessible_graphs
        ext._accessible_graphs = lambda actor: [_TENANT_GRAPH]  # type: ignore[assignment]
        try:
            with use_session(_session()):
                result = api_extensions._rows_per_accessible_graph(
                    engine, lambda scoped: scoped.query_cypher('x')
                )
        finally:
            ext._accessible_graphs = original

        assert result is not None
        succeeded, degraded = result
        assert succeeded == [(_TENANT_GRAPH, [{'id': 'n1'}])]
        assert degraded == []
