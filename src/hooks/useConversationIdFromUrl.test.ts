import { describe, expect, it } from 'vitest'

import { isApplicationRoute, normalizeConversationId, resolveConversationId } from './useConversationIdFromUrl'

describe('conversation route resolution', () => {
  it('keeps the stored conversation while workspace pages change', () => {
    expect(resolveConversationId('/graph', '', '/session-1')).toBe('/session-1')
    expect(resolveConversationId('/files', '?filter=md', '/session-1')).toBe('/session-1')
  })

  it('uses an explicit chat deep link and supports legacy conversation paths', () => {
    expect(resolveConversationId('/chat', '?conversation=%2Fsession-2', '/session-1')).toBe('/session-2')
    expect(resolveConversationId('/legacy-session', '', null)).toBe('/legacy-session')
  })

  it('normalizes IDs without confusing declared application routes', () => {
    expect(normalizeConversationId('session-3')).toBe('/session-3')
    expect(normalizeConversationId(null)).toBe('/')
    expect(isApplicationRoute('/object/claim-9')).toBe(true)
    expect(isApplicationRoute('/session-3')).toBe(false)
  })
})
