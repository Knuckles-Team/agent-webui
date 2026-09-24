import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import { fetchDecision, fetchDecisionProvenance } from '@/lib/decisions-api'
import type {
  CoverageDerivation,
  DecisionOutcome,
  DecisionProvenance,
  DecisionRecord,
  Elimination,
  PremiseRef,
  ProvenanceRow,
  WhyNot,
} from './decision-schemas'
import { rawEntries, tagOf } from './decision-schemas'
import { categoryTone, formatEpochMs, humanize } from './decision-format'

/**
 * @file DecisionDetailPanel.tsx
 * @description EH-046's detail view: one committed `DecisionRecord` in full —
 * premises with their evidence classes, eliminations, coverage derivations,
 * the solve certificate or the typed abstention reasons, `why_not`, and
 * (from a second, independent query) every evaluation/resolution logged
 * against it. Pure rendering plus two `useQuery` reads; no local state of
 * its own beyond what React Query already owns.
 */

function CategoryBadge({ value }: { value: string | null | undefined }) {
  return (
    <Badge variant="outline" className={`text-[10px] ${categoryTone(value)}`}>
      {humanize(value)}
    </Badge>
  )
}

/** A small `{tag}` plus its remaining fields, rendered as `key: value` text —
 * the generic fallback for an open-record union payload (`Violation`,
 * `PremiseProvenance`, `AbstainReason`, ...) this view does not special-case. */
