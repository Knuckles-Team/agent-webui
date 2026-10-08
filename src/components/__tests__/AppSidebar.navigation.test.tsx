import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  routesBySection: () => [{ id: 'knowledge.atlas', path: '/explore', label: 'Atlas', icon: () => null }],
}))

function sidebarLink() {
  render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  )
  return screen.getByRole('link', { name: 'Atlas' })
}

afterEach(() => {
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
