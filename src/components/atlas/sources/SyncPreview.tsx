import { ArrowDownToLine, CircleAlert, Loader2, ShieldAlert, type LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { safeSourceDisplayText } from '@/lib/atlas/sources/contracts'
import type { SourceFreshness, SourceProvenance, SyncPreview as SyncPreviewModel } from '@/lib/atlas/sources/contracts'

import { ErrorNotice } from './ErrorNotice'
import { UnavailableNotice } from './UnavailableNotice'

export interface SyncPreviewProps {
  preview: SyncPreviewModel | null
  loading?: boolean
  unavailable?: boolean
  error?: string | null
  onStart?: (preview: SyncPreviewModel) => void | Promise<void>
  starting?: boolean
  /** Approval is intentionally parent-owned; `true` must be supplied after review. */
  approved?: boolean
  onApprove?: (preview: SyncPreviewModel) => void | Promise<void>
  approving?: boolean
}

function ChangeCount({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`text-lg font-semibold ${tone}`}>{value.toLocaleString()}</p>
    </div>
  )
}

function PreviewLoading() {
  return (
    <Card data-testid="atlas-sync-preview-loading">
      <CardContent
        className="flex items-center gap-2 p-6 text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Building a read-only sync preview…
      </CardContent>
    </Card>
  )
}

function PreviewUnavailable({ error }: { error?: string | null }) {
  return (
    <Card data-testid="atlas-sync-preview-unavailable">
      <CardContent className="p-6">
        <UnavailableNotice capability="The source sync preview" reason={error} />
      </CardContent>
    </Card>
  )
}

function PreviewError({ error }: { error: string }) {
  return (
    <Card data-testid="atlas-sync-preview-error">
      <CardContent className="p-6">
        <ErrorNotice capability="The source sync preview" message={error} />
      </CardContent>
    </Card>
  )
}

function PreviewEmpty() {
  return (
    <Card data-testid="atlas-sync-preview-empty">
      <CardContent className="p-6 text-sm text-muted-foreground" role="status" aria-live="polite">
        Request a preview to inspect the proposed source changes before starting a run.
      </CardContent>
    </Card>
  )
}

function WriteBadge({ willWrite }: { willWrite: boolean }) {
  return <Badge variant="outline">{willWrite ? 'Writes proposed' : 'No writes proposed'}</Badge>
}

function ApprovalBadge({ required }: { required: boolean }) {
  if (!required) return null
  return (
    <Badge variant="outline" className="border-amber-500/30 text-amber-600 dark:text-amber-400">
      <ShieldAlert className="size-3.5" aria-hidden="true" /> Approval required
    </Badge>
  )
}

function PreviewRefreshWarning({ error }: { error?: string | null }) {
  const safeError = safeSourceDisplayText(error)
  if (!safeError) return null
  return <p className="text-amber-600 text-xs dark:text-amber-400">Refresh warning: {safeError}</p>
}

function PreviewHeader({ preview, error }: { preview: SyncPreviewModel; error?: string | null }) {
  return (
    <CardHeader className="gap-2 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-sm">Sync preview</CardTitle>
          <CardDescription>
            {preview.source_id} · {preview.mode} · generated {preview.generated_at}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <WriteBadge willWrite={preview.will_write} />
          <ApprovalBadge required={preview.requires_approval} />
        </div>
      </div>
      <PreviewRefreshWarning error={error} />
    </CardHeader>
  )
}

function PreviewChanges({ preview }: { preview: SyncPreviewModel }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <ChangeCount label="Added" value={preview.changes.added} tone="text-emerald-600 dark:text-emerald-400" />
      <ChangeCount label="Updated" value={preview.changes.updated} tone="text-blue-600 dark:text-blue-400" />
      <ChangeCount label="Removed" value={preview.changes.removed} tone="text-destructive" />
      <ChangeCount label="Unchanged" value={preview.changes.unchanged} tone="text-muted-foreground" />
    </div>
  )
}

function PreviewWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <CircleAlert className="size-3.5" aria-hidden="true" /> Warnings from the preview
      </p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {warnings.map((warning) => (
          <li key={warning}>{safeSourceDisplayText(warning, 'Warning details unavailable.')}</li>
        ))}
      </ul>
    </div>
  )
}

function PlanReference({ planRef }: { planRef?: string | null }) {
  if (!planRef) return null
  const safePlanRef = safeSourceDisplayText(planRef, 'Review plan unavailable.')
  if (!safePlanRef) return null
  return (
    <p>
      Review plan: <code className="font-mono">{safePlanRef}</code>
    </p>
  )
}

function FreshnessEvidence({ freshness }: { freshness?: SourceFreshness }) {
  if (!freshness) return null
  const observed = freshness.observed_at ? ` · observed ${freshness.observed_at}` : ''
  return (
    <p>
      Freshness: <span className="font-medium">{freshness.state}</span>
      {observed}
    </p>
  )
}

function ProvenanceEvidence({ provenance }: { provenance?: SourceProvenance }) {
  if (!provenance) return null
  const sourceRef = safeSourceDisplayText(provenance.source_ref, 'Provenance unavailable.')
  if (!sourceRef) return null
  return (
    <p className="truncate" title={sourceRef}>
      Provenance: <code className="font-mono">{sourceRef}</code>
    </p>
  )
}

