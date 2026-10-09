/**
 * @file offline-cache.ts
 * @description Typed offline-cache staleness contract (FUI-12.1). The
 * installed PWA shell keeps showing a previously cached financial fact
 * while offline, but marks it stale and disables any action implying
 * current market, account, or order state. Wiring a service-worker cache
 * and real `navigator.onLine` checks into the shell is FUI-12.2.
 */

export interface CachedFact<T> {
  data: T
  cached_at: number
}

export interface CacheView<T> {
  data: T
  stale: boolean
  disabledActions: readonly string[]
}

const CURRENT_STATE_ACTIONS = ['refresh_quote', 'place_order', 'submit_order', 'sync_account'] as const

/** Offline, or past maxAgeMs even while online, a cached fact is stale and current-state actions disable. */
export function viewCachedFact<T>(
  cached: CachedFact<T>,
  isOnline: boolean,
  now: number,
  maxAgeMs: number,
): CacheView<T> {
  const expired = now - cached.cached_at > maxAgeMs
  const stale = !isOnline || expired
  return { data: cached.data, stale, disabledActions: stale ? [...CURRENT_STATE_ACTIONS] : [] }
}
