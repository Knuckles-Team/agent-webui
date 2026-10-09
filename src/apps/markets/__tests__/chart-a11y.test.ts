import { describe, expect, it } from 'vitest'
import { allowsAnimation, chartSummaryText, directionWord } from '../chart-a11y'
import { CHART } from './fixtures'

describe('chart-a11y (FUI-13.1)', () => {
  // spec: FUI-11.1, FUI-12.1, FUI-13.1
  it('summarizes a bar series in text a screen reader can announce', () => {
    const summary = chartSummaryText(CHART.bars, 'bullish')
    expect(summary.label).toMatch(/bars, trend rising, last close/)
    expect(summary.barCount).toBe(CHART.bars.length)
  })

  // spec: FUI-11.1, FUI-12.1, FUI-13.1
  it('reports no-data without a chart present', () => {
    expect(chartSummaryText([], null).label).toBe('No chart data available')
  })

  // spec: FUI-11.1, FUI-12.1, FUI-13.1
  it('conveys direction with a non-color word', () => {
    expect(directionWord('bullish')).toBe('up')
    expect(directionWord('bearish')).toBe('down')
    expect(directionWord(null)).toBe('flat')
  })

  it('disables animation when the viewer prefers reduced motion', () => {
    expect(allowsAnimation('reduce')).toBe(false)
    expect(allowsAnimation('no-preference')).toBe(true)
  })
})
