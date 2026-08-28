/**
 * @file TenantsPanel.tsx
 * @description Tenants / graphs overview for the Admin console.
 *
 * WIRING (honest):
 *   - Aggregate node/edge counts for the active graph:
 *     `GET /api/enhanced/graph/stats` — REAL.
 *   - Counts by node type: `GET /api/enhanced/graph/node-types` — REAL, and a
 *     genuine engine-side `GROUP BY` over every node. It is a SEPARATE request
 *     because it is 10-80x more expensive than the totals; what this panel used
 *     to show under "Counts by type" was neither this endpoint nor an
 *     aggregate.
 *   - Shard placement + default graph name: `GET /api/dashboard/daemon/shards`
 *     (`shard_topology_status()`) — REAL.
 *   - Indexed source tenants (the ingested source_systems): `GET
 *     /api/enhanced/code/instances` — REAL.
 *
 * The engine's full multi-tenant / graph ENUMERATION (a per-tenant catalog with
 * per-tenant counts) is only reachable over the engine's UDS client today, not
 * over the browser REST surface — so this panel presents the active graph as the
 * primary tenant (with real stats + real shard placement) and lists the indexed
 * source-systems, rather than fabricating a multi-tenant table. That limitation
 * is surfaced in the UI note below.
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, Boxes, Database, GitBranch, Loader2, Network, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import {
  fetchCodeInstances,
  fetchGraphNodeTypes,
  fetchGraphStats,
  fetchShardTopology,
  type GraphNodeTypes,
  type GraphStats,
  type ShardTopology,
} from '@/lib/admin-api'

function fmt(n: number | undefined): string {
  if (n === undefined) return '-'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function renderStatsSummary({
  stats,
  placement,
}: {
  stats: GraphStats | null
  placement: ShardTopology['endpoints']
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      <div className="rounded border p-3">
        <p className="text-sm text-muted-foreground">Nodes</p>
        <p className="text-2xl font-bold">{fmt(stats?.total_nodes)}</p>
      </div>
      <div className="rounded border p-3">
        <p className="text-sm text-muted-foreground">Relationships</p>
        <p className="text-2xl font-bold">{fmt(stats?.total_relationships)}</p>
      </div>
      <div className="rounded border p-3">
        <p className="text-sm text-muted-foreground">Shard placement</p>
        <p className="text-lg font-semibold">{placement.length ? `${String(placement.length)} shard(s)` : '-'}</p>
      </div>
    </div>
  )
}

function renderCountsByType({ byType, nodeTypes }: { byType: [string, number][]; nodeTypes: GraphNodeTypes | null }) {
  if (byType.length === 0) return null
  return (
    <div>
      <p className="text-sm font-medium mb-2 flex items-center gap-1">
        <Database className="size-3.5" />
        Counts by type
        <span className="text-muted-foreground font-normal">
          ({fmt(nodeTypes?.type_count)} types, {fmt(nodeTypes?.total_typed_nodes)} nodes)
        </span>
      </p>
      {nodeTypes?.partial === true && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="size-3.5 shrink-0" />
          Partial — excludes {nodeTypes.degraded_graphs.join(', ')}.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {byType.map(([type, count]) => (
          <Badge key={type} variant="outline" className="gap-1">
            {type}
            <span className="text-muted-foreground">{fmt(count)}</span>
          </Badge>
        ))}
      </div>
    </div>
  )
}

function renderPartialStatsNotice(stats: GraphStats | null) {
  if (stats?.partial !== true) return null
  return (
    <p className="flex items-center gap-1.5 text-xs text-amber-500">
      <AlertTriangle className="size-3.5 shrink-0" />
      These totals are partial — {(stats.degraded_graphs ?? []).join(', ')} could not be read.
    </p>
  )
}

function renderPlacementList(placement: ShardTopology['endpoints']) {
  if (placement.length === 0) return null
  return (
    <div>
      <p className="text-sm font-medium mb-2">Placed on</p>
      <div className="flex flex-wrap gap-2">
        {placement.map((ep) => (
          <Badge key={ep.endpoint} variant={ep.reachable ? 'default' : 'destructive'} className="font-mono text-xs gap-1">
            {ep.endpoint}
            {ep.local && <span className="opacity-70">· local</span>}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function renderActiveGraphCard({
  defaultGraph,
  stats,
  placement,
  byType,
  nodeTypes,
}: {
  defaultGraph: string
  stats: GraphStats | null
  placement: ShardTopology['endpoints']
  byType: [string, number][]
  nodeTypes: GraphNodeTypes | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Network className="size-4" />
          <span className="font-mono">{defaultGraph}</span>
          <Badge variant="secondary">active</Badge>
        </CardTitle>
        <CardDescription>The active graph tenant served by this backend.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {renderStatsSummary({ stats, placement })}
        {renderCountsByType({ byType, nodeTypes })}
        {renderPartialStatsNotice(stats)}
        {renderPlacementList(placement)}
      </CardContent>
    </Card>
  )
}

function renderIndexedSourcesBody({
  loading,
  sourcesUnavailable,
  sources,
}: {
  loading: boolean
  sourcesUnavailable: boolean
  sources: string[]
}) {
  if (loading) return <Loader2 className="size-4 animate-spin text-muted-foreground" />
  if (sourcesUnavailable) return <UnavailableNotice what="Indexed source tenants" />
  if (sources.length === 0) return <p className="text-muted-foreground text-sm">No indexed source tenants reported.</p>
  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((s) => (
        <Badge key={s} variant="secondary" className="font-mono text-xs">
          {s}
        </Badge>
      ))}
    </div>
  )
}

export default function TenantsPanel() {
  const [stats, setStats] = useState<GraphStats | null>(null)
  const [nodeTypes, setNodeTypes] = useState<GraphNodeTypes | null>(null)
  const [topology, setTopology] = useState<ShardTopology | null>(null)
  const [sources, setSources] = useState<string[]>([])
  // BUG-008 (dashboard-wide follow-on, GOC-28-W06): a failed `/enhanced/code/
  // instances` fetch left `sources` at `[]` with no distinguishing state, so
  // "No indexed source tenants reported." rendered identically for a real
  // fresh-install zero and a fetch failure.
  const [sourcesUnavailable, setSourcesUnavailable] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    const [st, top, src, nt] = await Promise.all([
      fetchGraphStats(),
      fetchShardTopology(),
      fetchCodeInstances(),
      fetchGraphNodeTypes(),
    ])
    setStats(st.ok ? st.data : null)
    setNodeTypes(nt.ok ? nt.data : null)
    setTopology(top.ok ? top.data : null)
    setSources(src.ok && src.data ? src.data.source_systems : [])
    setSourcesUnavailable(!src.ok)
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const defaultGraph = topology?.default_graph ?? '__commons__'
  const placement = topology?.endpoints ?? []
  // The real distribution, descending. Previously `stats.by_type`, which the
  // backend could not actually compute inside its budget — so this section was
  // either empty or (as rendered elsewhere in the app) a 256-row sample.
  const byType = Object.entries(nodeTypes?.by_type ?? {}).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-6" data-testid="admin-tenants-panel">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Boxes className="size-5" />
            Tenants &amp; Graphs
          </h2>
          <p className="text-muted-foreground text-sm">Per-tenant node/edge counts and shard placement.</p>
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

      {/* Active graph tenant — REAL stats + placement */}
      {renderActiveGraphCard({ defaultGraph, stats, placement, byType, nodeTypes })}

      {/* Indexed source tenants — REAL */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="size-4" />
            Indexed source tenants
          </CardTitle>
          <CardDescription>Ingested source-systems that carry code in the graph.</CardDescription>
        </CardHeader>
        <CardContent>{renderIndexedSourcesBody({ loading, sourcesUnavailable, sources })}</CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Note: full multi-tenant enumeration (a per-tenant catalog with per-tenant counts) is not yet exposed over the
        REST surface — the engine tenant catalog is reachable only over the UDS client. This panel shows the active
        graph with real statistics and shard placement plus indexed source tenants.
      </p>
    </div>
  )
}
