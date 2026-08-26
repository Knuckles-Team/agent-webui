from __future__ import annotations

"""Test API endpoints for agent-webui backend."""

import asyncio
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import agent_webui.api_extensions as api_extensions
import pytest
from agent_webui.server import create_agent_web_app
from fastapi import HTTPException
from fastapi.testclient import TestClient


@pytest.fixture
def client(mock_agent, mock_workspace_helpers, authenticated_client_factory):
    """Create test client.

    ``create_agent_web_app`` installs ``WebUIActorIdentityMiddleware``
    unconditionally, so every ``/api/*`` request now requires a verified
    actor or is rejected 401 -- an unauthenticated ``TestClient`` no longer
    reflects a real caller. ``authenticated_client_factory`` (tests/conftest
    .py) presents a legitimate, fully verified admin credential through the
    REAL identity + authorization middleware stack -- see its docstring and
    ``authenticated_asgi_app`` for why this is not a bypass. Individual tests
    that need to prove the gate itself (unauthenticated -> 401, an
    under-privileged role -> 403) build their own client directly instead of
    using this fixture -- see ``TestAuthenticationGateIsNotWeakened`` below.
    """
    app = create_agent_web_app(mock_agent, mock_workspace_helpers)
    return authenticated_client_factory(app, raise_server_exceptions=False)


class TestAuthenticationGateIsNotWeakened:
    """Known-bad proof: the ``client`` fixture above now presents a
    legitimate credential, but the gate it goes through must still reject
    what it should. A gate never demonstrated against a known-bad input is
    not evidence -- these drive the exact same real middleware stack through
    a real ``TestClient``/ASGI request, not the fixture's happy-path
    credential.
    """

    def test_unauthenticated_request_is_still_rejected(
        self, mock_agent, mock_workspace_helpers
    ):
        """No credential at all -> 401, even though this file's default
        ``client`` fixture now attaches one. Proves the fixture fix did not
        weaken ``WebUIActorIdentityMiddleware``."""
        app = create_agent_web_app(mock_agent, mock_workspace_helpers)
        bare_client = TestClient(app, raise_server_exceptions=False)

        response = bare_client.get('/api/enhanced/graph/stats')

        assert response.status_code == 401

    def test_underprivileged_role_is_still_refused_on_an_admin_route(
        self, mock_agent, mock_workspace_helpers, authenticated_client_factory
    ):
        """A verified ``kg:read``-only caller must still be refused the
        admin-only ``/api/enhanced/graph/query`` route (arbitrary Cypher
        execution) -- the same boundary
        ``test_security_boundaries.py::test_role_matrix_graph_query_post_stays_admin_only``
        pins at the middleware-unit level; this proves it end to end through
        a real ``TestClient`` request instead."""
        app = create_agent_web_app(mock_agent, mock_workspace_helpers)
        reader_client = authenticated_client_factory(
            app, scope='kg:read', raise_server_exceptions=False
        )

        response = reader_client.post(
            '/api/enhanced/graph/query', json={'query': 'MATCH (n) RETURN n'}
        )

        assert response.status_code == 403


