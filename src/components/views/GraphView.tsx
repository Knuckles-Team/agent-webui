import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Network,
  Terminal,
  Brain,
  RefreshCw,
  Database,
  Play,
  Layers,
  Sparkles,
  ShieldAlert,
  AlertTriangle,
  Inbox,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { z } from 'zod'
import { ApiError, fetchValidated, looseArray } from '@/lib/api-validation'
import { GraphCanvas } from '../knowledge-graph/GraphCanvas'
import { NodeTypeBreakdown, type NodeTypeBreakdownData } from '../knowledge-graph/NodeTypeBreakdown'
import { usePageContextPublisher, type PageContextContribution } from '@/lib/page-context'

interface GraphNode {
  id: string
  labels: string[]
  properties: Record<string, unknown>
}

interface GraphRelationship {
  source: string
  type: string
  target: string
}

interface GraphStats {
  total_nodes: number
  total_relationships: number
  // Absent (older backend) is treated as available — only an explicit `false`
  // means the engine reported itself unreachable/uninitialized. Distinct from
  // a genuinely empty graph: see GraphLoadStatus's 'unavailable' kind below.
  available?: boolean
  // Union-read provenance. The backend has always returned these; this schema
  // used to strip them, so a read that silently skipped a whole graph rendered
  // byte-identically to a complete one. Kept and surfaced (see the `partial`
  // banner in the render) — that is the defect class this program has now hit
  // four separate times.
  source_graphs?: string[]
  degraded_graphs?: string[]
  partial?: boolean
}

// D-WUI-6 (hostile-payload update, additive to the pre-existing
// usePageContextPublisher/PageContextProvider defect this item already
// tracks) — GraphView crashed on `null`/`{}`/error-body responses because
// none of the three fetches checked `res.ok` or validated the shape before
// casting. Validating each independently (rather than one schema over
// `Promise.all`'s tuple) means one bad endpoint doesn't wipe out data that
// loaded fine from the other two.
const graphNodeSchema: z.ZodType<GraphNode> = z.object({
  id: z.string(),
  labels: looseArray(z.string()),
  properties: z.record(z.string(), z.unknown()),
})
const graphRelationshipSchema: z.ZodType<GraphRelationship> = z.object({
  source: z.string(),
  type: z.string(),
  target: z.string(),
})
const graphStatsSchema: z.ZodType<GraphStats> = z.object({
  total_nodes: z.number(),
  total_relationships: z.number(),
  // Not stripped: `available: false` is how the backend distinguishes "the
  // engine is unreachable/uninitialized" from a real, connected, empty graph
  // (both otherwise render as total_nodes: 0). Dropping this field here was
  // the actual bug — the API always returned it honestly, but the schema
  // discarded it before the component ever saw it. `partial`/`degraded_graphs`
  // were being dropped the same way, for the same reason, with the same
  // consequence: a degraded read rendered as an authoritative one.
  available: z.boolean().optional(),
  source_graphs: looseArray(z.string()).optional(),
  degraded_graphs: looseArray(z.string()).optional(),
  partial: z.boolean().optional(),
})

// `/graph/node-types` — the real engine-side `GROUP BY`. Loaded independently
// of `/graph/stats` because it is 10-80x more expensive (measured 5.5s-22.4s
// vs ~0.1-1.6s on the same graph); coupling them meant the fast, trustworthy
// totals waited on the slow aggregate, or the aggregate was cut to fit.
const nodeTypeBreakdownSchema: z.ZodType<NodeTypeBreakdownData> = z.object({
  by_type: z.record(z.string(), z.number()),
  type_count: z.number(),
  total_typed_nodes: z.number(),
  truncated: z.boolean(),
  available: z.boolean(),
  source_graphs: looseArray(z.string()),
  degraded_graphs: looseArray(z.string()),
  partial: z.boolean(),
})

