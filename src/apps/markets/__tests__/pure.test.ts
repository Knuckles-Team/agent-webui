import { describe, expect, it } from 'vitest'
import { barPosition, niceTicks, trailSegments } from '../components/chart-geometry'
import { formatSince } from '../format'
import { mergeBarRevisions, ohlcBars } from '../ohlc-rows'
import { readChart, readFilters, writeChart, writeFilters, DEFAULT_FILTERS } from '../view-state'
import { CHART } from './fixtures'

describe('chart geometry', () => {
  it('splits the trailing line at every flip so no connector crosses price', () => {
    const segments = trailSegments(
      CHART.trail,
      (t) => t,
      (v) => v,
    )
    expect(segments.map((segment) => [segment.direction, segment.points.length])).toEqual([
      ['bearish', 2],
      ['bullish', 2],
    ])
  })

  it('places a time inside its bar and refuses one outside every bar', () => {
    const [first] = CHART.bars
    expect(barPosition(CHART.bars, first.t)).toBe(0)
    expect(barPosition(CHART.bars, CHART.bars[2].t + (CHART.bars[2].T - CHART.bars[2].t) / 2)).toBeCloseTo(2.5)
    expect(barPosition(CHART.bars, first.t - 1)).toBeNull()
  })

  it('picks round ticks inside the domain', () => {
    expect(niceTicks([95, 115], 4)).toEqual([95, 100, 105, 110, 115])
  })
})

describe('formatting', () => {
  it('states time since a flip in its three largest units', () => {
    const now = Date.UTC(2026, 0, 31)
    const since = now - (17 * 86_400_000 + 2 * 3_600_000 + 32 * 60_000)
    expect(formatSince(since, now)).toBe('2W 3D 2h')
    expect(formatSince(null, now)).toBe('—')
  })
})

describe('view state in the URL', () => {
  it('round-trips scanner filters and drops anything not in the vocabulary', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      assetClass: 'crypto' as const,
      direction: 'bullish' as const,
      quote: 'USDT',
      nearAth: true,
    }
    expect(readFilters(writeFilters(filters))).toEqual(filters)
    const hostile = new URLSearchParams('tf=7D&asset=memes&trend=up&status=valid&status=nope&quote=<x>&since=-3')
    expect(readFilters(hostile)).toEqual({ ...DEFAULT_FILTERS, statuses: ['valid'] })
  })

  it('round-trips chart settings, including no layers at all', () => {
    const settings = { timeframe: '1D' as const, range: '1Y' as const, layers: [] }
    expect(readChart(writeChart(settings))).toEqual(settings)
  })
})

describe('Atlas OHLC recognition', () => {
  // spec: FUI-06
  it('accepts complete candles and refuses any row that is not one', () => {
    const rows = [
      { time: '2026-01-02', open: 10, high: 12, low: 9, close: 11 },
      { time: '2026-01-01', open: 9, high: 11, low: 8, close: 10, volume: 5 },
    ]
    const bars = ohlcBars(rows)
    expect(bars?.map((bar) => bar.c)).toEqual([10, 11])
    expect(bars?.[0].T).toBe(bars?.[1].t)
    expect(ohlcBars([...rows, { time: '2026-01-03', open: 10, high: 9, low: 8, close: 10 }])).toBeNull()
    expect(ohlcBars([{ value: 1 }, { value: 2 }])).toBeNull()
  })
})

describe('bar revisions (FUI-06)', () => {
  const bar = (t: number, c: number): (typeof CHART.bars)[number] => ({
    t,
    T: t + 60,
    o: c,
    h: c + 1,
    l: c - 1,
    c,
    v: 1,
    final: true,
  })

  // spec: FUI-06
  it('replaces a bar by open time with its later revision and leaves a gap unfilled', () => {
    const original = bar(100, 10)
    const revised = bar(100, 20)
    const nextBar = bar(220, 30)
    const merged = mergeBarRevisions([original, revised, nextBar])
    expect(merged.map((candle) => candle.c)).toEqual([20, 30])
    expect(merged.some((candle) => candle.t > 100 && candle.t < 220)).toBe(false)
  })
})
