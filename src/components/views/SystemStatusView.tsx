/**
 * @file SystemStatusView.tsx
 * @description KV-cache stats + capability status board over the gateway.
 *
 * Renders the KV-cache statistics from `/graph/kvcache` (hit rate, entries,
 * bytes, offloads) as KPI cards, and probes the other newly-exposed capability
 * routes (federated search, GIS, agent-memory, message broker, PromQL, traces,
 * NL→query, data-analyst) plus the multi-DB drop-in wire protocols, showing a
 * live availability board so operators can see what is activated on the backend.
 */

import { useEffect, useState, type ReactElement } from 'react'
import { CheckCircle2, Database, Gauge, HardDrive, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { gatewayGet, gatewayPost } from '@/lib/gateway'

interface KvStats {
  entries?: number
  bytes?: number
  hits?: number
  misses?: number
  hit_rate?: number
  offloads?: number
  backend?: string
}

interface Probe {
  label: string
  route: string
  method: 'GET' | 'POST'
  state: 'checking' | 'live' | 'unavailable' | 'error'
}

const INITIAL_PROBES: Probe[] = [
  { label: 'PromQL metrics', route: '/promql', method: 'POST', state: 'checking' },
  { label: 'Traces', route: '/traces', method: 'GET', state: 'checking' },
  { label: 'Message broker', route: '/broker', method: 'POST', state: 'checking' },
  { label: 'Federated search', route: '/federated-search', method: 'POST', state: 'checking' },
  { label: 'GIS / geo', route: '/gis', method: 'POST', state: 'checking' },
  { label: 'Agent memory', route: '/memory', method: 'POST', state: 'checking' },
  { label: 'NL → query', route: '/nl-query', method: 'POST', state: 'checking' },
  { label: 'Data analyst', route: '/ask-data', method: 'POST', state: 'checking' },
]

/** Multi-DB drop-in wire protocols the engine speaks (informational). */
const WIRE_PROTOCOLS = ['Postgres', 'Neo4j-Bolt', 'Timescale', 'Redis', 'SQL/DataFusion']

function fmt(n: number | undefined): string {
  if (n === undefined) return '-'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtBytes(n: number | undefined): string {
  if (n === undefined) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v.toFixed(1)} ${units[u]}`
}

function Kpi({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Gauge }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
          <Icon className="size-8 text-muted-foreground/40" />
        </div>
      </CardContent>
    </Card>
  )
}

/** Dispatch table: probe `state` -> the badge that represents it. */
const PROBE_STATE_BADGE: Record<Probe['state'], ReactElement> = {
  checking: <Loader2 className="size-4 animate-spin text-muted-foreground" />,
  live: (
    <Badge variant="default" className="gap-1">
      <CheckCircle2 className="size-3" />
      live
    </Badge>
  ),
  unavailable: (
    <Badge variant="outline" className="gap-1">
      <XCircle className="size-3" />
      not wired
    </Badge>
  ),
  error: (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="size-3" />
      error
    </Badge>
  ),
}

function ProbeRow({ probe }: { probe: Probe }) {
  return (
    <div className="flex items-center justify-between rounded border p-2 text-sm">
      <div className="flex flex-col">
        <span className="font-medium">{probe.label}</span>
        <span className="font-mono text-xs text-muted-foreground">/graph{probe.route}</span>
      </div>
      {PROBE_STATE_BADGE[probe.state]}
    </div>
  )
}

function deriveHitRate(stats: KvStats | null): number | undefined {
  if (stats?.hit_rate !== undefined) return stats.hit_rate
  if (stats?.hits === undefined || stats.misses === undefined) return undefined
  return stats.hits / Math.max(stats.hits + stats.misses, 1)
}

function KvCacheSection({ stats, kvUnavailable }: { stats: KvStats | null; kvUnavailable: boolean }) {
  const hitRate = deriveHitRate(stats)
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <HardDrive className="size-5" />
        KV-Cache
        {stats?.backend && (
          <Badge variant="secondary" className="font-mono text-xs">
            {stats.backend}
          </Badge>
        )}
      </h2>
      {kvUnavailable ? (
        <p className="text-muted-foreground text-sm">
          The `/graph/kvcache` route is not activated on this backend yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi label="Hit rate" value={hitRate !== undefined ? `${(hitRate * 100).toFixed(1)}%` : '-'} icon={Gauge} />
          <Kpi label="Entries" value={fmt(stats?.entries)} icon={Database} />
          <Kpi label="Size" value={fmtBytes(stats?.bytes)} icon={HardDrive} />
          <Kpi label="Offloads" value={fmt(stats?.offloads)} icon={HardDrive} />
        </div>
      )}
    </div>
  )
}

export default function SystemStatusView() {
  const [stats, setStats] = useState<KvStats | null>(null)
  const [kvUnavailable, setKvUnavailable] = useState(false)
  const [loading, setLoading] = useState(false)
  const [probes, setProbes] = useState<Probe[]>(INITIAL_PROBES)

  const refresh = async () => {
    setLoading(true)
    setProbes(INITIAL_PROBES.map((p) => ({ ...p, state: 'checking' })))

    const kv = await gatewayGet<KvStats>('/kvcache')
    setKvUnavailable(kv.unavailable)
    setStats(kv.ok ? kv.data : null)

    const results = await Promise.all(
      INITIAL_PROBES.map(async (p) => {
        const r = p.method === 'GET' ? await gatewayGet<unknown>(p.route) : await gatewayPost<unknown>(p.route, {})
        const state: Probe['state'] = r.ok ? 'live' : r.unavailable ? 'unavailable' : 'error'
        return { ...p, state }
      }),
    )
    setProbes(results)
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <div className="space-y-6" data-testid="system-status-view">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Gauge className="size-6" />
            System Status
          </h1>
          <p className="text-muted-foreground text-sm">KV-cache statistics and gateway capability availability.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void refresh()
          }}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      <KvCacheSection stats={stats} kvUnavailable={kvUnavailable} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Capability Availability</CardTitle>
          <CardDescription>Live probe of the newly-exposed gateway `/graph/*` routes.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {probes.map((p) => (
              <ProbeRow key={p.route} probe={p} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Multi-DB Drop-in Wire Protocols</CardTitle>
          <CardDescription>Protocols the epistemic-graph engine speaks natively.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {WIRE_PROTOCOLS.map((w) => (
              <Badge key={w} variant="secondary" className="gap-1">
                <Database className="size-3" />
                {w}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
