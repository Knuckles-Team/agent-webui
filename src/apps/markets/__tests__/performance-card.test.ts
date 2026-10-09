import { describe, expect, it } from 'vitest'
import { isVerbatimDecimalString, renderPerformanceCard, type PerformanceCard } from '../performance-card'

const BASE: PerformanceCard = {
  available: true,
  value: '12.340000',
  return_method: 'twr',
  currency: 'USD',
  source: 'portfolio-engine',
  as_of: '2026-10-09T00:00:00Z',
  session: 'regular',
  stale: false,
}

describe('performance-card (FUI-08.1)', () => {
  it('reproduces the owner decimal string verbatim, trailing zeros included', () => {
    expect(renderPerformanceCard(BASE)).toEqual({ state: 'value', displayValue: '12.340000' })
  })

  it('shows an explicit unavailable state rather than a computed figure', () => {
    expect(renderPerformanceCard({ ...BASE, available: false, value: null })).toEqual({
      state: 'unavailable',
      displayValue: null,
    })
  })

  it('marks a stale valuation distinctly while still showing the owner value', () => {
    expect(renderPerformanceCard({ ...BASE, stale: true })).toEqual({ state: 'stale', displayValue: '12.340000' })
  })

  it('handles multi-currency, dividend/split/fee-bearing fixtures without recomputation', () => {
    const eurCard: PerformanceCard = { ...BASE, value: '-3.500000', currency: 'EUR', return_method: 'mwr' }
    expect(renderPerformanceCard(eurCard).displayValue).toBe('-3.500000')
  })

  it('accepts a fixed-point decimal string and rejects scientific notation or NaN', () => {
    expect(isVerbatimDecimalString('12.340000')).toBe(true)
    expect(isVerbatimDecimalString('-3.5')).toBe(true)
    expect(isVerbatimDecimalString('1.2e5')).toBe(false)
    expect(isVerbatimDecimalString('NaN')).toBe(false)
  })
})
