import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invokeIdentity } from '@/lib/graphos-api/identity'

function response(status: number, payload: unknown): Promise<Response> {
  return Promise.resolve({ ok: status < 400, status, json: async () => payload } as Response)
}

describe('identity operation adapter', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('requires an explicit successful envelope before confirming a mutation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(200, { status: 'success' })),
    )
    const reply = await invokeIdentity('identity.users.disable', { principal_id: 'u-1' })
    expect(reply.kind).toBe('error')
  })

  it('separates missing API, refused scope, and MFA step-up', async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => response(404, {}))
      .mockImplementationOnce(() => response(403, { ok: false, error: { code: 'SCOPE_REQUIRED' } }))
      .mockImplementationOnce(() => response(428, { ok: false, error: { code: 'STEP_UP_REQUIRED' } }))
      .mockImplementationOnce(() => response(428, { ok: true, result: { plan_ref: 'plan-1' } }))
    vi.stubGlobal('fetch', fetcher)
    expect((await invokeIdentity('identity.users.list')).kind).toBe('unavailable')
    expect((await invokeIdentity('identity.users.list')).kind).toBe('forbidden')
    expect((await invokeIdentity('identity.users.admin_reset')).kind).toBe('step_up')
    expect((await invokeIdentity('identity.users.disable')).kind).toBe('confirmation')
  })
})
