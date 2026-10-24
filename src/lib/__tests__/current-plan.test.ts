// spec: WEBUI-APPS-R004.4
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentPlanRunId, readCurrentPlan } from '@/lib/current-plan'

const now = Date.parse('2026-01-01T12:00:00Z')
const snapshot = {
  run_id: 'opaque-run',
  revision: 0,
  observed_at: '2026-01-01T11:59:00Z',
  expires_at: '2026-01-01T12:01:00Z',
  items: [{ text: 'Check evidence', status: 'in_progress' }],
}
function response(value: unknown, outer: Record<string, unknown> = {}, status = 200) {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const fetcher = vi.fn().mockImplementation(async (path: string) => ({
    ok: path === '/auth/session' || status === 200,
    status: path === '/auth/session' ? 200 : status,
    json: async () =>
      path === '/auth/session'
        ? { authenticated: true, csrf_token: 'fixture-csrf' }
        : { ok: true, result: { value }, meta: { registry_digest: 'digest', api_version: 'v1' }, ...outer },
  }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
describe('canonical current-plan read', () => {
  it('preserves producer code-point bounds for the shared task run selector', () => {
    const runId = '🌳'.repeat(512)
    expect(currentPlanRunId({ metadata: { arbora: { runId } } })).toBe(runId)
    expect(currentPlanRunId({ metadata: { arbora: { runId: `${runId}x` } } })).toBeNull()
    expect(currentPlanRunId({ metadata: { arbora: { runId: '  ' } } })).toBeNull()
  })
  it('uses the cookie/CSRF operation, exact run selector and abort signal', async () => {
    const fetcher = response({ availability: 'available', snapshot })
    const signal = new AbortController().signal
    await expect(readCurrentPlan('opaque-run', signal)).resolves.toEqual({ availability: 'available', snapshot })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/auth/session',
      expect.objectContaining({ signal, credentials: 'same-origin' }),
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/v1/ops/runs.current_plan',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        signal,
        body: JSON.stringify({ run_id: 'opaque-run' }),
        headers: expect.objectContaining({ 'X-CSRF-Token': 'fixture-csrf' }),
      }),
    )
  })
  it.each([
    { availability: 'unavailable', snapshot: null },
    { availability: 'available', snapshot: { ...snapshot, items: [] } },
  ])('preserves empty and unavailable as distinct typed results: $availability', async (value) => {
    response(value)
    await expect(readCurrentPlan('opaque-run', new AbortController().signal)).resolves.toEqual(value)
  })
  it('accepts the SDK UTC offset serialization without changing producer order', async () => {
    const value = {
      availability: 'available',
      snapshot: {
        ...snapshot,
        observed_at: '2026-01-01T11:59:00+00:00',
        items: [
          { text: 'Second named first', status: 'pending' },
          { text: 'First named second', status: 'done' },
        ],
      },
    }
    response(value)
    await expect(readCurrentPlan('opaque-run', new AbortController().signal)).resolves.toEqual(value)
  })
  it.each([
    ['wrong run', { ...snapshot, run_id: 'other-run' }],
    ['unknown status', { ...snapshot, items: [{ text: 'Never render', status: 'running' }] }],
    ['negative revision', { ...snapshot, revision: -1 }],
    ['fractional revision', { ...snapshot, revision: 1.5 }],
    ['unsafe revision', { ...snapshot, revision: Number.MAX_SAFE_INTEGER + 1 }],
    ['string revision', { ...snapshot, revision: '1' }],
    ['empty text', { ...snapshot, items: [{ text: '', status: 'done' }] }],
    ['future observation', { ...snapshot, observed_at: '2026-01-01T12:00:01Z' }],
    ['expired', { ...snapshot, expires_at: '2026-01-01T12:00:00Z' }],
    ['inverted interval', { ...snapshot, expires_at: snapshot.observed_at }],
    ['non UTC', { ...snapshot, observed_at: '2026-01-01T12:59:00+01:00' }],
    ['naive timestamp', { ...snapshot, observed_at: '2026-01-01T11:59:00' }],
    ['malformed timestamp', { ...snapshot, observed_at: 'yesterday' }],
    ['unexpected executable plan', { ...snapshot, task_plan: { execute: true } }],
  ])('rejects %s before rendering', async (_, invalid) => {
    response({ availability: 'available', snapshot: invalid })
    await expect(readCurrentPlan('opaque-run', new AbortController().signal)).rejects.toThrow()
  })
  it.each([
    {},
    { availability: 'available', snapshot: null },
    { availability: 'unavailable', snapshot },
    { availability: 'unavailable' },
    { availability: 'unknown', snapshot: null },
  ])('rejects malformed availability %#', async (invalid) => {
    response(invalid)
    await expect(readCurrentPlan('opaque-run', new AbortController().signal)).rejects.toThrow()
  })
  it('preserves a server CSRF refusal rather than retrying with stronger authority', async () => {
    const fetcher = response(
      null,
      {
        ok: false,
        error: {
          code: 'CSRF_REFUSED',
          source: 'arbora',
          message: 'Refused',
          retryable: false,
        },
      },
      403,
    )
    await expect(readCurrentPlan('opaque-run', new AbortController().signal)).rejects.toMatchObject({
      code: 'CSRF_REFUSED',
      status: 403,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    const request = fetcher.mock.calls[1][1] as RequestInit
    expect(request.headers).not.toHaveProperty('Authorization')
    expect(request.headers).not.toHaveProperty('Arbora-Plan-Ref')
  })
  it('rejects malformed envelopes and absent session authority before an operation', async () => {
    response({ availability: 'unavailable', snapshot: null }, { meta: {} })
    await expect(readCurrentPlan('opaque-run', new AbortController().signal)).rejects.toThrow()
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ authenticated: false }) }))
    vi.stubGlobal('fetch', fetcher)
    await expect(readCurrentPlan('opaque-run', new AbortController().signal)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
describe('explicit task run reference', () => {
  it('uses only metadata.arbora.runId without parsing or inventing an association', () => {
    expect(currentPlanRunId({ metadata: { arbora: { runId: 'opaque/run?x', runTraceRef: 'trace-other' } } })).toBe(
      'opaque/run?x',
    )
  })
  it.each([
    {},
    { run: 'url-trace' },
    { runId: 'task-id' },
    { metadata: { arbora: { runTraceRef: 'trace' } } },
    { metadata: { arbora: { runId: '' } } },
    { metadata: { arbora: { runId: 123 } } },
    { metadata: { arbora: { runId: 'x'.repeat(513) } } },
  ])('does not create a selector from missing or invalid metadata %#', (task) => {
    expect(currentPlanRunId(task)).toBeNull()
  })
})
