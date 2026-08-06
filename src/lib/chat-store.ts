/**
 * @file chat-store.ts
 * @description The ONE store for chat session state: the conversation index
 * (id, first message, timestamp) and each conversation's message history.
 *
 * Before this module existed, the nav sidebar's "Active Chats" list
 * (`app-sidebar.tsx`) and the floating chat launcher (`ChatPanel.tsx` →
 * `Chat.tsx`) each read/wrote the same raw `localStorage` keys independently,
 * with no shared read model — an operator-reported visible bug where the two
 * surfaces could show different session lists. Every read and write now goes
 * through the functions here, and both surfaces read the list via the same
 * {@link useConversations} hook, so there is exactly one source of truth to
 * desync from.
 *
 * **Per-user (R9).** Chat sessions and history are per-user state, not shared.
 * Every key is namespaced by `userKey` (from `useIdentity()` in `auth.ts` —
 * the verified subject, or `'local'` in the zero-config single-operator/dev
 * posture). A one-time migration folds any pre-namespacing history recorded
 * under the legacy global keys into the `'local'` namespace so upgrading does
 * not silently orphan existing conversations.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ConversationEntry } from '@/types'
import { DEV_IDENTITY_USER_KEY } from './auth'

/** Fired whenever this module writes the conversation index, for same-tab listeners
 * (the native `storage` event only fires in OTHER tabs/windows). */
export const CONVERSATIONS_CHANGED_EVENT = 'chat-store:conversations-changed'

const LEGACY_INDEX_KEY = 'conversationIds'
const MAX_FIRST_MESSAGE_LENGTH = 30

function indexKey(userKey: string): string {
  return `chat:${userKey}:conversationIds`
}

function messagesKey(userKey: string, conversationId: string): string {
  return `chat:${userKey}:messages:${conversationId}`
}

function isDefaultUser(userKey: string): boolean {
  return userKey === DEV_IDENTITY_USER_KEY
}

function readIndex(userKey: string): ConversationEntry[] {
  try {
    const own = window.localStorage.getItem(indexKey(userKey))
    if (own) return JSON.parse(own) as ConversationEntry[]
    if (isDefaultUser(userKey)) {
      const legacy = window.localStorage.getItem(LEGACY_INDEX_KEY)
      if (legacy) {
        // One-time migration: adopt the pre-namespacing global list as this
        // user's own, so introducing per-user keys does not lose history.
        window.localStorage.setItem(indexKey(userKey), legacy)
        return JSON.parse(legacy) as ConversationEntry[]
      }
    }
    return []
  } catch {
    return []
  }
}

function writeIndex(userKey: string, entries: ConversationEntry[]): void {
  try {
    window.localStorage.setItem(indexKey(userKey), JSON.stringify(entries))
  } catch {
    // Storage may be disabled (private mode, quota) — non-fatal, matches the
    // existing best-effort persistence contract for this data.
  }
  window.dispatchEvent(new Event(CONVERSATIONS_CHANGED_EVENT))
}

/** Read a conversation's persisted message history, or `null` if none is cached. */
export function readConversationMessages(userKey: string, conversationId: string): unknown[] | null {
  try {
    const own = window.localStorage.getItem(messagesKey(userKey, conversationId))
    if (own) return JSON.parse(own) as unknown[]
    if (isDefaultUser(userKey)) {
      const legacy = window.localStorage.getItem(conversationId)
      if (legacy) return JSON.parse(legacy) as unknown[]
    }
    return null
  } catch {
    return null
  }
}

export function writeConversationMessages(userKey: string, conversationId: string, messages: unknown[]): void {
  try {
    window.localStorage.setItem(messagesKey(userKey, conversationId), JSON.stringify(messages))
  } catch {
    // Storage may be disabled (private mode, quota) — non-fatal.
  }
}

export function removeConversationMessages(userKey: string, conversationId: string): void {
  window.localStorage.removeItem(messagesKey(userKey, conversationId))
  if (isDefaultUser(userKey)) window.localStorage.removeItem(conversationId)
}

/** Record a new conversation at the top of `userKey`'s index. */
export function saveConversationEntry(userKey: string, conversationId: string, firstMessage: string): void {
  const trimmed =
    firstMessage.length > MAX_FIRST_MESSAGE_LENGTH
      ? `${firstMessage.slice(0, MAX_FIRST_MESSAGE_LENGTH)}...`
      : firstMessage
  const entries = readIndex(userKey)
  entries.unshift({ id: conversationId, firstMessage: trimmed, timestamp: Date.now() })
  writeIndex(userKey, entries)
}

export function renameConversationEntry(userKey: string, conversationId: string, firstMessage: string): void {
  writeIndex(
    userKey,
    readIndex(userKey).map((entry) => (entry.id === conversationId ? { ...entry, firstMessage } : entry)),
  )
}

export function deleteConversationEntry(userKey: string, conversationId: string): void {
  writeIndex(
    userKey,
    readIndex(userKey).filter((entry) => entry.id !== conversationId),
  )
  removeConversationMessages(userKey, conversationId)
}

/**
 * The ONE hook the nav "Active Chats" list and the floating chat launcher both
 * call. Merges `userKey`'s local index with the server-side conversation list
 * (`GET /api/enhanced/chats`, already scoped to the authenticated caller),
 * local entries winning only where the server has not (yet) recorded that id.
 */
export function useConversations(userKey: string): ConversationEntry[] {
  const [local, setLocal] = useState<ConversationEntry[]>(() => readIndex(userKey))
  const [remote, setRemote] = useState<ConversationEntry[]>([])

  useEffect(() => {
    setLocal(readIndex(userKey))
  }, [userKey])

  useEffect(() => {
    let cancelled = false
    const fetchRemote = async () => {
      try {
        const res = await fetch('/api/enhanced/chats')
        if (!res.ok) return
        const data = (await res.json()) as ConversationEntry[]
        if (cancelled) return
        setRemote(
          data.map((entry) => ({
            ...entry,
            timestamp:
              typeof entry.timestamp === 'string' || typeof entry.timestamp === 'number'
                ? new Date(entry.timestamp).getTime()
                : Date.now(),
          })),
        )
      } catch (err) {
        console.error('Failed to fetch remote conversations', err)
      }
    }
    void fetchRemote()
    return () => {
      cancelled = true
    }
  }, [userKey])

  useEffect(() => {
    const refresh = () => {
      setLocal(readIndex(userKey))
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === indexKey(userKey)) refresh()
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener(CONVERSATIONS_CHANGED_EVENT, refresh)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(CONVERSATIONS_CHANGED_EVENT, refresh)
    }
  }, [userKey])

  return useMemo(() => {
    const map = new Map<string, ConversationEntry>()
    local.forEach((entry) => map.set(entry.id, entry))
    remote.forEach((entry) => map.set(entry.id, entry))
    return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp)
  }, [local, remote])
}
