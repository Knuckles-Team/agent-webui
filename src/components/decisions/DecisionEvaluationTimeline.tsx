import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { fetchDecisionEvalTimeline } from '@/lib/decisions-api'
import type { DecisionEvalTimelinePage } from './decision-schemas'
import { formatEpochMs } from './decision-format'
import { ReceiptCard } from './DecisionEvaluationReceipts'

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
          receipts without a time index remain in the digest list above. Alert status is unavailable until policy
          thresholds and LGTM wiring exist; a change between these measurements alone is not a drift alert.
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
