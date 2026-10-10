import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { saveConversationEntry, useConversations } from '@/lib/chat-store'

function ConversationList({ userKey, observe }: { userKey: string; observe: (owner: string, ids: string[]) => void }) {
  const entries = useConversations(userKey)
  observe(
    userKey,
    entries.map((entry) => entry.id),
  )
  return (
    <ul aria-label="Conversations">
      {entries.map((entry) => (
        <li key={entry.id}>{entry.id}</li>
      ))}
    </ul>
  )
}

function pendingResponse() {
  let fulfill!: (response: Response) => void
  const promise = new Promise<Response>((resolve) => {
    fulfill = resolve
  })
  return { promise, resolve: fulfill }
}

function response(id: string) {
  return new Response(JSON.stringify([{ id, firstMessage: id, timestamp: 1 }]), { status: 200 })
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('conversation cache ownership (IDUI-06)', () => {
  // spec: IDUI-06
  it.each(['success', 'unavailable'] as const)(
    'removes prior-user entries immediately when the new request is %s',
    async (outcome) => {
      saveConversationEntry('alice', '/alice-local', 'Synthetic Alice chat')
      saveConversationEntry('bob', '/bob-local', 'Synthetic Bob chat')
      const pending = pendingResponse()
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(response('/alice-remote')).mockReturnValueOnce(pending.promise),
      )
      const observe = vi.fn()
      const view = render(<ConversationList userKey="alice" observe={observe} />)
      await screen.findByText('/alice-remote')
      view.rerender(<ConversationList userKey="bob" observe={observe} />)
      expect(screen.queryByText('/alice-local')).not.toBeInTheDocument()
      expect(screen.queryByText('/alice-remote')).not.toBeInTheDocument()
      expect(screen.getByText('/bob-local')).toBeInTheDocument()
      // Also reject a one-render disclosure before effects flush.
      for (const [owner, ids] of observe.mock.calls) {
        if (owner === 'bob') expect(ids).not.toEqual(expect.arrayContaining([expect.stringMatching(/^\/alice-/)]))
      }
      await act(async () => {
        pending.resolve(outcome === 'success' ? response('/bob-remote') : new Response('Unavailable', { status: 503 }))
      })
      expect(screen.queryByText('/alice-remote')).not.toBeInTheDocument()
      expect(screen.getByText('/bob-local')).toBeInTheDocument()
      if (outcome === 'success') expect(await screen.findByText('/bob-remote')).toBeInTheDocument()
    },
  )

  it('ignores an old user response that completes after switching accounts', async () => {
    const pending = pendingResponse()
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response('/bob-remote')))
    const observe = vi.fn()
    const view = render(<ConversationList userKey="alice" observe={observe} />)
    view.rerender(<ConversationList userKey="bob" observe={observe} />)
    await screen.findByText('/bob-remote')
    await act(async () => {
      pending.resolve(response('/alice-late'))
    })
    await waitFor(() => expect(screen.queryByText('/alice-late')).not.toBeInTheDocument())
    expect(screen.getByText('/bob-remote')).toBeInTheDocument()
  })
})
