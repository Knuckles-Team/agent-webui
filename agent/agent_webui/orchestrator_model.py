#!/usr/bin/python
"""agent-webui's chat model — the SAME execution plane as messaging (D-W5OEP-2).

The production entrypoint (``server.py::main()``, the function the Dockerfile
CMD invokes) used to hand pydantic-ai's ``agent.to_web()`` a bare
``Agent(TestModel())`` — a canned, no-LLM double, so every chat turn served in
production was ungrounded by construction. There is also no separate
"webui model config" to invent: ``Orchestrator.execute_agent`` already
resolves its model/provider from the SAME ``AgentConfig`` every other
entrypoint uses, so routing chat through it is also how webui inherits
AgentConfig instead of maintaining a parallel config surface.

``AGENTS.md``'s *Universal capability* rule says every user-facing surface is
a thin entrypoint over ONE core orchestrator; the messaging entrypoint
(``agent_utilities/messaging/router.py::_graph_agent_reply``) already does
this correctly, and ``Orchestrator.execute_agent``'s own docstring names
"the agent-webui/REST gateway" as one of the entrypoints that is SUPPOSED to
converge on it. This module is that convergence for the webui chat surface.

Design: pydantic-ai's own ``FunctionModel`` (``pydantic_ai.models.function``)
is a ``Model`` whose "inference" is an arbitrary Python function — exactly
the seam ``TestModel`` plugs into. Swapping the canned double for a function
that calls ``Orchestrator(engine).execute_agent(...)`` keeps
``agent.to_web()``'s whole AG-UI/HTTP/streaming protocol machinery intact
(it still owns transport) while making the actual reply come from the real
graph orchestration path — the same one messaging, and the servicenow-skills
delegation path, are already validated against.

Progress streaming (D-W6-BSF-1-ish follow-up: "the chat spins for minutes then
answers"): ``_reply_stream`` used to ``await`` the WHOLE orchestrated turn
before yielding anything, so ``agent.to_web()``'s SSE stream carried exactly
one chunk, at the very end -- a live turn that spent 264s inside
``Orchestrator.execute_agent`` left the browser spinning for 264s with zero
wire traffic. The core already has the fix built: ``execute_agent`` (and the
``run_agent`` it forwards to,
CONCEPT:AU-ORCH.execution.messaging-orchestration-transparency) accepts an
optional ``progress_sink`` callback and emits a ``ProgressEvent`` at every
existing checkpoint (routing decision, each fleet tool call/result, the
evidence gate, synthesis, the terminal done/failure) -- built for the
messaging entrypoint's live-edited status message. This module reuses that
SAME core seam (no second progress mechanism) rather than inventing a
webui-only one, per ``AGENTS.md``'s *Universal capability* rule: the core
emits the events, this entrypoint only adapts them to its wire.

``FunctionModel.stream_function`` may only yield ``str`` (a text delta),
``DeltaToolCalls``, ``DeltaThinkingCalls``, or ``BuiltinToolCallsReturns`` --
there is no generic custom-data channel available without subclassing
pydantic-ai's Vercel-AI event-stream adapter, which is out of this module's
reach (that lives inside ``agent.to_web()``, wired in ``server.py``). Each
``ProgressEvent`` is therefore surfaced as its OWN reasoning
(``DeltaThinkingPart``) part -- a distinct ``vendor_part_id`` per event opens
a fresh part, so pydantic-ai's adapter emits a real ``reasoning-start`` /
``reasoning-delta`` SSE chunk per checkpoint instead of one run-on "thinking"
blob. ``@ai-sdk/react``'s ``useChat`` already renders reasoning parts
distinctly from the answer text and flips ``status`` out of ``'submitted'``
on the FIRST chunk of ANY kind -- so the spinner clears the instant routing
starts, not when the whole run finishes.

Token streaming (events AND the answer, concurrently): the core's model call
sites (``agent_utilities.orchestration.agent_runner._stream_agent_run``) now
stream the answer's OWN token deltas onto this SAME ``progress_sink`` channel
as ``ProgressEvent(stage="text_delta")``. ``_reply_stream`` routes those onto
the wire as ordinary ``str`` chunks (not another reasoning part), so
``@ai-sdk/react`` appends each one to the assistant message's growing text
part exactly like a normal streaming model reply -- while the surrounding
route/tool_call/synthesis checkpoints keep streaming as reasoning parts on
the SAME drain loop. Because both come off the ONE queue this generator
already drains in arrival order, there is no second queue to reconcile and
no interleaving hazard: a text delta can never be reordered relative to the
checkpoint immediately before or after it. Not every run streams its answer
token-by-token yet (the full multi-agent-graph shape's model call lives in
``orchestration/engine.py`` and does not yet accept ``progress_sink`` --
see ``agent_runner._execute_graph``'s docstring), so ``_reply_stream`` still
falls back to yielding the run's final return string in one chunk whenever
no ``text_delta`` event arrived -- covering that shape today and preserving
the failure-path guarantee (the engine's own failure ``GraphResponse``
message must still reach the user as a streamed terminal chunk, never
silence) unconditionally.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from typing import TYPE_CHECKING, Any

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, DeltaThinkingPart, FunctionModel

if TYPE_CHECKING:
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine
    from agent_utilities.orchestration.agent_runner import ProgressEvent

logger = logging.getLogger(__name__)

DEFAULT_WEBUI_AGENT_NAME = 'webui-assistant'


def _latest_user_text(messages: list[ModelMessage]) -> str:
    """Extract the newest user message text from the AG-UI conversation history.

    ``agent.to_web()`` resends the FULL message history every turn (stateless
    HTTP), so the caller's actual new input is the ``UserPromptPart`` content
    of the LAST ``ModelRequest`` in ``messages``.
    """
    for message in reversed(messages):
        if not isinstance(message, ModelRequest):
            continue
        chunks: list[str] = []
        for part in message.parts:
            if not isinstance(part, UserPromptPart):
                continue
            content = part.content
            if isinstance(content, str):
                chunks.append(content)
            else:
                for item in content:
                    if isinstance(item, str):
                        chunks.append(item)
                    else:
                        text = getattr(item, 'content', None) or getattr(
                            item, 'text', None
                        )
                        if isinstance(text, str):
                            chunks.append(text)
        if chunks:
            return '\n'.join(chunks)
        # Newest ModelRequest carried no user text (e.g. a tool-return-only
        # turn) -- keep walking backward for the most recent real user turn.
    return ''


def _progress_event_payload(event: ProgressEvent) -> str:
    """Serialize one core ``ProgressEvent`` to the JSON string a reasoning part carries.

    Pure input-adaptation (CONCEPT:AU-ORCH.execution.messaging-orchestration-transparency,
    webui half of *Universal capability* -- ``AGENTS.md``): every field comes straight off
    the core's own event, unmodified and unfiltered, so no routing/stage/status logic lives
    in this entrypoint -- ``src/Chat.tsx`` is the ONLY place that turns this into a rendered
    stage badge. Falls back to a plain string on the near-impossible chance a field is not
    JSON-serializable, so a rendering hiccup can never turn into a broken stream.
    """
    try:
        return json.dumps(
            {
                'stage': event.stage,
                'status': event.status,
                'detail': event.detail,
                'evidence': event.evidence,
            }
        )
    except (TypeError, ValueError):
        return json.dumps(
            {'stage': event.stage, 'status': event.status, 'detail': event.detail}
        )


def _conversation_session_id(messages: list[ModelMessage]) -> str:
    """Derive a stable per-conversation session id.

    Prefers pydantic-ai's own ``conversation_id`` (populated from the AG-UI
    ``threadId`` when the frontend supplies one) so successive turns of the
    SAME browser conversation share the SAME memento/session continuity
    ``Orchestrator.execute_agent`` gives every other entrypoint. Falls back to
    a stable hash of the conversation's first user turn when no
    ``conversation_id`` is present (older pydantic-ai/AG-UI client, or a
    history replayed without one) -- still stable across the growing
    history, just unable to distinguish two conversations that happen to
    open with byte-identical text.
    """
    for message in messages:
        if isinstance(message, ModelRequest) and message.conversation_id:
            return f'webui:{message.conversation_id}'
    first_text = _latest_user_text(messages[:1]) or _latest_user_text(messages)
    digest = hashlib.sha256(first_text.encode('utf-8')).hexdigest()[:32]
    return f'webui:anon:{digest}'


def build_orchestrator_model(
    engine_provider: Any,
    *,
    agent_name: str | None = None,
) -> FunctionModel:
    """Build the ``FunctionModel`` that routes agent-webui chat through Orchestrator.

    Args:
        engine_provider: an async, zero-arg callable resolving the live
            ``IntelligenceGraphEngine`` (``agent_webui.api_extensions._get_engine_bounded``
            in production) -- called lazily, per turn, exactly like every
            other engine-backed webui route, never constructed eagerly at
            process startup (the engine requires a verified actor context
            that only exists once a real authenticated request is in
            flight).
        agent_name: the named agent Orchestrator routes this chat turn to.
            Defaults to ``DEFAULT_WEBUI_AGENT_NAME``; an unresolved name
            still runs the full dynamic-delegation graph (matching
            messaging's own ``MESSAGING_AGENT`` default), it just skips
            starting from a curated identity prompt.
    """
    resolved_agent_name = (agent_name or '').strip() or DEFAULT_WEBUI_AGENT_NAME

    async def _run_orchestrator_turn(
        messages: list[ModelMessage],
        agent_info: AgentInfo,
        *,
        progress_sink: Any = None,
    ) -> str:
        from agent_utilities.orchestration.manager import Orchestrator
        from agent_utilities.orchestration.run_identity import new_run_id

        task = _latest_user_text(messages)
        if not task:
            return ''

        session_id = _conversation_session_id(messages)
        engine: IntelligenceGraphEngine = await engine_provider()

        reply_text = await Orchestrator(engine).execute_agent(
            agent_name=resolved_agent_name,
            task=task,
            session_id=session_id,
            memento_source=session_id,
            execution_profile='chat',
            run_id=new_run_id(),
            context=agent_info.instructions,
            progress_sink=progress_sink,
        )
        return str(reply_text or '').strip()

    async def _reply(
        messages: list[ModelMessage], agent_info: AgentInfo
    ) -> ModelResponse:
        text = await _run_orchestrator_turn(messages, agent_info)
        return ModelResponse(parts=[TextPart(content=text)])

    async def _reply_stream(messages: list[ModelMessage], agent_info: AgentInfo):
        # CONCEPT:AU-ORCH.execution.messaging-orchestration-transparency, webui half.
        # Run the orchestrated turn as a background task and drain its
        # ``ProgressEvent`` stream (the SAME core channel the messaging
        # entrypoint's live-edited status message already reuses) through a
        # queue, yielding one reasoning part per event AS THEY ARRIVE instead
        # of awaiting the whole turn first. See the module docstring for why
        # a reasoning part (not a custom data chunk) is the wire shape used.
        task = _latest_user_text(messages)
        if not task:
            yield ''
            return

        events: asyncio.Queue[ProgressEvent | None] = asyncio.Queue()

        async def _sink(event: ProgressEvent) -> None:
            await events.put(event)

        async def _run() -> str:
            try:
                return await _run_orchestrator_turn(
                    messages, agent_info, progress_sink=_sink
                )
            finally:
                # Always unblock the drain loop below, success or failure, so
                # a run that raises still lets the generator observe every
                # checkpoint emitted before the failure and then re-raise.
                await events.put(None)

        run_task = asyncio.create_task(_run())
        try:
            part_index = 0
            streamed_answer = False
            while True:
                event = await events.get()
                if event is None:
                    break
                # CONCEPT:AU-ORCH.execution.messaging-orchestration-transparency,
                # token-streaming half -- the core now emits the answer's own token
                # deltas on this SAME channel as ``stage="text_delta"`` events
                # (``agent_runner._stream_agent_run``). Route those onto the wire as
                # plain ``str`` chunks (FunctionModel's ordinary text-delta shape) so
                # ``@ai-sdk/react`` appends them to the message's growing text part,
                # INTERLEAVED with the reasoning-part checkpoints above/below in
                # whatever order the core produced them -- both come off the ONE
                # queue this generator drains, so there is no second stream to
                # reconcile and no reordering hazard.
                if event.stage == 'text_delta':
                    if event.detail:
                        streamed_answer = True
                        yield event.detail
                    continue
                part_index += 1
                yield {
                    part_index: DeltaThinkingPart(
                        content=_progress_event_payload(event)
                    )
                }

            # Every checkpoint (including the terminal "done"/"failure" one --
            # run_agent emits it BEFORE returning, CONCEPT:AU-ORCH.execution.messaging-orchestration-transparency)
            # has now streamed. ``run_task`` is therefore already finished;
            # ``await`` just collects its result (or re-raises its exception,
            # which is exactly what a run that failed before producing any
            # output should do -- the engine's own failure GraphResponse
            # still reaches the user as a real answer string, streamed here
            # like any other successful turn, never silently).
            text = await run_task
            # A run whose model call streamed its own token deltas above (the
            # single-server/focused-tools/direct-completion shapes) already put the
            # full answer on the wire incrementally -- yielding ``text`` again here
            # would duplicate it. A run that only ever streamed checkpoint events
            # (today: the full multi-agent-graph shape, whose engine-side model call
            # does not yet stream -- see agent_runner._execute_graph's docstring --
            # and any failure path that never reached a model call) still needs this
            # fallback so the answer/failure text reaches the wire at all.
            if text and not streamed_answer:
                yield text
        finally:
            if not run_task.done():
                run_task.cancel()

    return FunctionModel(
        _reply,
        stream_function=_reply_stream,
        model_name=f'orchestrator:{resolved_agent_name}',
    )
