/**
 * @file chart-a11y.ts
 * @description Typed accessibility contract for charts and controls
 * (FUI-13.1): every chart needs a screen-reader-accessible text summary
 * independent of its visual rendering, and every control's state must be
 * describable in text/icon labels rather than color alone. Wiring this
 * summary into ChartPanel/OhlcChart `aria-label`s and verifying keyboard
 * operation, 200% zoom, and reduced-motion in the live DOM is FUI-13.2.
 */

import type { Direction, OhlcBar } from './schemas'

export type MotionPreference = 'no-preference' | 'reduce'

export interface ChartA11ySummary {
  label: string
  trendDirection: Direction | null
  lastClose: number | null
  barCount: number
}

/** A text summary of a bar series a screen reader can announce without seeing the chart. */
export function chartSummaryText(bars: readonly OhlcBar[], trendDirection: Direction | null): ChartA11ySummary {
  const last = bars.at(-1) ?? null
  const trendWord = trendDirection === 'bullish' ? 'rising' : trendDirection === 'bearish' ? 'falling' : 'flat'
  const label =
    last === null ? 'No chart data available' : `${bars.length} bars, trend ${trendWord}, last close ${last.c}`
  return { label, trendDirection, lastClose: last?.c ?? null, barCount: bars.length }
}

/** State must be conveyed by text/icon, never color alone: every direction needs a non-color word. */
export function directionWord(direction: Direction | null): string {
  if (direction === 'bullish') return 'up'
  if (direction === 'bearish') return 'down'
  return 'flat'
}

/** An animation runs only when the viewer has not asked to reduce motion. */
export function allowsAnimation(preference: MotionPreference): boolean {
  return preference === 'no-preference'
}
