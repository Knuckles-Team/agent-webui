import { describe, expect, it } from 'vitest'
import { viewCachedFact } from '../offline-cache'

describe('offline-cache (FUI-12.1)', () => {
  it('marks a cached fact stale and disables current-state actions while offline', () => {
    const view = viewCachedFact({ data: { price: 100 }, cached_at: 1000 }, false, 2000, 60_000)
    expect(view.stale).toBe(true)
    expect(view.disabledActions).toContain('place_order')
    expect(view.data).toEqual({ price: 100 })
  })

  it('keeps a fresh online cache non-stale with no disabled actions', () => {
    const view = viewCachedFact({ data: { price: 100 }, cached_at: 1000 }, true, 2000, 60_000)
    expect(view.stale).toBe(false)
    expect(view.disabledActions).toEqual([])
  })

  it('marks an expired cache stale even while online', () => {
    const view = viewCachedFact({ data: { price: 100 }, cached_at: 0 }, true, 70_000, 60_000)
    expect(view.stale).toBe(true)
  })
})
