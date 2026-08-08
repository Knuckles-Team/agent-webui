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
"""

from __future__ import annotations

import hashlib
import logging
from typing import TYPE_CHECKING, Any

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

if TYPE_CHECKING:
    from agent_utilities.knowledge_graph.core.engine import IntelligenceGraphEngine

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
        messages: list[ModelMessage], agent_info: AgentInfo
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
        )
        return str(reply_text or '').strip()

    async def _reply(
        messages: list[ModelMessage], agent_info: AgentInfo
    ) -> ModelResponse:
        text = await _run_orchestrator_turn(messages, agent_info)
        return ModelResponse(parts=[TextPart(content=text)])

    async def _reply_stream(messages: list[ModelMessage], agent_info: AgentInfo):
        # Orchestrator.execute_agent (like messaging's own _graph_agent_reply)
        # returns one fully-composed reply, not a token stream -- so
        # "streaming" here is one chunk carrying the whole answer once the
        # orchestrated run completes. This is still a REAL streamed response
        # (agent.to_web()'s AG-UI protocol gets a proper stream event, just
        # with a single delta) rather than a crash: FunctionModel.request_stream
        # requires a stream_function to be supplied at all, and asserts if
        # one is not -- omitting this would fail every chat turn agent.to_web()
        # drives through the streaming path.
        text = await _run_orchestrator_turn(messages, agent_info)
        yield text

    return FunctionModel(
        _reply,
        stream_function=_reply_stream,
        model_name=f'orchestrator:{resolved_agent_name}',
    )
