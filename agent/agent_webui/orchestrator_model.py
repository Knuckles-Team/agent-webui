"""agent-webui's chat model: one served Graph OS agent run per turn.

``agent.to_web()`` owns the AG-UI transport. pydantic-ai's ``FunctionModel``
plugs a plain function in as the model. That function sends the newest user
message to the Graph OS ``agents.run`` served operation, as the verified
caller, and returns the reply text. The WebUI holds no agent runtime of its
own.

The conversation ID (the AG-UI ``threadId``) becomes the A2A ``contextId``, so
successive turns of one browser conversation share one context.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from typing import Any

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

logger = logging.getLogger(__name__)

DEFAULT_WEBUI_AGENT_NAME = 'webui-assistant'


def _user_prompt_item_text(item: object) -> str | None:
    """Resolve one ``UserPromptPart.content`` list item to its text, or ``None``.

    Prefers a ``.content`` attribute over ``.text`` (matching multimodal content
    parts where ``.content`` is the canonical field); an empty/falsy ``.content``
    falls through to ``.text`` rather than being treated as present-but-empty.
    """
    if isinstance(item, str):
        return item
    text = getattr(item, 'content', None) or getattr(item, 'text', None)
    return text if isinstance(text, str) else None


def _user_prompt_chunks(content: str | list[object]) -> list[str]:
    """Flatten one ``UserPromptPart.content`` (str or list of parts) to text chunks."""
    if isinstance(content, str):
        return [content]
    chunks: list[str] = []
    for item in content:
        text = _user_prompt_item_text(item)
        if text is not None:
            chunks.append(text)
    return chunks


def _request_user_chunks(message: ModelRequest) -> list[str]:
    """Collect every ``UserPromptPart`` text chunk from one ``ModelRequest``."""
    chunks: list[str] = []
    for part in message.parts:
        if isinstance(part, UserPromptPart):
            chunks.extend(_user_prompt_chunks(part.content))
    return chunks


def _latest_user_text(messages: list[ModelMessage]) -> str:
    """Extract the newest user message text from the AG-UI conversation history.

    ``agent.to_web()`` resends the FULL message history every turn (stateless
    HTTP), so the caller's actual new input is the ``UserPromptPart`` content
    of the LAST ``ModelRequest`` in ``messages``.
    """
    for message in reversed(messages):
        if not isinstance(message, ModelRequest):
            continue
        chunks = _request_user_chunks(message)
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


_REPLY_KEYS = ('result', 'value', 'status', 'message', 'artifacts', 'parts')


def _join_texts(values: Any) -> str:
    return '\n'.join(text for item in values if (text := _reply_text(item)))


def _mapping_reply_text(value: dict[str, Any]) -> str:
    if value.get('kind') == 'text' and isinstance(value.get('text'), str):
        return value['text']
    return _join_texts(value[key] for key in _REPLY_KEYS if key in value)


def _reply_text(value: Any) -> str:
    """Collect the text parts of an A2A task or message result."""

    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return _mapping_reply_text(value)
    if isinstance(value, list):
        return _join_texts(value)
    return ''


def build_orchestrator_model(
    engine_provider: Any = None,
    *,
    agent_name: str | None = None,
    invoke: Any = None,
) -> FunctionModel:
    """Build the ``FunctionModel`` that runs each chat turn through Graph OS.

    Args:
        engine_provider: Unused. Kept so a host that passes one still works.
        agent_name: The named agent the turn asks Graph OS to run. Defaults to
            ``DEFAULT_WEBUI_AGENT_NAME``.
        invoke: The served-operation invoker. Defaults to
            :func:`agent_webui.host.invoke_operation`.
    """
    del engine_provider
    resolved_agent_name = (agent_name or '').strip() or DEFAULT_WEBUI_AGENT_NAME

    async def _run_turn(messages: list[ModelMessage], agent_info: AgentInfo) -> str:
        from .host import invoke_operation

        task = _latest_user_text(messages)
        if not task:
            return ''
        run_id = uuid.uuid4().hex
        message: dict[str, Any] = {
            'role': 'user',
            'kind': 'message',
            'messageId': run_id,
            'contextId': _conversation_session_id(messages),
            'parts': [{'kind': 'text', 'text': task}],
            'metadata': {
                'agent': resolved_agent_name,
                'execution_profile': 'chat',
                'instructions': agent_info.instructions or '',
            },
        }
        result = await (invoke or invoke_operation)(
            'agents.run', {'message': message}, idempotency_key=run_id
        )
        return _reply_text(result).strip()

    async def _reply(
        messages: list[ModelMessage], agent_info: AgentInfo
    ) -> ModelResponse:
        text = await _run_turn(messages, agent_info)
        return ModelResponse(parts=[TextPart(content=text)])

    async def _reply_stream(messages: list[ModelMessage], agent_info: AgentInfo):
        yield await _run_turn(messages, agent_info)

    return FunctionModel(
        _reply,
        stream_function=_reply_stream,
        model_name=f'orchestrator:{resolved_agent_name}',
    )
