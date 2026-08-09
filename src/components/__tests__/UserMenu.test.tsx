import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { UserMenu } from '@/components/UserMenu'
import { SidebarProvider } from '@/components/ui/sidebar'
import type { Identity } from '@/lib/auth'
import { renderWithProviders } from '@/__tests__/fixtures'

// SidebarMenuButton reads `useSidebar()`, which throws outside a SidebarProvider
// ancestor -- UserMenu is always mounted inside app-sidebar.tsx's <Sidebar>/
// <SidebarProvider> in the real app (see App.tsx), so tests provide the same.
function renderUserMenu() {
  return renderWithProviders(
    <SidebarProvider>
      <UserMenu />
    </SidebarProvider>,
  )
}

// A plain closure variable (rather than `vi.fn()`) keeps the mocked hook's
// return type concrete instead of `any`, so consumers don't need an
// eslint-disable for `@typescript-eslint/no-unsafe-return`.
let identityResult: { identity: Identity; loading: boolean } | null = null

vi.mock('@/lib/auth', () => ({
  useIdentity: () => {
    if (!identityResult) throw new Error('set identityResult before rendering UserMenu in this suite')
    return identityResult
  },
}))

const AUTHENTICATED: Identity = {
  userKey: 'user-1',
  role: 'maintainer',
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
    roles: ['webui:maintainer'],
    webui_role: 'maintainer',
    expires_at: null,
  },
}

const EXPIRED: Identity = { ...AUTHENTICATED, needsSignIn: true }

const NO_SSO: Identity = {
  userKey: 'local',
  role: 'admin',
  ssoConfigured: false,
  needsSignIn: false,
  raw: null,
}

describe('UserMenu', () => {
  beforeEach(() => {
    window.localStorage.clear()
    identityResult = null
  })

  it('renders the signed-in operator name and email in the trigger', async () => {
    identityResult = { identity: AUTHENTICATED, loading: false }
    renderUserMenu()

    await waitFor(() => {
      expect(screen.getByText('Alice Example')).toBeInTheDocument()
    })
    expect(screen.getByText('alice@example.test')).toBeInTheDocument()
  })

  it('offers Profile and a working Log out link when authenticated', async () => {
    identityResult = { identity: AUTHENTICATED, loading: false }
    const { user } = renderUserMenu()

    await user.click(screen.getByRole('button', { name: /Alice Example/ }))

    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument()

    const logout = within(menu).getByRole('menuitem', { name: /Log out/ })
    expect(logout.tagName).toBe('A')
    expect(logout).toHaveAttribute('href', '/auth/logout')
  })

  it('offers Sign in instead of Log out when the session has expired', async () => {
    identityResult = { identity: EXPIRED, loading: false }
    const { user } = renderUserMenu()

    await user.click(screen.getByRole('button', { name: /Alice Example/ }))

    const menu = await screen.findByRole('menu')
    const signIn = within(menu).getByRole('menuitem', { name: /Sign in/ })
    expect(signIn.tagName).toBe('A')
    expect(signIn).toHaveAttribute('href', '/auth/login')
    expect(within(menu).queryByRole('menuitem', { name: /^Log out$/ })).not.toBeInTheDocument()
  })

  it('disables Log out and explains why when SSO is not configured for this deployment', async () => {
    identityResult = { identity: NO_SSO, loading: false }
    const { user } = renderUserMenu()

    await user.click(screen.getByRole('button', { name: /Local operator/ }))

    const menu = await screen.findByRole('menu')
    const logoutItem = within(menu).getByText(/Log out \(SSO not configured\)/)
    expect(logoutItem.closest('[data-slot="dropdown-menu-item"]')).toHaveAttribute('data-disabled')
  })

  it('opens the Profile dialog from the menu', async () => {
    identityResult = { identity: AUTHENTICATED, loading: false }
    const { user } = renderUserMenu()

    await user.click(screen.getByRole('button', { name: /Alice Example/ }))
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: 'Profile' }))

    await waitFor(() => {
      expect(screen.getByText(/Your avatar and nickname below are local to this browser/)).toBeInTheDocument()
    })
  })
})
