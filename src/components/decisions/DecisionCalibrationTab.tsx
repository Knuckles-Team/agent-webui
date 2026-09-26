import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import { fetchDecisionAggregate } from '@/lib/decisions-api'
import type { FidelityCounts, OptionAggregate } from './decision-schemas'
import { fidelityTone, shortenId, successRatePercent } from './decision-format'
import DecisionEvaluationReceipts from './DecisionEvaluationReceipts'
import DecisionEvaluationTimeline from './DecisionEvaluationTimeline'

/**
 * @file DecisionCalibrationTab.tsx
 * @description EH-047: calibration and coverage dashboard, over
 * `DecisionLog.aggregate` (DECIDE §6.4). Every number here is what the
 * engine already agreed to disclose (k-anonymized by `min_support`) — this
 * component computes nothing beyond a display percentage from two integers
 * (`successes`/`trials`) it already received.
 *
 * No charting library is added for this: a fixed-hue single-series bar (the
 * success rate) and a four-segment categorical bar (trace fidelity), both
 * built from plain HTML/CSS per the dataviz method's mark specs (thin bars,
 * rounded data-ends, a 2px gap between adjacent segments, a legend for the
 * 4-series case, numbers shown as text so a table view always exists beside
 * the bar).
 */

const WINDOW_PRESETS = [
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: 'All time', ms: null },
] as const

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/30 bg-muted/10 px-2 py-1.5 text-center">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-bold text-sm">{value.toLocaleString()}</div>
    </div>
  )
}

function SuccessRateBar({ percent }: { percent: number | null }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Observed success rate (uncensored trials)</span>
        <span className="font-mono font-bold">{percent === null ? '—' : `${percent}%`}</span>
      </div>
      <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent ?? 0}%` }} />
      </div>
    </div>
  )
}

function PolicyLabel({ digest }: { digest: string | null | undefined }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      Policy:{' '}
      <span className="font-mono" title={digest ?? undefined}>
        {digest ? shortenId(digest) : 'unavailable'}
      </span>
    </p>
  )
}

function PolicyCohortNotice({ rows }: { rows: OptionAggregate[] }) {
  const policies = new Set(rows.map((row) => row.policy_digest).filter(Boolean))
  if (policies.size <= 1) return null
  return (
    <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
      This window includes multiple policy versions. Their observed rates are separate cohorts and are not directly
      comparable without re-evaluation.
    </p>
  )
}

const FIDELITY_SEGMENTS: { key: keyof FidelityCounts; label: string }[] = [
  { key: 'full_step', label: 'Full step' },
  { key: 'tool_calls', label: 'Tool calls' },
  { key: 'final_output', label: 'Final output' },
  { key: 'censored', label: 'Censored' },
]

function FidelityLegendEntry({ label, tone, value }: { label: string; tone: string; value: number }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block size-2 rounded-full ${tone}`} aria-hidden="true" />
      {label} {value.toLocaleString()}
    </span>
  )
}

