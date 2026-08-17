import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricCards, type MetricCardValue } from '@/components/renderers/MetricCards'

describe('MetricCards', () => {
  it('renders a real numeric value with its unit', () => {
    render(
      <MetricCards
        metrics={[{ id: 'latency', label: 'Latency', value: 42, unit: 'ms' }]}
        observedAt="2026-08-16T12:00:00.000Z"
      />,
    )
    expect(screen.getByText('42 ms')).toBeInTheDocument()
  })

  it('KNOWN-BAD PROOF: a null value renders as -- , never fabricated as 0', () => {
    render(
      <MetricCards metrics={[{ id: 'errors', label: 'Errors', value: null }]} observedAt="2026-08-16T12:00:00.000Z" />,
    )
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('an undefined value also renders as --, never 0', () => {
    render(<MetricCards metrics={[{ id: 'x', label: 'X', value: undefined }]} observedAt={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('a real 0 value is still rendered as 0 (distinct from missing)', () => {
    render(<MetricCards metrics={[{ id: 'queue', label: 'Queue depth', value: 0 }]} observedAt={null} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('shows "freshness unknown" when observedAt is null, never claims fresh', () => {
    render(<MetricCards metrics={[{ id: 'a', label: 'A', value: 1 }]} observedAt={null} />)
    expect(screen.getByText(/freshness unknown/i)).toBeInTheDocument()
    expect(screen.queryByText(/stale/i)).not.toBeInTheDocument()
  })

  it('shows a stale badge when observedAt exceeds staleAfterSeconds relative to `now`', () => {
    const observedAt = '2026-08-16T12:00:00.000Z'
    const now = Date.parse(observedAt) + 120_000 // 2 minutes later
    render(
      <MetricCards
        metrics={[{ id: 'a', label: 'A', value: 1 }]}
        observedAt={observedAt}
        staleAfterSeconds={60}
        now={now}
      />,
    )
    expect(screen.getByText(/stale/i)).toBeInTheDocument()
  })

  it('does not show a stale badge when observedAt is within staleAfterSeconds', () => {
    const observedAt = '2026-08-16T12:00:00.000Z'
    const now = Date.parse(observedAt) + 5_000
    render(
      <MetricCards
        metrics={[{ id: 'a', label: 'A', value: 1 }]}
        observedAt={observedAt}
        staleAfterSeconds={60}
        now={now}
      />,
    )
    expect(screen.queryByText(/stale/i)).not.toBeInTheDocument()
  })

  it('renders "No metrics reported" for an empty array, not a blank grid', () => {
    render(<MetricCards metrics={[]} observedAt={null} />)
    expect(screen.getByText(/no metrics reported/i)).toBeInTheDocument()
  })

  it('ADVERSARIAL/HUGE: bounds rendering to 50 cards and reports the remainder count', () => {
    const many: MetricCardValue[] = Array.from({ length: 90 }, (_, i) => ({
      id: `m${i}`,
      label: `Metric ${i}`,
      value: i,
    }))
    render(<MetricCards metrics={many} observedAt={null} />)
    expect(screen.getAllByTestId(/^metric-card-/)).toHaveLength(50)
    expect(screen.getByText(/40 more metric/i)).toBeInTheDocument()
  })

  it('ADVERSARIAL: a hostile label string is rendered as text, never interpreted as HTML', () => {
    render(
      <MetricCards
        metrics={[{ id: 'x', label: '<img src=x onerror=alert(1)>evil label', value: 1 }]}
        observedAt={null}
      />,
    )
    expect(screen.getByText(/evil label/)).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('an invalid observedAt string is treated as no observation, never a bogus date', () => {
    render(<MetricCards metrics={[{ id: 'a', label: 'A', value: 1 }]} observedAt="not-a-real-date" />)
    expect(screen.getByText(/freshness unknown/i)).toBeInTheDocument()
  })
})
