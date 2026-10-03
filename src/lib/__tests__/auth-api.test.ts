import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  regenerateRecoveryCodes,
  signOut,
  verifySecondFactor,
} from '@/lib/auth-api'

describe('identity browser mutations', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the pending session and sends its token when completing MFA', async () => {
    const calls: { path: string; init?: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init?: RequestInit) => {
        calls.push({ path, init })
        return Promise.resolve(
          path === '/auth/session'
            ? Response.json({ authenticated: false, second_factor_required: true, csrf_token: 'pending-token' })
            : Response.json({ outcome: 'ok' }),
        )
      }),
    )
    expect(await verifySecondFactor('totp', '123456')).toBe('ok')
    expect(calls.map((call) => call.path)).toEqual(['/auth/session', '/auth/mfa/verify'])
    expect(new Headers(calls[1].init?.headers).get('X-CSRF-Token')).toBe('pending-token')
    expect(calls[1].init?.credentials).toBe('same-origin')
  })

  it('refuses a protected mutation if the session has no CSRF token', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ authenticated: false })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(signOut()).rejects.toThrow('CSRF token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses protected broker routes for authenticator and recovery-code self-service', async () => {
    const calls: { path: string; init?: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init?: RequestInit) => {
        calls.push({ path, init })
        if (path === '/auth/session')
          return Promise.resolve(Response.json({ authenticated: true, csrf_token: 'session-token' }))
        if (path.endsWith('/enroll'))
          return Promise.resolve(Response.json({ secret: 'SECRET', provisioning_uri: 'otpauth://totp/test' }))
        if (path.endsWith('/confirm')) return Promise.resolve(Response.json({ confirmed: true }))
        return Promise.resolve(Response.json({ codes: ['recovery-one'] }))
      }),
    )
    expect(await beginTotpEnrollment()).toEqual({ secret: 'SECRET', provisioningUri: 'otpauth://totp/test' })
    expect(await confirmTotpEnrollment('123456')).toBe(true)
    expect(await regenerateRecoveryCodes()).toEqual(['recovery-one'])
    const mutations = calls.filter((call) => call.path !== '/auth/session')
    expect(mutations.map((call) => call.path)).toEqual([
      '/auth/mfa/totp/enroll',
      '/auth/mfa/totp/confirm',
      '/auth/mfa/recovery-codes',
    ])
    expect(mutations.every((call) => new Headers(call.init?.headers).get('X-CSRF-Token') === 'session-token')).toBe(
      true,
    )
  })
})