function FidelityBreakdownBar({ counts }: { counts: FidelityCounts }) {
  const total = counts.full_step + counts.tool_calls + counts.final_output + counts.censored
  if (total === 0) return <p className="text-[10px] text-muted-foreground">No trace-fidelity data.</p>
  const present = FIDELITY_SEGMENTS.filter((segment) => counts[segment.key] > 0)
  return (
    <div className="space-y-1.5">
      <div
        className="flex h-2 rounded-full overflow-hidden gap-[2px]"
        role="img"
        aria-label="Trace fidelity breakdown"
      >
        {present.map((segment) => (
          <div
            key={segment.key}
            className={fidelityTone(segment.key)}
            style={{ width: `${(counts[segment.key] / total) * 100}%` }}
            title={`${segment.label}: ${counts[segment.key]}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {FIDELITY_SEGMENTS.map((segment) => (
          <FidelityLegendEntry
            key={segment.key}
            label={segment.label}
            tone={fidelityTone(segment.key)}
            value={counts[segment.key]}
          />
        ))}
      </div>
    </div>
  )
}

function OptionCard({ option }: { option: OptionAggregate }) {
  const percent = successRatePercent(option.successes, option.trials)
  return (
    <div className="p-3.5 rounded-lg border border-border/30 bg-muted/5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-bold truncate" title={option.option_id}>
          {option.option_id}
        </span>
        {option.question_id && (
          <Badge variant="outline" className="text-[9px]">
            {option.question_id}
          </Badge>
        )}
      </div>
      <PolicyLabel digest={option.policy_digest} />
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <StatTile label="Trials" value={option.trials} />
        <StatTile label="Successes" value={option.successes} />
        <StatTile label="Refused" value={option.refused} />
      </div>
      <SuccessRateBar percent={percent} />
      <p className="text-[10px] text-muted-foreground">
        Executed options only. This observed rate has no uncertainty interval or act-risk bound.
      </p>
      <FidelityBreakdownBar counts={option.by_fidelity} />
    </div>
  )
}

function ResultsGrid({ rows, isLoading, isError }: { rows: OptionAggregate[]; isLoading: boolean; isError: boolean }) {
  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading aggregate…</div>
  if (isError) return <UnavailableNotice what="The calibration aggregate" />
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No reportable outcome rows in this window. Data may be absent or withheld below minimum support.
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {rows.map((row, i) => (
        <OptionCard key={`${row.option_id}-${row.question_id ?? ''}-${i}`} option={row} />
      ))}
    </div>
  )
}

export default function DecisionCalibrationTab() {
  const [questionFilter, setQuestionFilter] = useState('')
  const [windowLabel, setWindowLabel] = useState<(typeof WINDOW_PRESETS)[number]['label']>('7d')

  const preset = WINDOW_PRESETS.find((w) => w.label === windowLabel) ?? WINDOW_PRESETS[1]
  const fromMs = preset.ms === null ? 0 : Date.now() - preset.ms

  const aggregateQuery = useQuery({
    queryKey: ['decision-aggregate', questionFilter, windowLabel],
    queryFn: () => fetchDecisionAggregate({ questionId: questionFilter || undefined, fromMs }),
  })

  const rows = aggregateQuery.data?.rows ?? []
  const minSupport = aggregateQuery.data?.min_support

  return (
    <div className="space-y-4">
      <section aria-label="Calibration and coverage status" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-md border border-border/40 bg-muted/10 p-3 text-xs">
          <h3 className="font-semibold">Outcome aggregate calibration: unavailable</h3>
          <p className="mt-1 text-muted-foreground">
            No independently labeled calibration metrics or uncertainty intervals are available from this aggregate.
          </p>
        </div>
        <div className="rounded-md border border-border/40 bg-muted/10 p-3 text-xs">
          <h3 className="font-semibold">Outcome aggregate coverage and act risk: unavailable</h3>
          <p className="mt-1 text-muted-foreground">
            Observed outcomes cannot establish coverage or act-risk bounds. Independently labeled evaluation receipts
            may report bounds for their evaluation set below.
          </p>
        </div>
      </section>
      <p className="text-xs text-muted-foreground">The rows below are observed outcomes for executed options only.</p>
      <PolicyCohortNotice rows={rows} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Filter by question id"
          placeholder="Filter by question id…"
          value={questionFilter}
          onChange={(e) => {
            setQuestionFilter(e.target.value)
          }}
          className="h-9 bg-muted/20 max-w-xs"
        />
        <div className="flex items-center gap-1" role="group" aria-label="Time window">
          {WINDOW_PRESETS.map((w) => (
            <Button
              key={w.label}
              type="button"
              size="sm"
              variant={w.label === windowLabel ? 'default' : 'outline'}
              className="h-8 text-xs"
              onClick={() => {
                setWindowLabel(w.label)
              }}
            >
              {w.label}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 ml-auto"
          onClick={() => {
            void aggregateQuery.refetch()
          }}
          disabled={aggregateQuery.isFetching}
          aria-label="Refresh aggregate"
        >
          <RefreshCw className={`size-4 ${aggregateQuery.isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      {minSupport !== undefined && (
        <p className="text-[11px] text-muted-foreground">
          Rows below {minSupport} trials are withheld by the engine. A missing row does not mean zero trials.
        </p>
      )}
      <ResultsGrid rows={rows} isLoading={aggregateQuery.isLoading} isError={aggregateQuery.isError} />
      <DecisionEvaluationReceipts />
      <DecisionEvaluationTimeline />
    </div>
  )
}