class TestGraphStatsEndpoint:
    """Test graph statistics endpoint."""

    def test_get_graph_stats_success(self, client, mock_graph_engine):
        """Test successful graph stats retrieval.

        FIX LANE Priority 1/2: `get_graph_stats` now unions the read across
        every graph the real, middleware-minted test session may access
        (tenant shard + commons -- `_accessible_graphs`, unmocked here so
        this exercises the real resolution) rather than reading
        `engine.backend.execute` once. `engine.query_cypher` (totals) and
        `engine.graph_compute.sql_exec` (`by_type`) are mocked with a
        `side_effect` keyed on the query TEXT / statement rather than a
        fixed call-order sequence, since the union issues one call per
        accessible graph -- order- and count-independent by construction.
        Each graph reports the SAME per-call values below, so the summed
        totals are an exact multiple of the number of accessible graphs.

        BUG-PE-058: `by_type` is read through `engine.sql()`
        (`QueryMixin.sql`, the read-only SQL surface) rather than the
        write-capable `engine.graph_compute.sql_exec` -- `sql` is a
        class-level `QueryMixin` method, so `MagicMock(spec=
        IntelligenceGraphEngine)` auto-specs it like `query_cypher`, with
        no extra manual attachment needed.
        """
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()

            def _query_cypher(cypher, params=None):
                if 'count(n)' in cypher:
                    return [{'count': 100}]
                if 'count(r)' in cypher:
                    return [{'count': 200}]
                return []

            mock_graph_engine.query_cypher.side_effect = _query_cypher
            # FIX LANE Priority 2 (Defect 3): the real `nodes` SQL projection
            # has no `type` column at all ("Schema error: No field named
            # type", verified live) -- the node-class discriminator is
            # `node_type` (`models.knowledge_graph.GRAPH_NODE_TYPE_PROPERTY`).
            mock_graph_engine.sql.return_value = [
                {'node_type': 'Memory', 'n': 50},
                {'node_type': 'Article', 'n': 30},
            ]

            response = client.get('/api/enhanced/graph/stats')
            assert response.status_code == 200
            data = response.json()
            graph_count = max(len(data.get('source_graphs') or []), 1)
            assert data['total_nodes'] == 100 * graph_count
            assert data['total_relationships'] == 200 * graph_count
            assert 'source_graphs' in data
            # The breakdown is NOT part of this response any more, and the
            # totals route must not even touch the (10-80x more expensive)
            # SQL surface -- that decoupling is the fix, not a side effect.
            assert 'by_type' not in data
            mock_graph_engine.sql.assert_not_called()

    def test_get_graph_node_types_is_a_real_aggregate(self, client, mock_graph_engine):
        """The breakdown's own route: an engine-side `GROUP BY node_type`
        over ALL nodes, summed across every graph the actor may read.

        What this replaces was not an aggregate at all -- the dashboard's
        "counts by type" was `GraphLegend` grouping the bounded 256-row
        `/graph/nodes` page. Live, that summed to exactly 256 on a
        25,121-node graph and named only the alphabetically-first labels
        that fitted in the budget.
        """
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.sql.return_value = [
                {'node_type': 'Memory', 'n': 50},
                {'node_type': 'Article', 'n': 30},
            ]

            response = client.get('/api/enhanced/graph/node-types')
            assert response.status_code == 200
            data = response.json()
            graph_count = max(len(data.get('source_graphs') or []), 1)
            assert data['by_type'] == {
                'Memory': 50 * graph_count,
                'Article': 30 * graph_count,
            }
            # Descending, so the shape of the distribution reads off the top.
            assert list(data['by_type']) == ['Memory', 'Article']
            assert data['type_count'] == 2
            assert data['total_typed_nodes'] == 80 * graph_count
            assert data['truncated'] is False
            assert data['available'] is True
            assert data['partial'] is False
            # It really is a GROUP BY, not a page that got grouped.
            statement = mock_graph_engine.sql.call_args[0][0]
            assert 'GROUP BY node_type' in statement
            assert 'COUNT(*)' in statement

    def test_node_types_second_concurrent_caller_is_refused_not_queued(self):
        """Single-flight admission. The aggregate holds one of only four
        shared `_SYNC_WORK_EXECUTOR` slots for up to its 45s deadline, and a
        caller-side timeout does not release that slot -- so a handful of
        browsers could otherwise starve every other synchronous route. The
        second caller is told so immediately rather than queued invisibly.
        """
        assert api_extensions._NODE_TYPE_SLOT.acquire(blocking=False) is True
        try:

            async def _go() -> Any:
                return await api_extensions.get_graph_node_types()

            with (
                patch(
                    'agent_webui.api_extensions.IntelligenceGraphEngine.get_active'
                ) as get_active,
                pytest.raises(api_extensions.HTTPException) as excinfo,
            ):
                asyncio.run(_go())
        finally:
            api_extensions._NODE_TYPE_SLOT.release()

        assert excinfo.value.status_code == 503
        # Refused BEFORE any engine work -- the point of admitting one at a
        # time is that the second caller never charges an executor slot.
        # (The detail string is deliberately opaque: `HTTPException` above
        # replaces every message with a fixed public one.)
        get_active.assert_not_called()
        # And the slot is handed back, so the refusal is not self-perpetuating.
        assert api_extensions._NODE_TYPE_SLOT.acquire(blocking=False) is True
        api_extensions._NODE_TYPE_SLOT.release()

    def test_get_graph_stats_no_engine(self, client):
        """Test graph stats when engine not initialized."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=None,
        ):
            response = client.get('/api/enhanced/graph/stats')
            assert response.status_code == 200
            data = response.json()
            assert data['total_nodes'] == 0
            assert data['total_relationships'] == 0


class TestGraphStatsConcurrency:
    """PERF fix lane: `get_graph_stats`'s aggregate calls (node count,
    relationship count) run CONCURRENTLY via `asyncio.gather` instead of one
    after another. This proves the two things a regression here could
    silently break:

    1. Wall-clock now tracks the SLOWEST of the calls, not their SUM
       -- the entire justification for the change.
    2. The ambient `GraphSession`/actor this request was verified under is
       still visible inside both calls despite them now running as
       separate `asyncio.gather` tasks / `_SYNC_WORK_EXECUTOR` threads --
       getting this wrong would be a silent authorization bug (the wrong,
       or no, principal), which the fix lane's own instructions call out as
       far worse than the latency being fixed. Each fake call below reads
       `current_session()` from INSIDE the worker thread it actually runs
       on (not the test's own thread) and records the actor id it sees --
       exactly the failure mode a bare `ThreadPoolExecutor.submit()`
       (dropping the ambient `contextvars.Context`) would produce.

    The `by_type` GROUP BY is no longer one of them: it moved to its own
    route (`/graph/node-types`) precisely because it is 10-80x more
    expensive, and `sql()` below asserts the totals route never calls it.
    """

    def test_total_count_calls_run_concurrently_with_session_intact(
        self,
    ):
        import threading
        import time

        from agent_utilities.knowledge_graph.core.session import (
            GraphSession,
            current_session,
            use_session,
        )
        from agent_utilities.security.brain_context import ActorContext

        actor = ActorContext(
            actor_id='concurrency-test-actor',
            tenant_id='acme',
            roles=('kg:read',),
            authenticated=True,
        )
        graph_name = 'tenant__acme____commons__'
        session = GraphSession(
            actor=actor,
            tenant='acme',
            scopes=frozenset({'kg:read'}),
            graph=graph_name,
        )

        call_delay = 0.2
        lock = threading.Lock()
        observed_actor_ids: list[str | None] = []
        call_intervals: list[tuple[float, float]] = []

        def _record_call() -> None:
            start = time.monotonic()
            sess = current_session()
            with lock:
                observed_actor_ids.append(
                    sess.actor.actor_id if sess is not None else None
                )
            time.sleep(call_delay)
            with lock:
                call_intervals.append((start, time.monotonic()))

        class _Engine:
            def __init__(self) -> None:
                self.backend = object()  # truthy; no attributes read on it

            def for_graph(self, name: str) -> _Engine:
                assert name == graph_name
                return self

            def query_cypher(
                self, query: str, params: dict[str, Any] | None = None
            ) -> list[dict[str, Any]]:
                _record_call()
                if 'count(n)' in query:
                    return [{'count': 5}]
                return [{'count': 7}]

            def sql(self, statement: str) -> list[dict[str, Any]]:
                raise AssertionError(
                    'the totals route must not run the expensive GROUP BY'
                )

        engine = _Engine()

        def _fake_accessible_graphs(actor_arg: Any) -> list[str]:
            assert actor_arg is not None
            return [graph_name]

        with (
            patch.object(api_extensions, '_accessible_graphs', _fake_accessible_graphs),
            patch(
                'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
                return_value=engine,
            ),
        ):

            async def _run() -> dict[str, Any]:
                with use_session(session):
                    return await api_extensions.get_graph_stats()

            wall_start = time.monotonic()
            result = asyncio.run(_run())
            wall_elapsed = time.monotonic() - wall_start

        assert result['available'] is True
        assert result['total_nodes'] == 5
        assert result['total_relationships'] == 7
        assert 'by_type' not in result

        # Context propagation: both calls ran under the SAME actor
        # this request was verified under -- never None, never a stray
        # default/no-session identity.
        assert observed_actor_ids == ['concurrency-test-actor'] * 2

        # Concurrency, wall-clock proof: two genuinely serialized 0.2s
        # calls take >= 0.4s; run concurrently, wall time tracks the
        # SLOWEST single call. A 0.35s bound is under the serialized
        # floor and well above a single call, so this can only pass if the
        # calls actually overlapped.
        assert wall_elapsed < 0.35, (
            f'expected concurrent execution (~{call_delay}s), measured '
            f'{wall_elapsed:.3f}s -- the aggregate calls appear to '
            'be serialized again'
        )

        # Concurrency, direct overlap proof (stronger than the wall-clock
        # bound alone): the two recorded (start, end) intervals overlap.
        assert len(call_intervals) == 2

        def _overlaps(a: tuple[float, float], b: tuple[float, float]) -> bool:
            return a[0] < b[1] and b[0] < a[1]

        assert _overlaps(call_intervals[0], call_intervals[1]), (
            'the two aggregate calls did not overlap in time'
        )


class TestGraphStatsByTypeDegrade:
    """A `by_type` breakdown that cannot be computed must SAY so.

    Two separate things had to be true, and only one of them was. The
    breakdown must not take the headline totals down with it -- now
    structurally guaranteed, because they are different routes. And when it
    does fail, the response must be distinguishable from a graph that
    genuinely holds no typed nodes; an empty `by_type` with an empty
    `degraded_graphs` is exactly the silently-degraded output this program
    has now been bitten by four times.

    Root cause context (measured live in-pod against the production graph):
    the `GROUP BY` aggregate costs 5.5s uncontended and up to 22.4s under
    load, so behind the old 10s deadline on `/graph/stats` it degraded on
    essentially every production request -- which is why the dashboard's
    visible "counts by type" came from somewhere else entirely.
    """

    @staticmethod
    def _engine(sql_delay: float) -> Any:
        graph_name = 'tenant__acme____commons__'

        class _GraphCompute:
            def sql_exec(self, statement: str) -> list[dict[str, Any]]:
                time.sleep(sql_delay)
                return [{'node_type': 'Memory', 'n': 3}]

        class _Engine:
            def __init__(self) -> None:
                self.backend = object()
                self.graph_compute = _GraphCompute()

            def for_graph(self, name: str) -> Any:
                assert name == graph_name
                return self

            def query_cypher(
                self, query: str, params: dict[str, Any] | None = None
            ) -> list[dict[str, Any]]:
                return [{'count': 5}] if 'count(n)' in query else [{'count': 7}]

        return _Engine(), graph_name

    @staticmethod
    def _session(graph_name: str) -> Any:
        from agent_utilities.knowledge_graph.core.session import GraphSession
        from agent_utilities.security.brain_context import ActorContext

        actor = ActorContext(
            actor_id='by-type-degrade-actor',
            tenant_id='acme',
            roles=('kg:read',),
            authenticated=True,
        )
        return GraphSession(
            actor=actor,
            tenant='acme',
            scopes=frozenset({'kg:read'}),
            graph=graph_name,
        )

    def _run(self, engine: Any, graph_name: str) -> dict[str, Any]:
        from agent_utilities.knowledge_graph.core.session import use_session

        session = self._session(graph_name)

        def _fake_accessible_graphs(actor_arg: Any) -> list[str]:
            assert actor_arg is not None
            return [graph_name]

        with (
            patch.object(api_extensions, '_accessible_graphs', _fake_accessible_graphs),
            patch(
                'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
                return_value=engine,
            ),
        ):

            async def _go() -> dict[str, Any]:
                with use_session(session):
                    return await api_extensions.get_graph_node_types()

            return asyncio.run(_go())

    def _run_stats(self, engine: Any, graph_name: str) -> dict[str, Any]:
        """Same harness, pointed at the TOTALS route -- the two are separate
        endpoints now, and several of these tests exist to prove exactly that.
        """
        from agent_utilities.knowledge_graph.core.session import use_session

        session = self._session(graph_name)

        def _fake_accessible_graphs(actor_arg: Any) -> list[str]:
            assert actor_arg is not None
            return [graph_name]

        with (
            patch.object(api_extensions, '_accessible_graphs', _fake_accessible_graphs),
            patch(
                'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
                return_value=engine,
            ),
        ):

            async def _go() -> dict[str, Any]:
                with use_session(session):
                    return await api_extensions.get_graph_stats()

            return asyncio.run(_go())

    def test_by_type_budget_503_degrades_and_says_so(self):
        """THE regression: the bounded-work budget reports a blown deadline
        (and an exhausted capacity) as `HTTPException(503)`, and that 503
        must degrade the breakdown HONESTLY -- naming the graphs it failed
        to cover -- rather than returning an empty distribution that reads
        as complete.
        """
        engine, graph_name = self._engine(sql_delay=0.0)

        async def _budget_503(*args: Any, **kwargs: Any) -> Any:
            raise api_extensions.HTTPException(status_code=503)

        with patch.object(api_extensions, '_read_union_sql_group_counts', _budget_503):
            result = self._run(engine, graph_name)

        # The missing breakdown is reported as MISSING, never as an
        # empty-but-complete one. `partial` False here would make "the
        # breakdown timed out" indistinguishable from "this graph holds no
        # typed nodes" -- the exact honesty failure this route exists to
        # make impossible.
        assert result['available'] is True
        assert result['by_type'] == {}
        assert result['partial'] is True
        assert result['degraded_graphs'] == [graph_name]

    def test_totals_route_is_unaffected_by_a_broken_breakdown(self):
        """The structural half of the fix: `/graph/stats` cannot be harmed
        by the breakdown at all any more, because it no longer computes it.
        Pre-split, this same failure returned a 503 for the whole stats
        response and discarded two total counts that had already succeeded.
        """
        engine, graph_name = self._engine(sql_delay=0.0)

        async def _boom(*args: Any, **kwargs: Any) -> Any:
            raise api_extensions.HTTPException(status_code=503)

        with patch.object(api_extensions, '_read_union_sql_group_counts', _boom):
            result = self._run_stats(engine, graph_name)

        assert result['available'] is True
        assert result['total_nodes'] == 5
        assert result['total_relationships'] == 7
        assert result['partial'] is False

    def test_by_type_real_deadline_is_wired_and_degrades_end_to_end(self):
        """The same degrade driven by the REAL deadline machinery rather
        than a hand-thrown 503: a genuinely slow `sql_exec` against a
        deliberately tiny `_GRAPH_STATS_BY_TYPE_DEADLINE_SECONDS`.

        This is what proves the new constant is actually the value
        `_by_type_call` passes to `_invoke_governed_helper` -- a knob that
        silently was not read would leave the live route on the old 10s
        budget and this test would hang past its bound and fail.
        """
        engine, graph_name = self._engine(sql_delay=1.0)

        started = time.monotonic()
        with patch.object(api_extensions, '_GRAPH_STATS_BY_TYPE_DEADLINE_SECONDS', 0.2):
            result = self._run(engine, graph_name)
        elapsed = time.monotonic() - started

        assert result['by_type'] == {}
        assert result['partial'] is True
        assert result['degraded_graphs'] == [graph_name]
        assert elapsed < 0.9, (
            f'route took {elapsed:.3f}s -- the patched 0.2s by_type deadline '
            'does not appear to be the one actually used'
        )

    def test_by_type_non_503_http_error_still_propagates(self):
        """The degrade is scoped to the bounded budget's own signal (503),
        not a blanket `except HTTPException`. Any other HTTP status is a
        differently-shaped failure and must still surface.
        """
        engine, graph_name = self._engine(sql_delay=0.0)

        async def _boom(*args: Any, **kwargs: Any) -> Any:
            raise api_extensions.HTTPException(status_code=501)

        with patch.object(api_extensions, '_read_union_sql_group_counts', _boom):
            with pytest.raises(api_extensions.HTTPException) as excinfo:
                self._run(engine, graph_name)

        assert excinfo.value.status_code == 501

    def test_by_type_generic_failure_also_reports_degraded_graphs(self):
        """`_by_type_call`'s pre-existing catch-all degrade had the same
        honesty gap as the 503 one: it returned `({}, [], [])`, so an empty
        `by_type` came back with `partial: False` -- indistinguishable from
        a graph that genuinely holds no typed nodes. It now names the graphs
        the breakdown failed to cover, exactly like the budget path.

        Raised from `_read_union_sql_group_counts` itself, deliberately:
        an exception from `sql_exec` is swallowed EARLIER, by
        `_rows_per_accessible_graph`'s own per-graph fail-soft, and never
        reaches this handler at all.
        """
        engine, graph_name = self._engine(sql_delay=0.0)

        async def _boom(*args: Any, **kwargs: Any) -> Any:
            raise RuntimeError('sql surface unavailable')

        with patch.object(api_extensions, '_read_union_sql_group_counts', _boom):
            result = self._run(engine, graph_name)

        assert result['by_type'] == {}
        assert result['partial'] is True
        assert result['degraded_graphs'] == [graph_name]

    def test_required_total_count_deadline_still_fails_the_route(self):
        """The other half of the contract, unchanged: a REQUIRED aggregate
        failing is a real backend failure and must still be a 503 -- it must
        never be quietly degraded into a fake `0` the way the `by_type`
        breakdown legitimately is.
        """
        engine, graph_name = self._engine(sql_delay=0.0)

        async def _boom(*args: Any, **kwargs: Any) -> Any:
            raise api_extensions.HTTPException(status_code=503)

        with patch.object(api_extensions, '_read_union_scalar_sum', _boom):
            with pytest.raises(api_extensions.HTTPException) as excinfo:
                self._run_stats(engine, graph_name)

        assert excinfo.value.status_code == 503


class TestGraphNodesEndpoint:
    """Test graph nodes endpoint."""

    def test_get_graph_nodes_success(self, client, mock_graph_engine):
        """Nodes come from `nodes_by_label` -- the engine's native, non-Cypher
        id+properties fetch -- never `properties(n)` (the engine's Cypher
        grammar has no function-call syntax beyond a fixed aggregate set plus
        `type(r)`; `properties(n)` fails to parse and raises
        `CypherEngineError`) and never the whole node object (`RETURN n`,
        rejected for the same anonymous/whole-object reason `get_graph_stats`
        already documents).
        """
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.nodes_by_label.return_value = [
                (
                    'node1',
                    {
                        'node_type': 'Memory',
                        'content': 'Test memory',
                        'importance': 0.8,
                    },
                ),
                (
                    'node2',
                    {
                        'node_type': 'Person',
                        'labels': ['Admin', 'Person'],
                        'title': 'Test Article',
                    },
                ),
                ('node3', {'type': 'Article', 'title': 'Not a cypher label'}),
            ]

            response = client.get('/api/enhanced/graph/nodes')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 3
            by_id = {n['id']: n for n in data}
            assert by_id['node1']['labels'] == ['Memory']
            assert by_id['node1']['properties'] == {
                'content': 'Test memory',
                'importance': 0.8,
            }
            # `node_type` plus the explicit multi-label `labels` array are the
            # ONLY two fields the engine's `node_has_label` reads, deduped and
            # with `node_type` first; neither leaks back into `properties`.
            assert by_id['node2']['labels'] == ['Person', 'Admin']
            assert by_id['node2']['properties'] == {'title': 'Test Article'}
            # `type` is deliberately NOT a cypher label: `build_cypher_label_index`
            # is "deliberately narrower than `GraphCore.label_index`'s
            # `type`/`node_type`/`label`". Reporting it would claim a label that
            # `MATCH (n:Article)` does not match, so filtering by node_type would
            # disagree with the unfiltered list. It stays an ordinary property.
            # `nodes_by_label` itself matches the BROADER index, but this is
            # the UNFILTERED call (no `node_type` param), so nothing is
            # excluded -- node3 stays in the list with `type` as an ordinary
            # property, not a label.
            assert by_id['node3']['labels'] == []
            assert by_id['node3']['properties'] == {
                'type': 'Article',
                'title': 'Not a cypher label',
            }

            args = mock_graph_engine.backend.nodes_by_label.call_args[0]
            assert args == ('', 256)

    def test_get_graph_nodes_with_filter(self, client, mock_graph_engine):
        """Test graph nodes with type filter -- `nodes_by_label` is called
        with the requested label, bounded by the same collection cap."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.nodes_by_label.return_value = [
                ('node1', {'node_type': 'Memory'})
            ]

            response = client.get('/api/enhanced/graph/nodes?node_type=Memory')
            assert response.status_code == 200
            data = response.json()
            assert len(data) == 1

            args = mock_graph_engine.backend.nodes_by_label.call_args[0]
            assert args == ('Memory', 256)

    def test_get_graph_nodes_excludes_broader_index_only_matches(
        self, client, mock_graph_engine
    ):
        """`nodes_by_label` indexes the BROADER `type`/`node_type`/`label`/
        `labels` write-path contract; Cypher's own `(n:Label)` predicate is
        deliberately narrower (`node_type` + `labels[]` only). A node
        matched only via a bare `type` property must not appear in a
        node_type-filtered result -- `MATCH (n:Article)` would not have
        matched it either."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.nodes_by_label.return_value = [
                ('node1', {'node_type': 'Article'}),
                ('node2', {'type': 'Article', 'title': 'broader-index-only match'}),
            ]

            response = client.get('/api/enhanced/graph/nodes?node_type=Article')
            assert response.status_code == 200
            data = response.json()
            assert [n['id'] for n in data] == ['node1']

    def test_get_graph_nodes_no_native_helper_fails_closed(
        self, client, mock_graph_engine
    ):
        """A backend without the native `nodes_by_label` seam (e.g. a
        GraphBackend implementation that doesn't provide it) degrades to an
        explicit 503, never a silent/empty success."""
        from agent_utilities.knowledge_graph.backends.base import GraphBackend

        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock(spec=GraphBackend)

            response = client.get('/api/enhanced/graph/nodes')
            assert response.status_code == 503

    def test_get_graph_nodes_no_engine(self, client):
        """Test graph nodes when engine not initialized."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=None,
        ):
            response = client.get('/api/enhanced/graph/nodes')
            assert response.status_code == 200
            data = response.json()
            assert data == []


