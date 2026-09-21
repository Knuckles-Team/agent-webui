import {
  CheckCircle2,
  CircleAlert,
  CircleOff,
  Database,
  Loader2,
  PlugZap,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatSourceQueryMode,
  safeSourceDisplayText,
  sourceActionIsEnabled,
  type SourceAvailabilityState,
  type SourceCatalog as SourceCatalogModel,
  type SourceFreshness,
  type SourceProvider,
  type SourceProvenance,
} from '@/lib/atlas/sources/contracts'

import { ErrorNotice } from './ErrorNotice'
import { UnavailableNotice } from './UnavailableNotice'

export interface SourceCatalogProps {
  /** The validated catalog from `useAtlasSourceCatalog`, or null before a response. */
  catalog: SourceCatalogModel | null
  loading?: boolean
  unavailable?: boolean
  error?: string | null
  selectedSourceId?: string | null
  onSelect?: (provider: SourceProvider) => void
  onConnect?: (provider: SourceProvider) => void
}

interface AvailabilityDescriptor {
  label: string
  style: string
  icon: LucideIcon
}

const UNKNOWN_AVAILABILITY_DESCRIPTOR: AvailabilityDescriptor = {
  label: 'Unknown',
  style: 'border-border/60 bg-muted text-muted-foreground',
  icon: CircleAlert,
}

const AVAILABILITY_DESCRIPTOR: Partial<Record<SourceAvailabilityState, AvailabilityDescriptor>> = {
  available: {
    label: 'Available',
    style: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    icon: CheckCircle2,
  },
  degraded: {
    label: 'Degraded',
    style: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    icon: CircleAlert,
  },
  unavailable: {
    label: 'Unavailable',
    style: 'border-destructive/30 bg-destructive/10 text-destructive',
    icon: CircleOff,
  },
  not_configured: {
    label: 'Not configured',
    style: 'border-border/60 bg-muted text-muted-foreground',
    icon: ShieldCheck,
  },
  unconfigured: {
    label: 'Unconfigured',
    style: 'border-border/60 bg-muted text-muted-foreground',
    icon: ShieldCheck,
  },
  unknown: UNKNOWN_AVAILABILITY_DESCRIPTOR,
}

function AvailabilityBadge({ state }: { state: SourceAvailabilityState }) {
  const descriptor = AVAILABILITY_DESCRIPTOR[state] ?? UNKNOWN_AVAILABILITY_DESCRIPTOR
  const Icon = descriptor.icon
  return (
    <Badge variant="outline" className={descriptor.style}>
      <Icon className="size-3.5" aria-hidden="true" />
      {descriptor.label}
    </Badge>
  )
}

function FreshnessLine({ freshness }: { freshness?: SourceFreshness | null }) {
  if (!freshness) return null
  const detail = freshness.observed_at ? `observed ${freshness.observed_at}` : 'observation time not reported'
  return (
    <p className="text-muted-foreground text-xs">
      Freshness: <span className="font-medium">{freshness.state}</span> · {detail}
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

function ProviderIdentity({ provider }: { provider: SourceProvider }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Database className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <CardTitle className="truncate text-sm" title={provider.label}>
          {provider.label}
        </CardTitle>
        <CardDescription className="truncate font-mono text-xs" title={provider.source_id}>
          {provider.source_id}
        </CardDescription>
      </div>
    </div>
  )
}

function ProviderDescription({ description }: { description?: string | null }) {
  if (!description) return null
  return <CardDescription>{description}</CardDescription>
}

function ProviderReason({ provider }: { provider: SourceProvider }) {
  if (!provider.availability.reason) return null
  const reason = safeSourceDisplayText(provider.availability.reason)
  if (!reason) return null
  return (
    <p className="text-muted-foreground text-xs" data-testid={`atlas-source-reason-${provider.source_id}`}>
      {reason}
    </p>
  )
}

function QueryModeList({ modes }: { modes: SourceProvider['query_modes'] }) {
  if (modes.length === 0) return <p className="text-muted-foreground text-xs">No query mode reported.</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {modes.map((mode) => (
        <Badge key={mode} variant="secondary" className="text-[10px]">
          {formatSourceQueryMode(mode)}
        </Badge>
      ))}
    </div>
  )
}

function ProviderQueryModes({ modes }: { modes: SourceProvider['query_modes'] }) {
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wide">Query modes</p>
      <QueryModeList modes={modes} />
    </div>
  )
}

