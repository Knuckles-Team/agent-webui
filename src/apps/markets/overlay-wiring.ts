/**
 * @file overlay-wiring.ts
 * @description Live chart overlay wiring (FUI-07.2): wires the versioned,
 * simulation-flagged overlay marker type (FUI-07.1, {@link ChartOverlay}) into
 * chart rendering by resolving each overlay onto the bar it must be drawn
 * beside — in both the full-resolution series and a decimated one — so a
 * decimated view never drops, re-labels, or re-versions a marker.
 */
import type { ChartOverlay } from './overlay-strategy'

export interface AlignedOverlay {
  overlay: ChartOverlay
  /** Open time of the bar the overlay is drawn against in this view. */
  barOpenTime: number
}

/**
 * Resolves each overlay onto the bar closest to its own `bar_open_time` that
 * is actually present in `barOpenTimes` (the full or decimated series). An
 * overlay whose exact bar was decimated away still renders, pinned to the
 * nearest surviving bar, with its version and simulation flag untouched.
 */
export function alignOverlaysToBars(
  overlays: readonly ChartOverlay[],
  barOpenTimes: readonly number[],
): AlignedOverlay[] {
  if (barOpenTimes.length === 0) return []
  return overlays.map((overlay) => {
    let best = barOpenTimes[0]
    let bestDelta = Math.abs(overlay.bar_open_time - best)
    for (const t of barOpenTimes) {
      const delta = Math.abs(overlay.bar_open_time - t)
      if (delta < bestDelta) {
        best = t
        bestDelta = delta
      }
    }
    return { overlay, barOpenTime: best }
  })
}

/**
 * True when aligning the same overlays against the full-resolution and the
 * decimated bar series never changes an overlay's kind, version, or
 * simulation flag — only (at most) which bar it is pinned to.
 */
export function decimationPreservesOverlayIdentity(
  overlays: readonly ChartOverlay[],
  fullBarOpenTimes: readonly number[],
  decimatedBarOpenTimes: readonly number[],
): boolean {
  const full = alignOverlaysToBars(overlays, fullBarOpenTimes)
  const decimated = alignOverlaysToBars(overlays, decimatedBarOpenTimes)
  if (full.length !== decimated.length) return false
  return full.every((f, i) => {
    const d = decimated[i]
    return (
      f.overlay.kind === d.overlay.kind &&
      f.overlay.strategy_version === d.overlay.strategy_version &&
      f.overlay.simulated === d.overlay.simulated &&
      decimatedBarOpenTimes.includes(d.barOpenTime)
    )
  })
}
