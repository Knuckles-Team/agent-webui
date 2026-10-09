/**
 * @file SharePage.tsx
 * @description A shared analysis snapshot (EH-421). The host has already
 * checked the share lease and re-sealed the stored record against its digest;
 * the chart is rebuilt as of the moment it was shared. The page shows the
 * engine-stamped notices, the mechanical trigger first, and every note as a
 * claim with its sources. Positions are never part of a snapshot.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { BadgeCheck, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pathParam, useAppLocation } from '@/lib/apps/location'
import { fetchShared, revokeShare } from '../api'
import { formatDate } from '../format'
import type { SharedAnalysis, SnapshotClaim } from '../schemas'
import { MarketsGate, RequestFailed } from './Availability'
import { chartModel } from './chart-model'
import { ChartPanel, FlipTimeline } from './ChartPanel'
import { Provenance, SignalSummary } from './ChartPage'
import { MarketsNotices } from './Notices'

const PREFIX = '/apps/markets/share'

function Claim({ claim }: { claim: SnapshotClaim }) {
  return (
    <li className="rounded-md border border-border/50 p-3 text-sm">
      <p>
        <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold uppercase">
          Claim · {claim.author}
        </span>
        {claim.text}
      </p>
      <ul aria-label="Sources" className="mt-1 list-inside list-disc text-xs text-muted-foreground">
        {claim.sources.map((source) => (
          <li key={`${source.title}-${source.url ?? source.record_ref ?? ''}`}>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                {source.title}
              </a>
            ) : (
              `${source.title} (${source.record_ref ?? ''})`
            )}
          </li>
        ))}
      </ul>
    </li>
  )
}

function Reproduced({ shared }: { shared: SharedAnalysis }) {
  const Icon = shared.reproduced ? BadgeCheck : TriangleAlert
  return (
    <p role="status" className="flex items-center gap-2 text-sm">
      <Icon className="size-4" aria-hidden="true" />
      {shared.reproduced
        ? 'Verified: the record matches its digest and the data reproduces exactly as shared.'
        : 'The record matches its digest, but the stored bars no longer reproduce it exactly (for example after retention).'}
    </p>
  )
}

function Shared({ leaseId, shared }: { leaseId: string; shared: SharedAnalysis }) {
  const [revoked, setRevoked] = useState(false)
  const revoke = useMutation({
    mutationFn: () => revokeShare(leaseId),
    onSuccess: () => {
      setRevoked(true)
    },
  })
  const { snapshot, chart, listing } = shared
  const layers = useMemo(() => new Set(snapshot.draft.layers), [snapshot.draft.layers])
  const title = `${listing.symbol} / ${listing.quote} · ${chart.timeframe} · ${listing.venue}, as shared`
  const model = useMemo(() => chartModel(title, chart, layers, []), [title, chart, layers])
  const notices = snapshot.notices
  return (
    <article className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">
          {listing.symbol} / {listing.quote}{' '}
          <span className="text-base font-normal text-muted-foreground">{listing.venue}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Shared analysis of {formatDate(snapshot.draft.created_at / 1_000_000, chart.timeframe)}; link valid until{' '}
          {new Date(shared.expires_at).toLocaleString()}.
        </p>
        <Reproduced shared={shared} />
      </header>
      <MarketsNotices
        text={{
          informational: notices.informational_only,
          hallucination: notices.hallucination,
          trigger: notices.mechanical_trigger,
        }}
      />
      <SignalSummary chart={chart} />
      <ChartPanel model={model} palette="convention" />
      <FlipTimeline flips={chart.flips} timeframe={chart.timeframe} decimals={model.priceDecimals} />
      {snapshot.draft.claims.length > 0 && (
        <section aria-labelledby="claims-heading" className="space-y-2">
          <h2 id="claims-heading" className="text-sm font-semibold">
            Notes (claims, with their sources)
          </h2>
          <ul className="space-y-2">
            {snapshot.draft.claims.map((claim) => (
              <Claim key={claim.text} claim={claim} />
            ))}
          </ul>
        </section>
      )}
      <Provenance chart={chart} />
      <p className="font-mono text-xs break-all text-muted-foreground">snapshot {snapshot.digest}</p>
      {shared.can_revoke && !revoked && (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            revoke.mutate()
          }}
          disabled={revoke.isPending}
        >
          Revoke this link
        </Button>
      )}
      {revoked && <p role="status">This link is revoked. Nobody can open it any more.</p>}
      {revoke.isError && <RequestFailed what="Revoking" error={revoke.error} />}
    </article>
  )
}

function ShareBody({ leaseId }: { leaseId: string }) {
  const shared = useQuery({
    queryKey: ['markets', 'share', leaseId],
    queryFn: () => fetchShared(leaseId),
    retry: false,
  })
  if (shared.isError) {
    return (
      <p role="alert">
        This shared analysis is not available. The link may have expired, been revoked, or be for another workspace.
      </p>
    )
  }
  if (!shared.data) return <p className="text-sm text-muted-foreground">Loading the shared analysis…</p>
  return <Shared leaseId={leaseId} shared={shared.data} />
}

export default function SharePage() {
  const location = useAppLocation()
  const leaseId = pathParam(location.pathname, PREFIX)
  return (
    <MarketsGate>
      {leaseId ? <ShareBody leaseId={leaseId} /> : <p role="alert">This share link is not valid.</p>}
    </MarketsGate>
  )
}
