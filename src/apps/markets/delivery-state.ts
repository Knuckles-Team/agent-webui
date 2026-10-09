/**
 * @file delivery-state.ts
 * @description Typed DCA/alert delivery-state contract (FUI-10.1). Due,
 * missed, failed, replayed, paper-filled, and delivered are distinct
 * outcomes that must never collapse into one another; a paper fill is
 * never shown as a live fill, and a duplicated event ID or a channel retry
 * must not produce two visible receipts for the same event. Wiring into a
 * DCA/alert list component is FUI-10.2.
 */

export const DELIVERY_STATES = ['due', 'missed', 'failed', 'replayed', 'paper_filled', 'delivered'] as const
export type DeliveryState = (typeof DELIVERY_STATES)[number]

export interface DeliveryReceipt {
  event_id: string
  state: DeliveryState
  observed_at: string
}

/** The latest-observed receipt wins for a duplicated event ID or a retried channel delivery. */
export function dedupeByEventId(receipts: readonly DeliveryReceipt[]): DeliveryReceipt[] {
  const latest = new Map<string, DeliveryReceipt>()
  for (const receipt of receipts) {
    const existing = latest.get(receipt.event_id)
    if (!existing || receipt.observed_at >= existing.observed_at) latest.set(receipt.event_id, receipt)
  }
  return [...latest.values()]
}

/** A paper fill is never a live fill; only `delivered` counts as one. */
export function isLiveFill(state: DeliveryState): boolean {
  return state === 'delivered'
}
