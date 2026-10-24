"""WEBUI-API-R011.2: conversation labels and admitted run identity stay distinct."""

# spec: WEBUI-API-R011.2.1

import asyncio
from typing import Any

import pytest
from agent_webui.orchestrator_model import (
    _conversation_session_id,
    _run_identity,
    build_orchestrator_model,
)
from pydantic_ai import Agent
from pydantic_ai.messages import ModelRequest, UserPromptPart


def request(text='hello', conversation_id=None):
    return ModelRequest(
        parts=[UserPromptPart(content=text)], conversation_id=conversation_id
    )


def task_result(task_id, context='owned-context'):
    return {
        'value': {
            'id': task_id,
            'contextId': context,
            'metadata': {
                'arbora': {
                    'runId': 'run-' + task_id,
                    'runTraceRef': 'opaque-ref-' + task_id,
                }
            },
            'artifacts': [{'parts': [{'kind': 'text', 'text': 'reply-' + task_id}]}],
        }
    }


def test_explicit_identity_is_stable_not_content_derived():
    assert _conversation_session_id([request('one', 'c1')]) == 'webui:c1'
    assert _conversation_session_id([request('two', 'c1')]) == 'webui:c1'
    assert _conversation_session_id([request('one', 'c2')]) == 'webui:c2'
    assert _conversation_session_id([request()]) != _conversation_session_id(
        [request()]
    )


def test_conflicting_identity_refused():
    with pytest.raises(ValueError, match='Conflicting'):
        _conversation_session_id(
            [request(conversation_id='a'), request(conversation_id='b')]
        )


def test_explicit_references_only_no_guessed_trace():
    metadata = _run_identity(task_result('t1'), 'webui:c1')
    assert metadata is not None
    identity = metadata['arbora_run']
    assert identity == {
        'conversation_context': 'webui:c1',
        'task_id': 't1',
        'context_id': 'owned-context',
        'run_id': 'run-t1',
        'run_trace_ref': 'opaque-ref-t1',
    }
    assert _run_identity({'value': {'status': {}}}, 'webui:c1') is None
    assert _run_identity({'result': task_result('nested')}, 'webui:c1') is None
    assert _run_identity({'value': {'id': 't', 'contextId': 'c'}}, 'webui:c1') == {
        'arbora_run': {
            'conversation_context': 'webui:c1',
            'task_id': 't',
            'context_id': 'c',
        },
        'arbora': {'usage': None},
    }


@pytest.mark.parametrize(
    'field,value', [('id', 1), ('contextId', ''), ('contextId', ['c'])]
)
def test_invalid_returned_identity_refused(field, value):
    result = task_result('t1')
    result['value'][field] = value
    assert _run_identity(result, 'webui:c1') is None


async def test_stream_metadata_is_request_local_and_preserves_exact_refs():
    calls = []

    async def invoke(op, params, *, idempotency_key):
        context = params['message']['contextId']
        calls.append((context, idempotency_key))
        await asyncio.sleep(0)
        return task_result(context)

    agent = Agent(build_orchestrator_model(invoke=invoke))

    async def run(conversation):
        async with agent.run_stream('hello', conversation_id=conversation) as result:
            await result.get_output()
            return result.response

    one, two = await asyncio.gather(run('one'), run('two'))
    assert one.metadata['arbora_run']['task_id'] == 'webui:one'
    assert two.metadata['arbora_run']['task_id'] == 'webui:two'
    assert one.metadata['arbora_run']['run_trace_ref'] == 'opaque-ref-webui:one'
    from pydantic_ai.ui.vercel_ai import VercelAIAdapter

    wire = VercelAIAdapter.dump_messages([one])[0]
    assert wire.metadata['arbora_run'] == one.metadata['arbora_run']
    # Repeated turns share conversation identity, not a fabricated task/run ID.
    again = await run('one')
    assert again.metadata['arbora_run']['conversation_context'] == 'webui:one'
    assert calls[0][1] != calls[-1][1]
    assert calls[-1][0] == 'webui:one'


async def test_failed_stream_does_not_reuse_previous_identity():
    calls = 0

    async def invoke(op, params, *, idempotency_key):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError('unavailable')
        return task_result('first' if calls == 1 else 'third')

    agent = Agent(build_orchestrator_model(invoke=invoke))
    first = await agent.run('first', conversation_id='one')
    assert first.response.metadata['arbora_run']['task_id'] == 'first'
    with pytest.raises(RuntimeError, match='unavailable'):
        async with agent.run_stream('second', conversation_id='two') as result:
            await result.get_output()
    async with agent.run_stream('retry', conversation_id='two') as result:
        await result.get_output()
        assert result.response.metadata['arbora_run']['task_id'] == 'third'
        assert (
            result.response.metadata['arbora_run']['conversation_context']
            == 'webui:two'
        )


