import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { fetchDecisionEvalTimeline } from '@/lib/decisions-api'
import type { DecisionEvalTimelinePage } from './decision-schemas'
import { formatEpochMs } from './decision-format'
import { ReceiptCard } from './DecisionEvaluationReceipts'

type TimelineEntry = DecisionEvalTimelinePage['entries'][number]

function thresholdSummary(entry: TimelineEntry): string {
  const alert = entry.threshold_alert
  if (alert?.policy_digest !== entry.receipt.policy_digest) return 'Policy threshold status unavailable.'
  if (alert.insufficient_support) return `Insufficient labeled support (minimum ${alert.n_min}); no threshold claim.`
  const breaches = [
    alert.coverage_below_policy === true && 'coverage below policy target',
    alert.act_risk_above_policy === true && 'act risk above policy limit',
  ].filter(Boolean)
  if (breaches.length) return `Policy threshold breached: ${breaches.join(' and ')}.`
  if (alert.coverage_below_policy === false && alert.act_risk_above_policy === false) {
    return 'No reported policy threshold breach for this evaluation.'
  }
  return 'Policy threshold evaluation incomplete.'
}

function displayThresholdSummary(entry: TimelineEntry): string {
  return entry.receipt.synthetic
    ? 'Synthetic evaluation; production threshold status unavailable.'
    : thresholdSummary(entry)
}

function ThresholdStatus({ entry }: { entry: TimelineEntry }) {
  const message = displayThresholdSummary(entry)
  return (
    <p role="status" className="text-xs">
      {message}
    </p>
  )
}

function TimelineResults({
  page,
  isLoading,
  isError,
}: {
  page: DecisionEvalTimelinePage | undefined
  isLoading: boolean
  isError: boolean
}) {
  if (isLoading) return <p className="text-xs">Loading full-label evaluation history…</p>
  if (isError)
    return (
      <p role="status" className="text-xs">
        Evaluation history is unavailable or this session lacks admin decision-eval scope.
      </p>
    )
  if (page?.entries.length === 0)
    return <p className="text-xs">No timestamped full-label evaluations are available for this tenant.</p>
  return page?.entries.map((entry) => (
    <div key={`${entry.submitted_at_ms}:${entry.receipt.receipt_digest}`} className="space-y-1">
      <p className="text-xs text-muted-foreground">Evaluation job submitted {formatEpochMs(entry.submitted_at_ms)}</p>
      <ReceiptCard receipt={entry.receipt} />
      <ThresholdStatus entry={entry} />
    </div>
  ))
}

/** Full-label history; EG owns timestamps and intervals, while alert rules remain unavailable. */
export default function DecisionEvaluationTimeline() {
  const [enabled, setEnabled] = useState(false)
  const [after, setAfter] = useState<string | undefined>()
  const query = useQuery({
    queryKey: ['decision-evaluation-timeline', after],
    queryFn: () => fetchDecisionEvalTimeline(after),
    enabled,
    retry: false,
  })

  return (
    <section aria-label="Full-label evaluation history" className="space-y-3 border-t border-border/40 pt-4">
      <div>
        <h3 className="font-semibold text-sm">Full-label evaluation history</h3>
        <p className="text-xs text-muted-foreground">
          Server job-submission order for independently labeled evaluations, including failed promotion gates. Older
          receipts without a time index remain in the digest list above. A policy threshold breach is specific to one
          evaluation. Statistical drift detection and LGTM alert delivery remain unavailable.
        </p>
      </div>
      {!enabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setEnabled(true)
          }}
        >
          Load history
        </Button>
      )}
      {enabled && <TimelineResults page={query.data} isLoading={query.isLoading} isError={query.isError} />}
      {query.data?.next_after && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setAfter(query.data.next_after ?? undefined)
          }}
        >
          Next evaluations
        </Button>
      )}
    </section>
  )
}
