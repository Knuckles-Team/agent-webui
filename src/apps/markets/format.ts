/**
 * @file format.ts
 * @description Display formatting for Markets: prices, signed percentages,
 * "time since flip" and dates. Formatting only — no market arithmetic.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY

function decimalsFor(value: number): number {
  const magnitude = Math.abs(value)
  if (magnitude >= 1000) return 2
  if (magnitude >= 1) return Math.min(4, magnitude >= 100 ? 2 : 3)
  return 6
}

/** A price; with `decimals` (from the series' tick size) at exactly that
 * precision, else at a precision chosen from its magnitude. */
export function formatPrice(value: number | null | undefined, decimals?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (decimals !== undefined && decimals !== null) {
    return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  }
  const digits = decimalsFor(value)
  return value.toLocaleString('en-US', { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits })
}

/** Decimal places of a tick size such as `0.01` (2) or `0.5` (1). */
export function tickDecimals(tickSize: string): number {
  const fraction = tickSize.split('.')[1] ?? ''
  return fraction.replace(/0+$/, '').length
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`
}

export function formatVolume(value: number): string {
  return value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })
}

const SPANS: readonly [number, string][] = [
  [MONTH, 'M'],
  [WEEK, 'W'],
  [DAY, 'D'],
  [HOUR, 'h'],
  [MINUTE, 'm'],
]

/** "1M 2h 32m"-style elapsed time, largest three units. */
export function formatSince(fromMs: number | null | undefined, nowMs: number): string {
  if (fromMs === null || fromMs === undefined) return '—'
  let rest = Math.max(0, nowMs - fromMs)
  const parts: string[] = []
  for (const [size, unit] of SPANS) {
    const count = Math.floor(rest / size)
    if (count > 0 && parts.length < 3) {
      parts.push(`${count}${unit}`)
      rest -= count * size
    }
  }
  return parts.length > 0 ? parts.join(' ') : '<1m'
}

const INTRADAY = new Set(['1m', '15m', '1h', '4h', '12h'])

export function formatDate(ms: number, timeframe: string): string {
  const date = new Date(ms)
  const options: Intl.DateTimeFormatOptions = INTRADAY.has(timeframe)
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
    : { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }
  return date.toLocaleString('en-US', options)
}
