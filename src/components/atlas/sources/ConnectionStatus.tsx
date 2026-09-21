import { CheckCircle2, CircleAlert, CircleOff, Loader2, PlugZap, ShieldQuestion, type LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { isConnectionProfileReference, safeSourceDisplayText } from '@/lib/atlas/sources/contracts'
import type {
  SourceConnectionState,
  SourceConnectionStatus,
  SourceFreshness,
  SourceProvenance,
} from '@/lib/atlas/sources/contracts'

import { ErrorNotice } from './ErrorNotice'
import { UnavailableNotice } from './UnavailableNotice'

export interface ConnectionStatusProps {
  sourceLabel?: string
  status: SourceConnectionStatus | null
  loading?: boolean
  unavailable?: boolean
  error?: string | null
  freshness?: SourceFreshness | null
  provenance?: SourceProvenance | null
}

interface StateDescriptor {
  label: string
  style: string
  icon: LucideIcon
  iconClassName: string
}

const UNKNOWN_STATE_DESCRIPTOR: StateDescriptor = {
  label: 'Unknown',
  style: 'border-border/60 bg-muted text-muted-foreground',
  icon: ShieldQuestion,
  iconClassName: 'size-3.5',
}

const STATE_DESCRIPTOR: Partial<Record<SourceConnectionState, StateDescriptor>> = {
  connected: {
    label: 'Connected',
    style: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    icon: CheckCircle2,
    iconClassName: 'size-3.5',
  },
  disconnected: {
    label: 'Disconnected',
    style: 'border-border/60 bg-muted text-muted-foreground',
    icon: ShieldQuestion,
    iconClassName: 'size-3.5',
  },
  checking: {
    label: 'Checking',
    style: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
    icon: Loader2,
    iconClassName: 'size-3.5 animate-spin',
  },
  unavailable: {
    label: 'Unavailable',
    style: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    icon: CircleOff,
    iconClassName: 'size-3.5',
  },
  error: {
    label: 'Error',
    style: 'border-destructive/30 bg-destructive/10 text-destructive',
    icon: CircleAlert,
    iconClassName: 'size-3.5',
  },
}

function StateIcon({ state }: { state: SourceConnectionState }) {
  const descriptor = STATE_DESCRIPTOR[state] ?? UNKNOWN_STATE_DESCRIPTOR
  const Icon = descriptor.icon
  return <Icon className={descriptor.iconClassName} aria-hidden="true" />
}

function StatusBadge({ state }: { state: SourceConnectionState }) {
  const descriptor = STATE_DESCRIPTOR[state] ?? UNKNOWN_STATE_DESCRIPTOR
  return (
    <Badge variant="outline" className={descriptor.style}>
      <StateIcon state={state} />
      {descriptor.label}
    </Badge>
  )
}

function ReasonLine({ reason }: { reason?: string | null }) {
  const safeReason = safeSourceDisplayText(reason)
  if (!safeReason) return null
  return <p className="text-muted-foreground">{safeReason}</p>
}

function ProfileLine({ profileRef }: { profileRef?: string | null }) {
  if (!profileRef) return null
  const safeProfileRef = isConnectionProfileReference(profileRef) ? profileRef : 'Profile reference unavailable.'
  return (
    <p className="text-muted-foreground truncate text-xs" title={safeProfileRef}>
      Profile: <code className="font-mono">{safeProfileRef}</code>
    </p>
  )
}

function CheckedAtLine({ checkedAt }: { checkedAt?: string | null }) {
  if (!checkedAt) return null
  return <p className="text-muted-foreground text-xs">Checked {checkedAt}</p>
}

function CapabilitiesLine({ capabilities }: { capabilities?: string[] }) {
  if (!capabilities || capabilities.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {capabilities.map((capability) => (
        <Badge key={capability} variant="outline" className="font-mono text-[10px]">
          {capability}
        </Badge>
      ))}
    </div>
  )
}

function FreshnessLine({ freshness }: { freshness?: SourceFreshness | null }) {
  if (!freshness) return null
  const observed = freshness.observed_at ? ` · observed ${freshness.observed_at}` : ''
  return (
    <p className="text-muted-foreground text-xs">
      Freshness: <span className="font-medium">{freshness.state}</span>
      {observed}
    </p>
  )
}

function ProvenanceLine({ provenance }: { provenance?: SourceProvenance | null }) {
  if (!provenance) return null
  const sourceRef = safeSourceDisplayText(provenance.source_ref, 'Provenance unavailable.')
  if (!sourceRef) return null
  return (
    <p className="text-muted-foreground truncate text-xs" title={sourceRef}>
      Provenance: <code className="font-mono">{sourceRef}</code>
    </p>
  )
}

function RefreshWarning({ error }: { error?: string | null }) {
  const safeError = safeSourceDisplayText(error)
  if (!safeError) return null
  return <p className="text-amber-600 text-xs dark:text-amber-400">Refresh warning: {safeError}</p>
}

function ConnectionDetails({
  status,
  freshness,
  provenance,
  error,
}: {
  status: SourceConnectionStatus
  freshness?: SourceFreshness | null
  provenance?: SourceProvenance | null
  error?: string | null
}) {
  return (
    <>
      <ReasonLine reason={status.reason} />
      <ProfileLine profileRef={status.profile_ref} />
      <CheckedAtLine checkedAt={status.checked_at} />
      <CapabilitiesLine capabilities={status.capabilities} />
      <FreshnessLine freshness={freshness} />
      <ProvenanceLine provenance={provenance} />
      <RefreshWarning error={error} />
    </>
  )
}

function ObservedConnection({
  sourceLabel,
  status,
  freshness,
  provenance,
  error,
}: {
  sourceLabel: string
  status: SourceConnectionStatus
  freshness?: SourceFreshness | null
  provenance?: SourceProvenance | null
  error?: string | null
}) {
  return (
    <Card data-testid="atlas-connection-status" aria-live="polite">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-sm">{sourceLabel} connection</CardTitle>
          <CardDescription>Server-observed connection state</CardDescription>
        </div>
        <StatusBadge state={status.state} />
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <ConnectionDetails status={status} freshness={freshness} provenance={provenance} error={error} />
      </CardContent>
    </Card>
  )
}

function LoadingConnection({ sourceLabel }: { sourceLabel: string }) {
  return (
    <Card data-testid="atlas-connection-status-loading">
      <CardContent
        className="flex items-center gap-2 p-4 text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Checking {sourceLabel} connection…
      </CardContent>
    </Card>
  )
}

function UnavailableConnection({ sourceLabel, error }: { sourceLabel: string; error?: string | null }) {
  return (
    <Card data-testid="atlas-connection-status-unavailable">
      <CardContent className="p-4">
        <UnavailableNotice capability={`${sourceLabel} connection status`} reason={error} />
      </CardContent>
    </Card>
  )
}

function ErrorConnection({ sourceLabel, error }: { sourceLabel: string; error: string }) {
  return (
    <Card data-testid="atlas-connection-status-error">
      <CardContent className="p-4">
        <ErrorNotice capability={`${sourceLabel} connection status`} message={error} />
      </CardContent>
    </Card>
  )
}

function EmptyConnection({ sourceLabel }: { sourceLabel: string }) {
  return (
    <Card data-testid="atlas-connection-status-empty">
      <CardContent
        className="flex items-center gap-2 p-4 text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <PlugZap className="size-4" aria-hidden="true" />
        No connection status has been observed for {sourceLabel}.
      </CardContent>
    </Card>
  )
}

function shouldShowLoading(loading: boolean, status: SourceConnectionStatus | null) {
  return loading && status === null
}

function shouldShowUnavailable(unavailable: boolean, status: SourceConnectionStatus | null) {
  return unavailable && status === null
}

function shouldShowError(error: string | null | undefined, status: SourceConnectionStatus | null): error is string {
  return Boolean(error) && status === null
}

/** Render the latest server observation; missing status never becomes "connected" by default. */
export function ConnectionStatus({
  sourceLabel = 'Source',
  status,
  loading = false,
  unavailable = false,
  error = null,
  freshness = null,
  provenance = null,
}: ConnectionStatusProps) {
  if (shouldShowLoading(loading, status)) return <LoadingConnection sourceLabel={sourceLabel} />
  if (shouldShowUnavailable(unavailable, status)) {
    return <UnavailableConnection sourceLabel={sourceLabel} error={error} />
  }
  if (shouldShowError(error, status)) {
    return <ErrorConnection sourceLabel={sourceLabel} error={error} />
  }
  if (status === null) return <EmptyConnection sourceLabel={sourceLabel} />
  return (
    <ObservedConnection
      sourceLabel={sourceLabel}
      status={status}
      freshness={freshness}
      provenance={provenance}
      error={error}
    />
  )
}
