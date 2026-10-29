import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveIdentity, type AuthSession, type Identity } from '@/lib/auth'
import { conversationOwnerKey, saveConversationEntry } from '@/lib/chat-store'
import { AppSidebar } from '../app-sidebar'
import { SidebarProvider } from '../ui/sidebar'

// Observe an admitted identity change in one document, without remounting the
// app or reloading the browser. This seam does not simulate session discovery:
// the production useIdentity hook still resolves only on initial mount.
const session = vi.hoisted(() => ({
  current: null as { identity: Identity; loading: boolean } | null,
  listeners: new Set<() => void>(),
}))
vi.mock('@/lib/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth')>()
  const { useSyncExternalStore } = await import('react')
  return {
    ...original,
    useIdentity: () =>
      useSyncExternalStore(
        (notify) => {
          session.listeners.add(notify)
          return () => {
            session.listeners.delete(notify)
          }
        },
        () => session.current!,
      ),
  }
})
vi.mock('../mode-toggle', () => ({ ModeToggle: () => null }))
vi.mock('../UserMenu', () => ({ UserMenu: () => null }))

function admitted(subject = 'same-subject', tenant: string | null = 'tenant-a') {
  return {
    identity: resolveIdentity({ authenticated: true, roles: [], subject, tenant } as AuthSession, true),
    loading: false,
  }
}
function transition(next: { identity: Identity; loading: boolean }) {
  act(() => {
    session.current = next
    session.listeners.forEach((notify) => {
      notify()
    })
  })
}
const changes = [
  [
    'signed-out session',
    () => ({ identity: resolveIdentity({ authenticated: false, roles: [] }, true), loading: false }),
  ],
  ['unavailable session', () => ({ identity: resolveIdentity(null, false), loading: false })],
  ['tenant switch', () => admitted('same-subject', 'tenant-b')],
  ['subject switch', () => admitted('different-subject', 'tenant-a')],
  ['tenant removal', () => admitted('same-subject', null)],
  ['session denial', () => ({ identity: { ...admitted().identity, needsSignIn: true }, loading: false })],
  ['unresolved session', () => ({ ...admitted(), loading: true })],
] as const

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </QueryClientProvider>,
  )
}
function snapshot() {
  return Object.fromEntries(
    Object.keys(localStorage)
      .filter((key) => key.startsWith('chat:'))
      .map((key) => [key, localStorage.getItem(key)]),
  )
}
beforeEach(() => {
  session.current = admitted()
  localStorage.clear()
  window.history.replaceState({}, '', '/chat')
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => Promise.resolve(Response.json(url === '/api/apps' ? { apps: [] } : []))),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('OVERSTORY-API-R011.2 same-document sidebar retirement', () => {
  it.each(changes)('retires delete confirmation on %s without deleting either owner cache', (_label, next) => {
    const nextState = next()
    saveConversationEntry(conversationOwnerKey(admitted().identity), '/same-id', 'Original private title')
    if (!nextState.loading && !nextState.identity.needsSignIn) {
      saveConversationEntry(conversationOwnerKey(nextState.identity), '/same-id', 'Next private title')
    }
    const before = snapshot()
    mount()
    const documentBefore = document
    fireEvent.click(screen.getByRole('button', { name: 'Delete Original private title' }))
    const oldConfirm = screen.getByRole('button', { name: 'Delete' })
    transition(nextState)
    expect(document).toBe(documentBefore)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(oldConfirm)
    expect(snapshot()).toEqual(before)
    transition(admitted())
    expect(screen.getByRole('button', { name: 'Delete Original private title' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(changes)('retires pending rename on %s without saving old input to another owner', (_label, next) => {
    const nextState = next()
    saveConversationEntry(conversationOwnerKey(admitted().identity), '/same-id', 'Original private title')
    if (!nextState.loading && !nextState.identity.needsSignIn) {
      saveConversationEntry(conversationOwnerKey(nextState.identity), '/same-id', 'Next private title')
    }
    const before = snapshot()
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Rename Original private title' }))
    const oldInput = screen.getByRole('textbox', { name: 'Rename Original private title' })
    fireEvent.change(oldInput, { target: { value: 'Uncommitted private rename' } })
    const oldSave = screen.getByRole('button', { name: 'Save rename for Original private title' })
    transition(nextState)
    expect(screen.queryByDisplayValue('Uncommitted private rename')).not.toBeInTheDocument()
    fireEvent.click(oldSave)
    fireEvent.keyDown(oldInput, { key: 'Enter' })
    expect(snapshot()).toEqual(before)
    transition(admitted())
    expect(screen.queryByRole('textbox', { name: 'Rename Original private title' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename Original private title' })).toBeInTheDocument()
  })

  it.each(changes)('discards the old remote index when it resolves after %s', async (_label, next) => {
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      finish = resolve
    })
    let indexCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/chats' && ++indexCalls === 1) return pending
        return Promise.resolve(Response.json(url === '/api/apps' ? { apps: [] } : []))
      }),
    )
    mount()
    await waitFor(() => {
      expect(indexCalls).toBe(1)
    })
    transition(next())
    await act(async () => {
      finish(Response.json([{ id: '/old-remote', firstMessage: 'Late old private title' }]))
      await pending
    })
    expect(screen.queryByText('Late old private title')).not.toBeInTheDocument()
    expect(Object.values(snapshot()).join('')).not.toContain('Late old private title')
  })
})

it('preserves a pending rename for a renewed observation of the same admitted owner', () => {
  const owner = conversationOwnerKey(admitted().identity)
  saveConversationEntry(owner, '/same-id', 'Original private title')
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Rename Original private title' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Rename Original private title' }), {
    target: { value: 'Owned new title' },
  })
  transition(admitted())
  expect(screen.getByDisplayValue('Owned new title')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save rename for Original private title' }))
  expect(screen.getByRole('button', { name: 'Rename Owned new title' })).toBeInTheDocument()
  expect(Object.values(snapshot()).join('')).toContain('Owned new title')
})
