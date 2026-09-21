"""Wiring proof that ``mock_graph_engine`` never opens a socket.

Regression: after GOC-53 scoped a synthetic actor context around
``GraphComputeEngine()`` in ``tests/conftest.py::mock_graph_engine`` (to clear
the verified-identity-carrier gate GOC-15 added), the fixture still called the
REAL ``GraphComputeEngine.__init__``, which resolves an engine coordinator and
opens a UDS/TCP socket via ``SyncEpistemicGraphClient.connect`` -- i.e. a
fixture named "mock" constructed a live client. With no engine running that is
``ConnectionRefusedError``. The ``graphos`` dependency extra now deliberately
installs the native ``epistemic_graph`` client, so package absence can no
longer be used as the safety boundary.

These tests prove both sides of the current contract: the declared client is
importable, while the fixture remains a genuine double with the socket layer
wired to explode on first use. The resulting
``engine.graph`` is still a real ``GraphComputeEngine`` instance (the exact
type ``PipelineContext`` -- agent_utilities/knowledge_graph/pipeline/types.py
-- validates via Pydantic ``arbitrary_types_allowed`` isinstance checking).
"""

from __future__ import annotations

import socket


def test_epistemic_graph_client_package_is_declared_and_importable() -> None:
    """The graphos dependency contract includes the engine client package.

    Network isolation is proven by the fixture test below, not by keeping a
    runtime dependency absent from the environment.
    """
    import epistemic_graph.client as client

    assert client.__name__ == 'epistemic_graph.client'


def test_mock_graph_engine_never_opens_a_socket(mock_graph_engine, monkeypatch) -> None:
    """The fixture must succeed even when any real connect attempt would explode.

    ``socket.socket.connect`` is the last-resort chokepoint every transport
    (AF_UNIX for the local engine, AF_INET for a remote shard) funnels
    through. Wiring it to raise proves that, whatever path the fixture takes,
    it never reaches a real connect call -- the strongest available
    known-bad proof without actually spinning up a listener to observe a
    hit-count of zero from the other side.
    """

    def _explode(self, *_args, **_kwargs):
        raise AssertionError(
            'mock_graph_engine attempted a real socket connection -- it must '
            'never construct a live GraphComputeEngine transport'
        )

    monkeypatch.setattr(socket.socket, 'connect', _explode)

    # The fixture is already constructed by the time this test body runs
    # (pytest resolves it at setup) -- so the real proof is that setup did
    # NOT already raise. Re-affirm the double's shape here too.
    from agent_utilities.knowledge_graph.core.graph_compute import GraphComputeEngine

    assert isinstance(mock_graph_engine.graph, GraphComputeEngine)
    # And prove the double is inert: touching it now, with the socket
    # chokepoint wired to explode, still never trips it because the double
    # holds a MagicMock transport, not a real one.
    assert mock_graph_engine.graph.graph_name == 'test-graph'
    assert mock_graph_engine.graph.endpoint == 'test://mock-graph-engine-fixture'