// GOC-60-W05 (E1b layer 3 / E6): `fetchData` used to `.catch(() => null)` each of the
// three requests independently and fall back to one generic toast on any failure —
// an authorization denial (403, e.g. from a nav/policy drift like the one this lane
// fixes) was therefore visually indistinguishable from a genuinely empty graph: both
// left `nodes`/`relationships` at their `[]` default and rendered a blank canvas. This
// type makes the three cases explicit so the render can tell the difference:
//   - `ready`    all three requests succeeded and returned at least one node.
//   - `empty`    all three requests succeeded but the graph genuinely has no nodes.
//   - `degraded` some requests succeeded and some failed — partial data is shown,
//                with the failed ones named.
//   - `error`    every request failed — no data at all — naming the reason (an
//                authorization denial vs. any other fetch/shape failure) rather than
//                rendering the same blank canvas an empty graph would show.
type GraphLoadStatus =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'empty' }
  // The `/graph/stats` request itself succeeded (HTTP 200, valid shape) but
  // the backend honestly reported `available: false` — the engine handle
  // could not be acquired server-side (e.g. an identity/authorization gap
  // between the app and the graph engine). This is NOT the same as `empty`:
  // an empty graph means "connected, genuinely zero nodes"; `unavailable`
  // means "we don't actually know how many nodes there are." Rendering both
  // the same way is the exact defect this kind exists to prevent.
  | { kind: 'unavailable' }
  | { kind: 'degraded'; failed: string[]; forbidden: boolean }
  | { kind: 'error'; failed: string[]; forbidden: boolean }

const GRAPH_FETCH_LABELS = ['stats', 'nodes', 'relationships'] as const

// Defect A fix: `stats.total_nodes`/`stats.total_relationships` sit at their
// `useState` initial value of `0` until a stats fetch actually resolves —
// `setStats()` only ever runs on the fulfilled branch. That 0 is
// indistinguishable from a real, connected, empty graph unless the render
// also checks whether the fetch that would have supplied a real number
// actually succeeded. `'unavailable'` already means "the request succeeded
// but the backend honestly disclaimed the number" — this extends the same
// treatment to `'degraded'`/`'error'`, but only when the stats request
// itself is one of the ones that failed (a `degraded` load where only
// nodes/relationships failed still has a trustworthy stats number and
// should keep showing it).
function isStatsUnreliable(status: GraphLoadStatus): boolean {
  if (status.kind === 'unavailable') return true
  if (status.kind === 'degraded' || status.kind === 'error') return status.failed.includes('stats')
  return false
}

