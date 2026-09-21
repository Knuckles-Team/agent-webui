import { Ban, CheckCircle2, CircleAlert, Clock3, Loader2, RefreshCw, XCircle, type LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { hasSourceCapability, safeSourceDisplayText, sourceAvailabilityIsReady } from '@/lib/atlas/sources/contracts'
import type {
  SourceAvailability,
  SourceFreshness,
  SourceProvenance,
  SyncRun,
  SyncRunAggregate,
  SyncRunState,
} from '@/lib/atlas/sources/contracts'

import { ErrorNotice } from './ErrorNotice'
import { UnavailableNotice } from './UnavailableNotice'

export interface SyncRunPanelProps {
  aggregate: SyncRunAggregate | null
  loading?: boolean
  unavailable?: boolean
  error?: string | null
  onRefresh?: () => void
  onCancel?: (run: SyncRun) => void | Promise<void>
  cancellingRunId?: string | null
  /** Optional server descriptor used when a run does not repeat its own controls. */
  sourceAvailability?: SourceAvailability | null
  sourceCapabilities?: readonly string[]
}

interface RunStateDescriptor {
  label: string
  style: string
  icon: LucideIcon
  iconClassName: string
}

const RUN_STATE_DESCRIPTOR: Record<SyncRunState, RunStateDescriptor> = {
  queued: {
    label: 'Queued',
    style: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
    icon: Loader2,
    iconClassName: 'size-3.5 animate-spin',
  },
  pending: {
    label: 'Pending',
    style: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
    icon: Loader2,
    iconClassName: 'size-3.5 animate-spin',
  },
  running: {
    label: 'Running',
    style: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
    icon: Loader2,
    iconClassName: 'size-3.5 animate-spin',
  },
  cancelling: {
    label: 'Cancelling',
    style: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    icon: Clock3,
    iconClassName: 'size-3.5',
  },
  succeeded: {
    label: 'Succeeded',
    style: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    icon: CheckCircle2,
    iconClassName: 'size-3.5',
  },
  completed: {
    label: 'Completed',
    style: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    icon: CheckCircle2,
    iconClassName: 'size-3.5',
  },
  failed: {
    label: 'Failed',
    style: 'border-destructive/30 bg-destructive/10 text-destructive',
    icon: CircleAlert,
    iconClassName: 'size-3.5',
  },
  cancelled: {
    label: 'Cancelled',
    style: 'border-border/60 bg-muted text-muted-foreground',
    icon: XCircle,
    iconClassName: 'size-3.5',
  },
  unknown: {
    label: 'Unknown',
    style: 'border-border/60 bg-muted text-muted-foreground',
    icon: Clock3,
    iconClassName: 'size-3.5',
  },
}

const ACTIVE_STATES = new Set<SyncRunState>(['queued', 'pending', 'running', 'cancelling'])

function RunStateIcon({ state }: { state: SyncRunState }) {
  const descriptor = RUN_STATE_DESCRIPTOR[state]
  const Icon = descriptor.icon
  return <Icon className={descriptor.iconClassName} aria-hidden="true" />
}

function RunStateBadge({ state }: { state: SyncRunState }) {
  const descriptor = RUN_STATE_DESCRIPTOR[state]
  return (
    <Badge variant="outline" className={descriptor.style}>
      <RunStateIcon state={state} />
      {descriptor.label}
    </Badge>
  )
}

function progressText(run: SyncRun): string | null {
  const progress = run.progress
  if (!progress) return null
  const parts: string[] = []
  if (progress.pages_done !== undefined) parts.push(`${progress.pages_done.toLocaleString()} pages`)
  if (progress.items_seen !== undefined) parts.push(`${progress.items_seen.toLocaleString()} seen`)
  if (progress.items_ingested !== undefined) parts.push(`${progress.items_ingested.toLocaleString()} ingested`)
  if (progress.items_failed !== undefined && progress.items_failed > 0) {
    parts.push(`${progress.items_failed.toLocaleString()} failed`)
  }
  if (progress.total_items !== undefined && progress.total_items !== null) {
    parts.push(`of ${progress.total_items.toLocaleString()}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function RunPhase({ phase }: { phase?: string | null }) {
  const safePhase = safeSourceDisplayText(phase)
  if (!safePhase) return null
  return <p className="text-muted-foreground text-xs">Phase: {safePhase}</p>
}

function RunProgress({ run }: { run: SyncRun }) {
  const text = progressText(run)
  if (!text) return null
  return <p className="text-muted-foreground text-xs">{text}</p>
}

function RunError({ error }: { error?: string | null }) {
  const safeError = safeSourceDisplayText(error, 'Run error details unavailable.')
  if (!safeError) return null
  return <p className="text-destructive text-xs">{safeError}</p>
}

function RunTime({ updatedAt, startedAt }: { updatedAt?: string | null; startedAt?: string | null }) {
  const text = updatedAt ? `Updated ${updatedAt}` : startedAt ? `Started ${startedAt}` : 'Time not reported'
  return <span>{text}</span>
}

function isActiveRun(run: SyncRun): boolean {
  return ACTIVE_STATES.has(run.state) && run.state !== 'cancelling'
}

function isCancellableRun(
  run: SyncRun,
  sourceAvailability: SourceAvailability | null | undefined,
  sourceCapabilities: readonly string[] | undefined,
): boolean {
  const availability = run.availability ?? sourceAvailability
  const capabilities = run.capabilities ?? sourceCapabilities
  return isActiveRun(run) && sourceAvailabilityIsReady(availability) && hasSourceCapability(capabilities, 'cancel')
}

function CancelRunButton({
  run,
  onCancel,
  cancellingRunId,
  sourceAvailability,
  sourceCapabilities,
}: {
  run: SyncRun
  onCancel?: (run: SyncRun) => void | Promise<void>
  cancellingRunId?: string | null
  sourceAvailability?: SourceAvailability | null
  sourceCapabilities?: readonly string[]
}) {
  if (!onCancel || !isActiveRun(run)) return null
  const enabled = isCancellableRun(run, sourceAvailability, sourceCapabilities)
  const cancelling = cancellingRunId === run.run_id
  const Icon = cancelling ? Loader2 : Ban
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 text-xs"
      disabled={cancelling || !enabled}
      onClick={() => {
        if (cancelling || !enabled) return
        void onCancel(run)
      }}
      data-testid={`atlas-sync-cancel-${run.run_id}`}
    >
      <Icon className={cancelling ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden="true" />
      {cancelling ? 'Cancelling…' : 'Cancel'}
    </Button>
  )
}

function RunRow({
  run,
  onCancel,
  cancellingRunId,
  sourceAvailability,
  sourceCapabilities,
}: {
  run: SyncRun
  onCancel?: (run: SyncRun) => void | Promise<void>
  cancellingRunId?: string | null
  sourceAvailability?: SourceAvailability | null
  sourceCapabilities?: readonly string[]
}) {
  return (
    <li className="flex flex-col gap-2 rounded-md border p-3" data-testid={`atlas-sync-run-${run.run_id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={run.run_id}>
            {run.source_id} · {run.mode}
          </p>
          <p className="text-muted-foreground truncate font-mono text-[10px]" title={run.run_id}>
            {run.run_id}
          </p>
        </div>
        <RunStateBadge state={run.state} />
      </div>
      <RunPhase phase={run.phase} />
      <RunProgress run={run} />
      <RunError error={run.error} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <RunTime updatedAt={run.updated_at} startedAt={run.started_at} />
        <CancelRunButton
          run={run}
          onCancel={onCancel}
          cancellingRunId={cancellingRunId}
          sourceAvailability={sourceAvailability}
          sourceCapabilities={sourceCapabilities}
        />
      </div>
    </li>
  )
}

function RunsLoading() {
  return (
    <Card data-testid="atlas-sync-runs-loading">
      <CardContent
        className="flex items-center gap-2 p-6 text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading sync run status…
      </CardContent>
    </Card>
  )
}

function RunsUnavailable({ error }: { error?: string | null }) {
  return (
    <Card data-testid="atlas-sync-runs-unavailable">
      <CardContent className="p-6">
        <UnavailableNotice capability="The source sync run status" reason={error} />
      </CardContent>
    </Card>
  )
}

function RunsError({ error }: { error: string }) {
  return (
    <Card data-testid="atlas-sync-runs-error">
      <CardContent className="p-6">
        <ErrorNotice capability="The source sync run status" message={error} />
      </CardContent>
    </Card>
  )
}

function RunsEmpty() {
  return (
    <Card data-testid="atlas-sync-runs-empty">
      <CardContent className="p-6 text-sm text-muted-foreground" role="status" aria-live="polite">
        No aggregate sync status has been observed.
      </CardContent>
    </Card>
  )
}

function RefreshButton({ onRefresh, loading }: { onRefresh?: () => void; loading: boolean }) {
  if (!onRefresh) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Refresh sync runs"
      disabled={loading}
      onClick={onRefresh}
      data-testid="atlas-sync-runs-refresh"
    >
      <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
    </Button>
  )
}

function RunsHeader({
  aggregate,
  onRefresh,
  loading,
}: {
  aggregate: SyncRunAggregate
  onRefresh?: () => void
  loading: boolean
}) {
  return (
    <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
      <div>
        <CardTitle className="text-sm">Sync runs</CardTitle>
        <CardDescription>Server aggregate observed {aggregate.observed_at}</CardDescription>
      </div>
      <div className="flex items-center gap-2">
        <RunStateBadge state={aggregate.aggregate_state} />
        <RefreshButton onRefresh={onRefresh} loading={loading} />
      </div>
    </CardHeader>
  )
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-muted-foreground text-[10px]">{label}</p>
      <p className="text-sm font-semibold">{value.toLocaleString()}</p>
    </div>
  )
}

function RunSummaryCounts({ aggregate }: { aggregate: SyncRunAggregate }) {
  const { counts } = aggregate
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <SummaryCount label="Total" value={counts.total} />
      <SummaryCount label="Queued" value={counts.queued} />
      <SummaryCount label="Running" value={counts.running} />
      <SummaryCount label="Succeeded" value={counts.succeeded} />
      <SummaryCount label="Failed" value={counts.failed} />
      <SummaryCount label="Cancelled" value={counts.cancelled} />
    </div>
  )
}

