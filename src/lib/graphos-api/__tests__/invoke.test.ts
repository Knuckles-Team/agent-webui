import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { GraphOsApiError, invoke } from '../invoke'

const meta = { registry_digest: 'digest', api_version: 'v1' }
const session = { authenticated: true, csrf_token: 'csrf-secret' }

afterEach(() => vi.unstubAllGlobals())

describe('GraphOS browser invocation', () => {
  it('uses the verified cookie session and validates the result', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, result: { value: 7 }, meta }) })
    vi.stubGlobal('fetch', fetcher)
    await expect(invoke('markets.status', {}, z.object({ value: z.number() }))).resolves.toEqual({ value: 7 })
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/v1/ops/markets.status',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-secret' }),
      }),
    )
  })

  it('does not call an operation without a GraphOS CSRF token', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authenticated: true }) })
    vi.stubGlobal('fetch', fetcher)
    await expect(invoke('markets.status', {}, z.unknown())).rejects.toThrow('API shape violation')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('preserves a structured server refusal and rejects malformed success', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          ok: false,
          error: { code: 'UNKNOWN_OP', source: 'graphos', message: 'Request refused', retryable: false },
          meta,
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, result: {}, meta }) })
    vi.stubGlobal('fetch', fetcher)
    await expect(invoke('decisions.list', {}, z.unknown())).rejects.toMatchObject<Partial<GraphOsApiError>>({
      code: 'UNKNOWN_OP',
      status: 404,
    })
    await expect(invoke('markets.status', {}, z.object({ value: z.number() }))).rejects.toThrow('API shape violation')
  })
})
