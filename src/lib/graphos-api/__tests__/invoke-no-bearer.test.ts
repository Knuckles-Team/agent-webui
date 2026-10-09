/**
 * @file invoke-no-bearer.test.ts
 * @description Adversarial coverage for APIUI-06: `invoke()` preserves the
 * shared same-origin cookie session and CSRF token, never emits a Graph OS
 * service bearer to the browser, propagates cancellation into the in-flight
 * request rather than swallowing it, and surfaces a denial as a typed
 * `GraphOsApiError` instead of silently discarding it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { GraphOsApiError, invoke } from '../invoke'

const meta = { registry_digest: 'digest', api_version: 'v1' }
const session = { authenticated: true, csrf_token: 'csrf-secret' }

/** Matches an HTTP bearer/service-token credential, not the CSRF field name. */
const BEARER_LEAK = /\bbearer\b|service[-_ ]?token|service[-_ ]?bearer/i

function flattenCallText(calls: unknown[][]): string {
  return calls
    .map(([, init]) => {
      const request = init as { headers?: Record<string, string>; body?: unknown } | undefined
      return JSON.stringify({ headers: request?.headers ?? {}, body: request?.body ?? null })
    })
    .join('\n')
}

afterEach(() => vi.unstubAllGlobals())

describe('invoke() never exposes a Graph OS service bearer', () => {
  it('sets no Authorization header on the session fetch or the operation call', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, result: {}, meta }) })
    vi.stubGlobal('fetch', fetcher)
    await invoke('markets.status', {}, z.unknown())
    for (const [, init] of fetcher.mock.calls) {
      const headers = (init as { headers?: Record<string, string> } | undefined)?.headers ?? {}
      expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('authorization')
    }
  })

  it('never carries a bearer or service-token credential in any request header or body', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, result: {}, meta }) })
    vi.stubGlobal('fetch', fetcher)
    await invoke('decisions.list', { note: 'plain input, no credential' }, z.unknown())
    expect(flattenCallText(fetcher.mock.calls)).not.toMatch(BEARER_LEAK)
  })

  it('relies only on the same-origin cookie session plus the fetched CSRF token', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, result: {}, meta }) })
    vi.stubGlobal('fetch', fetcher)
    await invoke('markets.status', {}, z.unknown())
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/auth/session',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/v1/ops/markets.status',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-secret' }),
      }),
    )
  })
})

describe('invoke() cancellation reaches the in-flight request', () => {
  it('forwards the same AbortSignal to both the session fetch and the operation fetch', async () => {
    const controller = new AbortController()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, result: {}, meta }) })
    vi.stubGlobal('fetch', fetcher)
    await invoke('markets.status', {}, z.unknown(), { signal: controller.signal })
    for (const [, init] of fetcher.mock.calls) {
      expect((init as { signal?: AbortSignal } | undefined)?.signal).toBe(controller.signal)
    }
  })

  it('propagates an abort instead of swallowing it, and does not continue to the operation call', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    const fetcher = vi.fn().mockImplementation(() => Promise.reject(abortError))
    vi.stubGlobal('fetch', fetcher)
    controller.abort()
    await expect(invoke('markets.status', {}, z.unknown(), { signal: controller.signal })).rejects.toBe(abortError)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('invoke() surfaces a denial as a typed error instead of swallowing it', () => {
  it('turns a 401 refusal into a GraphOsApiError carrying the server code and status', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          ok: false,
          error: { code: 'AUTH_REQUIRED', source: 'graphos', message: 'Verified session required', retryable: false },
          meta,
        }),
      })
    vi.stubGlobal('fetch', fetcher)
    await expect(invoke('decisions.list', {}, z.unknown())).rejects.toMatchObject<Partial<GraphOsApiError>>({
      code: 'AUTH_REQUIRED',
      status: 401,
      retryable: false,
    })
  })

  it('turns a 403 refusal into a GraphOsApiError, never a bare resolved value', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          ok: false,
          error: { code: 'ACCESS_DENIED', source: 'graphos', message: 'Tenant scope denied', retryable: false },
          meta,
        }),
      })
    vi.stubGlobal('fetch', fetcher)
    const outcome = invoke('decisions.list', {}, z.unknown())
    await expect(outcome).rejects.toBeInstanceOf(GraphOsApiError)
    await expect(outcome).rejects.toMatchObject<Partial<GraphOsApiError>>({ code: 'ACCESS_DENIED', status: 403 })
  })
})
