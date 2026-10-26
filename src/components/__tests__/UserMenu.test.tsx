import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { toast } from 'sonner'
import { screen, waitFor, within } from '@testing-library/react'
import { UserMenu } from '@/components/UserMenu'
import { SidebarProvider } from '@/components/ui/sidebar'
import type { Identity } from '@/lib/auth'
import { renderWithProviders } from '@/__tests__/fixtures'

// SidebarMenuButton reads `useSidebar()`, which throws outside a SidebarProvider
// ancestor -- both the legacy sidebar and workspace header share App.tsx's
// SidebarProvider, so tests provide the same owner.
function renderUserMenu(compact = false) {
  return renderWithProviders(
    <SidebarProvider>
      <UserMenu compact={compact} />
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
  role: 'reader',
  ssoConfigured: false,
  needsSignIn: true,
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
    expect(signIn).toHaveAttribute('href', '/')
    expect(within(menu).queryByRole('menuitem', { name: /^Log out$/ })).not.toBeInTheDocument()
  })

  it('disables Log out and explains why when the identity service is unavailable', async () => {
    identityResult = { identity: NO_SSO, loading: false }
    const { user } = renderUserMenu()

    await user.click(screen.getByRole('button', { name: /Not signed in/ }))

    const menu = await screen.findByRole('menu')
    const logoutItem = within(menu).getByText(/Log out \(identity unavailable\)/)
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

// spec: WEBUI-IDENTITY-R004.1
describe('workspace account control', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('offers a compact labeled trigger with keyboard opening, Escape dismissal and focus restoration', async () => {
    identityResult = { identity: AUTHENTICATED, loading: false }
    const { user } = renderUserMenu(true)
    const trigger = screen.getByRole('button', { name: 'Account menu for Alice Example' })
    expect(trigger).toHaveClass('min-h-11', 'w-11')
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('menu')).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it.each([200, 403])('uses the existing broker sign-out and only reloads after success (%s)', async (status) => {
    const raw = AUTHENTICATED.raw
    if (!raw) throw new Error('Authenticated fixture requires a session')
    identityResult = { identity: { ...AUTHENTICATED, raw: { ...raw, mode: 'local' } }, loading: false }
    const assign = vi.fn()
    const failure = vi.spyOn(toast, 'error')
    vi.stubGlobal('location', { assign, search: '', origin: window.location.origin, href: window.location.href })
    const calls: { path: string; method?: string; proof: boolean; credentials?: RequestCredentials }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (path === '/auth/session') {
          // The sanitizer recognizes mock-prefixed inert fixture values.
          return Promise.resolve(Response.json({ authenticated: true, csrf_token: 'mock-session-proof' }))
        }
        calls.push({
          path,
          method: init?.method,
          proof: new Headers(init?.headers).get('X-CSRF-Token') === 'mock-session-proof',
          credentials: init?.credentials,
        })
        return Promise.resolve(Response.json({ outcome: 'ok' }, { status }))
      }),
    )
    const { user } = renderUserMenu(true)
    await user.click(screen.getByRole('button', { name: 'Account menu for Alice Example' }))
    const action = await screen.findByRole('menuitem', { name: 'Log out' })
    expect(action.tagName).not.toBe('A')
    await user.click(action)
    await waitFor(() => {
      expect(calls).toEqual([{ path: '/auth/logout', method: 'POST', proof: true, credentials: 'same-origin' }])
    })
    if (status === 200)
      await waitFor(() => {
        expect(assign).toHaveBeenCalledWith('/')
      })
    else {
      await waitFor(() => {
        expect(failure).toHaveBeenCalledWith('Sign-out was refused. Your session may still be active.')
      })
      expect(assign).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Account menu for Alice Example' })).toBeVisible()
    }
  })
})
