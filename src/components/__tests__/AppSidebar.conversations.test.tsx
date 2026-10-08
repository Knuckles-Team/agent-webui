import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ACTIVE_CONVERSATION_STORAGE_KEY, useConversationIdFromUrl } from '@/hooks/useConversationIdFromUrl'
import { saveConversationEntry } from '@/lib/chat-store'

import { AppSidebar } from '../app-sidebar'
import { SidebarProvider } from '../ui/sidebar'

vi.mock('@/lib/auth', () => ({
  DEV_IDENTITY_USER_KEY: 'local',
  useIdentity: () => ({ identity: { userKey: 'reader', role: 'reader' } }),
}))
vi.mock('../mode-toggle', () => ({ ModeToggle: () => null }))
vi.mock('../UserMenu', () => ({ UserMenu: () => null }))

function ActiveConversation() {
  const [id] = useConversationIdFromUrl()
  return <output aria-label="Active conversation">{id}</output>
}

async function deleteFromSidebar(path: string, activeId: string) {
  window.history.replaceState({}, '', path)
  window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, activeId)
  saveConversationEntry('reader', '/session-1', 'First chat')
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(new Response('[]', { status: 200 }))),
  )
  render(
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
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.resolve(new Response('[]', { status: 200 }))),
      )
      const panel = (
        <SidebarProvider>
          <AppSidebar />
          <ActiveConversation />
        </SidebarProvider>
      )
      const view = render(panel)
      expect(screen.getByLabelText('Active conversation')).toHaveTextContent('/session-1')
      for (let attempt = 0; attempt < 2; attempt += 1) {
        fireEvent.click(screen.getByRole('link', { name: 'Atlas' }))
        expect(window.location.pathname).toBe('/explore')
        expect(screen.getByLabelText('Active conversation')).toHaveTextContent('/session-1')
        fireEvent.click(screen.getByRole('link', { name: 'Chat' }))
        expect(window.location.pathname).toBe('/chat')
        expect(screen.getByLabelText('Active conversation')).toHaveTextContent('/session-1')
      }
      view.unmount()
      render(panel)
      expect(screen.getByLabelText('Active conversation')).toHaveTextContent('/session-1')
      expect(window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY)).toBe('/session-1')
    },
  )
})
