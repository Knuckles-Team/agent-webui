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
        return Promise.resolve(Response.json({ authenticated: false, csrf_token: 'mock-pending-session-csrf' }))
      calls.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        csrf: new Headers(init?.headers).get('X-CSRF-Token'),
      })
      return Promise.resolve(Response.json({ outcome }, { status }))
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
      csrf: 'mock-pending-session-csrf',
    })
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
