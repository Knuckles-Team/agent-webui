import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { saveConversationEntry, useConversations } from '@/lib/chat-store'

// BUG-259: the left-hand "Active Chats" sidebar is reported to append a
// freshly created conversation at the BOTTOM instead of the top. This
// reproduces the exact real-world sequence: an existing conversation
// already sits in the per-user index, then a brand-new one is recorded via
// the SAME `saveConversationEntry` call site `Chat.tsx`'s `handleSubmit`
// uses when starting a chat from `conversationId === '/'`.
describe('useConversations ordering (BUG-259)', () => {
  const userKey = 'test-user'

  beforeEach(() => {
    window.localStorage.clear()
    // The default jsdom fetch shim (src/__tests__/setup.ts) has no route for
    // `/api/enhanced/chats`; stub it directly so the remote branch resolves
    // to an empty list instead of exercising the shim's fallback behaviour.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) as unknown as Promise<Response>),
    )
  })

  it('places a newly created conversation ABOVE an older existing one', async () => {
    saveConversationEntry(userKey, '/older-conversation', 'First chat')
    // Real timestamps are `Date.now()`-based and monotonic; advance the clock
    // so the new entry is unambiguously later, matching real usage (the user
    // sends a first message, then later clicks "New Conversation").
    await new Promise((resolve) => setTimeout(resolve, 5))
    saveConversationEntry(userKey, '/newer-conversation', 'New Chat')

    const { result } = renderHook(() => useConversations(userKey))

    await waitFor(() => {
      expect(result.current.length).toBe(2)
    })

    expect(result.current[0].id).toBe('/newer-conversation')
    expect(result.current[1].id).toBe('/older-conversation')
  })

  it('BUG-259 repro: a server chat record with no timestamp field sorts ABOVE a just-created local conversation', async () => {
    // The server's /api/enhanced/chats records predate the `timestamp`
    // field on some historical records (list_chats' helper does not
    // guarantee one). rawConversationEntrySchema marks `timestamp` optional,
    // so this is a real, schema-legal server response shape.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ id: '/old-server-chat', firstMessage: 'An old chat with no timestamp' }]),
          }) as unknown as Promise<Response>,
      ),
    )

    // The user just clicked "New Conversation" and sent their first message.
    saveConversationEntry(userKey, '/brand-new-chat', 'New Chat')

    const { result } = renderHook(() => useConversations(userKey))

    await waitFor(() => {
      expect(result.current.length).toBe(2)
    })

    // Bug: `useConversations` defaults a missing/non-numeric remote timestamp
    // to `Date.now()` AT FETCH TIME, which resolves strictly after the local
    // entry's creation instant -- so the untimestamped server record outranks
    // the just-created conversation and the new chat is pushed to the bottom.
    expect(result.current[0].id).toBe('/brand-new-chat')
    expect(result.current[1].id).toBe('/old-server-chat')
  })
})
