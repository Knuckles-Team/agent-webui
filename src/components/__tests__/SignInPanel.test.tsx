import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { SignInPanel } from '@/components/SignInPanel'
import { AuthModeBanner } from '@/components/AuthModeBanner'
import { renderWithProviders } from '@/__tests__/fixtures'
import type { AuthSession, Identity } from '@/lib/auth'

function identity(raw: Partial<AuthSession> | null, ssoConfigured = true): Identity {
  const session = raw ? ({ authenticated: false, roles: [], ...raw } as AuthSession) : null
  return { userKey: 'local', role: 'reader', ssoConfigured, needsSignIn: true, raw: session }
}

interface Call {
  path: string
  body: unknown
  csrf?: string | null
}

let calls: Call[] = []

function answer(outcome: string, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/auth/idps') return Promise.resolve(Response.json({ idps: [] }))
      if (path === '/auth/session')
        return Promise.resolve(Response.json({ authenticated: false, csrf_token: 'csrf-fixture' }))
      calls.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        csrf: new Headers(init?.headers).get('X-CSRF-Token'),
      })
      return Promise.resolve(Response.json({ outcome }, { status }))
    }),
  )
}

function stubPendingTotp(calls: Call[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/auth/session') return Promise.resolve(Response.json({ csrf_token: 'csrf-fixture' }))
      calls.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        csrf: new Headers(init?.headers).get('X-CSRF-Token'),
      })
      if (path === '/auth/mfa/totp/enroll')
        return Promise.resolve(Response.json({ secret: 'ONE-TIME-KEY', provisioning_uri: 'otpauth://totp/example' }))
      return Promise.resolve(Response.json({ confirmed: true }))
    }),
  )
}

function stubPendingPasskey(calls: Call[]): void {
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('navigator', {
    credentials: {
      get: vi.fn(() =>
        Promise.resolve({
          id: 'credential',
          rawId: new Uint8Array([1]).buffer,
          type: 'public-key',
          response: {
            authenticatorData: new Uint8Array([2]).buffer,
            clientDataJSON: new Uint8Array([3]).buffer,
            signature: new Uint8Array([4]).buffer,
            userHandle: null,
          },
        }),
      ),
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/auth/session')
        return Promise.resolve(Response.json({ authenticated: false, csrf_token: 'csrf-fixture' }))
      if (path === '/auth/mfa/webauthn/authenticate')
        return Promise.resolve(Response.json({ challenge: 'AQ', allowCredentials: [] }))
      calls.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        csrf: new Headers(init?.headers).get('X-CSRF-Token'),
      })
      return Promise.resolve(Response.json({ outcome: 'ok' }))
    }),
  )
}

