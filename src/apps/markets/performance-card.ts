/**
 * @file performance-card.ts
 * @description Typed performance/benchmark card contract (FUI-08.1).
 * Performance figures are fixed-point decimal strings calculated by the
 * owning service; the UI reproduces them verbatim (never parses them back
 * to float and recomputes or rounds) alongside the return method, currency,
 * source, as-of time, and session, and shows an explicit unavailable state
 * rather than a computed figure. Wiring into a PerformanceCard component is
 * FUI-08.2.
 */

export type ReturnMethod = 'twr' | 'mwr' | 'simple'
export type Session = 'regular' | 'pre_market' | 'post_market' | 'closed'

export interface PerformanceCard {
  available: boolean
  /** Fixed-point decimal string from the owning service, e.g. "12.3456"; never parsed to float here. */
  value: string | null
  return_method: ReturnMethod
  currency: string
  source: string
  as_of: string
  session: Session
  stale: boolean
}

export interface PerformanceCardView {
  state: 'unavailable' | 'stale' | 'value'
  displayValue: string | null
}

/** Renders the owner's decimal string unchanged; never a computed or estimated figure. */
export function renderPerformanceCard(card: PerformanceCard): PerformanceCardView {
  if (!card.available || card.value === null) return { state: 'unavailable', displayValue: null }
  if (card.stale) return { state: 'stale', displayValue: card.value }
  return { state: 'value', displayValue: card.value }
}

/** Refuses any card whose value has been coerced to float, losing trailing-zero precision. */
export function isVerbatimDecimalString(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value)
}