function RunsList({
  runs,
  onCancel,
  cancellingRunId,
  sourceAvailability,
  sourceCapabilities,
}: {
  runs: SyncRun[]
  onCancel?: (run: SyncRun) => void | Promise<void>
  cancellingRunId?: string | null
  sourceAvailability?: SourceAvailability | null
  sourceCapabilities?: readonly string[]
}) {
  if (runs.length === 0) {
    return <p className="text-muted-foreground text-sm">The server reported no individual runs in this window.</p>
  }
  return (
    <ul className="space-y-2">
      {runs.map((run) => (
        <RunRow
          key={run.run_id}
          run={run}
          onCancel={onCancel}
          cancellingRunId={cancellingRunId}
          sourceAvailability={sourceAvailability}
          sourceCapabilities={sourceCapabilities}
        />
      ))}
    </ul>
  )
}

function AggregateWarning({ error }: { error?: string | null }) {
  const safeError = safeSourceDisplayText(error)
  if (!safeError) return null
  return <p className="text-amber-600 text-xs dark:text-amber-400">Refresh warning: {safeError}</p>
}

function FreshnessEvidence({ freshness }: { freshness?: SourceFreshness }) {
  if (!freshness) return null
  return (
    <p className="text-muted-foreground text-xs">
      Freshness: <span className="font-medium">{freshness.state}</span>
    </p>
  )
}

