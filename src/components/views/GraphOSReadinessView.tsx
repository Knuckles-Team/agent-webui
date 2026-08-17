/**
 * @file GraphOSReadinessView.tsx
 * @description Renders the ONE truthful `graphos.readiness.v1` snapshot
 * (GOC-02, `lib/readiness-api.ts`).
 *
 * The program charter this view answers to: WebUI never fabricates state. An
 * independent audit found readiness/health can report GREEN before the graph
 * can actually answer a query (liveness != readiness) — this view's entire
 * job is to show the backend's real verdict, including every reason/failure
 * mode, and to NEVER soften `degraded`/`unavailable`/`stale` into something
 * that reads as fine. No polling optimism, no cached "last known good", no
 * client-side rollup recompute — `overall` and each check's `state` are
 * rendered exactly as the backend reported them.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  fetchReadinessSnapshot,
  isReadinessReady,
  READINESS_CHECK_LABELS,
  READINESS_CHECK_ORDER,
  type ReadinessCheck,
  type ReadinessSnapshot,
  type ReadinessState,
} from '@/lib/readiness-api'

const STATE_STYLE: Record<ReadinessState, string> = {
  ready: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  degraded: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  unavailable: 'bg-destructive/15 text-destructive',
  stale: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  not_configured: 'bg-muted text-muted-foreground',
}

const STATE_LABEL: Record<ReadinessState, string> = {
  ready: 'Ready',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
  stale: 'Stale',
  not_configured: 'Not configured',
}

function StateIcon({ state }: { state: ReadinessState }) {
  switch (state) {
    case 'ready':
      return <CheckCircle2 className="size-4" />
    case 'degraded':
    case 'stale':
      return <AlertTriangle className="size-4" />
    case 'unavailable':
      return <XCircle className="size-4" />
    default:
      return <HelpCircle className="size-4" />
  }
}

function StateBadge({ state }: { state: ReadinessState }) {
  return (
    <Badge variant="outline" className={STATE_STYLE[state]}>
      <StateIcon state={state} />
      {STATE_LABEL[state]}
    </Badge>
  )
}

/** Best-effort, defensive read of the few extra fields checks commonly carry
 * (evidence_count, coverage_pct, expected/covered, missing, digest, …) —
 * never assumed present, since each check kind carries a different subset. */
function checkDetailLine(check: ReadinessCheck): string | null {
  const parts: string[] = []
  if (typeof check.evidence_count === 'number') parts.push(`evidence: ${String(check.evidence_count)}`)
  if (typeof check.coverage_pct === 'number') parts.push(`coverage: ${check.coverage_pct.toFixed(1)}%`)
  if (typeof check.covered === 'number' && typeof check.expected === 'number') {
    parts.push(`${String(check.covered)}/${String(check.expected)} connectors`)
  }
  if (typeof check.count === 'number') parts.push(`${String(check.count)} routes resolved`)
  if (Array.isArray(check.missing) && check.missing.length > 0) {
    parts.push(`missing: ${check.missing.slice(0, 4).join(', ')}${check.missing.length > 4 ? '…' : ''}`)
  }
  if (typeof check.latency_ms === 'number') parts.push(`${check.latency_ms.toFixed(1)}ms`)
  return parts.length > 0 ? parts.join(' · ') : null
}

function CheckRow({ name, check }: { name: keyof typeof READINESS_CHECK_LABELS; check: ReadinessCheck }) {
  const label = READINESS_CHECK_LABELS[name]
  const detail = checkDetailLine(check)
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 font-medium text-sm">{label}</td>
      <td className="py-2 pr-4">
        <StateBadge state={check.state} />
      </td>
      <td className="py-2 pr-4 text-sm text-muted-foreground">{check.reason ?? '—'}</td>
      <td className="py-2 text-sm text-muted-foreground">{detail ?? '—'}</td>
    </tr>
  )
}

export default function GraphOSReadinessView() {
  const [snapshot, setSnapshot] = useState<ReadinessSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unavailableRoute, setUnavailableRoute] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    setUnavailableRoute(false)
    fetchReadinessSnapshot()
      .then((res) => {
        if (res.unavailable) {
          setUnavailableRoute(true)
          setSnapshot(null)
          return
        }
        if (!res.ok || !res.data) {
          // A validation/transport failure must NEVER be shown as a readiness
          // state — it is a "we don't know", rendered distinctly from every
          // real backend-reported state.
          setError(res.error ?? 'Readiness snapshot request failed')
          setSnapshot(null)
          return
        }
        setSnapshot(res.data)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setSnapshot(null)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">GraphOS Readiness</h1>
          <p className="text-sm text-muted-foreground">
            Live <code>graphos.readiness.v1</code> snapshot — engine, identity/policy, catalog, source sync,
            dense/sparse index, and a real synthetic query. Never derived from liveness alone.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>

      {unavailableRoute && (
        <Card>
          <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <HelpCircle className="size-4 shrink-0" />
            The readiness capability is not activated on this backend yet (route not served). This is not a claim about
            graph readiness — it is an unreached endpoint.
          </CardContent>
        </Card>
      )}

      {error && !unavailableRoute && (
        <Card>
          <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
            <XCircle className="size-4 shrink-0" />
            {error}
          </CardContent>
        </Card>
      )}

      {snapshot && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Overall</CardTitle>
                <CardDescription>
                  Observed {snapshot.observed_at} · <code className="text-xs">{snapshot.snapshot_id}</code>
                </CardDescription>
              </div>
              <StateBadge state={snapshot.overall} />
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {snapshot.required_failures.length > 0 && (
                <div className="flex items-start gap-2 text-destructive">
                  <XCircle className="size-4 mt-0.5 shrink-0" />
                  <span>Required check(s) failing: {snapshot.required_failures.join(', ')}</span>
                </div>
              )}
              {snapshot.degraded_reasons.length > 0 && (
                <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  <ul className="list-disc pl-4">
                    {snapshot.degraded_reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              {snapshot.required_failures.length === 0 && snapshot.degraded_reasons.length === 0 && (
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" />
                  Every check reported ready.
                </div>
              )}
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="size-3.5" />
                Refresh mode: {snapshot.refresh.mode}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Checks</CardTitle>
              <CardDescription>
                Every check the backend runs on this probe — none are skipped or cached.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b text-xs uppercase text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">Check</th>
                      <th className="pb-2 pr-4 font-medium">State</th>
                      <th className="pb-2 pr-4 font-medium">Reason</th>
                      <th className="pb-2 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {READINESS_CHECK_ORDER.map((name) => (
                      <CheckRow key={name} name={name} check={snapshot.checks[name]} />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!snapshot && !error && !unavailableRoute && loading && (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Running the live readiness probe…
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** Exported for tests / capability-gated action callers — the ONE place a
 * caller should decide "can I show the readiness-gated action" from. */
export { isReadinessReady }
