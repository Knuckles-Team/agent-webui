// spec: WEBUI-APPS-R049.1.7
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exploreLensHref, navigateExploreLens, parseExploreLensState } from '../explore-lens-state'

describe('Explore lens integration state', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/workspace/explore')
  })
  it('keeps lenses orthogonal to evidence selection and collection search', () => {
    const state = {
      entity: 'a/b',
      tool: 'history' as const,
      query: 'retained collection',
      lens: 'validation' as const,
    }
    expect(parseExploreLensState(exploreLensHref(state))).toEqual(state)
    expect(parseExploreLensState('/workspace/explore?lens=query')).toEqual({
      entity: null,
      tool: 'overview',
      lens: 'query',
    })
    expect(exploreLensHref({ entity: null, tool: 'overview', lens: 'evidence' })).toBe('/workspace/explore')
  })
  it.each(['?lens=query&lens=validation', '?lens=unknown', '?script=run', '?q=a&q=b', '?tool=history'])(
    'rejects malformed state %s',
    (query) => {
      expect(() => parseExploreLensState(`/workspace/explore${query}`)).toThrow()
    },
  )
  it('refuses missing capabilities and roles without writing history', () => {
    const push = vi.spyOn(window.history, 'pushState')
    const state = { entity: null, tool: 'overview' as const, lens: 'query' as const }
    expect(() => navigateExploreLens(state, 'maintainer', ['evidence'])).toThrow('unavailable')
    expect(() => navigateExploreLens(state, 'reader', ['query'])).toThrow('not permitted')
    expect(push).not.toHaveBeenCalled()
    push.mockRestore()
  })
  it('uses one canonical history transition without executing a query', () => {
    const push = vi.spyOn(window.history, 'pushState')
    const state = { entity: 'id', tool: 'overview' as const, query: 'collection', lens: 'query' as const }
    navigateExploreLens(state, 'maintainer', ['query'])
    navigateExploreLens(state, 'maintainer', ['query'])
    expect(push).toHaveBeenCalledTimes(1)
    expect(parseExploreLensState(window.location.href)).toEqual(state)
    navigateExploreLens({ ...state, lens: 'evidence' }, 'user', ['evidence'])
    expect(window.location.search).toBe('?q=collection&entity=id')
    push.mockRestore()
  })
})
