import { describe, expect, it } from 'vitest'
import { alignOverlaysToBars, decimationPreservesOverlayIdentity } from '../overlay-wiring'
import type { ChartOverlay } from '../overlay-strategy'

const FULL_BARS = [100, 200, 300, 400, 500, 600, 700, 800]
const DECIMATED_BARS = [100, 400, 800]

const TREND_FLIP: ChartOverlay = { kind: 'flip', at: 300, bar_open_time: 300, strategy_version: '4', simulated: false }
const DCA_BUY: ChartOverlay = { kind: 'dca_buy', at: 200, bar_open_time: 200, strategy_version: '4', simulated: false }
const COST_BASIS: ChartOverlay = {
  kind: 'cost_basis',
  at: 500,
  bar_open_time: 500,
  strategy_version: '4',
  simulated: false,
}
const MARGIN_SIM: ChartOverlay = {
  kind: 'margin_liquidation',
  at: 700,
  bar_open_time: 700,
  strategy_version: '2',
  simulated: true,
}
const FIXTURE = [TREND_FLIP, DCA_BUY, COST_BASIS, MARGIN_SIM]

describe('overlay-wiring (FUI-07.2)', () => {
  // spec: FUI-07.2
  it('aligns markers to the correct bars and versions in both full-resolution and decimated views', () => {
    const full = alignOverlaysToBars(FIXTURE, FULL_BARS)
    expect(full).toEqual([
      { overlay: TREND_FLIP, barOpenTime: 300 },
      { overlay: DCA_BUY, barOpenTime: 200 },
      { overlay: COST_BASIS, barOpenTime: 500 },
      { overlay: MARGIN_SIM, barOpenTime: 700 },
    ])

    const decimated = alignOverlaysToBars(FIXTURE, DECIMATED_BARS)
    // Each overlay pins to its nearest surviving bar, keeping kind/version/simulated intact.
    expect(decimated).toEqual([
      { overlay: TREND_FLIP, barOpenTime: 400 },
      { overlay: DCA_BUY, barOpenTime: 100 },
      { overlay: COST_BASIS, barOpenTime: 400 },
      { overlay: MARGIN_SIM, barOpenTime: 800 },
    ])
  })

  // spec: FUI-07.2
  it('never changes an overlay kind, version, or simulation flag when the view is decimated', () => {
    expect(decimationPreservesOverlayIdentity(FIXTURE, FULL_BARS, DECIMATED_BARS)).toBe(true)
  })
})