function TaggedFields({ value, tagKey }: { value: Record<string, unknown> | null | undefined; tagKey: string }) {
  const entries = rawEntries(value, tagKey)
  if (entries.length === 0) return null
  return (
    <span className="text-muted-foreground">
      {entries.map(([key, v]) => `${key}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')}
    </span>
  )
}

function RecordHeader({ record }: { record: DecisionRecord }) {
  const source = tagOf(record.candidate_source, 'source')
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <CategoryBadge value={record.outcome.outcome} />
        <CategoryBadge value={record.evidence_class} />
        <CategoryBadge value={record.resolution_kind} />
        <Badge variant="secondary" className="text-[10px]">
          {humanize(record.derivation_class)} derivation
        </Badge>
      </div>
      <p className="font-mono text-xs break-all text-foreground" title={record.record_id}>
        {record.record_id}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>Committed {formatEpochMs(record.created_at_ms)}</span>
        <span>Tenant {record.tenant_id}</span>
        <span>Caller {record.caller_principal}</span>
        {source && <span>Source {humanize(source)}</span>}
      </div>
    </div>
  )
}

function PremiseRow({ premise }: { premise: PremiseRef }) {
  const provenance = tagOf(premise.provenance, 'provenance')
  return (
    <div className="flex flex-wrap items-start gap-2 py-1.5 border-b border-border/20 last:border-0 text-xs">
      <CategoryBadge value={premise.class} />
      <span className="font-mono text-muted-foreground">{premise.subject}</span>
      <span className="text-muted-foreground">{premise.fact}</span>
      {provenance && (
        <span className="text-[10px] text-muted-foreground">
          via {humanize(provenance)} <TaggedFields value={premise.provenance} tagKey="provenance" />
        </span>
      )}
    </div>
  )
}

function PremisesSection({ premises }: { premises: PremiseRef[] }) {
  if (premises.length === 0) return null
  return (
    <section>
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
        Premises ({premises.length})
      </h4>
      <div>{premises.map((p, i) => <PremiseRow key={`${p.subject}:${p.fact}:${i}`} premise={p} />)}</div>
    </section>
  )
}

function EliminationRow({ item }: { item: Elimination }) {
  const violation = tagOf(item.violation, 'violation')
  return (
    <div className="flex flex-wrap items-center gap-2 py-1 text-xs">
      <span className="font-mono text-muted-foreground">{item.component_id}</span>
      <Badge variant="destructive" className="text-[9px]">
        {humanize(violation)}
      </Badge>
      <TaggedFields value={item.violation} tagKey="violation" />
    </div>
  )
}

function EliminatedSection({ eliminated }: { eliminated: Elimination[] }) {
  if (eliminated.length === 0) return null
  return (
    <section>
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
        Eliminated candidates ({eliminated.length})
      </h4>
      <div>{eliminated.map((e) => <EliminationRow key={e.component_id} item={e} />)}</div>
    </section>
  )
}

function DerivationRow({ derivation }: { derivation: CoverageDerivation }) {
  return (
    <div className="py-1.5 border-b border-border/20 last:border-0 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{derivation.required}</span>
        {derivation.covered_by ? (
          <span className="text-muted-foreground">covered by {derivation.covered_by}</span>
        ) : (
          <Badge variant="destructive" className="text-[9px]">
            uncovered
          </Badge>
        )}
      </div>
      {derivation.chain.length > 0 && (
        <ol className="mt-1 ml-3 space-y-0.5 text-[10px] text-muted-foreground list-decimal">
          {derivation.chain.map((edge, i) => (
            <li key={`${edge.narrower}-${edge.broader}-${i}`}>
              {edge.narrower} ⊑ {edge.broader} ({humanize(edge.class)}, via{' '}
              {humanize(tagOf(edge.source, 'edge'))})
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function DerivationsSection({ derivations }: { derivations: CoverageDerivation[] }) {
  if (derivations.length === 0) return null
  return (
    <section>
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
        Coverage derivations ({derivations.length})
      </h4>
      <div>{derivations.map((d) => <DerivationRow key={d.required} derivation={d} />)}</div>
    </section>
  )
}

function SolvedOutcome({ outcome }: { outcome: DecisionOutcome }) {
  const certificateEntries = rawEntries(outcome.certificate, '')
  return (
    <div className="space-y-2 text-xs">
      {outcome.graph_digest && (
        <p className="font-mono text-muted-foreground break-all">Graph {outcome.graph_digest}</p>
      )}
      {(outcome.slots ?? []).map((slot, i) => (
        <div key={`${slot.slot}-${i}`} className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-[9px]">
            {slot.slot}
          </Badge>
          <span className="text-muted-foreground">{JSON.stringify(slot.component)}</span>
        </div>
      ))}
      {certificateEntries.length > 0 && (
        <div className="rounded-md border border-border/30 bg-muted/10 p-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {certificateEntries.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{humanize(key)}</span>
              <span className="font-mono text-right">{typeof value === 'string' ? value : JSON.stringify(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AbstainedOutcome({ outcome }: { outcome: DecisionOutcome }) {
  const reasons = outcome.reasons ?? []
  if (reasons.length === 0) return <p className="text-xs text-muted-foreground">No reasons recorded.</p>
  return (
    <div className="space-y-1.5">
      {reasons.map((reason, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="text-[9px] bg-red-500/10 border-red-500/30 text-red-400">
            {humanize(tagOf(reason, 'reason'))}
          </Badge>
          <TaggedFields value={reason} tagKey="reason" />
        </div>
      ))}
    </div>
  )
}

function OutcomeSection({ outcome }: { outcome: DecisionOutcome }) {
  return (
    <section>
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Outcome</h4>
      {outcome.outcome === 'solved' ? <SolvedOutcome outcome={outcome} /> : <AbstainedOutcome outcome={outcome} />}
    </section>
  )
}

function WhyNotRow({ item }: { item: WhyNot }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-1 text-xs">
      <span className="font-mono text-muted-foreground">{item.component_id}</span>
      <Badge variant="secondary" className="text-[9px]">
        {item.slot}
      </Badge>
      {item.violation ? (
        <span className="text-muted-foreground">{humanize(tagOf(item.violation, 'violation'))}</span>
      ) : item.forced_objective !== undefined && item.forced_objective !== null ? (
        <span className="text-muted-foreground">objective {JSON.stringify(item.forced_objective)}</span>
      ) : null}
    </div>
  )
}

function WhyNotSection({ whyNot }: { whyNot: WhyNot[] }) {
  if (whyNot.length === 0) return null
  return (
    <section>
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
        Why not ({whyNot.length})
      </h4>
      <div>{whyNot.map((w, i) => <WhyNotRow key={`${w.component_id}-${w.slot}-${i}`} item={w} />)}</div>
    </section>
  )
}

function ProvenanceRowLine({ row, kind }: { row: ProvenanceRow; kind: 'evaluation' | 'resolution' }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-1 text-[11px]">
      <Badge variant="outline" className="text-[9px]">
        {kind}
      </Badge>
      {row.class && <CategoryBadge value={row.class} />}
      {row.resolver && <span className="text-muted-foreground">by {humanize(row.resolver)}</span>}
      {row.option_id && <span className="font-mono">{row.option_id}</span>}
      {row.producer && <span className="text-muted-foreground">producer {row.producer}</span>}
      {row.success !== null && row.success !== undefined && (
        <Badge variant={row.success ? 'secondary' : 'destructive'} className="text-[9px]">
          {row.success ? 'success' : 'failure'}
        </Badge>
      )}
      <span className="text-muted-foreground ml-auto">{formatEpochMs(row.recorded_at_ms)}</span>
    </div>
  )
}

function ProvenanceSection({ provenance }: { provenance: DecisionProvenance | undefined }) {
  const evaluations = provenance?.evaluations ?? []
  const resolutions = provenance?.resolutions ?? []
  if (evaluations.length === 0 && resolutions.length === 0) return null
  return (
    <section>
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Provenance</h4>
      <div>
        {evaluations.map((row, i) => (
          <ProvenanceRowLine key={`eval-${i}`} row={row} kind="evaluation" />
        ))}
        {resolutions.map((row, i) => (
          <ProvenanceRowLine key={`res-${i}`} row={row} kind="resolution" />
        ))}
      </div>
    </section>
  )
}

export default function DecisionDetailPanel({ recordId }: { recordId: string | null }) {
  const detailQuery = useQuery({
    queryKey: ['decision', recordId],
    queryFn: () => fetchDecision(recordId ?? ''),
    enabled: Boolean(recordId),
  })
  const provenanceQuery = useQuery({
    queryKey: ['decision-provenance', recordId],
    queryFn: () => fetchDecisionProvenance(recordId ?? ''),
    enabled: Boolean(recordId),
  })

  if (!recordId) {
    return (
      <Card className="border-border/30 bg-muted/5">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Select a decision to see its premises, derivations, certificate and why-not.
        </CardContent>
      </Card>
    )
  }
  if (detailQuery.isLoading) {
    return (
      <Card className="border-border/30 bg-muted/5">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">Loading decision…</CardContent>
      </Card>
    )
  }
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <Card className="border-border/30 bg-muted/5">
        <CardContent className="py-6">
          <UnavailableNotice what="This decision record" />
        </CardContent>
      </Card>
    )
  }

  const record = detailQuery.data
  return (
    <Card className="border-border/30 bg-card/60">
      <CardHeader>
        <CardTitle className="text-base font-bold">Decision</CardTitle>
        <RecordHeader record={record} />
      </CardHeader>
      <CardContent className="space-y-4">
        <OutcomeSection outcome={record.outcome} />
        <PremisesSection premises={record.premises} />
        <DerivationsSection derivations={record.derivations} />
        <EliminatedSection eliminated={record.eliminated} />
        <WhyNotSection whyNot={record.why_not} />
        <ProvenanceSection provenance={provenanceQuery.data} />
      </CardContent>
    </Card>
  )
}
