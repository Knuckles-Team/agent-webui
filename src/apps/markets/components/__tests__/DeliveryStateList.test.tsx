import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeliveryStateList } from '../DeliveryStateList'
import type { DeliveryReceipt } from '../../delivery-state'

const ALL_STATES: DeliveryReceipt[] = [
  { event_id: 'evt-due', state: 'due', observed_at: '2026-10-09T00:00:00Z' },
  { event_id: 'evt-missed', state: 'missed', observed_at: '2026-10-09T00:00:00Z' },
  { event_id: 'evt-failed', state: 'failed', observed_at: '2026-10-09T00:00:00Z' },
  { event_id: 'evt-replayed', state: 'replayed', observed_at: '2026-10-09T00:00:00Z' },
  { event_id: 'evt-paper', state: 'paper_filled', observed_at: '2026-10-09T00:00:00Z' },
  { event_id: 'evt-delivered', state: 'delivered', observed_at: '2026-10-09T00:00:00Z' },
]

describe('DeliveryStateList (FUI-10.2)', () => {
  // spec: FUI-10.2
  it('renders due, missed, failed, replayed, paper-filled, and delivered as visibly distinct outcomes', () => {
    render(<DeliveryStateList receipts={ALL_STATES} />)
    const rows = screen.getAllByTestId('delivery-state-row')
    expect(rows).toHaveLength(6)
    const statesSeen = rows.map((row) => row.getAttribute('data-state'))
    expect(new Set(statesSeen).size).toBe(6)
  })

  // spec: FUI-10.2
  it('never shows a paper fill with the live-fill marker, only the delivered state gets it', () => {
    render(<DeliveryStateList receipts={ALL_STATES} />)
    const rows = screen.getAllByTestId('delivery-state-row')
    const paper = rows.find((row) => row.getAttribute('data-state') === 'paper_filled')!
    const delivered = rows.find((row) => row.getAttribute('data-state') === 'delivered')!
    expect(paper.querySelector('[data-testid="delivery-state-live-badge"]')).toBeNull()
    expect(delivered.querySelector('[data-testid="delivery-state-live-badge"]')).not.toBeNull()
  })

  // spec: FUI-10.2
  it('collapses a duplicated event ID and a channel retry to a single distinct row', () => {
    const receipts: DeliveryReceipt[] = [
      { event_id: 'evt-dup', state: 'due', observed_at: '2026-10-09T00:00:00Z' },
      { event_id: 'evt-dup', state: 'delivered', observed_at: '2026-10-09T00:01:00Z' },
      { event_id: 'evt-retry', state: 'failed', observed_at: '2026-10-09T00:00:00Z' },
      { event_id: 'evt-retry', state: 'replayed', observed_at: '2026-10-09T00:00:30Z' },
      { event_id: 'evt-retry', state: 'delivered', observed_at: '2026-10-09T00:01:00Z' },
    ]
    render(<DeliveryStateList receipts={receipts} />)
    expect(screen.getAllByTestId('delivery-state-row')).toHaveLength(2)
    expect(screen.getAllByTestId('delivery-state-live-badge')).toHaveLength(2)
  })
})
