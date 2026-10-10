import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChartA11ySummary } from '../ChartA11ySummary'
import { CHART } from '../../__tests__/fixtures'

describe('ChartA11ySummary (FUI-13.2)', () => {
  // spec: FUI-13.2
  it('exposes a screen-reader text summary independent of the visual chart', () => {
    render(<ChartA11ySummary bars={CHART.bars} trendDirection="bullish" motionPreference="no-preference" />)
    expect(screen.getByTestId('chart-a11y-text')).toHaveTextContent(/bars, trend rising, last close/)
  })

  // spec: FUI-13.2
  it('is keyboard-focusable and carries the summary as its accessible label', () => {
    render(<ChartA11ySummary bars={CHART.bars} trendDirection="bullish" motionPreference="no-preference" />)
    const group = screen.getByTestId('chart-a11y-summary')
    expect(group).toHaveAttribute('tabindex', '0')
    expect(group.getAttribute('aria-label')).toMatch(/bars, trend rising, last close/)
  })

  // spec: FUI-13.2
  it('conveys direction with a non-color word for bullish, bearish, and flat', () => {
    const { rerender } = render(
      <ChartA11ySummary bars={CHART.bars} trendDirection="bullish" motionPreference="no-preference" />,
    )
    expect(screen.getByTestId('chart-a11y-direction')).toHaveTextContent('up')
    rerender(<ChartA11ySummary bars={CHART.bars} trendDirection="bearish" motionPreference="no-preference" />)
    expect(screen.getByTestId('chart-a11y-direction')).toHaveTextContent('down')
    rerender(<ChartA11ySummary bars={CHART.bars} trendDirection={null} motionPreference="no-preference" />)
    expect(screen.getByTestId('chart-a11y-direction')).toHaveTextContent('flat')
  })

  // spec: FUI-13.2
  it('never animates when the viewer prefers reduced motion', () => {
    render(<ChartA11ySummary bars={CHART.bars} trendDirection="bullish" motionPreference="reduce" />)
    const group = screen.getByTestId('chart-a11y-summary')
    expect(group).toHaveAttribute('data-motion', 'reduce')
    expect(group.className).not.toMatch(/transition-colors/)
  })
})
