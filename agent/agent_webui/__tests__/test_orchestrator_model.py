"""Wiring tests for ``orchestrator_model``'s progress-event streaming.

Production incident this closes: a single chat turn spent 264s inside
``Orchestrator.execute_agent`` while ``src/Chat.tsx`` showed a bare spinner the
whole time, because ``_reply_stream`` used to ``await`` the WHOLE orchestrated
turn before yielding its one and only chunk. The fix reuses the core's own
``progress_sink`` channel (``agent_utilities.orchestration.agent_runner.ProgressEvent``,
built for the messaging entrypoint's live-edited status message) rather than
inventing a webui-only mechanism.

These tests drive the REAL ``build_orchestrator_model`` / ``_reply_stream``
seam -- only ``Orchestrator.execute_agent`` itself (agent-utilities'
deepest boundary, mirroring how ``agent-utilities``' own ``test_run_summary.py``
mocks just the KG-engine boundary and lets the real dispatch code run) is
faked, so the queue-draining / ordering / JSON-adaptation logic in
``orchestrator_model.py`` executes for real.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from agent_webui.orchestrator_model import build_orchestrator_model
from pydantic_ai.messages import ModelRequest, UserPromptPart
from pydantic_ai.models.function import DeltaThinkingPart


class _FakeAgentInfo:
    """Duck-typed stand-in for ``pydantic_ai.models.function.AgentInfo``.

    ``_run_orchestrator_turn`` only ever reads ``.instructions`` off this object, so a
    minimal double is enough -- constructing the real frozen dataclass would require
    fabricating ``ModelRequestParameters`` for no additional coverage.
    """

    instructions: str | None = None


def _user_message(text: str) -> ModelRequest:
    return ModelRequest(parts=[UserPromptPart(content=text)])


async def _fake_engine_provider() -> Any:
    return object()


def _install_fake_orchestrator(
    monkeypatch: pytest.MonkeyPatch, orchestrator_cls: type
) -> None:
    """``_run_orchestrator_turn`` does ``from ...manager import Orchestrator`` INSIDE the
    function on every call, so patching the module attribute is picked up live -- no
    import-time caching to work around."""
    monkeypatch.setattr(
        'agent_utilities.orchestration.manager.Orchestrator', orchestrator_cls
    )


@pytest.mark.asyncio
async def test_reply_stream_yields_progress_before_the_final_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The generator streams each ``ProgressEvent`` AS THE RUN PROCEEDS, then the
    final answer LAST -- proving ``_reply_stream`` no longer awaits the whole turn
    before yielding anything. Assert ORDERING (progress chunks precede the answer
    chunk in the yielded sequence), not wall-clock timing, per house style: a
    timing-based assertion is flaky on a loaded host.
    """
    from agent_utilities.orchestration.agent_runner import ProgressEvent

    emitted = [
        ProgressEvent(
            run_id='run:x', stage='start', status='started', detail='webui-assistant'
        ),
        ProgressEvent(
            run_id='run:x', stage='route', status='ok', detail='routed to au-expert'
        ),
        ProgressEvent(run_id='run:x', stage='done', status='ok', detail='completed'),
    ]

    class _FakeOrchestrator:
        def __init__(self, engine: Any) -> None:
            self.engine = engine

        async def execute_agent(self, **kwargs: Any) -> str:
            sink = kwargs['progress_sink']
            assert sink is not None, 'progress_sink must reach execute_agent'
            for event in emitted:
                await sink(event)
            return 'ANSWER'

    _install_fake_orchestrator(monkeypatch, _FakeOrchestrator)
    model = build_orchestrator_model(
        _fake_engine_provider, agent_name='webui-assistant'
    )

    chunks = [
        chunk
        async for chunk in model.stream_function(
            [_user_message('hi')], _FakeAgentInfo()
        )
    ]

    # 3 progress chunks (dict-shaped DeltaThinkingCalls, one per ProgressEvent) THEN
    # the plain-text final answer -- not one post-hoc chunk carrying everything.
    assert len(chunks) == 4
    for chunk in chunks[:3]:
        assert isinstance(chunk, dict)
        (part,) = chunk.values()
        assert isinstance(part, DeltaThinkingPart)
    assert chunks[3] == 'ANSWER'

    # Each progress chunk's distinct dict key opens its OWN reasoning part (so
    # pydantic-ai's adapter emits one reasoning-start/delta per checkpoint, not one
    # run-on blob) and its payload is the source ProgressEvent verbatim -- no
    # stage/status logic lives in this entrypoint (Universal capability).
    keys = [next(iter(c.keys())) for c in chunks[:3]]
    assert len(set(keys)) == 3, 'each progress event must open a distinct part'
    payloads = [json.loads(next(iter(c.values())).content) for c in chunks[:3]]
    assert [p['stage'] for p in payloads] == ['start', 'route', 'done']
    assert [p['status'] for p in payloads] == ['started', 'ok', 'ok']
    assert payloads[1]['detail'] == 'routed to au-expert'