@pytest.mark.parametrize('malformed', [False, True])
async def test_real_vercel_stream_propagates_served_identity_without_repeating_effects(
    malformed,
):
    import json

    from pydantic_ai.ui.vercel_ai import VercelAIAdapter
    from starlette.requests import Request

    calls = []

    async def invoke(op, params, *, idempotency_key):
        calls.append(params)
        result = task_result('wire-task')
        result['value']['metadata']['arbora']['usage'] = {
            'runId': 'run-wire-task',
            'taskId': 'wire-task',
            'contextId': 'owned-context',
            'scope': 'turn',
            'counts': {'requests': 0, 'input_tokens': 17},
        }
        if malformed:
            result['value']['id'] = 42
        return {'ok': True, 'result': result, 'meta': {'registry_digest': 'test'}}

    payload = json.dumps(
        {
            'id': '/selected',
            'trigger': 'submit-message',
            'messages': [
                {
                    'id': 'u1',
                    'role': 'user',
                    'parts': [{'type': 'text', 'text': 'hello'}],
                }
            ],
        }
    ).encode()

    async def receive():
        return {'type': 'http.request', 'body': payload, 'more_body': False}

    request = Request(
        {
            'type': 'http',
            'method': 'POST',
            'path': '/api/chats/messages',
            'headers': [(b'content-type', b'application/json')],
        },
        receive,
    )
    response = await VercelAIAdapter.dispatch_request(
        request, agent=Agent(build_orchestrator_model(invoke=invoke)), sdk_version=7
    )
    assert hasattr(response, 'body_iterator'), response.body
    chunks = [chunk async for chunk in response.body_iterator]
    body = ''.join(
        chunk.decode() if isinstance(chunk, bytes) else chunk for chunk in chunks
    )
    assert len(calls) == 1
    assert calls[0]['message']['contextId'] == 'webui:/selected'
    assert 'reply-wire-task' in body
    events = [
        json.loads(line[6:])
        for line in body.splitlines()
        if line.startswith('data: ') and line != 'data: [DONE]'
    ]
    metadata = [
        event['messageMetadata']
        for event in events
        if event['type'] == 'message-metadata'
    ]
    assert len(metadata) == 1
    if malformed:
        assert 'arbora_run' not in metadata[0]
        assert metadata[0]['arbora'] == {'usage': None}
    else:
        assert metadata[0]['arbora_run']['task_id'] == 'wire-task'
        assert metadata[0]['arbora_run']['run_trace_ref'] == 'opaque-ref-wire-task'
        assert metadata[0]['arbora']['usage'] == {
            'runId': 'run-wire-task',
            'taskId': 'wire-task',
            'contextId': 'owned-context',
            'scope': 'turn',
            'counts': {'requests': 0, 'input_tokens': 17},
        }


def test_error_envelope_cannot_supply_identity():
    assert (
        _run_identity({'ok': False, 'result': task_result('fake')}, 'webui:c') is None
    )


def turn_receipt():
    return {
        'runId': 'run-t1',
        'taskId': 't1',
        'contextId': 'owned-context',
        'scope': 'turn',
        'counts': {'requests': 0, 'input_tokens': 9_007_199_254_740_991},
    }


def result_with_usage(usage):
    result = task_result('t1')
    result['value']['metadata']['arbora']['usage'] = usage
    return result


def usage_metadata(usage: Any) -> dict[str, Any]:
    metadata = _run_identity(result_with_usage(usage), 'webui:c1')
    assert metadata is not None
    return metadata


def test_turn_usage_preserves_exact_bound_receipt_and_missing_counts():
    receipt = turn_receipt()
    metadata = usage_metadata(receipt)
    assert metadata['arbora']['usage'] == receipt
    assert 'total_tokens' not in metadata['arbora']['usage']['counts']
    receipt['counts'] = {}
    assert usage_metadata(receipt)['arbora'] == {'usage': receipt}


@pytest.mark.parametrize(
    'invalid', [-1, 0.5, 1.0, 9_007_199_254_740_992, True, None, '1', [], {}]
)
def test_invalid_turn_count_refuses_all_usage_without_losing_task(invalid):
    receipt = turn_receipt()
    receipt['counts']['tool_calls'] = invalid
    metadata = usage_metadata(receipt)
    assert metadata['arbora_run']['task_id'] == 't1'
    assert metadata['arbora']['usage'] is None


@pytest.mark.parametrize('field', ['runId', 'taskId', 'contextId', 'scope'])
def test_mismatched_turn_receipt_refuses_usage(field):
    receipt = turn_receipt()
    receipt[field] = 'foreign'
    assert usage_metadata(receipt)['arbora']['usage'] is None


@pytest.mark.parametrize(
    'usage', [None, [], {'status': 'unavailable'}, {'status': 'denied'}]
)
def test_unavailable_or_denied_receipt_never_retains_counts(usage):
    assert usage_metadata(usage)['arbora']['usage'] is None


def test_unknown_counter_and_missing_outer_run_refuse_usage():
    receipt = turn_receipt()
    receipt['counts']['cost'] = 0
    assert usage_metadata(receipt)['arbora']['usage'] is None
    result = result_with_usage(turn_receipt())
    del result['value']['metadata']['arbora']['runId']
    metadata = _run_identity(result, 'webui:c1')
    assert metadata is not None
    assert metadata['arbora']['usage'] is None
    assert _run_identity({'ok': False, 'result': result}, 'webui:c1') is None


async def test_request_local_turn_receipts_and_unavailable_replay():
    async def invoke(op, params, *, idempotency_key):
        receipt = turn_receipt()
        context = params['message']['contextId']
        if context.endswith('unavailable'):
            receipt = {'status': 'unavailable'}
        await asyncio.sleep(0)
        return result_with_usage(receipt)

    agent = Agent(build_orchestrator_model(invoke=invoke))

    async def run(conversation):
        async with agent.run_stream('hello', conversation_id=conversation) as result:
            await result.get_output()
            return result.response.metadata

    measured, unavailable = await asyncio.gather(run('one'), run('unavailable'))
    assert measured['arbora']['usage'] == turn_receipt()
    assert unavailable['arbora'] == {'usage': None}
    assert measured['arbora_run']['conversation_context'] == 'webui:one'
    assert unavailable['arbora_run']['conversation_context'] == 'webui:unavailable'
    again = await agent.run('again', conversation_id='unavailable')
    assert again.response.metadata['arbora'] == {'usage': None}