function ProvenanceEvidence({ provenance }: { provenance?: SourceProvenance }) {
  if (!provenance) return null
  const sourceRef = safeSourceDisplayText(provenance.source_ref, 'Provenance unavailable.')
  if (!sourceRef) return null
  return (
    <p className="text-muted-foreground truncate text-xs" title={sourceRef}>
      Provenance: <code className="font-mono">{sourceRef}</code>
    </p>
  )
}

function AggregateEvidence({ aggregate }: { aggregate: SyncRunAggregate }) {
  return (
    <>
      <FreshnessEvidence freshness={aggregate.freshness} />
      <ProvenanceEvidence provenance={aggregate.provenance} />
    </>
  )
}

function ObservedRuns({
  aggregate,
  loading,
  error,
  onRefresh,
  onCancel,
  cancellingRunId,
  sourceAvailability,
  sourceCapabilities,
}: {
  aggregate: SyncRunAggregate
  loading: boolean
  error?: string | null
  onRefresh?: () => void
  onCancel?: (run: SyncRun) => void | Promise<void>
  cancellingRunId?: string | null
  sourceAvailability?: SourceAvailability | null
  sourceCapabilities?: readonly string[]
}) {
  return (
    <Card data-testid="atlas-sync-runs" aria-live="polite">
      <RunsHeader aggregate={aggregate} onRefresh={onRefresh} loading={loading} />
      <CardContent className="space-y-4">
        <AggregateWarning error={error} />
        <RunSummaryCounts aggregate={aggregate} />
        <RunsList
          runs={aggregate.runs}
          onCancel={onCancel}
          cancellingRunId={cancellingRunId}
          sourceAvailability={sourceAvailability}
          sourceCapabilities={sourceCapabilities}
        />
        <AggregateEvidence aggregate={aggregate} />
      </CardContent>
    </Card>
  )
}

function shouldShowLoading(loading: boolean, aggregate: SyncRunAggregate | null) {
  return loading && aggregate === null
}

function shouldShowUnavailable(unavailable: boolean, aggregate: SyncRunAggregate | null) {
  return unavailable && aggregate === null
}

function shouldShowError(error: string | null | undefined, aggregate: SyncRunAggregate | null): error is string {
  return Boolean(error) && aggregate === null
}

/** Render server-owned aggregate status and bounded child run observations. */
export function SyncRunPanel({
  aggregate,
  loading = false,
  unavailable = false,
  error = null,
  onRefresh,
  onCancel,
  cancellingRunId = null,
  sourceAvailability = null,
  sourceCapabilities,
}: SyncRunPanelProps) {
  if (shouldShowLoading(loading, aggregate)) return <RunsLoading />
  if (shouldShowUnavailable(unavailable, aggregate)) return <RunsUnavailable error={error} />
  if (shouldShowError(error, aggregate)) return <RunsError error={error} />
  if (aggregate === null) return <RunsEmpty />
  return (
    <ObservedRuns
      aggregate={aggregate}
      loading={loading}
      error={error}
      onRefresh={onRefresh}
      onCancel={onCancel}
      cancellingRunId={cancellingRunId}
      sourceAvailability={sourceAvailability}
      sourceCapabilities={sourceCapabilities}
    />
  )
}