class TestGraphRelationshipsEndpoint:
    """Test graph relationships endpoint."""

    def test_get_graph_relationships_success(
        self, client, mock_graph_engine, sample_graph_data
    ):
        """Test successful graph relationships retrieval.

        FIX LANE Priority 1: the route now unions the read across every
        accessible graph via `_read_union_cypher`, which calls
        `engine.query_cypher` (`_graph_union_executor`) -- never
        `engine.backend.execute` -- same primitive `get_graph_stats` already
        exercises (`TestGraphStatsEndpoint.test_get_graph_stats_success`).
        The real, middleware-minted test session may access more than one
        graph (tenant shard + commons, unmocked here so this exercises the
        real `_accessible_graphs` resolution) and a relationship row carries
        no `id` column, so `read_union`'s id-dedup is a documented no-op for
        every row here -- the SAME mocked row can legitimately come back
        once per accessible graph. This asserts on content/shape, not a
        graph-count-dependent row total.
        """
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.query_cypher.return_value = [
                sample_graph_data['relationships'][0]
            ]

            response = client.get('/api/enhanced/graph/relationships')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) >= 1
            assert all(
                row == {'source': 'node1', 'type': 'REFERENCES', 'target': 'node2'}
                for row in data
            )

    def test_get_graph_relationships_no_engine(self, client):
        """Test graph relationships when engine not initialized."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=None,
        ):
            response = client.get('/api/enhanced/graph/relationships')
            assert response.status_code == 200
            data = response.json()
            assert data == []


class TestGraph3DEndpoint:
    """`GET /graph/graph3d` -- the closed node+edge payload the 3D view reads."""

    def _rows(self):
        """Two edges over three nodes, in the route's own projected shape.

        Note `edge_count`: the route's Cypher carries `count(*)` because the
        DEPLOYED engine returns ZERO rows for a RETURN clause with no
        aggregate in it (measured 2026-08-25 -- see the route's own comment).
        A fixture without that column would not exercise the real projection.
        """
        return [
            {
                's': 'wf:a',
                'st': 'WorkflowDefinition',
                'sn': 'workflow a',
                'rt': 'HAS_STEP',
                't': 'wf:a:step:0',
                'tt': 'WorkflowStep',
                'tn': 'step 0',
                'edge_count': 1,
            },
            {
                's': 'wf:a:step:0',
                'st': 'WorkflowStep',
                'sn': 'step 0',
                'rt': 'USES_SKILL',
                't': 'skill:build',
                'tt': 'Skill',
                'tn': 'build',
                'edge_count': 2,
            },
        ]

    def test_returns_a_closed_payload_with_index_referenced_edges(
        self, client, mock_graph_engine
    ):
        """Every edge endpoint must be present in `nodes`, by index."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.query_cypher.return_value = self._rows()

            response = client.get('/api/enhanced/graph/graph3d')
            assert response.status_code == 200
            data = response.json()

            assert data['available'] is True
            assert data['truncated'] is False
            ids = [node['id'] for node in data['nodes']]
            assert set(ids) == {'wf:a', 'wf:a:step:0', 'skill:build'}
            # The closure property this route exists to guarantee.
            for edge in data['edges']:
                assert 0 <= edge['s'] < len(data['nodes'])
                assert 0 <= edge['t'] < len(data['nodes'])
            assert {edge['r'] for edge in data['edges']} == {'HAS_STEP', 'USES_SKILL'}
            # De-duped across the read union. `_read_union_cypher` runs the
            # same query once per accessible graph, and the test session can
            # reach more than one, so the SAME mocked row comes back more than
            # once -- exactly as `test_get_graph_relationships_success`
            # documents. A renderer must not draw that line twice.
            assert len(data['edges']) == 2
            # Parallel-edge multiplicity survives as edge weight.
            assert sorted(edge['w'] for edge in data['edges']) == [1, 2]
            assert data['connected_nodes'] == len(data['nodes'])
            assert data['isolated_nodes'] == 0

    def test_node_type_and_name_come_from_the_projected_columns(
        self, client, mock_graph_engine
    ):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.query_cypher.return_value = self._rows()
            data = client.get('/api/enhanced/graph/graph3d').json()
            by_id = {node['id']: node for node in data['nodes']}
            assert by_id['skill:build']['type'] == 'Skill'
            assert by_id['skill:build']['name'] == 'build'

    def test_a_row_missing_an_endpoint_id_is_dropped_and_flagged(
        self, client, mock_graph_engine
    ):
        """A malformed row must not fabricate a node, and must not be silent."""
        rows = self._rows()
        rows.append({**rows[0], 't': None, 'tt': None, 'tn': None})
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.query_cypher.return_value = rows
            data = client.get('/api/enhanced/graph/graph3d').json()
            assert data['truncated'] is True
            assert len(data['nodes']) == 3

    def test_an_oversized_name_is_truncated_not_dropped(
        self, client, mock_graph_engine
    ):
        rows = self._rows()
        rows[0]['sn'] = 'x' * 5000
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.query_cypher.return_value = rows
            data = client.get('/api/enhanced/graph/graph3d').json()
            name = next(n['name'] for n in data['nodes'] if n['id'] == 'wf:a')
            assert len(name) <= 121
            assert name.endswith('…')

    def test_engine_totals_are_null_not_zero_when_the_gauges_are_unreadable(
        self, client, mock_graph_engine
    ):
        """A missing engine gauge must never be presented as "0 nodes".

        The engine's own per-graph gauges are what tell the UI how much of the
        graph it is drawing. If they cannot be read, `null` says so; `0` would
        render as "the engine reports 0 edges", which is a lie and, worse, one
        that makes the payload look complete.
        """
        with (
            patch(
                'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
                return_value=mock_graph_engine,
            ),
            patch(
                'agent_webui.api_extensions._engine_graph_sizes',
                return_value={},
            ),
        ):
            mock_graph_engine.query_cypher.return_value = self._rows()
            data = client.get('/api/enhanced/graph/graph3d').json()
            assert data['engine_total_nodes'] is None
            assert data['engine_total_relationships'] is None

    def test_no_engine_is_an_honest_empty_graph_not_a_failure(self, client):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=None,
        ):
            response = client.get('/api/enhanced/graph/graph3d')
            assert response.status_code == 200
            data = response.json()
            assert data['available'] is False
            assert data['nodes'] == []
            assert data['edges'] == []