@pytest.mark.asyncio
async def test_reply_stream_reraises_after_draining_pending_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A run that fails mid-flight still streams every checkpoint emitted BEFORE the
    failure, then re-raises -- progress is never lost, and a genuine exception is
    never swallowed into silence."""
    from agent_utilities.orchestration.agent_runner import ProgressEvent

    class _Boom(RuntimeError):
        pass

    class _FakeOrchestrator:
        def __init__(self, engine: Any) -> None:
            pass

        async def execute_agent(self, **kwargs: Any) -> str:
            sink = kwargs['progress_sink']
            await sink(ProgressEvent(run_id='run:y', stage='start', status='started'))
            raise _Boom('engine offline')

    _install_fake_orchestrator(monkeypatch, _FakeOrchestrator)
    model = build_orchestrator_model(_fake_engine_provider)

    chunks: list[Any] = []
    with pytest.raises(_Boom):
        async for chunk in model.stream_function(
            [_user_message('hi')], _FakeAgentInfo()
        ):
            chunks.append(chunk)

    assert len(chunks) == 1  # the one progress event streamed BEFORE the raise


@pytest.mark.asyncio
async def test_reply_stream_yields_the_engines_failure_text_not_silence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the orchestration graph terminates with no output, ``engine.py`` already
    builds a real failure ``GraphResponse`` whose friendly message
    ``execute_agent`` returns as a normal string (not an exception). That message
    must still reach the caller as a streamed terminal chunk, not silence."""
    from agent_utilities.orchestration.agent_runner import ProgressEvent

    failure_text = (
        "I couldn't produce a response for this turn: the orchestration "
        'graph ended before any model ran. Please try again.'
    )

    class _FakeOrchestrator:
        def __init__(self, engine: Any) -> None:
            pass

        async def execute_agent(self, **kwargs: Any) -> str:
            sink = kwargs['progress_sink']
            await sink(
                ProgressEvent(
                    run_id='run:z',
                    stage='done',
                    status='degraded',
                    detail=failure_text[:200],
                )
            )
            return failure_text

    _install_fake_orchestrator(monkeypatch, _FakeOrchestrator)
    model = build_orchestrator_model(_fake_engine_provider)

    chunks = [
        chunk
        async for chunk in model.stream_function(
            [_user_message('hi')], _FakeAgentInfo()
        )
    ]

    assert chunks[-1] == failure_text


