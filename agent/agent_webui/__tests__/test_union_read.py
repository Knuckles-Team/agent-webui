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
        node_data: dict[str, dict[str, dict[str, Any]]] | None = None,
    ) -> None:
        self.graph_name = pinned_graph
        self._cypher_data = cypher_data or {}
        self._sql_data = sql_data or {}
        self._fail_graphs = fail_graphs
        self._visited = visited if visited is not None else []
        # {graph_name: {node_id: props}} -- backs `.backend.execute` for the
        # object-locate helpers (`_node_properties`/`_locate_object_graph`/
        # `_ids_present_in_graph`), same pinning-guard shape as `cypher_data`.
        self._node_data = node_data or {}
        self.graph_compute = _PinnedGraphCompute(self)
        self.backend = _PinnedGraphBackend(self)

    def for_graph(self, graph_name: str) -> _PinnedGraphEngine:
        if graph_name == self.graph_name:
            return self
        return _PinnedGraphEngine(
            graph_name,
            self._cypher_data,
            self._sql_data,
            self._fail_graphs,
            visited=self._visited,
            node_data=self._node_data,
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
        self, query: str, params: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        # Parameter is named ``query`` (not ``cypher``) to match the real
        # ``QueryMixin.query_cypher(self, query, params=None, ...)``
        # signature (`engine_query.py:137`) -- `_graph_union_executor` calls
        # it under that keyword deliberately (see
        # `test_execute_cypher_forwards_the_query_text_under_the_query_keyword`
        # in `test_api_extensions.py`), so this double must accept it.
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


class _PinnedGraphBackend:
    """``engine.backend`` half of ``_PinnedGraphEngine`` -- same pinning
    guard, backs the two Cypher shapes ``_locate_object_graph``/
    ``_node_properties``/``_ids_present_in_graph`` actually issue against
    ``_node_data`` (query-shape-aware, not a real parser -- mirrors how
    ``query_cypher`` above answers from pre-seeded data keyed by graph)."""

    def __init__(self, owner: _PinnedGraphEngine) -> None:
        self._owner = owner

    def execute(
        self, query: str, params: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        self._owner._assert_pinned_and_record()
        nodes = self._owner._node_data.get(self._owner.graph_name, {})
        params = params or {}
        if 'id' in params:
            # `_node_properties`: MATCH (n {id: $id}) RETURN n LIMIT 1
            node = nodes.get(params['id'])
            return [{'n': dict(node)}] if node is not None else []
        if 'ids' in params:
            # `_ids_present_in_graph`: MATCH (n) WHERE n.id IN $ids RETURN n.id AS id
            return [{'id': nid} for nid in params['ids'] if nid in nodes]
        return []


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


class TestLocateObjectGraph:
    """`_locate_object_graph` -- the union-read fix `get_ontology_object`
    (``GET /ontology/object/{object_id}``) and `derive_ontology_property`
    (``POST /ontology/derive``) share: resolves which accessible graph holds
    an object id ONCE, before scoping the rest of either route's reads to
    it. Regression coverage for the concrete acceptance criterion -- a
    commons-resident object must resolve, not 404 -- neither route had
    before this lane."""

    def test_finds_a_commons_only_object_absent_from_the_tenant_graph(self):
        """A `:Tool` node that lives ONLY in commons must still resolve --
        the concrete defect this fix closes (a tenant-only lookup 404s it)."""
        engine = _PinnedGraphEngine(
            _TENANT_GRAPH,
            node_data={
                _TENANT_GRAPH: {},
                _COMMONS_GRAPH: {
                    'tool-1': {'id': 'tool-1', 'node_type': 'Tool', 'name': 'Tool-A'}
                },
            },
        )

        with use_session(_session()):
            located = api_extensions._locate_object_graph(engine, 'tool-1')

        assert located is not None
        graph_name, scoped_engine, props = located
        assert graph_name == _COMMONS_GRAPH
        assert scoped_engine.graph_name == _COMMONS_GRAPH
        assert props['name'] == 'Tool-A'

    def test_tenant_only_object_needs_no_for_graph_retarget(self):
        """Mirrors `TestRowsPerAccessibleGraph::test_own_graph_is_called_
        without_a_for_graph_retarget` -- when the object lives in the
        caller's own graph, the SAME engine object is returned (no
        `.for_graph()` view constructed)."""
        engine = _PinnedGraphEngine(
            _TENANT_GRAPH,
            node_data={
                _TENANT_GRAPH: {'n1': {'id': 'n1', 'name': 'tenant-node'}},
                _COMMONS_GRAPH: {},
            },
        )

        with use_session(_session()):
            located = api_extensions._locate_object_graph(engine, 'n1')

        assert located is not None
        graph_name, scoped_engine, props = located
        assert graph_name == _TENANT_GRAPH
        assert scoped_engine is engine
        assert props['name'] == 'tenant-node'

    def test_tenant_wins_on_the_impossible_duplicate_id(self):
        """Two physically partitioned graphs (GOC-61) never legitimately
        share a node id, but if one somehow did, tenant wins -- the same
        semantic `read_union`'s own de-dup already applies on a duplicate
        id."""
        engine = _PinnedGraphEngine(
            _TENANT_GRAPH,
            node_data={
                _TENANT_GRAPH: {'dup': {'id': 'dup', 'source': 'tenant'}},
                _COMMONS_GRAPH: {'dup': {'id': 'dup', 'source': 'commons'}},
            },
        )

        with use_session(_session()):
            located = api_extensions._locate_object_graph(engine, 'dup')

        assert located is not None
        graph_name, _scoped_engine, props = located
        assert graph_name == _TENANT_GRAPH
        assert props['source'] == 'tenant'

    def test_object_not_found_in_any_accessible_graph(self):
        engine = _PinnedGraphEngine(
            _TENANT_GRAPH, node_data={_TENANT_GRAPH: {}, _COMMONS_GRAPH: {}}
        )

        with use_session(_session()):
            located = api_extensions._locate_object_graph(engine, 'ghost')

        assert located is None


class _DuckGraph:
    """Minimal in-memory graph `ObjectSet`/`GraphView` can read directly --
    the "Raw GraphComputeEngine / in-memory duck graph" fallback branch of
    `object_set.py::_view_for` -- no engine, no store, no session guard.
    Used to prove `/ontology/object-set/pivot`'s and `/aggregate`'s per-graph
    fan-out + merge logic without standing up the real engine singleton
    `_ontology_facade_for` binds to on the tenant leg (`get_ontology_kg()` ->
    `IntelligenceGraphEngine.get_active()`).
    """

    def __init__(
        self,
        nodes: dict[str, dict[str, Any]],
        edges: list[tuple[str, str, str]] | None = None,
    ) -> None:
        self._nodes = nodes
        self._edges = edges or []

    def node_ids(self) -> list[str]:
        return list(self._nodes)

    def _get_node_properties(self, node_id: str) -> dict[str, Any]:
        return dict(self._nodes.get(node_id, {}))

    def has_node(self, node_id: str) -> bool:
        return node_id in self._nodes

    def out_edges(
        self, node_id: str, data: bool = True
    ) -> list[tuple[str, str, dict[str, Any]]]:
        del data
        return [
            (s, t, {'relationship': et}) for s, t, et in self._edges if s == node_id
        ]

    def in_edges(
        self, node_id: str, data: bool = True
    ) -> list[tuple[str, str, dict[str, Any]]]:
        del data
        return [
            (s, t, {'relationship': et}) for s, t, et in self._edges if t == node_id
        ]


_GraphFixture = dict[str, tuple[dict[str, dict[str, Any]], list[tuple[str, str, str]]]]


def _fake_facade_for(graphs: _GraphFixture) -> Any:
    """Build an `_ontology_facade_for(engine, scoped_engine)` replacement
    bound to per-graph `_DuckGraph` data, keyed by `scoped_engine.graph_name`."""
    from agent_utilities.knowledge_graph.ontology import OntologySystem

    def _facade(_engine: Any, scoped_engine: Any) -> Any:
        nodes, edges = graphs.get(scoped_engine.graph_name, ({}, []))
        return None, OntologySystem(graph=_DuckGraph(nodes, edges))

    return _facade


def _node_data_from_graphs(
    graphs: _GraphFixture,
) -> dict[str, dict[str, dict[str, Any]]]:
    """`_PinnedGraphEngine.backend`'s existence-check data
    (`_ids_present_in_graph`) for the SAME per-graph id sets `_fake_facade_for`
    serves -- the aggregate route narrows to only the ids each graph actually
    holds before aggregating, so this must agree with `graphs` or every
    per-graph aggregate call sees an empty present-id set."""
    return {
        graph_name: {node_id: {} for node_id in nodes}
        for graph_name, (nodes, _edges) in graphs.items()
    }


def _async_return(value: Any) -> Any:
    """An async callable ignoring its arguments and returning ``value`` --
    used to stub `_get_engine_bounded`/`_get_ontology_kg_bounded` for the
    pivot/aggregate route tests below."""

    async def _fn(*_args: Any, **_kwargs: Any) -> Any:
        return value

    return _fn


class TestOntologyObjectSetPivot:
    """``POST /ontology/object-set/pivot`` -- proves a seed id's link into a
    commons-resident object surfaces in the merged pivot groups (the concrete
    union-read acceptance criterion), same seed-id reasoning as
    ``/ontology/object-set/search-around``."""

    def test_merges_commons_linked_objects_into_the_pivot_groups(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        graphs: _GraphFixture = {
            _TENANT_GRAPH: (
                {
                    'seed1': {'id': 'seed1'},
                    'tenant-tool': {'id': 'tenant-tool', 'category': 'tenant'},
                },
                [('seed1', 'tenant-tool', 'USES')],
            ),
            _COMMONS_GRAPH: (
                {
                    'seed1': {'id': 'seed1'},
                    'commons-tool': {'id': 'commons-tool', 'category': 'commons'},
                },
                [('seed1', 'commons-tool', 'USES')],
            ),
        }
        monkeypatch.setattr(
            api_extensions, '_ontology_facade_for', _fake_facade_for(graphs)
        )
        monkeypatch.setattr(
            api_extensions, '_get_ontology_kg_bounded', _async_return((None, None))
        )
        engine = _PinnedGraphEngine(_TENANT_GRAPH)
        monkeypatch.setattr(
            api_extensions, '_get_engine_bounded', _async_return(engine)
        )

        async def _run() -> Any:
            with use_session(_session()):
                return await api_extensions.ontology_object_set_pivot(
                    {'ids': ['seed1'], 'link_type': 'USES', 'group_by': 'category'}
                )

        import asyncio

        result = asyncio.run(_run())

        assert result['groups'] == {
            'tenant': ['tenant-tool'],
            'commons': ['commons-tool'],
        }


class TestOntologyObjectSetAggregate:
    """``POST /ontology/object-set/aggregate`` -- proves count/sum/avg/min/max
    correctly merge a tenant + commons split of ``ids``, the concrete
    union-read acceptance criterion for this route (and the correctness
    argument for NOT scoping min/max to only the tenant, which a prior
    lane's over-caution here would have hidden the commons-held extreme)."""

    def _graphs(self) -> _GraphFixture:
        return {
            _TENANT_GRAPH: (
                {
                    'tenant-a': {'id': 'tenant-a', 'cost': 10.0},
                    'tenant-b': {'id': 'tenant-b', 'cost': 20.0},
                },
                [],
            ),
            _COMMONS_GRAPH: (
                {'commons-tool': {'id': 'commons-tool', 'cost': 5.0}},
                [],
            ),
        }

    def _patch(self, monkeypatch: pytest.MonkeyPatch) -> list[str]:
        graphs = self._graphs()
        monkeypatch.setattr(
            api_extensions, '_ontology_facade_for', _fake_facade_for(graphs)
        )
        monkeypatch.setattr(
            api_extensions, '_get_ontology_kg_bounded', _async_return((None, None))
        )
        engine = _PinnedGraphEngine(
            _TENANT_GRAPH, node_data=_node_data_from_graphs(graphs)
        )
        monkeypatch.setattr(
            api_extensions, '_get_engine_bounded', _async_return(engine)
        )
        return ['tenant-a', 'tenant-b', 'commons-tool']

    @staticmethod
    def _aggregate(ids: list[str], **body: Any) -> Any:
        async def _run() -> Any:
            with use_session(_session()):
                return await api_extensions.ontology_object_set_aggregate(
                    {'ids': ids, **body}
                )

        import asyncio

        return asyncio.run(_run())

    def test_count_unions_across_graphs_without_double_counting(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """3 ids split 2 tenant / 1 commons must come back as 3, never 6 (3
        ids x 2 graphs) -- proves `_ids_present_in_graph` narrows each
        graph's run to the ids it actually holds before a STATIC
        ObjectSet's `.aggregate()` (which counts every id verbatim, present
        or not) runs against it."""
        ids = self._patch(monkeypatch)

        result = self._aggregate(ids, metric='count')

        assert result['value'] == 3
        assert result['total_objects'] == 3

    def test_sum_sums_across_graphs(self, monkeypatch: pytest.MonkeyPatch):
        ids = self._patch(monkeypatch)

        result = self._aggregate(ids, metric='sum', field='cost')

        assert result['value'] == 35.0

    def test_avg_merges_via_sum_and_count_not_average_of_averages(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """A naive average-of-per-graph-averages would give
        ``(15.0 + 5.0) / 2 == 10.0`` -- wrong, since the graphs hold
        different group sizes (2 vs 1). The correct merge -- sum/count from
        each graph, divided AFTER merging -- gives
        ``(10 + 20 + 5) / 3 == 11.67``."""
        ids = self._patch(monkeypatch)

        result = self._aggregate(ids, metric='avg', field='cost')

        assert result['value'] == pytest.approx(35.0 / 3)

    def test_min_and_max_merge_directly_across_graphs(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """The commons-only id holds the global min; a tenant-scoped-only
        aggregate (a prior over-cautious pass here) would have missed it."""
        ids = self._patch(monkeypatch)

        min_result = self._aggregate(ids, metric='min', field='cost')
        max_result = self._aggregate(ids, metric='max', field='cost')

        assert min_result['value'] == 5.0
        assert max_result['value'] == 20.0