describe('SignInPanel', () => {
  const assign = vi.fn()

  beforeEach(() => {
    calls = []
    vi.stubGlobal('location', { assign, search: '', origin: window.location.origin, href: window.location.href })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    assign.mockReset()
  })

  it('signs in with the local form and lets the server decide who the user is', async () => {
    answer('ok')
    const { user } = renderWithProviders(<SignInPanel identity={identity({ mode: 'local' })} />)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/')
    })
    expect(calls).toEqual([
      { path: '/auth/login', body: { username: 'alice', password: 'correct horse battery' }, csrf: null },
    ])
  })

  it('shows the uniform failure message and stays on the form', async () => {
    answer('bad', 401)
    const { user } = renderWithProviders(<SignInPanel identity={identity({ mode: 'local' })} />)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed')
    expect(assign).not.toHaveBeenCalled()
  })

  it('asks for the second factor when the session owes one', async () => {
    answer('ok')
    const pending = identity({ mode: 'local', second_factor_required: true })
    const { user } = renderWithProviders(<SignInPanel identity={pending} />)
    await user.type(screen.getByLabelText('Authenticator code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/')
    })
    expect(calls[0]).toEqual({
      path: '/auth/mfa/verify',
      body: { method: 'totp', code: '123456' },
      csrf: 'csrf-fixture',
    })
  })

  it('does not continue an enrollment-required sign-in without a session', async () => {
    answer('mfa_enrollment_required')
    const { user } = renderWithProviders(<SignInPanel identity={identity({ mode: 'local' })} />)
    await user.type(screen.getByLabelText('Username'), 'admin')
    await user.type(screen.getByLabelText('Password'), 'password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Ask an administrator')
    })
    expect(assign).not.toHaveBeenCalled()
  })

  it('lets an un-enrolled privileged pending session set up TOTP', async () => {
    stubPendingTotp(calls)
    const pending = identity({ mode: 'local', second_factor_required: true, mfa_required: true, mfa_enrolled: false })
    const { user } = renderWithProviders(<SignInPanel identity={pending} />)
    expect(screen.queryByRole('button', { name: 'Use a passkey' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Set up an authenticator app' }))
    expect(await screen.findByLabelText('Authenticator setup key')).toHaveTextContent('ONE-TIME-KEY')
    await user.type(screen.getByLabelText('Authenticator code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirm authenticator' }))
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/')
    })
    expect(calls).toEqual([
      { path: '/auth/mfa/totp/enroll', body: {}, csrf: 'csrf-fixture' },
      { path: '/auth/mfa/totp/confirm', body: { code: '123456' }, csrf: 'csrf-fixture' },
    ])
  })

  it('does not infer an enrollment requirement from an admin scope', () => {
    const pending = identity({
      mode: 'local',
      roles: ['identity:admin'],
      second_factor_required: true,
      mfa_required: false,
      mfa_enrolled: false,
    })
    renderWithProviders(<SignInPanel identity={pending} />)

    expect(screen.getByRole('button', { name: 'Use a passkey' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set up an authenticator app' })).toBeNull()
  })

  it('uses a signed browser passkey for a pending second factor', async () => {
    stubPendingPasskey(calls)
    const { user } = renderWithProviders(
      <SignInPanel identity={identity({ mode: 'local', second_factor_required: true })} />,
    )
    await user.click(screen.getByRole('button', { name: 'Use a passkey' }))
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/')
    })
    expect(calls).toEqual([
      {
        path: '/auth/mfa/webauthn/authenticate-complete',
        body: {
          credential: {
            id: 'credential',
            rawId: 'AQ',
            type: 'public-key',
            response: { authenticatorData: 'Ag', clientDataJSON: 'Aw', signature: 'BA', userHandle: null },
          },
        },
        csrf: 'csrf-fixture',
      },
    ])
  })

  it('creates the first administrator on a fresh production install', async () => {
    answer('ok')
    const fresh = identity({ mode: null, setup_required: true })
    const { user } = renderWithProviders(<SignInPanel identity={fresh} />)
    await user.type(screen.getByLabelText('Setup code'), 'code')
    await user.type(screen.getByLabelText('Username'), 'root')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Create administrator' }))
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/')
    })
    expect(calls[0].path).toBe('/auth/setup')
  })

  it('offers the offline administrator reset-token path without claiming email delivery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === '/auth/idps') return Promise.resolve(Response.json({ idps: [] }))
        if (path === '/auth/password/forgot')
          return Promise.resolve(Response.json({ email_reset: false, alternatives: ['admin_reset'] }))
        calls.push({ path, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(Response.json({ reset: true }))
      }),
    )
    const { user } = renderWithProviders(<SignInPanel identity={identity({ mode: 'local' })} />)
    await user.click(screen.getByRole('button', { name: 'Use a reset token' }))
    expect(await screen.findByText(/Email reset is unavailable/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Reset token'), 'one-time-token')
    await user.type(screen.getByLabelText('New password'), 'new-correct-horse')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument()
    expect(calls[0]).toEqual({
      path: '/auth/password/reset',
      body: { purpose: 'admin_reset', token: 'one-time-token', new_password: 'new-correct-horse' },
    })
  })

  it('never renders a form when the identity service is unreachable', () => {
    renderWithProviders(<SignInPanel identity={identity(null, false)} />)
    expect(screen.getByText('Identity unavailable')).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('keeps the redirect login of a standalone single-client OIDC boundary', () => {
    renderWithProviders(<SignInPanel identity={identity({})} />)
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/login')
  })
})

describe('AuthModeBanner', () => {
  it('shows the server banner only in none mode', () => {
    const demo = identity({ mode: 'none', banner: 'Unauthenticated demo mode' })
    const { unmount } = renderWithProviders(<AuthModeBanner identity={demo} />)
    expect(screen.getByTestId('auth-mode-banner')).toHaveTextContent('Unauthenticated demo mode')
    unmount()
    renderWithProviders(<AuthModeBanner identity={identity({ mode: 'local', banner: null })} />)
    expect(screen.queryByTestId('auth-mode-banner')).toBeNull()
  })
})
