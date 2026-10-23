"""agent-webui's chat model: one served Arbora agent run per turn.

``agent.to_web()`` owns the Vercel AI transport. pydantic-ai's ``FunctionModel``
plugs a plain function in as the model. That function sends the newest user
message to the Arbora ``agents.run`` served operation, as the verified
caller, and returns the reply text. The WebUI holds no agent runtime of its
own.

The conversation ID (the Vercel request ``id``) becomes the A2A ``contextId``, so
successive turns of one browser conversation share one context.
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError
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
    """Extract the newest user message text from the Vercel conversation history.

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
    """Use explicit conversation identity, never prompt text as an identity key.

    Missing legacy identity gets a new isolated context, not false continuity.
    Arbora scopes this caller-supplied label to the verified tenant and owner.
    """
    ids = {
        message.conversation_id
        for message in messages
        if isinstance(message, ModelRequest) and message.conversation_id
    }
    if len(ids) > 1:
        raise ValueError('Conflicting conversation identities')
    return f'webui:{next(iter(ids))}' if ids else f'webui:isolated:{uuid.uuid4().hex}'


class RunIdentity(BaseModel):
    """References returned by Arbora, not client-inferred execution relationships."""

    model_config = ConfigDict(extra='forbid', strict=True)
    conversation_context: str = Field(min_length=1, max_length=2048)
    task_id: str = Field(min_length=1, max_length=80)
    context_id: str = Field(min_length=1, max_length=1024)
    run_id: str | None = Field(default=None, min_length=1, max_length=128)
    run_trace_ref: str | None = Field(default=None, min_length=1, max_length=2048)


def _run_identity(result: Any, conversation_context: str) -> dict[str, Any] | None:
    """Copy only the admitted task's explicit identity, without recursive guessing."""
    if not isinstance(result, dict):
        return None
    if 'ok' in result:
        if result['ok'] is not True or not isinstance(result.get('result'), dict):
            return None
        result = result['result']
    task = result.get('value')
    if not isinstance(task, dict) or 'id' not in task or 'contextId' not in task:
        return None
    metadata = task.get('metadata') or {}
    arbora = metadata.get('arbora') if isinstance(metadata, dict) else None
    arbora = arbora if isinstance(arbora, dict) else {}
    try:
        identity = RunIdentity(
            conversation_context=conversation_context,
            task_id=task['id'],
            context_id=task['contextId'],
            run_id=arbora.get('runId'),
            run_trace_ref=arbora.get('runTraceRef'),
        )
    except ValidationError:
        # The action already executed. Do not turn a malformed display reference
        # into an execution failure that encourages the caller to repeat effects.
        logger.warning('Arbora run identity metadata is invalid')
        return None
    return {'arbora_run': identity.model_dump(exclude_none=True)}


_stream_metadata: ContextVar[dict[str, Any] | None] = ContextVar(
    'webui_run_metadata', default=None
)


class _OrchestratorFunctionModel(FunctionModel):
    """Carry gateway identity through the standard Vercel message metadata path."""

    @asynccontextmanager
    async def request_stream(self, *args: Any, **kwargs: Any):
        token = _stream_metadata.set(None)
        try:
            async with super().request_stream(*args, **kwargs) as response:
                # FunctionModel peeks the first text before yielding this response.
                # The turn has completed and its request-local metadata is now set.
                response.metadata = _stream_metadata.get()
                yield response
        finally:
            _stream_metadata.reset(token)


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
    """Build the ``FunctionModel`` that runs each chat turn through Arbora.

    Args:
        engine_provider: Unused. Kept so a host that passes one still works.
        agent_name: The named agent the turn asks Arbora to run. Defaults to
            ``DEFAULT_WEBUI_AGENT_NAME``.
        invoke: The served-operation invoker. Defaults to
            :func:`agent_webui.host.invoke_operation`.
    """
    del engine_provider
    resolved_agent_name = (agent_name or '').strip() or DEFAULT_WEBUI_AGENT_NAME

    async def _run_turn(
        messages: list[ModelMessage], agent_info: AgentInfo
    ) -> tuple[str, dict[str, Any] | None]:
        from .host import invoke_operation

        task = _latest_user_text(messages)
        if not task:
            return '', None
        run_id = uuid.uuid4().hex
        conversation_context = _conversation_session_id(messages)
        message: dict[str, Any] = {
            'role': 'user',
            'kind': 'message',
            'messageId': run_id,
            'contextId': conversation_context,
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
        return _reply_text(result).strip(), _run_identity(result, conversation_context)

    async def _reply(
        messages: list[ModelMessage], agent_info: AgentInfo
    ) -> ModelResponse:
        text, metadata = await _run_turn(messages, agent_info)
        return ModelResponse(parts=[TextPart(content=text)], metadata=metadata)

    async def _reply_stream(messages: list[ModelMessage], agent_info: AgentInfo):
        text, metadata = await _run_turn(messages, agent_info)
        _stream_metadata.set(metadata)
        yield text

    return _OrchestratorFunctionModel(
        _reply,
        stream_function=_reply_stream,
        model_name=f'orchestrator:{resolved_agent_name}',
    )
