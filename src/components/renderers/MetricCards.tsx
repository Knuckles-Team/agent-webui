/**
 * @file MetricCards.tsx
 * @description GOC-25 generic renderer: the `metric-cards` entry in the
 * lane design's renderer table ("health/readiness/metric summary ->
 * observed timestamp, stale badge, no zero fallback").
 *
 * Two rules this component enforces structurally, not by caller discipline:
 *
 * 1. A metric whose `value` is `null`/`undefined` renders as an explicit
 *    "no value reported" mark ("--"), never as `0`. `GraphOSReadinessView`'s
 *    module docstring records why this matters generally ("never trust a
 *    signal about state; check state") -- a metric card is exactly the kind
 *    of surface a "probably fine" `0` fallback would misrepresent as a
 *    real, healthy zero count.
 * 2. Freshness is judged ONLY from `observedAt` + `staleAfterSeconds`, both
 *    caller-supplied from a real backend snapshot. When `observedAt` is
 *    absent, this component renders "freshness unknown" rather than
 *    guessing "fresh" -- an absent timestamp is not evidence of recency.
 */
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export interface MetricCardValue {
  id: string
  label: string
  /** `null`/`undefined` means "no value reported" -- rendered as `--`,
   * never coerced to `0`. */
  value: number | string | null | undefined
  unit?: string
}

export interface MetricCardsProps {
  metrics: MetricCardValue[]
  /** ISO-8601 timestamp the metrics were observed at, or `null` if the
   * caller has no real observation time (freshness then renders as
   * "unknown", never "fresh"). */
  observedAt: string | null
  /** Seconds after `observedAt` at which the values are considered stale. */
  staleAfterSeconds?: number
  /** Injectable "now" for deterministic tests; defaults to `Date.now()`. */
  now?: number
  className?: string
}

/** Bound: render at most this many cards; the rest are counted, not silently dropped. */
const MAX_METRICS = 50

function formatValue(value: MetricCardValue['value'], unit: string | undefined): string {
  if (value === null || value === undefined) return '—'
  const rendered = typeof value === 'number' ? value.toLocaleString() : value
  return unit ? `${rendered} ${unit}` : rendered
}

export function MetricCards({ metrics, observedAt, staleAfterSeconds, now, className }: MetricCardsProps) {
  const nowMs = now ?? Date.now()
  const observedMs = observedAt ? Date.parse(observedAt) : NaN
  const hasObservation = observedAt !== null && !Number.isNaN(observedMs)
  const isStale =
    hasObservation && staleAfterSeconds !== undefined ? nowMs - observedMs > staleAfterSeconds * 1000 : false

  const shown = metrics.slice(0, MAX_METRICS)
  const hiddenCount = metrics.length - shown.length

  return (
    <div className={className} data-testid="metric-cards">
      <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
        <span>{hasObservation ? `Observed ${new Date(observedMs).toLocaleString()}` : 'Freshness unknown'}</span>
        {isStale && (
          <Badge variant="outline" className="text-amber-600 dark:text-amber-500 border-amber-500/30 gap-1">
            <AlertTriangle className="size-3" /> stale
          </Badge>
        )}
      </div>
      {metrics.length === 0 ? (
        <p className="text-sm text-muted-foreground">No metrics reported.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {shown.map((metric) => (
            <Card key={metric.id} className="border-border/40 bg-card/60" data-testid={`metric-card-${metric.id}`}>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground truncate" title={metric.label}>
                  {metric.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-bold font-mono">{formatValue(metric.value, metric.unit)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {hiddenCount > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">{hiddenCount} more metric(s) not shown.</p>
      )}
    </div>
  )
}
