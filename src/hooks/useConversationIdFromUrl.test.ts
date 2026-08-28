import { describe, expect, it } from 'vitest'

import { ROUTES, isDynamicPath } from '@/lib/nav-registry'

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

  // Regression test for the class of bug where `/llm-templates` (a real registered page,
  // see nav-registry.ts) was silently misread as a conversation id because
  // `isApplicationRoute` used to consult a hand-maintained list that had drifted out of
  // sync with `ROUTES`. `isApplicationRoute` is now DERIVED from `nav-registry.ts`'s
  // `matchRoute`, so this test also guards against that duplication ever coming back:
  // adding a page to ROUTES without touching this file is enough to keep it passing.
  it('treats every registered nav-registry route as an application route, not a conversation id', () => {
    for (const route of ROUTES) {
      if (isDynamicPath(route.path)) continue
      expect(isApplicationRoute(route.path), `${route.id} (${route.path}) should be an application route`).toBe(true)
      expect(
        resolveConversationId(route.path, '', '/some-conversation'),
        `${route.id} (${route.path}) must not be read as a conversation id`,
      ).toBe('/some-conversation')
    }
  })
})
