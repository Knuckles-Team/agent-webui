import { afterEach, describe, expect, it, vi } from 'vitest'
import { graphosDecisionsTransport } from '../graphos-decisions-transport'
import { baseRecord } from './decisions-fixtures'

/**
 * The real `DecisionsTransport` (requirement WEBUI-API-R001) against a
 * stubbed `fetch`, exercising the shared `invoke` adapter end to end —
 * no module-level spy on `invoke` itself, the same convention
 * `identity.test.ts` uses for `identity.ts`. Operation ids are the real
 * `eg.coordination.DecisionLog`/`DecisionEval` actions (see
 * `graphos-decisions-transport.ts`'s file doc), not the earlier invented
 * `decide.*` ids.
 */

const meta = { registry_digest: 'registry-digest', api_version: 'v1' }
const session = { authenticated: true, csrf_token: 'session-csrf', tenant: 'tenant-a' }

/** Every call first resolves `/auth/session` (possibly twice: once for this
 * transport's own tenant lookup, once for `invoke()`'s CSRF fetch) before
 * the operation's own `POST /api/v1/ops/...` reply. */
function stubReplies(...opReplies: { status: number; body: unknown }[]) {
  const queue = [...opReplies]
  const fetcher = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/auth/session')) return Promise.resolve(Response.json(session))
    const next = queue.shift()
    if (!next) throw new Error('no more stubbed operation replies')
    return Promise.resolve(Response.json(next.body, { status: next.status }))
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => vi.unstubAllGlobals())

describe('graphosDecisionsTransport on the shared GraphOS invoke adapter', () => {
  // spec: WEBUI-API-R001
  it('has no bulk decision-record listing operation and refuses rather than fabricate one', async () => {
    stubReplies()
    await expect(graphosDecisionsTransport.listDecisions({ questionId: 'assemble' })).rejects.toThrow(
      /DECISION_LIST_UNAVAILABLE/,
    )
  })

  // spec: WEBUI-API-R001
  it('gets one committed decision record via DecisionLog.get, unwrapping the log entry', async () => {
    const fetcher = stubReplies({
      status: 200,
      body: {
        ok: true,
        result: {
          schema_version: 1,
          record: baseRecord,
          committed_by: 'principal:writer-1',
          committed_at_ms: 1,
          visibility: 'tenant',
        },
        meta,
      },
    })
    const record = await graphosDecisionsTransport.getDecision(baseRecord.record_id)
    expect(record.record_id).toBe(baseRecord.record_id)
    const opCall = fetcher.mock.calls.find(([input]) => input.toString().includes('/api/v1/ops/'))
    expect(opCall?.[0]).toBe('/api/v1/ops/eg.coordination.DecisionLog')
    expect(opCall?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining(`"op":"get","tenant_id":"tenant-a","record_id":"${baseRecord.record_id}"`),
      }),
    )
  })

  // spec: WEBUI-API-R001
  it('throws a typed not-found error when DecisionLog.get returns no entry', async () => {
    stubReplies({ status: 200, body: { ok: true, result: null, meta } })
    await expect(graphosDecisionsTransport.getDecision(baseRecord.record_id)).rejects.toThrow(
      /DECISION_RECORD_NOT_FOUND/,
    )
  })

  it('rejects a malformed record before any view can render it', async () => {
    stubReplies({
      status: 200,
      body: { ok: true, result: { schema_version: 1, record: { record_id: 'only-an-id' } }, meta },
    })
    await expect(graphosDecisionsTransport.getDecision(baseRecord.record_id)).rejects.toThrow()
  })

  it('has no dedicated provenance operation and refuses rather than fabricate one', async () => {
    stubReplies()
    await expect(graphosDecisionsTransport.getDecisionProvenance(baseRecord.record_id)).rejects.toThrow(
      /DECISION_PROVENANCE_UNAVAILABLE/,
    )
  })

  it('aggregates outcomes via DecisionLog.aggregate, nesting the request under the tenant window', async () => {
    const fetcher = stubReplies({
      status: 200,
      body: { ok: true, result: { schema_version: 1, min_support: 10, rows: [] }, meta },
    })
    expect((await graphosDecisionsTransport.getDecisionAggregate()).rows).toEqual([])
    const opCall = fetcher.mock.calls.find(([input]) => input.toString().includes('/api/v1/ops/'))
    expect(opCall?.[0]).toBe('/api/v1/ops/eg.coordination.DecisionLog')
    expect(opCall?.[1]).toEqual(expect.objectContaining({ body: expect.stringContaining('"op":"aggregate"') }))
  })

  it('fetches independently labeled receipts via DecisionEval.receipts', async () => {
    const fetcher = stubReplies({ status: 200, body: { ok: true, result: { receipts: [], next_after: null }, meta } })
    expect(await graphosDecisionsTransport.getDecisionEvalReceipts()).toEqual({ receipts: [], next_after: null })
    const opCall = fetcher.mock.calls.find(([input]) => input.toString().includes('/api/v1/ops/'))
    expect(opCall?.[0]).toBe('/api/v1/ops/eg.coordination.DecisionEval')
    expect(opCall?.[1]).toEqual(expect.objectContaining({ body: expect.stringContaining('"op":"receipts"') }))
  })

  it('fetches the submission-time timeline via DecisionEval.timeline', async () => {
    const fetcher = stubReplies({ status: 200, body: { ok: true, result: { entries: [], next_after: null }, meta } })
    expect(await graphosDecisionsTransport.getDecisionEvalTimeline()).toEqual({ entries: [], next_after: null })
    const opCall = fetcher.mock.calls.find(([input]) => input.toString().includes('/api/v1/ops/'))
    expect(opCall?.[0]).toBe('/api/v1/ops/eg.coordination.DecisionEval')
    expect(opCall?.[1]).toEqual(expect.objectContaining({ body: expect.stringContaining('"op":"timeline"') }))
  })

  it('refuses a why-not-on-demand request rather than fabricate an operation', async () => {
    stubReplies()
    const outcome = await graphosDecisionsTransport.getWhyNotOnDemand(baseRecord.record_id, {
      componentId: 'c1',
      slot: 's1',
      budgetMs: 100,
    })
    expect(outcome).toEqual({ kind: 'refused', reason: expect.stringContaining('does not yet expose') })
  })
})
