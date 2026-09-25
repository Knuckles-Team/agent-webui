import { afterEach, describe, expect, it, vi } from 'vitest'
import { invokeIdentity } from '@/lib/graphos-api/identity'

const meta = { registry_digest: 'registry-digest', api_version: 'v1' }
const session = { authenticated: true, csrf_token: 'session-csrf' }

function stubReplies(...replies: { status: number; body: unknown }[]) {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(session))
  for (const reply of replies) fetcher.mockResolvedValueOnce(Response.json(reply.body, { status: reply.status }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => vi.unstubAllGlobals())

describe('identity operation adapter on shared GraphOS invoke', () => {
  it('reads the browser session and sends its CSRF token through the shared transport', async () => {
    const fetcher = stubReplies({ status: 200, body: { ok: true, result: { items: [], next_cursor: null }, meta } })
    expect((await invokeIdentity('identity.users.list')).kind).toBe('ready')
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/auth/session',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/v1/ops/identity.users.list',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'session-csrf' }),
      }),
    )
  })

  it('rejects malformed list results before any view can map them', async () => {
    stubReplies({ status: 200, body: { ok: true, result: { items: 'bad' }, meta } })
    expect((await invokeIdentity('identity.users.list')).kind).toBe('error')
  })

  it('preserves missing operation and scope refusals', async () => {
    stubReplies({
      status: 404,
      body: {
        ok: false,
        error: { code: 'UNKNOWN_OP', source: 'graphos', message: 'unknown', retryable: false },
        meta,
      },
    })
    expect((await invokeIdentity('identity.users.list')).kind).toBe('unavailable')
    stubReplies({
      status: 403,
      body: {
        ok: false,
        error: { code: 'SCOPE_REQUIRED', source: 'graphos', message: 'refused', retryable: false },
        meta,
      },
    })
    expect((await invokeIdentity('identity.users.disable')).kind).toBe('forbidden')
  })

  it('returns only a validated console plan link for step-up', async () => {
    const planRef = `graphos_plan:${'a'.repeat(48)}`
    const url = `/console/confirm/${planRef}`
    stubReplies({
      status: 428,
      body: {
        ok: false,
        error: {
          code: 'STEP_UP_REQUIRED',
          source: 'graphos',
          message: 'confirm',
          retryable: false,
          details: { plan_ref: planRef, console_url: url, op: 'identity.users.disable' },
        },
        meta,
      },
    })
    expect(await invokeIdentity('identity.users.disable', { principal_id: 'usr:1' })).toEqual({
      kind: 'confirmation',
      message: 'Review and confirm this action in the console.',
      url,
    })
  })
})
