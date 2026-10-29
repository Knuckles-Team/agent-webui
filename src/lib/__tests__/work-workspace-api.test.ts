// spec: WEBUI-APPS-R049.1.3
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api-validation'
import { workApi, retryWorkTaskRead } from '../work-workspace'
afterEach(() => vi.unstubAllGlobals())
describe('Work existing contract adapters', () => {
  const meta = { registry_digest: 'installed-contract', api_version: 'v1' }
  const envelope = (value: unknown) => Response.json({ ok: true, result: { value }, meta })
  const session = () => Response.json({ authenticated: true, csrf_token: 'disposable-csrf' })
  it('reads canonical envelopes and preserves distinct task/context/run identities', async () => {
    const task = {
      id: 'work-item:' + 'a'.repeat(64),
      contextId: 'a2a-context-' + 'b'.repeat(64),
      status: { state: 'working' },
      metadata: { arbora: { runId: 'distinct-run' } },
    }
    const signal = new AbortController().signal
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(envelope({ tasks: [task], nextCursor: 'opaque-next' }))
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(envelope(task))
    vi.stubGlobal('fetch', fetch)
    expect(await workApi.listTaskPage(signal, 'opaque-before')).toEqual({ tasks: [task], nextCursor: 'opaque-next' })
    expect(await workApi.getTask(task.id, signal)).toEqual(task)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/auth/session',
      '/api/v1/ops/agents.tasks.list',
      '/auth/session',
      '/api/v1/ops/agents.tasks.get',
    ])
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ limit: 50, cursor: 'opaque-before' })
    expect(JSON.parse(String(fetch.mock.calls[3][1]?.body))).toEqual({ task_id: task.id })
    for (const index of [1, 3])
      expect(fetch.mock.calls[index][1]).toMatchObject({
        method: 'POST',
        credentials: 'same-origin',
        signal,
        headers: { 'X-CSRF-Token': 'disposable-csrf' },
      })
  })
  it('keeps the existing list bounded to the first page', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(envelope({ tasks: [{ id: 'task-a' }], nextCursor: 'more' }))
    vi.stubGlobal('fetch', fetch)
    expect(await workApi.listTasks()).toEqual([{ id: 'task-a' }])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ limit: 50 })
  })
  it.each([
    { sessions: [] },
    { tasks: [] },
    { tasks: [], nextCursor: 12 },
    { tasks: [{ status: {} }], nextCursor: null },
  ])('rejects malformed pages without legacy fallback: %j', async (value) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(envelope(value))
    vi.stubGlobal('fetch', fetch)
    await expect(workApi.listTasks()).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('rejects mismatched task identity and never falls back', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(envelope({ id: 'other-task' }))
    vi.stubGlobal('fetch', fetch)
    await expect(workApi.getTask('task-a')).rejects.toThrow('identity')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it.each([401, 403, 404, 501])('preserves canonical refusal %i without retry or fallback', async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(
        Response.json(
          { ok: false, error: { code: 'ACCESS_DENIED', source: 'arbora', message: 'denied', retryable: false }, meta },
          { status },
        ),
      )
    vi.stubGlobal('fetch', fetch)
    const error = await workApi.getTask('task-a').catch((error: unknown) => error)
    expect(error).toMatchObject({ status, code: 'ACCESS_DENIED' })
    expect(retryWorkTaskRead(0, error)).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('does not issue a task operation without admitted browser session', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ authenticated: false }))
    vi.stubGlobal('fetch', fetch)
    await expect(workApi.listTasks()).rejects.toThrow()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/auth/session'])
  })
  it('rejects invalid task IDs and cursors before any request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    await expect(workApi.getTask('x'.repeat(81))).rejects.toThrow()
    await expect(workApi.listTaskPage(undefined, '')).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('decodes the existing graph trace envelope and does not create missing latency', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'success',
          result: {
            surface: 'traces',
            action: 'waterfall',
            result: { trace: { id: 'trace-a' }, nodes: [{ id: 'node-a', parentId: null, kind: 'span' }] },
          },
        }),
      ),
    )
    const result = await workApi.getRun('trace-a')
    expect(result.ok).toBe(true)
    expect(result.data?.result.nodes[0].latencyMs).toBeUndefined()
  })
  it('distinguishes unavailable trace capability from malformed successful data', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 501 }))
      .mockResolvedValueOnce(Response.json({ result: null }))
    vi.stubGlobal('fetch', fetch)
    expect(await workApi.listRuns()).toMatchObject({ ok: false, unavailable: true })
    expect(await workApi.listRuns()).toMatchObject({ ok: false, unavailable: false })
  })
})

// spec: WEBUI-APPS-R049.1.3
it('cancels through the existing facade with an encoded ID and validates the response', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ status: 'cancelled', task: { id: 'task/a' } }))
    .mockResolvedValueOnce(Response.json({ status: 'success' }))
  vi.stubGlobal('fetch', fetch)
  expect(await workApi.cancelTask('task/a')).toMatchObject({ status: 'cancelled' })
  expect(fetch.mock.calls[0][0]).toBe('/api/enhanced/sessions/task%2Fa/cancel')
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST' })
  await expect(workApi.cancelTask('task/a')).rejects.toThrow()
})
it('rejects malformed cancellation IDs before any request and preserves provider denial', async () => {
  const fetch = vi.fn(async () => new Response('Denied', { status: 403 }))
  vi.stubGlobal('fetch', fetch)
  expect(() => workApi.cancelTask('')).toThrow()
  expect(fetch).not.toHaveBeenCalled()
  await expect(workApi.cancelTask('task-a')).rejects.toThrow('403')
})

// spec: WEBUI-APPS-R049.1.3
it('does not retry explicit task refusal but bounds transient retries', function checkTaskRefusalRetries() {
  for (const status of [401, 403, 404, 501]) expect(retryWorkTaskRead(0, new ApiError(status, 'refused'))).toBe(false)
  expect(retryWorkTaskRead(0, new ApiError(503, 'temporarily unavailable'))).toBe(true)
  expect(retryWorkTaskRead(0, new Error('network'))).toBe(true)
  expect(retryWorkTaskRead(3, new Error('network'))).toBe(false)
})