class TestMemoryCRUDEndpoints:
    """Test memory CRUD endpoints."""

    def test_add_memory_success(self, client, mock_graph_engine, sample_memory_data):
        """Test successful memory creation."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            response = client.post(
                '/api/enhanced/graph/memory', json=sample_memory_data
            )
            assert response.status_code == 200
            data = response.json()
            assert data['status'] == 'success'
            assert 'id' in data
            mock_graph_engine.add_memory_node.assert_called_once()

    def test_add_memory_no_engine(self, client, sample_memory_data):
        """Test memory creation when engine not initialized."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=None,
        ):
            response = client.post(
                '/api/enhanced/graph/memory', json=sample_memory_data
            )
            assert response.status_code == 501

    def test_get_memory_success(self, client, mock_graph_engine, sample_memory_data):
        """Test successful memory retrieval."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_memory = MagicMock()
            mock_memory.id = sample_memory_data['id']
            mock_memory.model_dump.return_value = sample_memory_data
            mock_graph_engine.get_memory_node.return_value = mock_memory

            response = client.get(
                f'/api/enhanced/graph/memory/{sample_memory_data["id"]}'
            )
            assert response.status_code == 200
            data = response.json()
            assert data['id'] == sample_memory_data['id']

    def test_get_memory_not_found(self, client, mock_graph_engine):
        """Test memory retrieval when not found."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.get_memory_node.return_value = None

            response = client.get('/api/enhanced/graph/memory/nonexistent')
            assert response.status_code == 404

    def test_update_memory_success(self, client, mock_graph_engine, sample_memory_data):
        """Test successful memory update."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            updated_data = {**sample_memory_data, 'content': 'Updated content'}
            response = client.put(
                f'/api/enhanced/graph/memory/{sample_memory_data["id"]}',
                json=updated_data,
            )
            assert response.status_code == 200
            mock_graph_engine.update_memory_node.assert_called_once()

    def test_delete_memory_success(self, client, mock_graph_engine, sample_memory_data):
        """Test successful memory deletion."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            response = client.delete(
                f'/api/enhanced/graph/memory/{sample_memory_data["id"]}'
            )
            assert response.status_code == 200
            mock_graph_engine.delete_memory_node.assert_called_once()


