/**
 * @file useConversationIdFromUrl.tsx
 * @description Keeps the active assistant session stable while workspace routes change.
 */

import { useCallback, useEffect, useState } from 'react'

export const ACTIVE_CONVERSATION_STORAGE_KEY = 'activeConversationId'
export const ACTIVE_CONVERSATION_CHANGED_EVENT = 'active-conversation-changed'

const APPLICATION_ROUTES = new Set([
  '/',
  '/admin',
  '/broker',
  '/chat',
  '/code-graph',
  '/configuration',
  '/cypher',
  '/dashboards',
  '/data-analyst',
  '/ecosystem',
  '/explorer',
  '/extraction',
  '/files',
  '/fleet',
  '/goals',
  '/graph',
  '/knowledge',
  '/magma',
  '/observability',
  '/ops',
  '/prompts',
  '/scheduling',
  '/sessions',
  '/skills',
  '/swe',
  '/system-status',
  '/temporal-graph',
  '/usage',
  '/vertex',
  '/workflows',
])

export function isApplicationRoute(pathname: string): boolean {
  return APPLICATION_ROUTES.has(pathname) || pathname.startsWith('/object/')
}

export function normalizeConversationId(value: string | null | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === '/') return '/'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

export function resolveConversationId(pathname: string, search: string, storedId: string | null): string {
  if (pathname === '/chat') {
    const requestedId = new URLSearchParams(search).get('conversation')
    if (requestedId) return normalizeConversationId(requestedId)
  }

  // Preserve compatibility with historical conversation links such as
  // `/V1StG...`, while treating every declared application page as a view.
  if (!isApplicationRoute(pathname)) return normalizeConversationId(pathname)
  return normalizeConversationId(storedId)
}

function readActiveConversation(): string {
  return resolveConversationId(
    window.location.pathname,
    window.location.search,
    window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY),
  )
}

function persistActiveConversation(conversationId: string): void {
  if (conversationId === '/') window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY)
  else window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, conversationId)
}

/**
 * Return the active assistant conversation and a setter for switching sessions.
 * Workspace navigation does not change the session. On `/chat`, the optional
 * `conversation` query parameter provides a shareable/deep-linkable session URL.
 */
export function useConversationIdFromUrl(): [string, (id: string) => void] {
  const [conversationId, setConversationId] = useState(readActiveConversation)

  useEffect(() => {
    const handleNavigation = () => {
      const nextId = readActiveConversation()
      setConversationId(nextId)
      if (nextId !== '/') persistActiveConversation(nextId)
    }

    window.addEventListener('popstate', handleNavigation)
    window.addEventListener('history-state-changed', handleNavigation)
    window.addEventListener(ACTIVE_CONVERSATION_CHANGED_EVENT, handleNavigation)
    return () => {
      window.removeEventListener('popstate', handleNavigation)
      window.removeEventListener('history-state-changed', handleNavigation)
      window.removeEventListener(ACTIVE_CONVERSATION_CHANGED_EVENT, handleNavigation)
    }
  }, [])

  const setConversationIdAndUrl = useCallback((id: string) => {
    const nextId = normalizeConversationId(id)
    persistActiveConversation(nextId)
    setConversationId(nextId)
    window.dispatchEvent(new Event(ACTIVE_CONVERSATION_CHANGED_EVENT))

    const url = new URL(window.location.toString())
    if (url.pathname === '/chat') {
      if (nextId === '/') url.searchParams.delete('conversation')
      else url.searchParams.set('conversation', nextId)
      window.history.pushState({}, '', url.toString())
      window.dispatchEvent(new Event('history-state-changed'))
    } else if (!isApplicationRoute(url.pathname)) {
      // Keep legacy conversation-only routes functional until all external
      // links have migrated to `/chat?conversation=...`.
      url.pathname = nextId
      window.history.pushState({}, '', url.toString())
      window.dispatchEvent(new Event('history-state-changed'))
    }
  }, [])

  return [conversationId, setConversationIdAndUrl]
}
