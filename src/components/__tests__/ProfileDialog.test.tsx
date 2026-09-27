import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { ProfileDialog } from '@/components/ProfileDialog'
import type { Identity } from '@/lib/auth'
import { renderWithProviders } from '@/__tests__/fixtures'

const SSO_IDENTITY: Identity = {
  userKey: 'user-1',
  role: 'user',
  ssoConfigured: true,
  needsSignIn: false,
  raw: {
    authenticated: true,
    subject: 'user-1',
    username: 'alice',
    email: 'alice@example.test',
    name: 'Alice Example',
    picture: null,
    tenant: 'homelab',
    roles: ['kg:read'],
    webui_role: 'user',
    expires_at: null,
  },
}

const DEMO_IDENTITY: Identity = {
  userKey: 'usr:bootstrap',
  role: 'admin',
  ssoConfigured: true,
  needsSignIn: false,
  raw: { authenticated: true, subject: 'usr:bootstrap', roles: ['kg:admin'], webui_role: 'admin', mode: 'none' },
}

interface PasskeyCall {
  path: string
  body: unknown
  csrf: string | null
}

function stubPasskeyRegistration(calls: PasskeyCall[]): void {
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('navigator', {
    credentials: {
      create: vi.fn(() =>
        Promise.resolve({
          id: 'credential',
          rawId: new Uint8Array([1]).buffer,
          type: 'public-key',
          response: {
            attestationObject: new Uint8Array([2]).buffer,
            clientDataJSON: new Uint8Array([3]).buffer,
            getTransports: () => ['internal'],
          },
        }),
      ),
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/auth/session') return Promise.resolve(Response.json({ csrf_token: 'local-csrf' }))
      calls.push({
        path,
        body: JSON.parse(String(init?.body)),
        csrf: new Headers(init?.headers).get('X-CSRF-Token'),
      })
      if (path.endsWith('/register'))
        return Promise.resolve(
          Response.json({
            challenge: 'AQ',
            user: { id: 'Ag', name: 'alice', displayName: 'Alice' },
            rp: { name: 'GraphOS' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          }),
        )
      return Promise.resolve(Response.json({}, { status: 201 }))
    }),
  )
}

describe('ProfileDialog', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('offers passkey enrollment to a signed-in local user through the protected broker route', async () => {
    const calls: PasskeyCall[] = []
    stubPasskeyRegistration(calls)
    const local = { ...SSO_IDENTITY, raw: { ...SSO_IDENTITY.raw!, mode: 'local' as const } }
    const { user } = renderWithProviders(<ProfileDialog open onOpenChange={vi.fn()} identity={local} />)
    await user.click(screen.getByRole('button', { name: 'Add passkey' }))
    await waitFor(() => {
      expect(screen.getByText('Passkey added')).toBeInTheDocument()
    })
    expect(calls.map((call) => call.path)).toEqual([
      '/auth/mfa/webauthn/register',
      '/auth/mfa/webauthn/register-complete',
    ])
    expect(calls.every((call) => call.csrf === 'local-csrf')).toBe(true)
    expect(calls[1].body).toEqual({
      name: 'Browser passkey',
      credential: {
        id: 'credential',
        rawId: 'AQ',
        type: 'public-key',
        response: { attestationObject: 'Ag', clientDataJSON: 'Aw', transports: ['internal'] },
      },
    })
  })

  it('shows the account name, email, and role read-only from IdP claims', async () => {
    renderWithProviders(<ProfileDialog open onOpenChange={vi.fn()} identity={SSO_IDENTITY} />)

    await waitFor(() => {
      expect(screen.getByText('Alice Example')).toBeInTheDocument()
    })
    expect(screen.getByText('alice@example.test')).toBeInTheDocument()
    expect(screen.getByText('user')).toBeInTheDocument()
    expect(screen.getByText('from your identity provider')).toBeInTheDocument()
  })

  it('explains the unauthenticated demo posture of the bootstrap administrator', async () => {
    renderWithProviders(<ProfileDialog open onOpenChange={vi.fn()} identity={DEMO_IDENTITY} />)

    await waitFor(() => {
      expect(screen.getByText(/Unauthenticated demo mode/)).toBeInTheDocument()
    })
    // Both the display-name row and the email row fall back to the same
    // "not provided" copy when the principal has no name or e-mail.
    expect(screen.getAllByText('Not provided by identity provider')).toHaveLength(2)
  })

  it('persists a local nickname override and reports it saved', async () => {
    const { user } = renderWithProviders(<ProfileDialog open onOpenChange={vi.fn()} identity={SSO_IDENTITY} />)

    const input = screen.getByLabelText(/Local nickname/)
    await user.type(input, 'Al')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText(/Local nickname saved/)).toBeInTheDocument()
    })
    expect(window.localStorage.getItem('profile:user-1:override')).toContain('"nickname":"Al"')
  })

  it('resets a saved nickname back to the account name', async () => {
    const { user } = renderWithProviders(<ProfileDialog open onOpenChange={vi.fn()} identity={SSO_IDENTITY} />)

    const input = screen.getByLabelText(/Local nickname/)
    await user.type(input, 'Al')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Reset' }))

    await waitFor(() => {
      expect(screen.getByText(/Reverted to your account name/)).toBeInTheDocument()
    })
    expect(window.localStorage.getItem('profile:user-1:override')).toBeNull()
  })

  it('stores an uploaded avatar locally and confirms it does not touch Keycloak', async () => {
    renderWithProviders(<ProfileDialog open onOpenChange={vi.fn()} identity={SSO_IDENTITY} />)

    const file = new File(['fake-image-bytes'], 'avatar.png', { type: 'image/png' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/Local avatar updated/)).toBeInTheDocument()
    })
    const stored = window.localStorage.getItem('profile:user-1:override')
    expect(stored).toContain('avatarDataUrl')
  })

  it('rejects a non-image file for the avatar', async () => {
    renderWithProviders(<ProfileDialog open onOpenChange={vi.fn()} identity={SSO_IDENTITY} />)

    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('Please choose an image file')).toBeInTheDocument()
    })
    expect(window.localStorage.getItem('profile:user-1:override')).toBeNull()
  })
})
