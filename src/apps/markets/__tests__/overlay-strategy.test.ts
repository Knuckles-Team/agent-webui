import { describe, expect, it } from 'vitest'
import { allOverlaysVersioned, overlayLabel, overlaysAtBar, type ChartOverlay } from '../overlay-strategy'

const TREND: ChartOverlay = {
  kind: 'trend_line',
  at: 100,
  bar_open_time: 100,
  strategy_version: '3',
  simulated: false,
}
const DCA: ChartOverlay = { kind: 'dca_buy', at: 100, bar_open_time: 100, strategy_version: '1', simulated: false }
const MARGIN_SIM: ChartOverlay = {
  kind: 'margin_liquidation',
  at: 200,
  bar_open_time: 200,
  strategy_version: '2',
  simulated: true,
}

describe('overlay-strategy (FUI-07.1)', () => {
  it('labels an overlay with its strategy version', () => {
    expect(overlayLabel(TREND)).toBe('trend_line v3')
  })

  it('tags a simulated overlay distinctly from a live one', () => {
    expect(overlayLabel(MARGIN_SIM)).toBe('margin_liquidation v2 (simulated)')
    expect(overlayLabel(TREND)).not.toMatch(/simulated/)
  })

  it('aligns trend, DCA, cost-basis, and margin markers to the bar they describe', () => {
    expect(overlaysAtBar([TREND, DCA, MARGIN_SIM], 100)).toEqual([TREND, DCA])
    expect(overlaysAtBar([TREND, DCA, MARGIN_SIM], 200)).toEqual([MARGIN_SIM])
  })

  it('flags a defective unversioned overlay', () => {
    expect(allOverlaysVersioned([TREND, DCA])).toBe(true)
    expect(allOverlaysVersioned([{ ...TREND, strategy_version: '' }])).toBe(false)
  })
})
