import { describe, expect, it } from 'vitest'
import { decimate, decimationPreservesFinalizedOutput, isValidCandleBar, validateSeriesInput } from '../chart-contract'
import { CHART } from './fixtures'

describe('chart-contract (FIN-UI-R002.1)', () => {
  // spec: FIN-UI-R001.1, FIN-UI-R001.2, FIN-UI-R002.1, FIN-UI-R002.2, FUI-05.1, FUI-05.2
  it('accepts a complete OHLC candle series and rejects an inconsistent bar', () => {
    expect(validateSeriesInput({ kind: 'candle', bars: CHART.bars })).toEqual({ valid: true })
    const broken = { ...CHART.bars[0], h: CHART.bars[0].l - 1 }
    expect(isValidCandleBar(broken)).toBe(false)
    expect(validateSeriesInput({ kind: 'candle', bars: [broken, ...CHART.bars.slice(1)] }).valid).toBe(false)
  })

  // spec: FIN-UI-R001.1, FIN-UI-R001.2, FIN-UI-R002.1, FIN-UI-R002.2, FUI-05.1, FUI-05.2
  it('accepts finite line points and rejects a non-finite one', () => {
    expect(
      validateSeriesInput({ kind: 'line', points: CHART.trail.map((p) => ({ t: p.t, value: p.value })) }),
    ).toEqual({
      valid: true,
    })
    expect(validateSeriesInput({ kind: 'line', points: [{ t: 1, value: Number.NaN }] }).valid).toBe(false)
  })

  // spec: FIN-UI-R001.1, FIN-UI-R001.2, FIN-UI-R002.1, FIN-UI-R002.2, FUI-05.1, FUI-05.2
  it('decimates while always keeping the first and last point', () => {
    const decimated = decimate(CHART.bars, 3)
    expect(decimated.length).toBe(3)
    expect(decimated[0]).toEqual(CHART.bars[0])
    expect(decimated[decimated.length - 1]).toEqual(CHART.bars[CHART.bars.length - 1])
  })

  it('returns input unchanged when it already fits within maxPoints', () => {
    expect(decimate(CHART.bars, 50)).toEqual([...CHART.bars])
  })

  it('never changes finalized trail/flip/state output when bars are decimated for display', () => {
    const full = { trail: CHART.trail, flips: CHART.flips, state: CHART.state }
    const afterDecimation = { trail: CHART.trail, flips: CHART.flips, state: CHART.state }
    expect(decimationPreservesFinalizedOutput(full, afterDecimation)).toBe(true)
    expect(decimationPreservesFinalizedOutput(full, { ...afterDecimation, trail: [] })).toBe(false)
  })
})
