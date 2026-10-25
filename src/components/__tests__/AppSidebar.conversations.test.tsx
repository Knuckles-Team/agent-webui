import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ACTIVE_CONVERSATION_STORAGE_KEY, useConversationIdFromUrl } from '@/hooks/useConversationIdFromUrl'
import { conversationOwnerKey, saveConversationEntry } from '@/lib/chat-store'
import { renderWithProviders } from '@/__tests__/fixtures'

import { AppSidebar } from '../app-sidebar'
import { SidebarProvider } from '../ui/sidebar'

const caller = vi.hoisted(() => ({ tenant: 'tenant-a', denied: false }))
vi.mock('@/lib/auth', () => ({
  DEV_IDENTITY_USER_KEY: 'local',
  useIdentity: () => ({
    identity: { userKey: 'reader', role: 'reader', needsSignIn: caller.denied, raw: { tenant: caller.tenant } },
    loading: false,
  }),
}))
vi.mock('../mode-toggle', () => ({ ModeToggle: () => null }))
vi.mock('../UserMenu', () => ({ UserMenu: () => null }))

function ActiveConversation() {
  const [id] = useConversationIdFromUrl()
  return <output aria-label="Active conversation">{id}</output>
}

function sidebarFixtureResponse(url: string) {
  return Promise.resolve(Response.json(url === '/api/apps' ? { apps: [] } : []))
}

async function deleteFromSidebar(path: string, activeId: string) {
  window.history.replaceState({}, '', path)
  window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, activeId)
  saveConversationEntry(
    conversationOwnerKey({ userKey: 'reader', raw: { authenticated: true, roles: [], tenant: caller.tenant } }),
    '/session-1',
    'First chat',
  )
  vi.stubGlobal('fetch', vi.fn().mockImplementation(sidebarFixtureResponse))
  renderWithProviders(
    <SidebarProvider>
      <AppSidebar />
      <ActiveConversation />
    </SidebarProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Delete First chat' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete First chat' })).not.toBeInTheDocument())
}

afterEach(() => {
  caller.tenant = 'tenant-a'
  caller.denied = false
  vi.unstubAllGlobals()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('deleting conversations from the sidebar', () => {
  it.each(['/chat?conversation=%2Fsession-1', '/session-1', '/graph'])(
    'clears the active session without reviving it from %s',
    async (path) => {
      await deleteFromSidebar(path, '/session-1')
      expect(screen.getByLabelText('Active conversation')).toHaveTextContent(/^\/$/)
      expect(window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)).toBeNull()
      expect(window.location.pathname).toBe(path === '/graph' ? '/graph' : '/chat')
      expect(window.location.search).toBe('')
    },
  )

  it('preserves another active conversation when deleting an inactive entry', async () => {
    await deleteFromSidebar('/chat?conversation=%2Fsession-2', '/session-2')
    expect(screen.getByLabelText('Active conversation')).toHaveTextContent('/session-2')
    expect(window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)).toBe('/session-2')
    expect(window.location.search).toBe('?conversation=%2Fsession-2')
  })
})

describe('conversation deep links across workspace navigation', () => {
  it.each([
    ['/chat?conversation=%2Fsession-1', null],
    ['/session-1', null],
    ['/chat?conversation=%2Fsession-1', '/older-session'],
    ['/session-1', '/older-session'],
  ])(
    'retains %s with prior selection %s across repeated navigation and remount',
    function retainsDeepLink(path, stored) {
      window.history.replaceState({}, '', path)
      if (stored) window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, stored)
      vi.stubGlobal('fetch', vi.fn().mockImplementation(sidebarFixtureResponse))
      const panel = (
        <SidebarProvider>
          <AppSidebar />
          <ActiveConversation />
        </SidebarProvider>
      )
      const view = renderWithProviders(panel)
      expect(screen.getByLabelText('Active conversation')).toHaveTextContent('/session-1')
      for (let attempt = 0; attempt < 2; attempt += 1) {
        fireEvent.click(screen.getByRole('link', { name: 'Understory' }))
        expect(window.location.pathname).toBe('/explore')
        expect(screen.getByLabelText('Active conversation')).toHaveTextContent('/session-1')
        fireEvent.click(screen.getByRole('link', { name: 'Chat' }))
        expect(window.location.pathname).toBe('/chat')
        expect(screen.getByLabelText('Active conversation')).toHaveTextContent('/session-1')
      }
      view.unmount()
      renderWithProviders(panel)
      expect(screen.getByLabelText('Active conversation')).toHaveTextContent('/session-1')
      expect(window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)).toBe('/session-1')
    },
  )
})

it('retires pending delete confirmation when the same subject changes tenant', async () => {
  const key = (tenant: string) =>
    conversationOwnerKey({ userKey: 'reader', raw: { authenticated: true, roles: [], tenant } })
  saveConversationEntry(key('tenant-a'), '/same', 'Old tenant chat')
  saveConversationEntry(key('tenant-b'), '/same', 'New tenant chat')
  const before = window.localStorage.getItem(`chat:${key('tenant-b')}:conversationIds`)
  vi.stubGlobal('fetch', vi.fn().mockImplementation(sidebarFixtureResponse))
  const client = new QueryClient()
  const panel = () => (
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </QueryClientProvider>
  )
  const view = renderWithProviders(panel())
  fireEvent.click(screen.getByRole('button', { name: 'Delete Old tenant chat' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  caller.tenant = 'tenant-b'
  view.rerender(panel())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Delete New tenant chat' })).toBeInTheDocument()
  expect(window.localStorage.getItem(`chat:${key('tenant-b')}:conversationIds`)).toBe(before)
})

it('retires pending deletion when the current owner becomes denied', () => {
  const owner = conversationOwnerKey({
    userKey: 'reader',
    raw: { authenticated: true, roles: [], tenant: caller.tenant },
  })
  saveConversationEntry(owner, '/same', 'Protected chat')
  const before = window.localStorage.getItem(`chat:${owner}:conversationIds`)
  vi.stubGlobal('fetch', vi.fn().mockImplementation(sidebarFixtureResponse))
  const client = new QueryClient()
  const panel = () => (
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </QueryClientProvider>
  )
  const view = renderWithProviders(panel())
  fireEvent.click(screen.getByRole('button', { name: 'Delete Protected chat' }))
  caller.denied = true
  view.rerender(panel())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete Protected chat' })).not.toBeInTheDocument()
  expect(window.localStorage.getItem(`chat:${owner}:conversationIds`)).toBe(before)
})