function CapabilityList({ capabilities }: { capabilities: SourceProvider['capabilities'] }) {
  if (capabilities.length === 0) return <p className="text-muted-foreground text-xs">No capabilities reported.</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {capabilities.map((capability) => (
        <Badge key={capability} variant="outline" className="font-mono text-[10px]">
          {capability}
        </Badge>
      ))}
    </div>
  )
}

function ProviderCapabilities({ capabilities }: { capabilities: SourceProvider['capabilities'] }) {
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wide">Capabilities</p>
      <CapabilityList capabilities={capabilities} />
    </div>
  )
}

function ProviderConnectionLine({ state }: { state?: string }) {
  if (!state) return null
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <PlugZap className="size-3.5" aria-hidden="true" /> Connection: {state}
    </p>
  )
}

function ProviderMetadata({ provider }: { provider: SourceProvider }) {
  return (
    <div className="mt-auto space-y-1 border-t pt-3">
      <ProviderConnectionLine state={provider.connection?.state} />
      <FreshnessLine freshness={provider.freshness} />
      <ProvenanceLine provenance={provider.provenance} />
    </div>
  )
}

function SelectSourceAction({
  provider,
  onSelect,
}: {
  provider: SourceProvider
  onSelect?: (provider: SourceProvider) => void
}) {
  if (!onSelect) return null
  const enabled = sourceActionIsEnabled(provider, 'explore')
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={!enabled}
      onClick={() => {
        if (!enabled) return
        onSelect(provider)
      }}
      data-testid={`atlas-source-select-${provider.source_id}`}
    >
      Explore source
    </Button>
  )
}

function ConnectSourceAction({
  provider,
  onConnect,
}: {
  provider: SourceProvider
  onConnect?: (provider: SourceProvider) => void
}) {
  if (!onConnect) return null
  const enabled = sourceActionIsEnabled(provider, 'connect')
  const label = provider.connection?.state === 'connected' ? 'Change profile' : 'Connect'
  return (
    <Button
      type="button"
      size="sm"
      disabled={!enabled}
      onClick={() => {
        if (!enabled) return
        onConnect(provider)
      }}
      data-testid={`atlas-source-connect-${provider.source_id}`}
    >
      {label}
    </Button>
  )
}

function ProviderActions({
  provider,
  onSelect,
  onConnect,
}: {
  provider: SourceProvider
  onSelect?: (provider: SourceProvider) => void
  onConnect?: (provider: SourceProvider) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <SelectSourceAction provider={provider} onSelect={onSelect} />
      <ConnectSourceAction provider={provider} onConnect={onConnect} />
    </div>
  )
}

function cardClassName(selected: boolean) {
  return `flex h-full flex-col border-border/50 bg-card/60 transition-colors ${selected ? 'border-primary' : ''}`
}

function ProviderCard({
  provider,
  selected,
  onSelect,
  onConnect,
}: {
  provider: SourceProvider
  selected: boolean
  onSelect?: (provider: SourceProvider) => void
  onConnect?: (provider: SourceProvider) => void
}) {
  return (
    <Card data-testid={`atlas-source-card-${provider.source_id}`} className={cardClassName(selected)}>
      <CardHeader className="gap-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <ProviderIdentity provider={provider} />
          <AvailabilityBadge state={provider.availability.state} />
        </div>
        <ProviderDescription description={provider.description} />
        <ProviderReason provider={provider} />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <ProviderQueryModes modes={provider.query_modes} />
        <ProviderCapabilities capabilities={provider.capabilities} />
        <ProviderMetadata provider={provider} />
        <ProviderActions provider={provider} onSelect={onSelect} onConnect={onConnect} />
      </CardContent>
    </Card>
  )
}

function CatalogUnavailable({ message }: { message: string }) {
  return (
    <Card data-testid="atlas-source-catalog-unavailable">
      <CardContent className="p-6">
        <UnavailableNotice capability="The Atlas source catalog" reason={message} />
      </CardContent>
    </Card>
  )
}

function CatalogError({ message }: { message: string }) {
  return (
    <Card data-testid="atlas-source-catalog-error">
      <CardContent className="p-6">
        <ErrorNotice capability="The Atlas source catalog" message={message} />
      </CardContent>
    </Card>
  )
}