export default function GraphView() {
  const [stats, setStats] = useState<GraphStats>({ total_nodes: 0, total_relationships: 0 })
  const [breakdown, setBreakdown] = useState<NodeTypeBreakdownData | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(true)
  const [breakdownError, setBreakdownError] = useState<string | null>(null)
  // `null` = the canvas is showing its unfiltered, budget-capped sample.
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [relationships, setRelationships] = useState<GraphRelationship[]>([])
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadStatus, setLoadStatus] = useState<GraphLoadStatus>({ kind: 'loading' })
  const [activeTab, setActiveTab] = useState('visualization')

  // Cypher states
  const [cypherQuery, setCypherQuery] = useState('MATCH (n) RETURN n LIMIT 15')
  const [cypherResults, setCypherResults] = useState<unknown[] | null>(null)
  const [executingCypher, setExecutingCypher] = useState(false)

  // MAGMA states
  const [magmaQuery, setMagmaQuery] = useState('')
  const [magmaView, setMagmaView] = useState<'semantic' | 'structural' | 'temporal' | 'hybrid'>('semantic')
  const [magmaResults, setMagmaResults] = useState<unknown[] | null>(null)
  const [retrievingMagma, setRetrievingMagma] = useState(false)

  const pageContext = useMemo<PageContextContribution>(
    () => ({
      selection: selectedNode
        ? [
            {
              kind: 'graph-node',
              id: selectedNode.id,
              label:
                typeof selectedNode.properties.name === 'string'
                  ? selectedNode.properties.name
                  : selectedNode.labels.join(', ') || selectedNode.id,
            },
          ]
        : [],
      filters: {
        workspaceTab: activeTab,
        ...(activeTab === 'cypher' ? { query: cypherQuery } : {}),
        ...(activeTab === 'magma' ? { query: magmaQuery, magmaView } : {}),
      },
      allowedActions: [
        { id: 'refresh-graph', label: 'Refresh graph data', kind: 'read' },
        { id: 'query-graph', label: 'Run the visible graph query', kind: 'read' },
        ...(selectedNode ? [{ id: 'inspect-node', label: 'Inspect the selected node', kind: 'read' as const }] : []),
      ],
    }),
    [activeTab, cypherQuery, magmaQuery, magmaView, selectedNode],
  )
  usePageContextPublisher(pageContext)

  useEffect(() => {
    void fetchData()
    // Deliberately a SEPARATE request with its own lifecycle: the breakdown is
    // slow by nature, and nothing else on this page should wait for it.
    void fetchBreakdown()
  }, [])

  // Re-fetch only the node page when the type filter changes — including
  // back to "All types", so clearing a filter actually clears the canvas
  // rather than leaving the last drill-down on screen. The totals and the
  // distribution describe the whole graph and do not depend on the filter.
  // `filterMounted` skips the first run, whose fetch `fetchData()` above
  // already issued.
  const filterMounted = useRef(false)
  useEffect(() => {
    if (!filterMounted.current) {
      filterMounted.current = true
      return
    }
    void fetchNodes(typeFilter)
  }, [typeFilter])

  const fetchBreakdown = async () => {
    setBreakdownLoading(true)
    setBreakdownError(null)
    try {
      setBreakdown(await fetchValidated('/api/enhanced/graph/node-types', nodeTypeBreakdownSchema))
    } catch (err) {
      setBreakdown(null)
      setBreakdownError(err instanceof Error ? err.message : String(err))
    } finally {
      setBreakdownLoading(false)
    }
  }

  const fetchNodes = async (nodeType: string | null) => {
    const path =
      nodeType === null
        ? '/api/enhanced/graph/nodes'
        : `/api/enhanced/graph/nodes?node_type=${encodeURIComponent(nodeType)}`
    try {
      setNodes(await fetchValidated(path, looseArray(graphNodeSchema)))
    } catch {
      toast.error(`Could not load ${nodeType ?? 'graph'} nodes.`)
    }
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      const [statsResult, nodesResult, relsResult] = await Promise.allSettled([
        fetchValidated('/api/enhanced/graph/stats', graphStatsSchema),
        fetchValidated(
          typeFilter === null
            ? '/api/enhanced/graph/nodes'
            : `/api/enhanced/graph/nodes?node_type=${encodeURIComponent(typeFilter)}`,
          looseArray(graphNodeSchema),
        ),
        fetchValidated('/api/enhanced/graph/relationships', looseArray(graphRelationshipSchema)),
      ])
      const results = [statsResult, nodesResult, relsResult]

      const failed: string[] = []
      let forbidden = false
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          failed.push(GRAPH_FETCH_LABELS[i])
          if (result.reason instanceof ApiError && (result.reason.status === 401 || result.reason.status === 403)) {
            forbidden = true
          }
        }
      })

      let nextStats = stats
      if (statsResult.status === 'fulfilled') {
        nextStats = statsResult.value
        setStats(statsResult.value)
      }
      let nextNodes = nodes
      if (nodesResult.status === 'fulfilled') {
        nextNodes = nodesResult.value
        setNodes(nodesResult.value)
      }
      if (relsResult.status === 'fulfilled') setRelationships(relsResult.value)

      if (failed.length === results.length) {
        setLoadStatus({ kind: 'error', failed, forbidden })
        toast.error(
          forbidden
            ? "You don't have permission to view the knowledge graph."
            : 'The knowledge graph is unavailable right now.',
        )
      } else if (nextStats.available === false) {
        // The backend answered (this wasn't a fetch failure) but explicitly
        // disclaimed its own numbers: `available: false` means the graph
        // engine handle could not be acquired server-side, so total_nodes: 0
        // is not "the graph is empty" — it's "we don't know." Checked before
        // the `empty` branch below so this honest signal isn't rendered as a
        // connected-but-empty graph.
        setLoadStatus({ kind: 'unavailable' })
        toast.error('The knowledge graph engine is not available right now.')
      } else if (failed.length > 0) {
        setLoadStatus({ kind: 'degraded', failed, forbidden })
        toast.error(`Partial graph data: ${failed.join(', ')} failed to load.`)
      } else if (nextStats.total_nodes === 0 && nextNodes.length === 0) {
        setLoadStatus({ kind: 'empty' })
      } else {
        setLoadStatus({ kind: 'ready' })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateNode = (id: string, properties: Record<string, unknown>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, properties: { ...n.properties, ...properties } } : n)))
  }

  const handleDeleteNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id))
    setRelationships((prev) => prev.filter((e) => e.source !== id && e.target !== id))
  }

  const handleAddNode = (labels: string[], properties: Record<string, unknown>) => {
    const newNode: GraphNode = {
      id: `node_${Date.now()}`,
      labels,
      properties,
    }
    setNodes((prev) => [...prev, newNode])
  }

  const runCypherQuery = async () => {
    if (!cypherQuery.trim()) return
    setExecutingCypher(true)
    try {
      const data = await fetchValidated('/api/enhanced/graph/query', looseArray(z.unknown()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: cypherQuery }),
      })
      setCypherResults(data)
      toast.success('Cypher query completed')
    } catch (err) {
      toast.error(`Cypher Execution Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExecutingCypher(false)
    }
  }

  const runMagmaRetrieve = async () => {
    if (!magmaQuery.trim()) return
    setRetrievingMagma(true)
    try {
      const data = await fetchValidated('/api/enhanced/graph/magma', looseArray(z.unknown()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: magmaQuery,
          view_type: magmaView,
        }),
      })
      setMagmaResults(data)
      toast.success('MAGMA orthogonal context retrieved')
    } catch {
      toast.error('Error during MAGMA contextual scan')
    } finally {
      setRetrievingMagma(false)
    }
  }

  return (
    <div className="space-y-6 h-[calc(100vh-12rem)] flex flex-col">
      {/* Dynamic Summary Cards */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
        <div>
          <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-500 flex items-center gap-2">
            <Network className="size-6 text-emerald-400" />
            Unified Graph Workspace
          </h2>
          <p className="text-sm text-muted-foreground">
            Execute cypher commands, traverse MAGMA orthogonal contexts, and view live active clusters.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Badge variant="outline" className="h-7 bg-muted/20 border-border/40 text-xs">
            Nodes: {isStatsUnreliable(loadStatus) ? '—' : stats.total_nodes}
          </Badge>
          <Badge variant="outline" className="h-7 bg-muted/20 border-border/40 text-xs">
            Edges: {isStatsUnreliable(loadStatus) ? '—' : stats.total_relationships}
          </Badge>
          {/* The backend has always reported when a union read skipped a graph.
              The zod schema above used to strip `partial`/`degraded_graphs`, so
              a half-read total rendered as an authoritative one. Surfaced here
              rather than merely un-stripped: an honest field nobody renders is
              still a silent degrade. */}
          {stats.partial === true && (
            <Badge
              variant="outline"
              className="h-7 border-amber-500/40 bg-amber-500/10 text-xs text-amber-500"
              data-testid="graph-stats-partial"
              title={`These totals exclude: ${(stats.degraded_graphs ?? []).join(', ')}`}
            >
              <AlertTriangle className="mr-1 size-3" />
              Partial
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void fetchData()
              void fetchBreakdown()
            }}
            disabled={loading}
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Structured Graph Tab List */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="grid w-full grid-cols-3 max-w-lg bg-muted/30 p-1 shrink-0 border border-border/40 rounded-xl">
          <TabsTrigger value="visualization" className="gap-1.5 text-xs">
            <Network className="size-3.5" />
            Visual Canvas
          </TabsTrigger>
          <TabsTrigger value="cypher" className="gap-1.5 text-xs">
            <Terminal className="size-3.5" />
            Cypher Console
          </TabsTrigger>
          <TabsTrigger value="magma" className="gap-1.5 text-xs">
            <Brain className="size-3.5" />
            MAGMA Context
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Network Visualization.

            Layout change, and the reason for it: on a 25k-node graph the canvas
            can only ever show a bounded sample, so the sample cannot be the
            whole view. The real type distribution sits permanently beside it
            and doubles as the filter — read the shape of the graph, click a
            type, and the canvas becomes a drill-down into something you chose
            rather than an arbitrary slice you didn't. */}
        <TabsContent value="visualization" className="flex-1 overflow-hidden mt-4">
          <Card className="h-full border-border/40 bg-card/60 backdrop-blur-md flex flex-row">
            <div className="hidden w-56 shrink-0 border-r border-border/30 md:block">
              <NodeTypeBreakdown
                data={breakdown}
                loading={breakdownLoading}
                error={breakdownError}
                selectedType={typeFilter}
                onSelectType={setTypeFilter}
              />
            </div>
            <CardContent className="flex-1 p-0 relative overflow-hidden h-full min-h-[450px]">
              {activeTab === 'visualization' && loadStatus.kind === 'error' && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 p-8">
                  <ShieldAlert className="size-10 text-red-400" />
                  <p className="text-sm font-semibold">
                    {loadStatus.forbidden
                      ? "You don't have permission to view the knowledge graph."
                      : 'The knowledge graph is unavailable right now.'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Failed to load: {loadStatus.failed.join(', ')}
                    {loadStatus.forbidden ? ' (403 Forbidden)' : ''}
                  </p>
                </div>
              )}
              {activeTab === 'visualization' && loadStatus.kind === 'empty' && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 p-8">
                  <Inbox className="size-10 text-muted-foreground/40" />
                  <p className="text-sm font-semibold text-muted-foreground">The knowledge graph has no nodes yet.</p>
                </div>
              )}
              {activeTab === 'visualization' && loadStatus.kind === 'unavailable' && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2 p-8">
                  <Database className="size-10 text-amber-500" />
                  <p className="text-sm font-semibold">The knowledge graph engine is not available right now.</p>
                  <p className="text-xs text-muted-foreground">
                    The server could not obtain a graph engine handle for this request. This is not the same as an
                    empty graph — retry shortly, or check the server's graph engine status if it persists.
                  </p>
                </div>
              )}
              {activeTab === 'visualization' &&
                (loadStatus.kind === 'ready' || loadStatus.kind === 'degraded' || loadStatus.kind === 'loading') && (
                  <>
                    {loadStatus.kind === 'degraded' && (
                      <div className="absolute top-2 left-2 right-2 z-10 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-500">
                        <AlertTriangle className="size-3.5 shrink-0" />
                        <span>
                          Showing partial data — {loadStatus.failed.join(', ')} failed to load
                          {loadStatus.forbidden ? ' (permission denied)' : ''}.
                        </span>
                      </div>
                    )}
                    {/* The canvas is a bounded sample and must say so. Before
                        this, 256 nodes out of 25,121 rendered with nothing to
                        distinguish them from "the graph" — and unfiltered, they
                        are not even a random 256: `/graph/nodes` fills its
                        budget by draining labels in `db.labels()` order, so it
                        returns the alphabetically-first labels and never
                        reaches RuntimeSignal/WorkItem/Concept at all. */}
                    <div
                      className="absolute top-2 right-2 z-10 rounded-md border border-border/40 bg-card/90 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur-sm"
                      data-testid="graph-sample-notice"
                    >
                      {typeFilter === null
                        ? `Sample: ${String(nodes.length)} of ${isStatsUnreliable(loadStatus) ? '?' : stats.total_nodes.toLocaleString()} nodes — pick a type to drill down`
                        : `${typeFilter}: showing ${String(nodes.length)} of ${(breakdown?.by_type[typeFilter] ?? nodes.length).toLocaleString()}`}
                    </div>
                    <GraphCanvas
                      nodes={nodes}
                      relationships={relationships}
                      onUpdateNode={handleUpdateNode}
                      onDeleteNode={handleDeleteNode}
                      onAddNode={handleAddNode}
                      selectedNodeExternally={selectedNode}
                      onSelectNode={setSelectedNode}
                    />
                  </>
                )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Cypher Console Terminal */}
        <TabsContent value="cypher" className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden mt-4">
          <Card className="lg:col-span-1 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/30">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Terminal className="size-4 text-emerald-400" />
                Query Editor
              </CardTitle>
              <CardDescription>Enter Cypher graph query syntax.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-4 gap-4">
              <Textarea
                value={cypherQuery}
                onChange={(e) => {
                  setCypherQuery(e.target.value)
                }}
                className="flex-1 font-mono text-xs bg-muted/10 border-border/40 p-3 resize-none h-[250px] lg:h-auto"
                placeholder="MATCH (n) RETURN n LIMIT 10"
              />
              <Button
                onClick={() => {
                  void runCypherQuery()
                }}
                disabled={executingCypher}
                className="bg-emerald-600 hover:bg-emerald-700 w-full"
              >
                <Play className="size-4 mr-2" />
                {executingCypher ? 'Executing...' : 'Run Query'}
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/30 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold">Execution Output</CardTitle>
                <CardDescription>Formatted tabular cypher nodes return.</CardDescription>
              </div>
              {cypherResults && (
                <Badge variant="secondary" className="text-[10px]">
                  {cypherResults.length} records returned
                </Badge>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0 bg-muted/5">
              <ScrollArea className="h-full">
                {cypherResults ? (
                  <pre className="p-4 font-mono text-xs text-muted-foreground whitespace-pre overflow-auto">
                    {JSON.stringify(cypherResults, null, 2)}
                  </pre>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                    <Database className="size-10 text-muted-foreground/30 mb-2" />
                    <p className="text-xs">No active execution dataset found. Submit a query to inspect live nodes.</p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: MAGMA Orthogonal views retriever */}
        <TabsContent value="magma" className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden mt-4">
          <Card className="lg:col-span-1 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/30">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Brain className="size-4 text-emerald-400" />
                Orthogonal Scanning
              </CardTitle>
              <CardDescription>Leverage multi-perspective contextual slices.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-4 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Orthogonal Perspective View</label>
                <select
                  value={magmaView}
                  onChange={(e) => {
                    setMagmaView(e.target.value as 'semantic' | 'structural' | 'temporal' | 'hybrid')
                  }}
                  className="w-full h-10 px-3 rounded-md border border-input bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="semantic" className="bg-background text-foreground">
                    Semantic View (NL concepts)
                  </option>
                  <option value="structural" className="bg-background text-foreground">
                    Structural View (Code inheritance)
                  </option>
                  <option value="temporal" className="bg-background text-foreground">
                    Temporal View (Execution logs/crons)
                  </option>
                  <option value="hybrid" className="bg-background text-foreground">
                    Hybrid Synthesized View
                  </option>
                </select>
              </div>
              <div className="space-y-1.5 flex-1 flex flex-col">
                <label className="text-xs font-semibold text-muted-foreground">Target Prompt Context / Seed</label>
                <Textarea
                  value={magmaQuery}
                  onChange={(e) => {
                    setMagmaQuery(e.target.value)
                  }}
                  className="flex-1 font-mono text-xs bg-muted/10 border-border/40 p-3 resize-none h-[180px] lg:h-auto"
                  placeholder="Enter retrieval keywords or context snippet..."
                />
              </div>
              <Button
                onClick={() => {
                  void runMagmaRetrieve()
                }}
                disabled={retrievingMagma}
                className="bg-emerald-600 hover:bg-emerald-700 w-full shrink-0"
              >
                <Sparkles className="size-4 mr-2" />
                {retrievingMagma ? 'Scanning...' : 'Retrieve MAGMA Context'}
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/30 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold">Retrieved Perspectives Context</CardTitle>
                <CardDescription>Nodes grouped by perspective weights.</CardDescription>
              </div>
              {magmaResults && (
                <Badge variant="secondary" className="text-[10px]">
                  {magmaResults.length} vectors returned
                </Badge>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0 bg-muted/5">
              <ScrollArea className="h-full">
                {magmaResults ? (
                  <pre className="p-4 font-mono text-xs text-muted-foreground whitespace-pre overflow-auto">
                    {JSON.stringify(magmaResults, null, 2)}
                  </pre>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                    <Layers className="size-10 text-muted-foreground/30 mb-2" />
                    <p className="text-xs">
                      No active MAGMA orthogonal context slices retrieved. Submit keywords above.
                    </p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
