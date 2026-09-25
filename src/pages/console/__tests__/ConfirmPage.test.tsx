import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { z } from 'zod'
import { invoke } from '@/lib/graphos-api/invoke'
import { matchRoute } from '@/lib/nav-registry'
import ConfirmPage from '../ConfirmPage'

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('console confirmation route', () => {
  it('is registered as a deep link', () => {
    expect(matchRoute(`/console/confirm/graphos_plan:${'a'.repeat(48)}`)?.route.id).toBe('console.confirm')
  })

  it('rejects malformed plan refs without a network call', () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    window.history.replaceState({}, '', '/console/confirm/invalid')
    render(<ConfirmPage />)
    expect(screen.getByRole('alert').textContent).toContain('Invalid confirmation reference')
    expect(fetcher).not.toHaveBeenCalled()
  })

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
    render(<ConfirmPage />)
    expect((await screen.findByRole('alert')).textContent).toContain('UNKNOWN_OP')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('uses the same operation transport for an attended confirmation', async () => {
    const planRef = `graphos_plan:${'b'.repeat(48)}`
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, csrf_token: 'csrf' }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 428,
        json: async () => ({
          ok: false,
          error: {
            code: 'STEP_UP_REQUIRED',
            source: 'graphos',
            message: 'Request refused',
            retryable: false,
            details: {
              plan_ref: planRef,
              op: 'finance.orders.approve',
              effect: 'admin',
              console_url: `/console/confirm/${planRef}`,
            },
          },
          meta: { registry_digest: 'digest', api_version: 'v1' },
        }),
      })
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
    await expect(invoke('finance.orders.approve', { order_id: 'order-1' }, z.unknown())).rejects.toThrow(
      'STEP_UP_REQUIRED',
    )
    window.history.replaceState({}, '', `/console/confirm/${planRef}`)
    render(<ConfirmPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm this operation' }))
    expect((await screen.findByRole('status')).textContent).toContain('Operation confirmed')
    expect(fetcher).toHaveBeenNthCalledWith(
      6,
      '/api/v1/ops/finance.orders.approve',
      expect.objectContaining({
        body: JSON.stringify({ order_id: 'order-1' }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf',
          'GraphOS-Plan-Ref': planRef,
          'Idempotency-Key': expect.any(String),
        }),
      }),
    )
  })
})
