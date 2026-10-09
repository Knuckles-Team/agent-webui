/**
 * @file overlay-strategy.ts
 * @description Typed chart overlay markers (FUI-07.1): trend lines/flips,
 * DCA buys, cost basis, and margin/liquidation levels each carry the
 * strategy version that produced them and whether they reflect a simulated
 * result, so the UI never shows a live and a simulated marker the same way.
 * Wiring these into ChartPanel/OhlcChart rendering is FUI-07.2.
 */

export type OverlayKind = 'trend_line' | 'flip' | 'dca_buy' | 'cost_basis' | 'margin_liquidation'

export interface ChartOverlay {
  kind: OverlayKind
  at: number
  bar_open_time: number
  strategy_version: string
  simulated: boolean
}

/** A short, unambiguous label: the overlay kind plus its version and simulation state. */
export function overlayLabel(overlay: ChartOverlay): string {
  const simTag = overlay.simulated ? ' (simulated)' : ''
  return `${overlay.kind} v${overlay.strategy_version}${simTag}`
}

/** Markers at the given bar open time, so each stays aligned to the bar it describes. */
export function overlaysAtBar(overlays: readonly ChartOverlay[], barOpenTime: number): ChartOverlay[] {
  return overlays.filter((overlay) => overlay.bar_open_time === barOpenTime)
}

/** True only when every overlay in the set declares a version; an unversioned overlay is a defect. */
export function allOverlaysVersioned(overlays: readonly ChartOverlay[]): boolean {
  return overlays.every((overlay) => overlay.strategy_version.length > 0)
}
