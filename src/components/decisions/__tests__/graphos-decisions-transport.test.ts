import { afterEach, describe, expect, it, vi } from 'vitest'
import { graphosDecisionsTransport } from '../graphos-decisions-transport'
import { baseRecord } from './decisions-fixtures'

/**
 * The real `DecisionsTransport` (requirement WEBUI-API-R001) against a
 * stubbed `fetch`, exercising the shared `invoke` adapter end to end —
 * no module-level spy on `invoke` itself, the same convention
 * `identity.test.ts` uses for `identity.ts`.
 */

const meta = { registry_digest: 'registry-digest', api_version: 'v1' }
const session = { authenticated: true, csrf_token: 'session-csrf' }

function stubReplies(...replies: { status: number; body: unknown }[]) {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(session))
  for (const reply of replies) fetcher.mockResolvedValueOnce(Response.json(reply.body, { status: reply.status }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => vi.unstubAllGlobals())

describe('graphosDecisionsTransport on the shared GraphOS invoke adapter', () => {
  it('lists decisions, unwrapping the items page and forwarding the question filter', async () => {
    const fetcher = stubReplies({ status: 200, body: { ok: true, result: { items: [] }, meta } })
    const rows = await graphosDecisionsTransport.listDecisions({ questionId: 'assemble' })
    expect(rows).toEqual([])
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/v1/ops/decide.records.list',
      expect.objectContaining({ body: expect.stringContaining('"question_id":"assemble"') }),
    )
  })

  it('fetches one committed decision record in full', async () => {
    stubReplies({ status: 200, body: { ok: true, result: baseRecord, meta } })
    const record = await graphosDecisionsTransport.getDecision(baseRecord.record_id)
    expect(record.record_id).toBe(baseRecord.record_id)
  })

  it('rejects a malformed record before any view can render it', async () => {
    stubReplies({ status: 200, body: { ok: true, result: { record_id: 'only-an-id' }, meta } })
    await expect(graphosDecisionsTransport.getDecision(baseRecord.record_id)).rejects.toThrow()
  })

  it('fetches the provenance log and the outcome aggregate', async () => {
    stubReplies({ status: 200, body: { ok: true, result: { evaluations: [], resolutions: [] }, meta } })
    expect(await graphosDecisionsTransport.getDecisionProvenance(baseRecord.record_id)).toEqual({
      evaluations: [],
      resolutions: [],
    })
    stubReplies({ status: 200, body: { ok: true, result: { schema_version: 1, min_support: 10, rows: [] }, meta } })
    expect((await graphosDecisionsTransport.getDecisionAggregate()).rows).toEqual([])
  })

  it('fetches independently labeled receipts and their submission-time timeline', async () => {
    stubReplies({ status: 200, body: { ok: true, result: { receipts: [], next_after: null }, meta } })
    expect(await graphosDecisionsTransport.getDecisionEvalReceipts()).toEqual({ receipts: [], next_after: null })
    stubReplies({ status: 200, body: { ok: true, result: { entries: [], next_after: null }, meta } })
    expect(await graphosDecisionsTransport.getDecisionEvalTimeline()).toEqual({ entries: [], next_after: null })
  })
})
