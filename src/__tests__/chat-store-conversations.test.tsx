import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useConversations } from '@/lib/chat-store'
import { stubFetch, HOSTILE_FIXTURES } from './hostile-payload-contract-helpers'

/**
 * @file chat-store-conversations.test.tsx
 * @description Defect-pinning coverage for D-WUI-28 (AppSidebar / global-chrome
 * `/api/enhanced/chats` unvalidated cast, hardening-not-a-proven-crash) at
 * its current home: `useConversations()` in `src/lib/chat-store.ts` (moved
 * there from `app-sidebar.tsx` by a concurrent lane, `w1-webui-rbac`,
 * mid-program — see the register item's own "fix relocated" update). Unlike
 * D-WUI-8/9/12/16/19/20, the OLD code here never actually crashed a mounted
 * component (the throwing `.map()` sat in the same `try` block as the
 * `setRemote` call it feeds, so a bad shape threw before any state was ever
 * written — the item's own title says so), but nothing here EXERCISED that
 * incidental safety before: no test for this hook existed on `main` despite
 * the register item claiming one had been added. This is that test, plus the
 * `fetchValidated()` migration it pins: the hook must settle without
 * throwing (asserted via `renderHook` not itself throwing / rejecting) and
 * `remote` must end up as `[]` — never a hostile-shaped value reaching
 * downstream consumers (`app-sidebar.tsx`, `ChatPanel.tsx`).
 */
describe('useConversations (D-WUI-28)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  for (const [fixtureName, body, opts] of HOSTILE_FIXTURES) {
    it(`settles to an empty remote list on a ${fixtureName} /api/enhanced/chats response`, async () => {
      stubFetch(body, opts)
      const { result } = renderHook(() => useConversations('test-user'))
      // Give the fetch -> validate -> setRemote chain a turn to settle;
      // asserting the hook is still usable (not thrown) is the actual pin.
      await waitFor(() => {
        expect(Array.isArray(result.current)).toBe(true)
      })
      expect(result.current).toEqual([])
    })
  }

  it('surfaces a well-formed remote conversation normally', async () => {
    stubFetch([{ id: 'conv-1', firstMessage: 'hi', timestamp: '2026-08-07T00:00:00Z' }])
    const { result } = renderHook(() => useConversations('test-user'))
    await waitFor(() => {
      expect(result.current).toHaveLength(1)
    })
    expect(result.current[0].id).toBe('conv-1')
    expect(typeof result.current[0].timestamp).toBe('number')
  })
})
