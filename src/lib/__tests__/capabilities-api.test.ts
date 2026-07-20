import { describe, expect, it, vi } from 'vitest'

import {
  type CapabilityApiError,
  RunEventStreamResetError,
  extractRunId,
  fetchRuns,
  followRunEvents,
  invokeCapability,
  parseRunEventSseRecord,
  replayRunEvents,
} from '../capabilities-api'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('canonical capability API client', () => {
  it('invokes only through the governed capability endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'success', result: { rows: [] } }))
    globalThis.fetch = fetchMock

    await invokeCapability('graph_query', {
      action: 'query',
      inputs: { action: 'query', query: 'MATCH (n) RETURN n' },
      target: 'workspace',
      session_id: 'conversation-1',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/capabilities/graph_query/invoke',
      expect.objectContaining({
        credentials: 'same-origin',
        method: 'POST',
        body: JSON.stringify({
          action: 'query',
          inputs: { action: 'query', query: 'MATCH (n) RETURN n' },
          target: 'workspace',
          session_id: 'conversation-1',
        }),
      }),
    )
  })

  it('accepts a 202 approval response and preserves server-bound resume identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          status: 'approval_required',
          approval_id: 'approval-7',
          run_id: 'run-7',
          session_id: 'conversation-1',
        },
        202,
      ),
    )
    globalThis.fetch = fetchMock

    const pending = await invokeCapability('graph_mine', {
      action: 'patterns',
      inputs: { topic: 'customer' },
      session_id: 'conversation-1',
    })

    expect(pending).toMatchObject({
      status: 'approval_required',
      approval_id: 'approval-7',
      run_id: 'run-7',
      session_id: 'conversation-1',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/capabilities/graph_mine/invoke', expect.any(Object))
  })

  it('lists recent runs with lifecycle filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ schema_version: '1.0', count: 0, runs: [] }))
    globalThis.fetch = fetchMock

    await fetchRuns({ status: 'waiting_for_input', sessionId: 'session A', limit: 12 })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/runs?limit=12&session_id=session+A&status=waiting_for_input',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
  })

  it('paginates replay by the canonical sequence cursor', async () => {
    const event = (sequence: number) => ({
      schema_version: '1.0',
      event_id: `run-pages:${sequence}`,
      sequence,
      timestamp: '2026-07-13T00:00:00Z',
      type: 'tool_call',
      run_id: 'run-pages',
      source: 'test',
      payload: {},
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const after = Number(new URL(String(input), 'http://localhost').searchParams.get('after'))
      if (after === 0) {
        return jsonResponse({
          schema_version: '1.0',
          run_id: 'run-pages',
          after,
          events: [event(1), event(2)],
          next_after: 2,
          has_more: true,
          retained_from: 1,
        })
      }
      if (after === 2) {
        return jsonResponse({
          schema_version: '1.0',
          run_id: 'run-pages',
          after,
          events: [event(3)],
          next_after: 3,
          has_more: false,
          retained_from: 1,
        })
      }
      return jsonResponse({
        schema_version: '1.0',
        run_id: 'run-pages',
        after,
        events: [],
        next_after: after,
      })
    })
    globalThis.fetch = fetchMock

    const replay = await replayRunEvents('run-pages', { pageSize: 2, maxEvents: 10 })

    expect(replay.events.map((item) => item.sequence)).toEqual([1, 2, 3])
    expect(replay.next_after).toBe(3)
    expect(replay.client_truncated).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('raises follow authorization and missing-run errors and stops after a terminal event', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ detail: 'authentication required' }, 401))
    await expect(followRunEvents('run-secure', { onEvent: vi.fn() })).rejects.toEqual(
      expect.objectContaining<Partial<CapabilityApiError>>({ status: 401, message: 'authentication required' }),
    )

    globalThis.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ detail: 'unknown run' }, 404))
    await expect(followRunEvents('run-missing', { onEvent: vi.fn() })).rejects.toEqual(
      expect.objectContaining<Partial<CapabilityApiError>>({ status: 404, message: 'unknown run' }),
    )

    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            [
              'event: run_completed',
              'data: {"schema_version":"1.0","event_id":"run-terminal:2","sequence":2,"timestamp":"2026-07-13T00:00:02Z","type":"run_completed","run_id":"run-terminal","source":"test","payload":{}}',
              '',
              'event: tool_result',
              'data: {"schema_version":"1.0","event_id":"run-terminal:3","sequence":3,"timestamp":"2026-07-13T00:00:03Z","type":"tool_result","run_id":"run-terminal","source":"test","payload":{}}',
              '',
            ].join('\n'),
          ),
        )
      },
      cancel,
    })
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const received: string[] = []

    await followRunEvents('run-terminal', {
      onEvent: (item) => {
        received.push(item.type)
      },
    })

    expect(received).toEqual(['run_completed'])
    expect(cancel).toHaveBeenCalledOnce()

    const resetCancel = vi.fn()
    const resetStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: stream_reset\ndata: {"schema_version":"1.0","type":"stream_reset","run_id":"run-reset","requested_after":2,"first_available":9,"last_available":12,"reason":"requested events are no longer retained"}\n\n',
          ),
        )
      },
      cancel: resetCancel,
    })
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(resetStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      )

    await expect(followRunEvents('run-reset', { after: 2, onEvent: vi.fn() })).rejects.toEqual(
      expect.objectContaining<Partial<RunEventStreamResetError>>({
        name: 'RunEventStreamResetError',
        reset: expect.objectContaining({ first_available: 9, last_available: 12 }),
      }),
    )
    expect(resetCancel).toHaveBeenCalledOnce()
  })

  it('parses arbitrary named SSE records by their canonical data envelope', () => {
    const event = parseRunEventSseRecord(
      [
        'id: run-1:3',
        'event: approval_required',
        'data: {"schema_version":"1.0","event_id":"run-1:3","sequence":3,"timestamp":"2026-07-13T00:00:00Z",',
        'data: "type":"approval_required","run_id":"run-1","source":"policy","payload":{"tier":"human"}}',
      ].join('\n'),
    )

    expect(event).toMatchObject({
      event_id: 'run-1:3',
      sequence: 3,
      type: 'approval_required',
      payload: { tier: 'human' },
    })
    expect(parseRunEventSseRecord(': heartbeat')).toBeNull()
    expect(parseRunEventSseRecord('data: not-json')).toBeNull()
  })

  it('finds run identifiers in canonical response envelopes', () => {
    expect(extractRunId({ status: 'success', result: { metadata: { run_id: 'run-42' } } })).toBe('run-42')
    expect(extractRunId({ session_id: 'session-only' })).toBeNull()
  })
})
