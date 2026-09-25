import { afterEach, describe, expect, it, vi } from 'vitest'
import { CSRF_HEADER, installCsrfToken, needsCsrfToken, withCsrfToken } from '@/lib/csrf'

describe('CSRF chokepoint', () => {
  afterEach(() => {
    installCsrfToken(null)
  })

  it('needs a token only for same-origin state changes', () => {
    expect(needsCsrfToken('/api/chats', { method: 'POST' })).toBe(true)
    expect(needsCsrfToken('/api/chats')).toBe(false)
    expect(needsCsrfToken('/api/chats', { method: 'head' })).toBe(false)
    expect(needsCsrfToken('https://elsewhere.example/api', { method: 'POST' })).toBe(false)
  })

  it('adds the header without overriding an explicit one', () => {
    const added = new Headers(withCsrfToken('/x', { method: 'POST' }, 'tok').headers)
    expect(added.get(CSRF_HEADER)).toBe('tok')
    const explicit = new Headers(
      withCsrfToken('/x', { method: 'POST', headers: { [CSRF_HEADER]: 'mine' } }, 'tok').headers,
    )
    expect(explicit.get(CSRF_HEADER)).toBe('mine')
  })

  it('wraps fetch once and attaches the current token to same-origin posts', async () => {
    const seen: Headers[] = []
    const stub = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers))
      return Promise.resolve(new Response('{}'))
    })
    vi.stubGlobal('fetch', stub)
    installCsrfToken('session-token')
    await window.fetch('/api/chats', { method: 'POST' })
    await window.fetch('/api/chats')
    await window.fetch('https://elsewhere.example/api', { method: 'POST' })
    expect(seen[0].get(CSRF_HEADER)).toBe('session-token')
    expect(seen[1].get(CSRF_HEADER)).toBeNull()
    expect(seen[2].get(CSRF_HEADER)).toBeNull()
    vi.unstubAllGlobals()
  })
})
