/**
 * @file chart-geometry.ts
 * @description Pure layout for the OHLC chart: index-based x (market gaps do
 * not leave holes, as on a trading chart), linear y per pane, nice ticks, and
 * trailing-line segments split at every direction change. Geometry only.
 */
import type { OhlcBar, TrailPoint } from '../schemas'

export interface Band {
  top: number
  height: number
}

/** Horizontal placement of `count` slots across `width` pixels. */
export interface XAxis {
  count: number
  width: number
}

export function slotWidth(axis: XAxis): number {
  return axis.count > 0 ? axis.width / axis.count : axis.width
}

export function xAtIndex(axis: XAxis, index: number): number {
  return (index + 0.5) * slotWidth(axis)
}

/** The bar containing time `t` (epoch ms), with the fraction of its span. */
export function barPosition(bars: readonly OhlcBar[], t: number): number | null {
  let low = 0
  let high = bars.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const bar = bars[mid]
    if (t < bar.t) high = mid - 1
    else if (t >= bar.T) low = mid + 1
    else return mid + (bar.T > bar.t ? (t - bar.t) / (bar.T - bar.t) : 0)
  }
  return null
}

export function xAtTime(axis: XAxis, bars: readonly OhlcBar[], t: number): number | null {
  const position = barPosition(bars, t)
  return position === null ? null : position * slotWidth(axis) + slotWidth(axis) * 0.5
}

export function nearestIndex(axis: XAxis, x: number): number {
  if (axis.count === 0) return -1
  return Math.max(0, Math.min(axis.count - 1, Math.floor(x / slotWidth(axis))))
}

export type Domain = readonly [number, number]

export function domainOf(values: readonly number[], padRatio = 0.05): Domain {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return [0, 1]
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const pad = max > min ? (max - min) * padRatio : Math.abs(max) * 0.01 || 1
  return [min - pad, max + pad]
}

export function yScale(domain: Domain, band: Band): (value: number) => number {
  const [min, max] = domain
  const span = max - min || 1
  return (value: number) => band.top + band.height - ((value - min) / span) * band.height
}

/** About `count` round tick values inside `domain`. */
export function niceTicks(domain: Domain, count = 5): number[] {
  const [min, max] = domain
  const raw = (max - min) / Math.max(1, count)
  if (!(raw > 0) || !Number.isFinite(raw)) return [min]
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw) ?? power * 10
  const ticks: number[] = []
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) ticks.push(value)
  return ticks
}

export interface TrailSegment {
  direction: TrailPoint['direction']
  points: [number, number][]
}

/** Trailing-line polylines, one per run of equal direction. A run ends where
 * the direction changes, so a flip never draws a sloped connector. */
export function trailSegments(
  trail: readonly TrailPoint[],
  x: (t: number) => number | null,
  y: (value: number) => number,
): TrailSegment[] {
  const segments: TrailSegment[] = []
  for (const point of trail) {
    const px = x(point.t)
    if (px === null) continue
    const last = segments.at(-1)
    if (last?.direction === point.direction) last.points.push([px, y(point.value)])
    else segments.push({ direction: point.direction, points: [[px, y(point.value)]] })
  }
  return segments
}

export function polyline(points: readonly [number, number][]): string {
  return points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
}