function PreviewEvidence({ preview }: { preview: SyncPreviewModel }) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <PlanReference planRef={preview.plan_ref} />
      <FreshnessEvidence freshness={preview.freshness} />
      <ProvenanceEvidence provenance={preview.provenance} />
    </div>
  )
}

interface StartDescriptor {
  label: string
  icon: LucideIcon
  iconClassName: string
}

const START_DESCRIPTOR: Record<'starting' | 'ready' | 'empty', StartDescriptor> = {
  starting: { label: 'Starting…', icon: Loader2, iconClassName: 'size-4 animate-spin' },
  ready: { label: 'Start reviewed sync', icon: ArrowDownToLine, iconClassName: 'size-4' },
  empty: { label: 'Nothing to apply', icon: ArrowDownToLine, iconClassName: 'size-4' },
}

function startState(preview: SyncPreviewModel, starting: boolean): keyof typeof START_DESCRIPTOR {
  if (starting) return 'starting'
  return preview.will_write ? 'ready' : 'empty'
}

function approvalIsSatisfied(preview: SyncPreviewModel, approved: boolean): boolean {
  return !preview.requires_approval || approved
}

function ApprovalAction({
  preview,
  approved,
  approving,
  onApprove,
}: {
  preview: SyncPreviewModel
  approved: boolean
  approving: boolean
  onApprove?: (preview: SyncPreviewModel) => void | Promise<void>
}) {
  if (!preview.requires_approval || approved || !onApprove) return null
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={approving}
      onClick={() => {
        void onApprove(preview)
      }}
      data-testid="atlas-sync-approve"
    >
      {approving ? 'Approving…' : 'Approve preview'}
    </Button>
  )
}

function StartAction({
  preview,
  onStart,
  starting,
  approved,
}: {
  preview: SyncPreviewModel
  onStart: (preview: SyncPreviewModel) => void | Promise<void>
  starting: boolean
  approved: boolean
}) {
  const descriptor = START_DESCRIPTOR[startState(preview, starting)]
  const disabled = starting || !preview.will_write || !approvalIsSatisfied(preview, approved)
  const Icon = descriptor.icon
  return (
    <Button
      type="button"
      size="sm"
      disabled={disabled}
      onClick={() => {
        if (disabled) return
        void onStart(preview)
      }}
      data-testid="atlas-sync-start"
    >
      <Icon className={descriptor.iconClassName} aria-hidden="true" />
      {descriptor.label}
    </Button>
  )
}

function SyncPreviewFooter({
  preview,
  onStart,
  starting,
  approved,
  onApprove,
  approving,
}: {
  preview: SyncPreviewModel
  onStart?: (preview: SyncPreviewModel) => void | Promise<void>
  starting: boolean
  approved: boolean
  onApprove?: (preview: SyncPreviewModel) => void | Promise<void>
  approving: boolean
}) {
  const approvalPending = preview.requires_approval && !approved
  if (!onStart && !(approvalPending && onApprove)) return null
  return (
    <CardFooter className="justify-end gap-2 border-t pt-4">
      <ApprovalAction preview={preview} approved={approved} approving={approving} onApprove={onApprove} />
      {onStart && <StartAction preview={preview} onStart={onStart} starting={starting} approved={approved} />}
    </CardFooter>
  )
}

function ObservedPreview({
  preview,
  error,
  onStart,
  starting,
  approved,
  onApprove,
  approving,
}: {
  preview: SyncPreviewModel
  error?: string | null
  onStart?: (preview: SyncPreviewModel) => void | Promise<void>
  starting: boolean
  approved: boolean
  onApprove?: (preview: SyncPreviewModel) => void | Promise<void>
  approving: boolean
}) {
  return (
    <Card data-testid="atlas-sync-preview" aria-live="polite">
      <PreviewHeader preview={preview} error={error} />
      <CardContent className="space-y-4">
        <PreviewChanges preview={preview} />
        <PreviewWarnings warnings={preview.warnings} />
        <PreviewEvidence preview={preview} />
      </CardContent>
      <SyncPreviewFooter
        preview={preview}
        onStart={onStart}
        starting={starting}
        approved={approved}
        onApprove={onApprove}
        approving={approving}
      />
    </Card>
  )
}

function shouldShowLoading(loading: boolean, preview: SyncPreviewModel | null) {
  return loading && preview === null
}

function shouldShowUnavailable(unavailable: boolean, preview: SyncPreviewModel | null) {
  return unavailable && preview === null
}

function shouldShowError(error: string | null | undefined, preview: SyncPreviewModel | null): error is string {
  return Boolean(error) && preview === null
}

/** A dry-run sync preview. Execution remains an explicit parent callback. */
export function SyncPreview({
  preview,
  loading = false,
  unavailable = false,
  error = null,
  onStart,
  starting = false,
  approved = false,
  onApprove,
  approving = false,
}: SyncPreviewProps) {
  if (shouldShowLoading(loading, preview)) return <PreviewLoading />
  if (shouldShowUnavailable(unavailable, preview)) return <PreviewUnavailable error={error} />
  if (shouldShowError(error, preview)) return <PreviewError error={error} />
  if (preview === null) return <PreviewEmpty />
  return (
    <ObservedPreview
      preview={preview}
      error={error}
      onStart={onStart}
      starting={starting}
      approved={approved}
      onApprove={onApprove}
      approving={approving}
    />
  )
}
