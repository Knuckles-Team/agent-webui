import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { fetchDecisionEvalReceipts } from '@/lib/decisions-api'
import type { DecisionEvalReceipt } from './decision-schemas'
import { shortenId } from './decision-format'

type EvaluationMetrics = NonNullable<DecisionEvalReceipt['metrics']>
type ClassCoverage = NonNullable<DecisionEvalReceipt['promotion']>['per_class'][number]

function percent(value: { numerator: number; denominator: number }): string {
  return `${((value.numerator / value.denominator) * 100).toFixed(1)}%`
}

function hasDeployableCalibration(receipt: DecisionEvalReceipt): boolean {
  return (
    receipt.passed &&
    !receipt.synthetic &&
    receipt.calibration?.synthetic === false &&
    receipt.calibration.method === 'conformal' &&
    receipt.calibration.n_calibration > 0 &&
    receipt.metrics !== null &&
    receipt.metrics !== undefined
  )
}

function ClassEvidenceRow({ row }: { row: ClassCoverage }) {
  const supported = row.n_min === null || row.n_min === undefined || row.n_items >= row.n_min
  return (
    <div className="rounded border border-border/30 p-2 space-y-1">
      <p className="font-mono">
        {row.class_key} · {row.n_items} labeled items
      </p>
      {row.metrics && supported ? (
        <p>
          Coverage {percent(row.metrics.coverage_lower)}–{percent(row.metrics.coverage_upper)}; act-risk upper bound{' '}
          {row.metrics.act_risk_upper ? percent(row.metrics.act_risk_upper) : 'unavailable (no acted items)'};
          confidence{' '}
          {percent({
            numerator: row.metrics.delta.denominator - row.metrics.delta.numerator,
            denominator: row.metrics.delta.denominator,
          })}
          .
        </p>
      ) : (
        <p>
          {row.n_min === null || row.n_min === undefined
            ? 'Class bounds unavailable for this receipt.'
            : `Insufficient labeled support (minimum ${row.n_min}); no class coverage or risk claim.`}
        </p>
      )}
    </div>
  )
}

function PerClassEvidence({ classes }: { classes: ClassCoverage[] }) {
  if (classes.length === 0) return null
  return (
    <section aria-label="Per-class evaluation bounds" className="space-y-2 border-t border-border/30 pt-2">
      <h4 className="font-semibold">Per-class evidence</h4>
      <p className="text-muted-foreground">
        Intervals apply separately to each class; they are not a simultaneous guarantee across classes.
      </p>
      {classes.map((row) => (
        <ClassEvidenceRow key={row.class_key} row={row} />
      ))}
    </section>
  )
}

function EvaluationBounds({ metrics, classes }: { metrics: EvaluationMetrics; classes: ClassCoverage[] }) {
  return (
    <>
      <p className="text-muted-foreground">Bounds apply to this labeled evaluation set under its pinned policy.</p>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <dt>Labeled items</dt>
          <dd className="font-semibold">{metrics.n_items}</dd>
        </div>
        <div>
          <dt>Coverage interval</dt>
          <dd className="font-semibold">
            {percent(metrics.coverage_lower)}–{percent(metrics.coverage_upper)}
          </dd>
        </div>
        <div>
          <dt>Act-risk upper bound</dt>
          <dd className="font-semibold">
            {metrics.acted > 0 ? percent(metrics.act_risk_upper) : 'unavailable (no acted items)'}
          </dd>
        </div>
      </dl>
      <PerClassEvidence classes={classes} />
    </>
  )
}

function ReceiptClaimNotice({ receipt }: { receipt: DecisionEvalReceipt }) {
  return (
    <>
      {receipt.synthetic && <p>Includes synthetic data; no production coverage or risk claim.</p>}
      {receipt.calibration?.synthetic && (
        <p>The fitted calibration used synthetic data; no production coverage or risk claim.</p>
      )}
      {!receipt.passed && <p>Failed gates: {receipt.failed_gates.join(', ') || 'unspecified'}.</p>}
    </>
  )
}

export function ReceiptCard({ receipt }: { receipt: DecisionEvalReceipt }) {
  const certified = hasDeployableCalibration(receipt)
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
      <ReceiptClaimNotice receipt={receipt} />
      {certified && receipt.metrics && (
        <EvaluationBounds metrics={receipt.metrics} classes={receipt.promotion?.per_class ?? []} />
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
          Admin decision-eval scope is required. Only passing full-label receipts with real labels and real fitted
          calibration carry coverage and act-risk bounds. Receipt order is by digest; formal drift monitoring remains
          unavailable without comparable policy cohorts.
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