@pytest.mark.asyncio
async def test_reply_stream_short_circuits_with_no_user_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No user text (e.g. a tool-return-only turn) yields a single empty chunk and
    never spins up the progress machinery at all."""

    class _UnusedOrchestrator:
        def __init__(self, engine: Any) -> None:
            raise AssertionError(
                'Orchestrator must not be constructed with no user text'
            )

    _install_fake_orchestrator(monkeypatch, _UnusedOrchestrator)
    model = build_orchestrator_model(_fake_engine_provider)

    chunks = [chunk async for chunk in model.stream_function([], _FakeAgentInfo())]
    assert chunks == ['']


@pytest.mark.asyncio
async def test_reply_stream_routes_text_delta_events_as_plain_text_chunks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The core's own token deltas (``agent_runner._stream_agent_run``,
    ``ProgressEvent(stage="text_delta")``) arrive on the SAME ``progress_sink``
    channel as every other checkpoint. ``_reply_stream`` must route those onto the
    wire as ordinary ``str`` chunks -- NOT another ``DeltaThinkingPart`` reasoning
    part -- so ``@ai-sdk/react`` appends them to the growing answer text instead of
    the progress timeline. Proves incremental emission (four deltas -> four
    chunks, never coalesced into one) and that the final ``run_task`` return value
    is NOT re-yielded afterward (it would duplicate the already-streamed answer).
    """
    from agent_utilities.orchestration.agent_runner import ProgressEvent

    class _FakeOrchestrator:
        def __init__(self, engine: Any) -> None:
            pass

        async def execute_agent(self, **kwargs: Any) -> str:
            sink = kwargs['progress_sink']
            await sink(
                ProgressEvent(run_id='run:t', stage='route', status='ok', detail='ok')
            )
            for delta in ('agent-', 'utilities is ', 'a platform.'):
                await sink(
                    ProgressEvent(
                        run_id='run:t', stage='text_delta', status='ok', detail=delta
                    )
                )
            await sink(
                ProgressEvent(run_id='run:t', stage='done', status='ok', detail='')
            )
            return 'agent-utilities is a platform.'

    _install_fake_orchestrator(monkeypatch, _FakeOrchestrator)
    model = build_orchestrator_model(_fake_engine_provider)

    chunks = [
        chunk
        async for chunk in model.stream_function(
            [_user_message('what is agent-utilities')], _FakeAgentInfo()
        )
    ]

    # route (dict/DeltaThinkingPart), 3 plain-str deltas, done (dict), and NOTHING
    # after -- the final ``run_task`` text is suppressed because it was already
    # streamed incrementally.
    assert len(chunks) == 5
    assert isinstance(chunks[0], dict)
    assert chunks[1:4] == ['agent-', 'utilities is ', 'a platform.']
    assert isinstance(chunks[4], dict)
    # Concatenating the streamed text chunks, in emission order, reconstructs the
    # full answer -- the ordering+count assertion the house style requires instead
    # of a wall-clock one.
    assert ''.join(chunks[1:4]) == 'agent-utilities is a platform.'


@pytest.mark.asyncio
async def test_reply_stream_falls_back_to_final_text_with_no_text_delta_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A run that never emits a ``text_delta`` (today: the full multi-agent-graph
    shape, whose model call does not yet stream) keeps the prior fallback of
    yielding the run's final return string in one chunk -- proving the two code
    paths (streamed vs. not) do not duplicate OR drop the answer."""
    from agent_utilities.orchestration.agent_runner import ProgressEvent

    class _FakeOrchestrator:
        def __init__(self, engine: Any) -> None:
            pass

        async def execute_agent(self, **kwargs: Any) -> str:
            sink = kwargs['progress_sink']
            await sink(ProgressEvent(run_id='run:u', stage='start', status='started'))
            await sink(ProgressEvent(run_id='run:u', stage='done', status='ok'))
            return 'ANSWER FROM THE GRAPH'

    _install_fake_orchestrator(monkeypatch, _FakeOrchestrator)
    model = build_orchestrator_model(_fake_engine_provider)

    chunks = [
        chunk
        async for chunk in model.stream_function(
            [_user_message('hi')], _FakeAgentInfo()
        )
    ]

    assert chunks[-1] == 'ANSWER FROM THE GRAPH'
    assert chunks.count('ANSWER FROM THE GRAPH') == 1
