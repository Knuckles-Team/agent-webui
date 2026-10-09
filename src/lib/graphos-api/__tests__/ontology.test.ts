import { afterEach, describe, expect, it, vi } from 'vitest'
import { invokeOntology } from '@/lib/graphos-api/ontology'

const meta = { registry_digest: 'registry-digest', api_version: 'v1' }
const session = { authenticated: true, csrf_token: 'session-csrf' }

function stubReplies(...replies: { status: number; body: unknown }[]) {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(session))
  for (const reply of replies) fetcher.mockResolvedValueOnce(Response.json(reply.body, { status: reply.status }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => vi.unstubAllGlobals())

describe('ontology operation adapter on shared GraphOS invoke', () => {
  // spec: WEBUI-API-R002, WEBUI-API-R003.1
  it('validates a well-shaped class page', async () => {
    stubReplies({
      status: 200,
      body: { ok: true, result: { items: [{ class_id: 'cls:1', label: 'Agent' }], next_cursor: null }, meta },
    })
    const reply = await invokeOntology('ontology.classes.list')
    expect(reply.kind).toBe('ready')
  })

  // spec: WEBUI-API-R002, WEBUI-API-R003.1
  it('rejects a malformed class result before any view can render it', async () => {
    stubReplies({ status: 200, body: { ok: true, result: { items: 'bad' }, meta } })
    const reply = await invokeOntology('ontology.classes.get')
    expect(reply.kind).toBe('error')
  })

  // spec: WEBUI-API-R003.1
  it('maps an unmounted registry route to unavailable, not a thrown error', async () => {
    stubReplies({ status: 503, body: {} })
    const reply = await invokeOntology('ontology.classes.list')
    expect(reply.kind).toBe('unavailable')
  })

  it('maps a forbidden scope to a forbidden reply without leaking detail', async () => {
    stubReplies({
      status: 403,
      body: {
        ok: false,
        error: { code: 'SCOPE_REQUIRED', source: 'graphos', message: 'nope', retryable: false },
        meta,
      },
    })
    const reply = await invokeOntology('ontology.properties.list')
    expect(reply).toEqual({ kind: 'forbidden', message: 'This operation requires an authorized ontology scope.' })
  })
})