function CatalogEmptyObservation() {
  return (
    <Card data-testid="atlas-source-catalog-empty-observation">
      <CardContent className="p-6 text-sm text-muted-foreground" role="status" aria-live="polite">
        No source catalog observation was returned.
      </CardContent>
    </Card>
  )
}

function CatalogLoading() {
  return (
    <Card data-testid="atlas-source-catalog-loading">
      <CardContent
        className="flex items-center gap-2 p-6 text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Reading the live Atlas source catalog…
      </CardContent>
    </Card>
  )
}

function CatalogEmpty() {
  return (
    <Card data-testid="atlas-source-catalog-empty">
      <CardContent className="p-6 text-sm text-muted-foreground" role="status" aria-live="polite">
        The live catalog reported no source providers.
      </CardContent>
    </Card>
  )
}

function providerCountLabel(count: number, observedAt: string) {
  return `${count} provider${count === 1 ? '' : 's'} reported by GraphOS · observed ${observedAt}`
}

function CatalogVersion({ version }: { version?: string }) {
  if (!version) return null
  return <Badge variant="outline">{version}</Badge>
}

function CatalogHeader({ catalog }: { catalog: SourceCatalogModel }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold">External sources</h2>
        <p className="text-muted-foreground text-xs">
          {providerCountLabel(catalog.providers.length, catalog.observed_at)}
        </p>
      </div>
      <CatalogVersion version={catalog.catalog_version} />
    </div>
  )
}

function CatalogRefreshWarning({ error }: { error?: string | null }) {
  const safeError = safeSourceDisplayText(error)
  if (!safeError) return null
  return <p className="text-amber-600 text-xs dark:text-amber-400">Refresh warning: {safeError}</p>
}

function CatalogEvidence({ catalog }: { catalog: SourceCatalogModel }) {
  return (
    <div className="space-y-1 text-xs">
      <FreshnessLine freshness={catalog.freshness} />
      <ProvenanceLine provenance={catalog.provenance} />
    </div>
  )
}

function CatalogProviders({
  catalog,
  selectedSourceId,
  onSelect,
  onConnect,
}: SourceCatalogProps & { catalog: SourceCatalogModel }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {catalog.providers.map((provider) => (
        <ProviderCard
          key={provider.source_id}
          provider={provider}
          selected={provider.source_id === selectedSourceId}
          onSelect={onSelect}
          onConnect={onConnect}
        />
      ))}
    </div>
  )
}

function ObservedCatalog({
  catalog,
  selectedSourceId,
  onSelect,
  onConnect,
  error,
}: {
  catalog: SourceCatalogModel
  selectedSourceId?: string | null
  onSelect?: (provider: SourceProvider) => void
  onConnect?: (provider: SourceProvider) => void
  error?: string | null
}) {
  return (
    <section className="space-y-3" data-testid="atlas-source-catalog" aria-live="polite">
      <CatalogHeader catalog={catalog} />
      <CatalogRefreshWarning error={error} />
      <CatalogEvidence catalog={catalog} />
      <CatalogProviders
        catalog={catalog}
        selectedSourceId={selectedSourceId}
        onSelect={onSelect}
        onConnect={onConnect}
      />
    </section>
  )
}

function shouldShowLoading(loading: boolean, catalog: SourceCatalogModel | null) {
  return loading && catalog === null
}

function shouldShowUnavailable(unavailable: boolean, catalog: SourceCatalogModel | null) {
  return unavailable && catalog === null
}

function shouldShowError(error: string | null | undefined, catalog: SourceCatalogModel | null): error is string {
  return Boolean(error) && catalog === null
}

/** Render every provider the server reported, including degraded/unavailable cards. */
export function SourceCatalog({
  catalog,
  loading = false,
  unavailable = false,
  error = null,
  selectedSourceId = null,
  onSelect,
  onConnect,
}: SourceCatalogProps) {
  if (shouldShowLoading(loading, catalog)) return <CatalogLoading />
  if (shouldShowUnavailable(unavailable, catalog)) {
    return <CatalogUnavailable message={error ?? 'The source catalog route is not available.'} />
  }
  if (shouldShowError(error, catalog)) return <CatalogError message={error} />
  if (catalog === null) return <CatalogEmptyObservation />
  if (catalog.providers.length === 0) return <CatalogEmpty />
  return (
    <ObservedCatalog
      catalog={catalog}
      selectedSourceId={selectedSourceId}
      onSelect={onSelect}
      onConnect={onConnect}
      error={error}
    />
  )
}
