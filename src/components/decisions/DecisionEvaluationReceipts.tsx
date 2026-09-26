import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { fetchDecisionEvalReceipts } from '@/lib/decisions-api'
import type { DecisionEvalReceipt } from './decision-schemas'
import { shortenId } from './decision-format'

function percent(value: { numerator: number; denominator: number }): string {
  return `${((value.numerator / value.denominator) * 100).toFixed(1)}%`
}

export function ReceiptCard({ receipt }: { receipt: DecisionEvalReceipt }) {
  const certified = receipt.passed && !receipt.synthetic && receipt.metrics !== null && receipt.metrics !== undefined
  return (
    <article className="rounded-md border border-border/40 p-3 text-xs space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono" title={receipt.receipt_digest}>
          {shortenId(receipt.receipt_digest)}
        </span>
        <span>{certified ? 'Passed independent-label evaluation' : 'No deployable calibration claim'}</span>
      </div>
      <p className="text-muted-foreground">
        Policy {shortenId(receipt.policy_digest)} · {receipt.n_records} records
      </p>
      {receipt.synthetic && <p>Includes synthetic data; no production coverage or risk claim.</p>}
      {!receipt.passed && <p>Failed gates: {receipt.failed_gates.join(', ') || 'unspecified'}.</p>}
      {certified && receipt.metrics && (
        <>
          <p className="text-muted-foreground">
            Bounds apply to this labeled evaluation set; this receipt provides no per-class breakdown.
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <dt>Labeled items</dt>
              <dd className="font-semibold">{receipt.metrics.n_items}</dd>
            </div>
            <div>
              <dt>Coverage interval</dt>
              <dd className="font-semibold">
                {percent(receipt.metrics.coverage_lower)}–{percent(receipt.metrics.coverage_upper)}
              </dd>
            </div>
            <div>
              <dt>Act-risk upper bound</dt>
              <dd className="font-semibold">{percent(receipt.metrics.act_risk_upper)}</dd>
            </div>
          </dl>
        </>
      )}
    </article>
  )
}

function ReceiptResults({
  receipts,
  isLoading,
  isError,
}: {
  receipts: DecisionEvalReceipt[] | undefined
  isLoading: boolean
  isError: boolean
}) {
  if (isLoading) return <p className="text-xs">Loading evaluation receipts…</p>
  if (isError) {
    return (
      <p role="status" className="text-xs">
        Evaluation receipts are unavailable or this session lacks admin decision-eval scope.
      </p>
    )
  }
  if (receipts?.length === 0) return <p className="text-xs">No evaluation receipts are available for this tenant.</p>
  return receipts?.map((receipt) => <ReceiptCard key={receipt.receipt_digest} receipt={receipt} />)
}

/** Admin-only evidence. Receipt pages are digest ordered, so this never plots temporal drift. */
export default function DecisionEvaluationReceipts() {
  const [enabled, setEnabled] = useState(false)
  const [after, setAfter] = useState<string | undefined>()
  const query = useQuery({
    queryKey: ['decision-evaluation-receipts', after],
    queryFn: () => fetchDecisionEvalReceipts(after),
    enabled,
    retry: false,
  })

  return (
    <section aria-label="Independent evaluation receipts" className="space-y-3 border-t border-border/40 pt-4">
      <div>
        <h3 className="font-semibold text-sm">Independent evaluation receipts</h3>
        <p className="text-xs text-muted-foreground">
          Admin decision-eval scope is required. Only passing, non-synthetic full-label receipts carry coverage and
          act-risk bounds. Receipt order is by digest; drift alerts require policy thresholds and LGTM monitoring.
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
          Load receipts
        </Button>
      )}
      {enabled && (
        <ReceiptResults receipts={query.data?.receipts} isLoading={query.isLoading} isError={query.isError} />
      )}
      {query.data?.next_after && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setAfter(query.data.next_after ?? undefined)
          }}
        >
          Next receipts
        </Button>
      )}
    </section>
  )
}
