import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { matchRoute } from '@/lib/nav-registry'
import ConsoleConfirmView from '../ConsoleConfirmView'

/**
 * The `console.confirm` deep link (requirement APIUI-02, part of
 * WEBUI-API-R001): the real component against a stubbed `fetch`, exercising
 * the shared `invoke` transport end to end.
 */

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('console confirmation route (APIUI-02)', () => {
  // spec: APIUI-02
  it('is registered as a deep link', () => {
    expect(matchRoute(`/console/confirm/graphos_plan:${'a'.repeat(48)}`)?.route.id).toBe('console.confirm')
  })

  // spec: APIUI-02
  it('rejects malformed plan refs without a network call', () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    window.history.replaceState({}, '', '/console/confirm/invalid')
    render(<ConsoleConfirmView />)
    expect(screen.getByRole('alert').textContent).toContain('Invalid confirmation reference')
    expect(fetcher).not.toHaveBeenCalled()
  })

  // spec: APIUI-02
  it('shows an unavailable operation as a failure', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, csrf_token: 'csrf' }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          ok: false,
          error: { code: 'UNKNOWN_OP', source: 'graphos', message: 'Request refused', retryable: false },
          meta: { registry_digest: 'digest', api_version: 'v1' },
        }),
      })
    vi.stubGlobal('fetch', fetcher)
    window.history.replaceState({}, '', `/console/confirm/graphos_plan:${'a'.repeat(48)}`)
    render(<ConsoleConfirmView />)
    expect((await screen.findByRole('alert')).textContent).toContain('UNKNOWN_OP')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('confirms a server-side plan by reference alone, never replaying the original arguments', async () => {
    const planRef = `graphos_plan:${'b'.repeat(48)}`
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, csrf_token: 'csrf' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: { plan_ref: planRef, op: 'finance.orders.approve', preview: 'Approve this order' },
          meta: { registry_digest: 'digest', api_version: 'v1' },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, csrf_token: 'csrf' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: { confirmed: true },
          meta: { registry_digest: 'digest', api_version: 'v1' },
        }),
      })
    vi.stubGlobal('fetch', fetcher)
    window.history.replaceState({}, '', `/console/confirm/${planRef}`)
    render(<ConsoleConfirmView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm this operation' }))
    expect((await screen.findByRole('status')).textContent).toContain('Operation confirmed')
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      '/api/v1/ops/plan.confirm',
      expect.objectContaining({
        body: expect.stringContaining(`"plan_ref":"${planRef}"`),
        headers: expect.objectContaining({
          'GraphOS-Plan-Ref': planRef,
          'X-CSRF-Token': 'csrf',
          'Idempotency-Key': expect.any(String),
        }),
      }),
    )
  })
})
