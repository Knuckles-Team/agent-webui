import { describe, it, expect, beforeEach, vi } from 'vitest'
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

const LOCAL_IDENTITY: Identity = {
  userKey: 'local',
  role: 'admin',
  ssoConfigured: false,
  needsSignIn: false,
  raw: null,
}

describe('ProfileDialog', () => {
  beforeEach(() => {
    window.localStorage.clear()
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

  it('explains the local-only posture when SSO is not configured', async () => {
    renderWithProviders(<ProfileDialog open onOpenChange={vi.fn()} identity={LOCAL_IDENTITY} />)

    await waitFor(() => {
      expect(screen.getByText(/Single sign-on is not configured/)).toBeInTheDocument()
    })
    // Both the display-name row and the email row fall back to the same
    // "not provided" copy when there is no IdP session at all.
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
