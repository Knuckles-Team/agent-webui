/**
 * @file chart-contract.ts
 * @description Typed contract for the shared ChartRenderer (FIN-UI-R002.1):
 * a series is either a scalar line or a complete OHLC candle series, never a
 * mix, and overlay points carry the strategy version and simulation flag
 * that produced them (FUI-07.1). Decimating a series for display must never
 * alter the already-finalized state/trail/flip output it is drawn beside;
 * that invariant is checked here as a pure comparison, not inside a
 * component. Live wiring of a ChartRenderer prop to this contract is
 * FIN-UI-R002.2.
 */
import type { LinePoint, OhlcBar, SignalStateView, TrailPoint, FlipMarker } from './schemas'

export type OverlayKind = 'trend_line' | 'flip' | 'dca_buy' | 'cost_basis' | 'margin_liquidation'

/** Any chart overlay marker, tagged with the strategy version that produced it. */
export interface VersionedOverlay {
  kind: OverlayKind
  strategy_version: string
  simulated: boolean
  at: number
}

export type ChartSeriesInput =
  { kind: 'line'; points: readonly LinePoint[] } | { kind: 'candle'; bars: readonly OhlcBar[] }

/** A candle bar is valid only when low <= min(open, close) and high >= max(open, close). */
export function isValidCandleBar(bar: OhlcBar): boolean {
  return bar.l <= Math.min(bar.o, bar.c) && bar.h >= Math.max(bar.o, bar.c) && Number.isFinite(bar.t)
}

/** Reject a series mixing valid and invalid candles, or any non-finite line point. */
export function validateSeriesInput(input: ChartSeriesInput): { valid: boolean; reason?: string } {
  if (input.kind === 'candle') {
    if (input.bars.length === 0) return { valid: false, reason: 'empty candle series' }
    const bad = input.bars.find((bar) => !isValidCandleBar(bar))
    return bad ? { valid: false, reason: `invalid OHLC bar at t=${bad.t}` } : { valid: true }
  }
  const bad = input.points.find((point) => !Number.isFinite(point.value) || !Number.isFinite(point.t))
  return bad ? { valid: false, reason: `non-finite point at t=${bad.t}` } : { valid: true }
}

/** Evenly sampled decimation that always keeps the first and last point. */
export function decimate<T>(points: readonly T[], maxPoints: number): T[] {
  if (maxPoints <= 0) return []
  if (points.length <= maxPoints) return [...points]
  if (maxPoints === 1) return [points[0]]
  const step = (points.length - 1) / (maxPoints - 1)
  const out: T[] = []
  for (let i = 0; i < maxPoints; i++) out.push(points[Math.round(i * step)])
  return out
}

/** The finalized output a ChartRenderer must not recompute: trail, flips, and signal state. */
export interface FinalizedOutput {
  trail: readonly TrailPoint[]
  flips: readonly FlipMarker[]
  state: SignalStateView
}

/** Decimating the bar series for display never changes finalized indicator output. */
export function decimationPreservesFinalizedOutput(full: FinalizedOutput, afterDecimation: FinalizedOutput): boolean {
  return (
    JSON.stringify(full.trail) === JSON.stringify(afterDecimation.trail) &&
    JSON.stringify(full.flips) === JSON.stringify(afterDecimation.flips) &&
    JSON.stringify(full.state) === JSON.stringify(afterDecimation.state)
  )
}
