import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/__tests__/fixtures'

import { AppSidebar } from '../app-sidebar'
import { SidebarProvider } from '../ui/sidebar'

vi.mock('@/lib/auth', () => ({ useIdentity: () => ({ identity: { userKey: 'reader', role: 'reader' } }) }))
vi.mock('@/lib/chat-store', () => ({ useConversations: () => [] }))
vi.mock('@/hooks/useConversationIdFromUrl', () => ({ useConversationIdFromUrl: () => ['/'] }))
vi.mock('../mode-toggle', () => ({ ModeToggle: () => null }))
vi.mock('../UserMenu', () => ({ UserMenu: () => null }))
vi.mock('@/lib/nav-registry', () => ({
  SECTIONS: [{ id: 'knowledge', label: 'Knowledge' }],
  roleAtLeast: () => true,
  isAtlasPath: () => false,
  routesBySection: () => [
    { id: 'knowledge.atlas', path: '/explore', label: 'Atlas', icon: () => null },
    { id: 'apps.markets', path: '/apps/markets', label: 'Markets', capability: 'app:markets', icon: () => null },
    { id: 'apps.reports', path: '/apps/reports', label: 'Reports', capability: 'app:reports', icon: () => null },
  ],
}))

function sidebarLink() {
  renderWithProviders(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  )
  return screen.getByRole('link', { name: 'Atlas' })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => Promise.resolve(Response.json(url === '/api/apps' ? { apps: [] } : {}))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('sidebar link navigation', () => {
  it.each(['shiftKey', 'altKey', 'ctrlKey', 'metaKey'] as const)(
    'leaves %s clicks to the browser without changing the current route',
    (modifier) => {
      const link = sidebarLink()
      const push = vi.spyOn(window.history, 'pushState')
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, [modifier]: true })
      let consumedBySidebar: boolean | undefined
      // Observe after React handles the click, then prevent jsdom's unsupported navigation.
      window.addEventListener(
        'click',
        (click) => {
          consumedBySidebar = click.defaultPrevented
          click.preventDefault()
        },
        { once: true },
      )
      fireEvent(link, event)
      expect(consumedBySidebar).toBe(false)
      expect(push).not.toHaveBeenCalled()
      expect(window.location.pathname).toBe('/')
    },
  )

  it('still handles an ordinary click through local navigation', () => {
    const link = sidebarLink()
    const push = vi.spyOn(window.history, 'pushState')
    fireEvent.click(link)
    expect(push).toHaveBeenCalledWith({}, '', '/explore')
    expect(window.location.pathname).toBe('/explore')
  })
})

// spec: WEBUI-APPS-R001
it('renders only available app links after the real catalog query resolves', async () => {
  let resolveCatalog!: (response: Response) => void
  const catalog = new Promise<Response>((resolve) => {
    resolveCatalog = resolve
  })
  const fetchMock = vi.fn((url: string) => (url === '/api/apps' ? catalog : Promise.resolve(Response.json({}))))
  vi.stubGlobal('fetch', fetchMock)
  sidebarLink()
  expect(screen.queryByRole('link', { name: 'Markets' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith('/api/apps', undefined)
  resolveCatalog(
    Response.json({
      apps: [
        { id: 'markets', available: true, detail: null },
        { id: 'reports', available: false, detail: 'Unavailable on this deployment.' },
      ],
    }),
  )
  expect(await screen.findByRole('link', { name: 'Markets' })).toHaveAttribute('href', '/apps/markets')
  expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Atlas' })).toBeInTheDocument()
})
