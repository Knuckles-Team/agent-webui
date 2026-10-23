import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { conversationOwnerKey, saveConversationEntry, useConversations } from '../chat-store'

function identity(userKey: string, tenant: string | null) {
  return { userKey, raw: tenant === null ? null : { authenticated: true, roles: [], tenant } }
}

function List({ enabled }: { enabled: boolean }) {
  const items = useConversations(conversationOwnerKey(identity('same', 'tenant-a')), enabled)
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>{item.firstMessage}</li>
      ))}
    </ul>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

it('uses an unambiguous tenant and subject namespace even for encoded-looking subjects', () => {
  const tenantKey = conversationOwnerKey(identity('same', 'tenant-a'))
  expect(conversationOwnerKey(identity(tenantKey, null))).not.toBe(tenantKey)
  expect(conversationOwnerKey(identity('same', 'tenant-b'))).not.toBe(tenantKey)
  expect(conversationOwnerKey(identity('same', null))).not.toBe(tenantKey)
})

it('does not read cached titles or fetch the conversation index before admission resolves', () => {
  saveConversationEntry(conversationOwnerKey(identity('same', 'tenant-a')), '/private', 'Private cached title')
  const reads = vi.spyOn(Storage.prototype, 'getItem')
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  render(<List enabled={false} />)
  expect(screen.queryByText('Private cached title')).not.toBeInTheDocument()
  expect(reads).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
})
