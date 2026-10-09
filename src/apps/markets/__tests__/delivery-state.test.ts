import { describe, expect, it } from 'vitest'
import { dedupeByEventId, isLiveFill, type DeliveryReceipt } from '../delivery-state'

describe('delivery-state (FUI-10.1)', () => {
  // spec: FUI-07.1, FUI-08.1, FUI-09.1, FUI-10.1
  it('keeps every distinct delivery state distinct', () => {
    expect(isLiveFill('delivered')).toBe(true)
    expect(isLiveFill('paper_filled')).toBe(false)
    expect(isLiveFill('due')).toBe(false)
    expect(isLiveFill('missed')).toBe(false)
    expect(isLiveFill('failed')).toBe(false)
    expect(isLiveFill('replayed')).toBe(false)
  })

  // spec: FUI-07.1, FUI-08.1, FUI-09.1, FUI-10.1
  it('collapses a duplicated event ID to its latest-observed receipt', () => {
    const receipts: DeliveryReceipt[] = [
      { event_id: 'evt-1', state: 'due', observed_at: '2026-10-09T00:00:00Z' },
      { event_id: 'evt-1', state: 'delivered', observed_at: '2026-10-09T00:01:00Z' },
    ]
    expect(dedupeByEventId(receipts)).toEqual([
      { event_id: 'evt-1', state: 'delivered', observed_at: '2026-10-09T00:01:00Z' },
    ])
  })

  // spec: FUI-07.1, FUI-08.1, FUI-09.1, FUI-10.1
  it('resolves a channel retry to one receipt rather than two', () => {
    const receipts: DeliveryReceipt[] = [
      { event_id: 'evt-2', state: 'failed', observed_at: '2026-10-09T00:00:00Z' },
      { event_id: 'evt-2', state: 'replayed', observed_at: '2026-10-09T00:00:30Z' },
      { event_id: 'evt-2', state: 'delivered', observed_at: '2026-10-09T00:01:00Z' },
    ]
    const result = dedupeByEventId(receipts)
    expect(result).toHaveLength(1)
    expect(result[0].state).toBe('delivered')
  })

  it('never reports a paper fill as a live fill after dedup', () => {
    const receipts: DeliveryReceipt[] = [
      { event_id: 'evt-3', state: 'paper_filled', observed_at: '2026-10-09T00:00:00Z' },
    ]
    const [receipt] = dedupeByEventId(receipts)
    expect(isLiveFill(receipt.state)).toBe(false)
  })
})