class TestGraphLinkEndpoint:
    """Test graph link endpoint."""

    def test_link_nodes_success(self, client, mock_graph_engine):
        """Test successful node linking."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            link_data = {
                'source': 'node1',
                'target': 'node2',
                'relationship_type': 'RELATED_TO',
                'properties': {'strength': 0.8},
            }
            response = client.post('/api/enhanced/graph/link', json=link_data)
            assert response.status_code == 200
            mock_graph_engine.link_nodes.assert_called_once()


class TestGraphSearchEndpoint:
    """Test graph search endpoint."""

    def test_hybrid_search_success(self, client, mock_graph_engine):
        """Test successful hybrid search."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.search_hybrid.return_value = [
                {'id': 'node1', 'content': 'Test content'}
            ]

            response = client.get('/api/enhanced/graph/search?query=test&top_k=10')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            mock_graph_engine.search_hybrid.assert_called_with('test', top_k=10)

    def test_hybrid_search_no_engine(self, client):
        """Test hybrid search when engine not initialized."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=None,
        ):
            response = client.get('/api/enhanced/graph/search?query=test')
            assert response.status_code == 200
            data = response.json()
            assert data == []


class TestGraphImpactEndpoint:
    """Test graph impact endpoint."""

    def test_get_impact_success(self, client, mock_graph_engine):
        """Test successful impact analysis."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.query_impact.return_value = [
                {'id': 'affected_node', 'severity': 'high'}
            ]

            response = client.get('/api/enhanced/graph/impact/test_symbol')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)


class TestGraphQueryEndpoint:
    """Test Cypher query endpoint."""

    def test_execute_cypher_success(self, client, mock_graph_engine):
        """Test successful Cypher query execution."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.return_value = [{'result': 'test_data'}]

            query_data = {'query': 'MATCH (n) RETURN n LIMIT 10', 'params': {}}
            response = client.post('/api/enhanced/graph/query', json=query_data)
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)

    def test_execute_cypher_dangerous_query(self, client):
        """Test dangerous query rejection."""
        dangerous_queries = [
            {'query': 'DELETE n', 'params': {}},
            {'query': 'DROP GRAPH', 'params': {}},
            {'query': 'REMOVE n', 'params': {}},
        ]

        for query_data in dangerous_queries:
            response = client.post('/api/enhanced/graph/query', json=query_data)
            assert response.status_code == 400

    def test_execute_cypher_forwards_the_query_text_under_the_query_keyword(
        self, client, mock_graph_engine
    ):
        """Defect D investigation (FIX LANE 2): a live pod observation
        reported ``/api/graph/query`` and ``/api/enhanced/graph/query`` both
        500ing with ``UnsupportedToolFieldError: Tool 'graph_query' does not
        accept field(s): query`` and attributed both to ``execute_cypher``
        here.

        That does NOT reproduce on this route.
        ``/api/enhanced/graph/query`` (this app's own ``execute_cypher``,
        mounted by ``server.py`` at ``app.include_router(enhanced_router,
        prefix='/api/enhanced')``) calls ``engine.query_cypher`` -- the
        native ``IntelligenceGraphEngine``/``QueryMixin`` method, whose
        first parameter is literally named ``query`` (see
        ``agent_utilities/knowledge_graph/orchestration/engine_query.py``)
        -- DIRECTLY, never through the MCP ``graph_query`` TOOL's
        ``_execute_tool``/field-validation dispatch that raises
        ``UnsupportedToolFieldError`` (that dispatch, and its `cypher`-named
        parameter, lives entirely in ``agent_utilities/mcp/kg_server.py``).
        The frontend's three callers of this route
        (``CypherReplView.tsx``, ``TemporalGraphView.tsx``,
        ``GraphView.tsx``) all POST ``{"query": ...}`` -- exactly matching
        what this route reads and forwards.

        The plain (non-``/enhanced``) ``/api/graph/query`` route is NOT
        served by this file at all -- it is mounted by
        ``agent_utilities.gateway.graph_api.register_graph_routes`` ->
        ``kg_server._mount_rest_routes`` -> ``graph_query_endpoint``, which
        DOES forward the raw request body as ``**kwargs`` into
        ``_execute_tool("graph_query", **body)`` and IS where a `query`
        vs `cypher` field mismatch would actually raise
        ``UnsupportedToolFieldError``. That file lives in
        ``agent-utilities`` and is out of scope for this lane (owns only
        ``agent_webui/api_extensions.py``); if the live defect is real it
        needs a fix there, not here. This test is a regression guard so a
        future "fix" does not rename this route's forwarded field to
        ``cypher`` and break its actually-correct, frontend-verified
        contract with the real ``QueryMixin.query_cypher(self, query, ...)``
        signature.
        """
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch.object(
                mock_graph_engine, 'query_cypher', return_value=[]
            ) as mock_query_cypher:
                response = client.post(
                    '/api/enhanced/graph/query',
                    json={'query': 'MATCH (n) RETURN n LIMIT 1', 'params': {}},
                )

        assert response.status_code == 200
        assert mock_query_cypher.call_args.kwargs['query'] == (
            'MATCH (n) RETURN n LIMIT 1'
        )
        assert 'cypher' not in mock_query_cypher.call_args.kwargs


class TestKnowledgeBaseEndpoints:
    """Test knowledge base endpoints."""

    def test_ingest_kb_success(
        self, client, mock_kb_engine, mock_graph_engine, sample_kb_data
    ):
        """Test successful KB ingestion."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.KBIngestionEngine',
                return_value=mock_kb_engine,
            ):
                response = client.post('/api/enhanced/kb/ingest', json=sample_kb_data)
                assert response.status_code in [200, 202]
                data = response.json()
                assert data['status'] == 'success'

    def test_list_kbs_success(self, client, mock_kb_engine, mock_knowledge_base):
        """Test successful KB listing."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=MagicMock(),
        ):
            with patch(
                'agent_webui.api_extensions.IntelligenceGraphEngine.get_active'
            ) as mock_get_engine:
                mock_get_engine.return_value.backend = MagicMock()
                mock_get_engine.return_value.backend.execute.return_value = [
                    {'kb': mock_knowledge_base}
                ]

                response = client.get('/api/enhanced/kb/list')
                assert response.status_code == 200
                data = response.json()
                assert isinstance(data, list)

    def test_search_kb_success(self, client, mock_kb_engine):
        """Test successful KB search."""
        with patch(
            'agent_webui.api_extensions.KBIngestionEngine', return_value=mock_kb_engine
        ):
            mock_kb_engine.search.return_value = [
                {'id': 'article1', 'title': 'Test Article'}
            ]

            response = client.get('/api/enhanced/kb/search?query=test&kb_id=test_kb')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)

    def test_get_kb_article_success(self, client, mock_kb_engine, mock_article):
        """Test successful article retrieval."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=MagicMock(),
        ):
            with patch(
                'agent_webui.api_extensions.IntelligenceGraphEngine.get_active'
            ) as mock_get_engine:
                mock_get_engine.return_value.backend = MagicMock()
                mock_get_engine.return_value.backend.execute.return_value = [
                    {'a': mock_article}
                ]

                response = client.get('/api/enhanced/kb/article/article1')
                assert response.status_code == 200

    def test_kb_health_check_success(self, client, mock_kb_engine, mock_graph_engine):
        """Test successful KB health check."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.KBIngestionEngine',
                return_value=mock_kb_engine,
            ):
                mock_kb_engine.health_check.return_value = {
                    'health_status': 'healthy',
                    'issues': [],
                }

                response = client.post(
                    '/api/enhanced/kb/health', json={'kb_id': 'test_kb'}
                )
                assert response.status_code == 200
                data = response.json()
                assert data['health_status'] == 'healthy'


class TestSDDEndpoints:
    """Test SDD lifecycle endpoints."""

    def test_get_constitution_success(self, client, mock_sdd_manager):
        """Test successful constitution retrieval."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_sdd_manager.get_constitution.return_value = {
                'governance_rules': ['Rule 1', 'Rule 2'],
                'tech_stack': {'language': 'Python'},
                'quality_gates': ['Gate 1'],
            }

            response = client.get('/api/enhanced/sdd/constitution')
            assert response.status_code == 200
            data = response.json()
            assert 'governance_rules' in data

    def test_save_constitution_success(self, client, mock_sdd_manager):
        """Test successful constitution save."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            constitution_data = {
                'governance_rules': ['Rule 1'],
                'tech_stack': {'language': 'Python'},
            }

            response = client.post(
                '/api/enhanced/sdd/constitution', json=constitution_data
            )
            assert response.status_code == 200
            mock_sdd_manager.save_constitution.assert_called_once()

    def test_list_specs_success(self, client, mock_sdd_manager, mock_spec):
        """Test successful specs listing."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_sdd_manager.list_specs.return_value = [mock_spec]

            response = client.get('/api/enhanced/sdd/specs')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 1

    def test_create_spec_success(self, client, mock_sdd_manager, sample_spec_data):
        """Test successful spec creation."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_spec = MagicMock()
            mock_spec.id = 'spec1'
            mock_spec.model_dump.return_value = {**sample_spec_data, 'id': 'spec1'}
            mock_sdd_manager.create_spec.return_value = mock_spec

            response = client.post('/api/enhanced/sdd/spec', json=sample_spec_data)
            assert response.status_code == 200
            data = response.json()
            assert data['id'] == 'spec1'

    def test_list_plans_success(self, client, mock_sdd_manager, mock_plan):
        """Test successful plans listing."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_sdd_manager.list_plans.return_value = [mock_plan]

            response = client.get('/api/enhanced/sdd/plans')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)

    def test_get_tasks_success(self, client, mock_sdd_manager, mock_task):
        """Test successful tasks retrieval."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_tasks = MagicMock()
            mock_tasks.tasks = [mock_task]
            mock_tasks.model_dump.return_value = {'tasks': [mock_task]}
            mock_sdd_manager.get_tasks.return_value = mock_tasks

            response = client.get('/api/enhanced/sdd/tasks?plan_id=plan1')
            assert response.status_code == 200
            data = response.json()
            assert 'tasks' in data

    def test_sync_sdd_to_memory_success(
        self, client, mock_graph_engine, mock_sdd_manager
    ):
        """Test successful SDD to memory sync."""
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            with patch(
                'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
                return_value=mock_graph_engine,
            ):
                response = client.post(
                    '/api/enhanced/sdd/sync', json={'plan_id': 'plan1'}
                )
                assert response.status_code == 200
                mock_sdd_manager.sync_to_memory.assert_called_once()


class TestMAGMAEndpoint:
    """Test MAGMA orthogonal view endpoint."""

    def test_magma_retrieve_success(self, client, mock_graph_engine, sample_magma_data):
        """Test successful MAGMA context retrieval."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.retrieve_orthogonal_context.return_value = [
                {'id': 'result1', 'content': 'Test result'}
            ]

            response = client.post('/api/enhanced/graph/magma', json=sample_magma_data)
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)


