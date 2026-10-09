/**
 * @file MarketsNews.tsx
 * @description The News destination (FUI-01). Source intake is owned by
 * media-downloader/emerald-exchange and remains PENDING
 * (specs/finance-asset-manager/tasks.md); this page states that honestly
 * rather than showing an empty feed.
 */
import { FeaturePending, MarketsGate } from './Availability'
import { MarketsShell } from './MarketsShell'

export default function MarketsNews() {
  return (
    <MarketsGate>
      <MarketsShell>
        <FeaturePending
          feature="News"
          reason="The owning source-intake service has not shipped a certified news feed yet."
        />
      </MarketsShell>
    </MarketsGate>
  )
}
