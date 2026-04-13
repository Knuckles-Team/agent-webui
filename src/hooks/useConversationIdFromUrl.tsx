/**
 * @file useConversationIdFromUrl.tsx
 * @description React hook for managing the active conversation ID based on the URL path.
 *
 * Provides a synchronized state between the application and the browser's
 * location pathname. Automatically handles popstate and custom history
 * events to enable back/forward navigation within the chat dashboard.
 */

import { useState, useEffect } from 'react'

/**
 * Custom hook to retrieve and update the unique ID of the current conversation
 * from the standard URL pathname.
 *
 * @returns A tuple containing the current conversation ID string and a
 * function to update it (which also pushes to the browser history).
 */
export function useConversationIdFromUrl(): [string, (id: string) => void] {
  const [conversationId, setConversationId] = useState(() => {
    return window.location.pathname
  })

  /**
   * Effect hook to listen for navigation events (browser back/forward or
   * programmatic pushState) and sync the local React state.
   */
  useEffect(() => {
    const handlePopState = () => {
      const newId = window.location.pathname
      setConversationId(newId)
    }

    // Standard browser navigation
    window.addEventListener('popstate', handlePopState)

    // Custom events for internal navigation triggering
    window.addEventListener('history-state-changed', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('history-state-changed', handlePopState)
    }
  }, [])

  /**
   * Updates the conversation ID state and synchronizes it with the
   * browser URL using the History API.
   *
   * @param id - The new conversation identifier (e.g., '/chat-123')
   */
  const setConversationIdAndUrl = (id: string) => {
    setConversationId(id)
    const url = new URL(window.location.toString())
    url.pathname = id || '/'
    window.history.pushState({}, '', url.toString())
  }

  return [conversationId, setConversationIdAndUrl]
}