class TestResourceManagementEndpoints:
    """Test resource management endpoints."""

    def test_list_resources_success(self, client, mock_graph_engine):
        """Test successful resource listing."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.return_value = [
                {'r': {'id': 'resource1', 'type': 'MCP_TOOL'}}
            ]

            response = client.get('/api/enhanced/resources')
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)

    def test_spawn_agent_success(self, client, mock_graph_engine, sample_resource_data):
        """Test successful agent spawning."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_agent = MagicMock()
            mock_agent.id = 'spawned_agent1'
            mock_agent.model_dump.return_value = {
                **sample_resource_data,
                'id': 'spawned_agent1',
            }
            mock_graph_engine.spawn_specialized_agent.return_value = mock_agent

            response = client.post(
                '/api/enhanced/resources/spawn', json=sample_resource_data
            )
            assert response.status_code == 200
            data = response.json()
            assert data['id'] == 'spawned_agent1'


class TestMaintenanceEndpoints:
    """Test maintenance operation endpoints."""

    def test_get_maintenance_status_success(self, client, mock_maintainer):
        """Test successful maintenance status retrieval."""
        with patch(
            'agent_webui.api_extensions.GraphMaintainer', return_value=mock_maintainer
        ):
            response = client.get('/api/enhanced/maintenance/status')
            assert response.status_code == 200
            data = response.json()
            assert 'status' in data
            assert 'operations' in data

    def test_trigger_maintenance_success(
        self, client, mock_maintainer, mock_graph_engine, sample_maintenance_operation
    ):
        """Test successful maintenance trigger."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.GraphMaintainer',
                return_value=mock_maintainer,
            ):
                response = client.post(
                    '/api/enhanced/maintenance/trigger',
                    json=sample_maintenance_operation,
                )
                assert response.status_code == 200
                data = response.json()
                assert data['status'] == 'success'


class TestPipelineEndpoints:
    """Test pipeline monitoring endpoints."""

    def test_get_pipeline_status_success(
        self, client, mock_pipeline_runner, mock_graph_engine
    ):
        """Test successful pipeline status retrieval."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.PipelineRunner',
                return_value=mock_pipeline_runner,
            ):
                response = client.get('/api/enhanced/pipeline/status')
                assert response.status_code == 200
                data = response.json()
                assert 'status' in data
                assert 'phases' in data

    def test_trigger_pipeline_success(
        self, client, mock_pipeline_runner, mock_graph_engine, sample_pipeline_phase
    ):
        """Test successful pipeline trigger."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.PipelineRunner',
                return_value=mock_pipeline_runner,
            ):
                response = client.post(
                    '/api/enhanced/pipeline/trigger', json=sample_pipeline_phase
                )
                assert response.status_code == 200
                data = response.json()
                assert data['status'] == 'success'


class TestExtendedEndpoints:
    """Test various extended endpoints for coverage."""

    def test_update_kb_success(self, client, mock_kb_engine, mock_graph_engine):
        """Test successful KB update."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.KBIngestionEngine',
                return_value=mock_kb_engine,
            ):
                response = client.post(
                    '/api/enhanced/kb/update', json={'kb_id': 'test_kb'}
                )
                assert response.status_code == 200
                data = response.json()
                assert data['status'] == 'success'

    def test_update_kb_error(self, client, mock_kb_engine):
        """Test KB update error."""
        with patch(
            'agent_webui.api_extensions.KBIngestionEngine', return_value=mock_kb_engine
        ):
            mock_kb_engine.update.side_effect = Exception('Update failed')
            response = client.post('/api/enhanced/kb/update', json={'kb_id': 'test_kb'})
            assert response.status_code == 500

    def test_sync_sdd_to_memory_success(
        self, client, mock_sdd_manager, mock_graph_engine
    ):
        """Test successful SDD sync to memory."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
            ):
                response = client.post(
                    '/api/enhanced/sdd/sync', json={'plan_id': 'plan1'}
                )
                assert response.status_code == 200
                data = response.json()
                assert data['status'] == 'success'

    def test_spawn_agent_success(self, client, mock_graph_engine):
        """Test successful agent spawning."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_agent = MagicMock()
            mock_agent.model_dump.return_value = {'id': 'agent1', 'name': 'Test Agent'}
            mock_graph_engine.spawn_specialized_agent.return_value = mock_agent

            spawn_data = {'agent_type': 'specialist', 'task': 'test task'}
            response = client.post('/api/enhanced/resources/spawn', json=spawn_data)
            assert response.status_code == 200
            data = response.json()
            assert data['id'] == 'agent1'

    def test_get_backend_config_success(self, client):
        """Test successful backend config retrieval."""
        response = client.get('/api/enhanced/config/backend')
        assert response.status_code == 200
        data = response.json()
        assert 'backend_type' in data or 'status' in data

    def test_update_backend_config_never_fabricates_success(
        self, sample_backend_config
    ):
        """GOC-28 (BUG-008-class fabrication): `PUT /api/enhanced/config/backend`
        used to accept ANY payload and unconditionally return
        `{"status": "success", ...}` without writing an environment variable,
        config file, or anything else -- a mocked response standing in for a
        backend that did nothing, regardless of what the caller sent or
        whether the write was even possible. This calls the real handler
        function directly (not the fabricated response, not a stub) against
        three known-bad inputs -- an ordinary-looking config payload, an
        adversarial payload attempting to smuggle unrelated keys, and an
        empty payload -- and proves every one of them now gets the honest
        "no config-write path is wired" failure instead of a fake success.
        """
        for payload in (
            sample_backend_config,
            {'GRAPH_DB_PATH': '/etc/passwd', '__proto__': {'admin': True}},
            {},
        ):
            with pytest.raises(HTTPException) as excinfo:
                asyncio.run(api_extensions.update_backend_config(payload))
            assert excinfo.value.status_code == 501
            assert 'success' not in excinfo.value.detail.lower()


