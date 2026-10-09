/**
 * @file MarketsPortfolio.tsx
 * @description The Portfolio destination (FUI-01). Account reads and
 * holdings are owned by agent-connector-sdk/emerald-exchange and remain
 * PENDING (specs/finance-asset-manager/tasks.md); this page states that
 * honestly rather than showing an empty portfolio.
 */
import { FeaturePending, MarketsGate } from './Availability'
import { MarketsShell } from './MarketsShell'

export default function MarketsPortfolio() {
  return (
    <MarketsGate>
      <MarketsShell>
        <FeaturePending
          feature="Portfolio"
          reason="No account provider is connected yet, so no holdings can be shown."
        />
      </MarketsShell>
    </MarketsGate>
  )
}
