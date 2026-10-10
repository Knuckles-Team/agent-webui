/**
 * @file DeliveryStateList.tsx
 * @description Live DCA/alert delivery-state wiring (FUI-10.2): renders the
 * delivery-receipt dedupe contract (FUI-10.1, {@link dedupeByEventId}) as a
 * list, so due, missed, failed, replayed, paper-filled, and delivered each
 * render as a visibly distinct outcome. A duplicated event ID or a channel
 * retry collapses to one receipt before rendering, and a paper fill is
 * never labeled as a live (delivered) fill.
 */
import { dedupeByEventId, isLiveFill } from '../delivery-state'
import type { DeliveryReceipt, DeliveryState } from '../delivery-state'

const STATE_LABEL: Record<DeliveryState, string> = {
  due: 'Due',
  missed: 'Missed',
  failed: 'Failed',
  replayed: 'Replayed',
  paper_filled: 'Paper-filled (simulated)',
  delivered: 'Delivered (live)',
}

export function DeliveryStateList({ receipts }: { receipts: readonly DeliveryReceipt[] }) {
  const deduped = dedupeByEventId(receipts)

  return (
    <ul data-testid="delivery-state-list">
      {deduped.map((receipt) => (
        <li key={receipt.event_id} data-testid="delivery-state-row" data-state={receipt.state}>
          <span data-testid="delivery-state-label">{STATE_LABEL[receipt.state]}</span>
          {/* A paper fill must never render with the live-fill marker. */}
          {isLiveFill(receipt.state) && <span data-testid="delivery-state-live-badge">Live</span>}
        </li>
      ))}
    </ul>
  )
}