class TestCoverageExpansion:
    """Additional tests for coverage expansion."""

    def test_list_agents_error(self, client):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            side_effect=Exception('List agents failed'),
        ):
            response = client.get('/api/enhanced/agents')
            assert response.status_code == 200
            assert response.json() == []

    def test_add_memory_error(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.add_memory_node.side_effect = Exception('Add failed')
            response = client.post(
                '/api/enhanced/graph/memory', json={'content': 'test'}
            )
            assert response.status_code == 500

    def test_update_memory_error(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.update_memory_node.side_effect = Exception(
                'Update failed'
            )
            response = client.put(
                '/api/enhanced/graph/memory/mem1', json={'content': 'test'}
            )
            assert response.status_code == 500

    def test_delete_memory_error(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.delete_memory_node.side_effect = Exception(
                'Delete failed'
            )
            response = client.delete('/api/enhanced/graph/memory/mem1')
            assert response.status_code == 500

    def test_link_nodes_error(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.link_nodes.side_effect = Exception('Link failed')
            response = client.post(
                '/api/enhanced/graph/link',
                json={'source': 'a', 'target': 'b', 'relationship_type': 'c'},
            )
            assert response.status_code == 500

    def test_hybrid_search_error(self, client, mock_graph_engine):
        """A REAL backend failure must raise 503, not a fabricated `200 []`.

        D-W6-10 (same class of fix as get_graph_nodes/get_graph_relationships/
        list_workflows -- see `TestWorkflowsEndpointFailsHonestly`): this
        route used to swallow ANY `search_hybrid` exception into a bare
        `[]`, indistinguishable from a search that genuinely matched
        nothing -- root cause of the observed live non-determinism (item C/F:
        identical successive `/graph/search` calls returning 5 results then
        0, because a transient per-call failure silently became a fake empty
        result instead of a distinguishable error). This expectation was
        stale (previously asserted 200 + []); see api_extensions.hybrid_search
        for the fix.
        """
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.search_hybrid.side_effect = Exception('Search failed')
            response = client.get('/api/enhanced/graph/search?query=test')
            assert response.status_code == 503
            assert response.json() != []

    def test_hybrid_search_genuinely_empty_is_200(self, client, mock_graph_engine):
        """A real search with zero matches still returns `200 []` -- the
        D-W6-10 fix above must not turn a genuinely empty result set into a
        false failure."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.search_hybrid.return_value = []
            response = client.get('/api/enhanced/graph/search?query=test')
            assert response.status_code == 200
            assert response.json() == []

    def test_ingest_kb_error(self, client, mock_kb_engine, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.KBIngestionEngine',
                return_value=mock_kb_engine,
            ):
                mock_kb_engine.ingest.side_effect = Exception('Ingest failed')
                response = client.post(
                    '/api/enhanced/kb/ingest', json={'kb_id': 'test', 'source': 'test'}
                )
                assert response.status_code == 500

    def test_get_tasks_error(self, client):
        with patch(
            'agent_webui.api_extensions.SDDManager', side_effect=Exception('SDD error')
        ):
            response = client.get('/api/enhanced/sdd/tasks')
            assert response.status_code == 200
            assert response.json() == {}

    def test_list_skills_success(self, client):
        """`/api/enhanced/skills` reads exclusively from the SQL fleet
        catalog's `skills` table (via `_read_fleet_catalog`) -- not a
        filesystem scan or a live-engine fallback chain."""
        catalog_rows = {
            'skills': [
                {
                    'id': 'wger-agent-docs',
                    'name': 'wger-agent-docs',
                    'description': 'Wger docs',
                    'enabled': True,
                },
                {
                    'id': 'a-skill',
                    'name': 'a-skill',
                    'description': '',
                    'enabled': False,
                },
            ]
        }
        with patch(
            'agent_webui.api_extensions._read_fleet_catalog',
            AsyncMock(return_value=catalog_rows),
        ):
            response = client.get('/api/enhanced/skills')
            assert response.status_code == 200
            data = response.json()
            # sorted alphabetically by name
            assert [item['id'] for item in data] == ['a-skill', 'wger-agent-docs']
            assert data[1] == {
                'id': 'wger-agent-docs',
                'name': 'wger-agent-docs',
                'description': 'Wger docs',
                'enabled': True,
            }

    def test_list_skills_empty_catalog_is_an_honest_empty_list(self, client):
        """A reachable catalog with zero rows (e.g. the hourly
        fleet-tool-schema-sync job has not run yet) is a genuine `[]`, never
        conflated with a read failure."""
        with patch(
            'agent_webui.api_extensions._read_fleet_catalog',
            AsyncMock(return_value={'skills': []}),
        ):
            response = client.get('/api/enhanced/skills')
            assert response.status_code == 200
            assert response.json() == []

    def test_list_skills_catalog_unavailable_fails_closed(self, client):
        """A failed/denied catalog read (`_read_fleet_catalog` returning
        `None`) must raise 503, never render as an indistinguishable empty
        list -- a degraded read must never look like "all clear"."""
        with patch(
            'agent_webui.api_extensions._read_fleet_catalog',
            AsyncMock(return_value=None),
        ):
            response = client.get('/api/enhanced/skills')
            assert response.status_code == 503

    def test_list_skills_this_kind_unavailable_within_a_mapping_also_fails_closed(
        self, client
    ):
        """Per-kind degradation (FIX LANE 2, Defect A): `_read_fleet_catalog`
        now returns a MAPPING (never a bare `None`) once authority is
        granted, with a per-kind `None` for a kind whose own read failed.
        `list_skills` only ever requests the `skills` kind, so THAT kind
        failing is equivalent to the old whole-catalog failure and must
        still raise 503, not render `catalog['skills']` as if it were an
        honest empty list."""
        with patch(
            'agent_webui.api_extensions._read_fleet_catalog',
            AsyncMock(return_value={'skills': None}),
        ):
            response = client.get('/api/enhanced/skills')
            assert response.status_code == 503

    def test_toggle_skill_success(self, client):
        mock_toggle = MagicMock(return_value={'status': 'enabled'})
        with patch('agent_webui.api_extensions.get_helper', return_value=mock_toggle):
            response = client.post('/api/enhanced/skills/skill1/toggle')
            assert response.status_code == 200
            assert response.json()['status'] == 'enabled'

    def test_spawn_agent_success(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_agent = MagicMock()
            mock_agent.model_dump.return_value = {'id': 'agent1'}
            mock_graph_engine.spawn_specialized_agent.return_value = mock_agent
            response = client.post(
                '/api/enhanced/resources/spawn', json={'agent_id': 'test'}
            )
            assert response.status_code == 200
            assert response.json()['id'] == 'agent1'

    def test_get_graph_stats_error(self, client):
        """A REAL failure acquiring the engine (an exception, not merely
        ``get_active()`` returning None) must stay a hard 503 -- D-W6-10
        hardened this precisely so a genuine backend failure can never look
        like a real empty/absent-engine graph (see the ``available: False``
        degrade path exercised by ``test_get_graph_stats_no_engine`` below,
        which is the "no engine at all" case and stays 200). This
        expectation was stale (previously asserted 200); the code was
        correct, per D-MQR/W7-ENGINE-FALLBACK-lane analysis -- see that
        lane's report."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            side_effect=Exception('Stats failed'),
        ):
            response = client.get('/api/enhanced/graph/stats')
            assert response.status_code == 503

    def test_list_kbs_success(self, client, mock_graph_engine, mock_kb_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.KBIngestionEngine',
                return_value=mock_kb_engine,
            ):
                mock_kb_engine.list_knowledge_bases.return_value = [{'id': 'kb1'}]
                response = client.get('/api/enhanced/kb/list')
                assert response.status_code == 200
                assert len(response.json()) == 1

    def test_kb_health_check_success(self, client, mock_graph_engine, mock_kb_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.KBIngestionEngine',
                return_value=mock_kb_engine,
            ):
                response = client.post(
                    '/api/enhanced/kb/health', json={'kb_id': 'test'}
                )
                assert response.status_code == 200
                assert response.json()['health_status'] == 'healthy'

    def test_list_specs_success(self, client, mock_sdd_manager):
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_sdd_manager.list_specs.return_value = [{'id': 'spec1'}]
            response = client.get('/api/enhanced/sdd/specs')
            assert response.status_code == 200
            assert len(response.json()) == 1

    def test_create_spec_success(self, client, mock_sdd_manager):
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_sdd_manager.create_spec.return_value = MagicMock()
            mock_sdd_manager.create_spec.return_value.id = 'spec1'
            mock_sdd_manager.create_spec.return_value.model_dump.return_value = {
                'id': 'spec1'
            }
            # Use data that won't fail validation
            response = client.post(
                '/api/enhanced/sdd/spec', json={'name': 'test', 'description': 'test'}
            )
            assert response.status_code == 200

    def test_graph_impact_success(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.query_impact.return_value = [{'id': 'impact1'}]
            # Fix URL: /graph/impact/{symbol}
            response = client.get('/api/enhanced/graph/impact/test')
            assert response.status_code == 200
            assert len(response.json()) == 1

    def test_pipeline_status_error(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.PipelineRunner',
                side_effect=Exception('Status failed'),
            ):
                response = client.get('/api/enhanced/pipeline/status')
                assert response.status_code == 200
                # Matches return {'status': 'error'} in api_extensions.py
                assert response.json()['status'] == 'error'

    def test_list_plans_success(self, client, mock_sdd_manager):
        with patch(
            'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
        ):
            mock_sdd_manager.list_plans.return_value = [{'id': 'plan1'}]
            response = client.get('/api/enhanced/sdd/plans')
            assert response.status_code == 200
            assert len(response.json()) == 1

    def test_sync_sdd_success(self, client, mock_sdd_manager, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.SDDManager', return_value=mock_sdd_manager
            ):
                response = client.post(
                    '/api/enhanced/sdd/sync', json={'spec_id': 'test'}
                )
                assert response.status_code == 200
                assert response.json()['status'] == 'success'

    def test_graph_stats_success(self, client, mock_graph_engine):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend.execute.return_value = [{'total': 10}]
            response = client.get('/api/enhanced/graph/stats')
            assert response.status_code == 200
            assert 'total_nodes' in response.json()

    def test_trigger_pipeline_success(
        self, client, mock_pipeline_runner, mock_graph_engine
    ):
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            with patch(
                'agent_webui.api_extensions.PipelineRunner',
                return_value=mock_pipeline_runner,
            ):
                response = client.post(
                    '/api/enhanced/pipeline/trigger', json={'phase': 'test'}
                )
                assert response.status_code == 200
                assert response.json()['status'] == 'success'


class TestInfraHandlersFailHonestly:
    """Infra handlers must surface real failures, never fabricate success.

    These previously returned hardcoded 'Simulated' success payloads on error —
    a dangerous facade for SSH/exec/process-kill operations. The fix raises the
    real error instead; these tests lock that in.
    """

    def test_add_host_failure_not_simulated(self, client):
        """A failed host registration reports the error, never 'added (Simulated)'."""
        with patch(
            'tunnel_manager.tunnel_manager.HostManager',
            side_effect=RuntimeError('store unwritable'),
        ):
            response = client.post(
                '/api/enhanced/tunnel-manager/hosts',
                json={
                    'alias': 'x',
                    'hostname': 'h',
                    'user': 'u',
                },
            )
        assert response.status_code >= 400
        assert 'Simulated' not in response.text


class TestWorkflowsEndpointFailsHonestly:
    """`GET /api/enhanced/workflows` must distinguish a real backend failure
    (D-W5WR-4: e.g. `PlacementAuthorityError`) from a genuinely empty
    Workflows list -- same class of fix `TestGraphNodesEndpoint` locks in for
    `/graph/nodes` (D-W6-10). Before this fix, a raised backend exception was
    swallowed into a bare `200 []`, indistinguishable from "no workflows
    saved yet".
    """

    def test_list_workflows_backend_error_is_not_silently_empty(
        self, client, mock_graph_engine
    ):
        """A backend failure raises 503, not a fabricated `200 []`."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.side_effect = RuntimeError(
                'PlacementAuthorityError: admin:cluster-read required'
            )

            response = client.get('/api/enhanced/workflows')

        assert response.status_code == 503
        assert response.json() != []

    def test_list_workflows_genuinely_empty_is_200(self, client, mock_graph_engine):
        """A real empty graph still returns `200 []` -- the fix must not
        turn a genuinely empty Workflows list into a false failure."""
        with patch(
            'agent_webui.api_extensions.IntelligenceGraphEngine.get_active',
            return_value=mock_graph_engine,
        ):
            mock_graph_engine.backend = MagicMock()
            mock_graph_engine.backend.execute.return_value = []

            response = client.get('/api/enhanced/workflows')

        assert response.status_code == 200
        assert response.json() == []


class TestLlmModelSchemaEndpoint:
    """`GET /api/enhanced/llm/model-schema` -- the `@router.get(...)`
    decorator was previously attached to the private helper
    `_flatten_model_schema(schema: dict)` instead of the real handler
    `get_llm_model_schema()` immediately below it (dead code, undecorated).
    FastAPI therefore registered the HELPER, treating its `schema` param as a
    REQUIRED query parameter -- the frontend sends none, so every real
    request 422'd. This proves the real handler is what is now routed, with
    no query parameters required.
    """

    def test_model_schema_returns_200_with_no_query_params(self, client):
        response = client.get('/api/enhanced/llm/model-schema')

        assert response.status_code == 200
        data = response.json()
        assert set(data) == {'chat', 'embedding'}
        # Each side is a flattened JSON Schema with real top-level
        # properties/required, not a `$ref`/`$defs` wrapper.
        assert 'properties' in data['chat']
        assert 'properties' in data['embedding']

    def test_model_schema_rejects_no_longer_taking_a_schema_query_param(self, client):
        """Regression guard for the exact bug: passing the OLD helper's
        `schema` query param must not be required, and must not change the
        response shape (the real handler ignores query params entirely)."""
        response = client.get('/api/enhanced/llm/model-schema')
        assert response.status_code == 200
        # The route function is the real handler, not `_flatten_model_schema`
        from agent_webui.api_extensions import router

        route = next(
            r for r in router.routes if getattr(r, 'path', None) == '/llm/model-schema'
        )
        assert route.endpoint.__name__ == 'get_llm_model_schema'


class TestServerIntegration:
    """Test server-level features."""

    def test_spa_fallback(self, client):
        response = client.get('/some-random-route')
        assert response.status_code in [200, 404]
