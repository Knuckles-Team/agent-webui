import { describe, expect, it } from 'vitest'
import { supportedChartMode, supportedDetailTabs, type SeriesCapabilities } from '../detail-support'

const STOCK: SeriesCapabilities = {
  dataTypes: ['line', 'candle'],
  supportedTimeframes: ['1D', '1W'],
  hasVolume: true,
  hasRates: false,
  hasDividends: true,
}

const CRYPTO: SeriesCapabilities = {
  dataTypes: ['candle'],
  supportedTimeframes: ['1h', '4h', '1D'],
  hasVolume: true,
  hasRates: false,
  hasDividends: false,
}

describe('detail-support (FIN-UI-R001.1, FUI-05.1)', () => {
  it('offers Dividends for a dividend-paying instrument and withholds Rates when unsupported', () => {
    const result = supportedDetailTabs(STOCK)
    expect(result.tabs).toContain('dividends')
    expect(result.tabs).not.toContain('rates')
    expect(result.tabs).toEqual(['chart', 'news', 'notes', 'dividends', 'analysis'])
  })

  it('withholds Dividends for an instrument that never pays one', () => {
    expect(supportedDetailTabs(CRYPTO).tabs).not.toContain('dividends')
  })

  it('allows a supported interval/data-type/volume combination', () => {
    expect(supportedChartMode(STOCK, { timeframe: '1D', dataType: 'candle', showVolume: true })).toEqual({
      allowed: true,
    })
  })

  it('explains an unsupported data type instead of silently rendering it', () => {
    const decision = supportedChartMode(CRYPTO, { timeframe: '1D', dataType: 'line', showVolume: false })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/line data is not available/)
  })

  it('explains an unsupported interval', () => {
    const decision = supportedChartMode(STOCK, { timeframe: '4h', dataType: 'line', showVolume: false })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/not a supported interval/)
  })

  it('explains volume requested where none is available', () => {
    const noVolume: SeriesCapabilities = { ...STOCK, hasVolume: false }
    const decision = supportedChartMode(noVolume, { timeframe: '1D', dataType: 'candle', showVolume: true })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/volume is not available/)
  })
})
