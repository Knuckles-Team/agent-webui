/**
 * @file ohlc-rows.ts
 * @description Recognise complete OHLC rows in an Atlas result. A table is a
 * candle series only when every row has a time and four finite prices with
 * low <= open, close <= high; any other numeric table stays a table.
 */
import type { Row } from '@/lib/atlas/types'
import type { OhlcBar } from './schemas'

const TIME_KEYS = ['t', 'time', 'ts', 'open_time', 'timestamp'] as const
const FIELDS = {
  o: ['o', 'open'],
  h: ['h', 'high'],
  l: ['l', 'low'],
  c: ['c', 'close'],
} as const

function numberAt(row: Row, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    const parsed = typeof value === 'string' ? Number(value) : value
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed
  }
  return null
}

function timeAt(row: Row): number | null {
  for (const key of TIME_KEYS) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return Date.parse(value)
  }
  return null
}

function toBar(row: Row): OhlcBar | null {
  const t = timeAt(row)
  const [o, h, l, c] = (['o', 'h', 'l', 'c'] as const).map((field) => numberAt(row, FIELDS[field]))
  if (t === null || o === null || h === null || l === null || c === null) return null
  if (l > Math.min(o, c) || h < Math.max(o, c)) return null
  return { t, T: t, o, h, l, c, v: numberAt(row, ['v', 'volume']) ?? 0, final: true }
}

/** Candle bars for the rows, oldest first, or null unless every row is a valid candle. */
export function ohlcBars(rows: readonly Row[]): OhlcBar[] | null {
  if (rows.length < 2) return null
  const bars: OhlcBar[] = []
  for (const row of rows) {
    const bar = toBar(row)
    if (!bar) return null
    bars.push(bar)
  }
  bars.sort((a, b) => a.t - b.t)
  return bars.map((bar, index) => ({ ...bar, T: bars[index + 1]?.t ?? bar.t + 1 }))
}

/**
 * Merge a bar stream by open time (FUI-06). A later occurrence of an open
 * time is a revision and replaces the earlier bar at that time; an open time
 * absent from the stream is a gap and is never synthesized. Ascending order.
 */
export function mergeBarRevisions(bars: readonly OhlcBar[]): OhlcBar[] {
  const byOpenTime = new Map<number, OhlcBar>()
  for (const bar of bars) byOpenTime.set(bar.t, bar)
  return [...byOpenTime.values()].sort((a, b) => a.t - b.t)
}
