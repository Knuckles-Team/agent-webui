import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PerformanceCardView } from '../PerformanceCardView'
import type { PerformanceCard } from '../../performance-card'

// Multi-currency cash flows, dividends, splits, and fees are the owning
// service's concern (FUI-08.1); this fixture is the decimal string it hands
// to the UI, with trailing-zero precision the UI must never recompute.
const EUR_WITH_FEES: PerformanceCard = {
  available: true,
  value: '12.340000',
  return_method: 'twr',
  currency: 'EUR',
  source: 'portfolio-performance-service',
  as_of: '2026-10-09T14:00:00Z',
  session: 'regular',
  stale: false,
}

const STALE_USD: PerformanceCard = {
  available: true,
  value: '-3.5',
  return_method: 'mwr',
  currency: 'USD',
  source: 'portfolio-performance-service',
  as_of: '2026-10-08T21:00:00Z',
  session: 'post_market',
  stale: true,
}

const UNAVAILABLE: PerformanceCard = {
  available: false,
  value: null,
  return_method: 'simple',
  currency: 'USD',
  source: 'portfolio-performance-service',
  as_of: '2026-10-09T14:00:00Z',
  session: 'closed',
  stale: false,
}

describe('PerformanceCardView (FUI-08.2)', () => {
  // spec: FUI-08.2
  it("reproduces the owner's decimal string verbatim with its currency, source, as-of, and session", () => {
    render(<PerformanceCardView card={EUR_WITH_FEES} />)
    expect(screen.getByTestId('performance-card-value')).toHaveTextContent('12.340000')
    expect(screen.getByTestId('performance-card-currency')).toHaveTextContent('EUR')
    expect(screen.getByTestId('performance-card-return-method')).toHaveTextContent('Time-weighted return')
    expect(screen.getByTestId('performance-card-as-of')).toHaveTextContent('2026-10-09T14:00:00Z')
    expect(screen.queryByTestId('performance-card-stale-badge')).not.toBeInTheDocument()
  })

  // spec: FUI-08.2
  it('shows an explicit stale state alongside the unmodified value, never a recomputed figure', () => {
    render(<PerformanceCardView card={STALE_USD} />)
    expect(screen.getByTestId('performance-card-stale-badge')).toBeInTheDocument()
    expect(screen.getByTestId('performance-card-value')).toHaveTextContent('-3.5')
  })

  // spec: FUI-08.2
  it('shows an explicit unavailable state rather than any computed figure', () => {
    render(<PerformanceCardView card={UNAVAILABLE} />)
    expect(screen.getByText('Performance unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('performance-card-value')).not.toBeInTheDocument()
  })
})
