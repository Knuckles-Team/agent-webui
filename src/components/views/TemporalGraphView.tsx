import { useState, useEffect, useMemo, useCallback } from 'react'
import { History, RefreshCw, Network } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { toast } from 'sonner'
import { z } from 'zod'
import { fetchValidated, looseArray } from '@/lib/api-validation'
import { GraphCanvas, edgeKey } from '../knowledge-graph/GraphCanvas'
import type { GraphNode, GraphRelationship } from '../knowledge-graph/GraphAdapter'
import { usePageContextPublisher, type PageContextContribution } from '@/lib/page-context'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'

// D-WUI-6 (hostile-payload update) — TemporalGraphView shares GraphView's
// crash class: `(await res.json()) as GraphNode[]` / `as GraphRelationship[]`
// asserted the shape without checking it, and neither fetch checked `res.ok`.
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
const asOfRowSchema = z.looseObject({
  source: z.string().optional(),
  target: z.string().optional(),
  valid_until: z.string().nullable().optional(),
})

/**
 * Temporal graph scrubber (Graphiti+Opik Track D / D1).
 *
 * A thin entrypoint over the existing GraphCanvas: it loads the current graph,
 * then lets the user scrub a timestamp. On each change it re-issues the base UQL
 * with `|> AS OF @<ts>` appended (the engine's bi-temporal filter, KG-2.250) and
 * greys/dashes edges that are no longer live at that instant.
 *
 * All business logic stays on the backend; this view only adapts the slider
 * position into a query suffix and the response into edge styling.
 */

const BASE_UQL = 'MATCH (n) RETURN n LIMIT 200'

interface AsOfRow {
  // The AS OF read returns rows describing the live edges at <ts>. We only need
  // enough to identify which (source, target) edges remain live; everything not
  // returned is treated as expired and rendered greyed/dashed.
  source?: string
  target?: string
  valid_until?: string | null
  [k: string]: unknown
}

/** Append the bi-temporal `|> AS OF @<ts>` operator to a UQL query string. */
export const withAsOf = (query: string, isoTs: string): string => `${query.trim()} |> AS OF @${isoTs}`

/**
 * Given the full edge set and the rows the AS OF query returned live at <ts>,
 * compute the set of edge keys that are expired (present in full, absent from
 * the live set, or carrying a valid_until <= ts).
 */
export const computeExpiredEdges = (all: GraphRelationship[], liveRows: AsOfRow[], isoTs: string): Set<string> => {
  const liveKeys = new Set<string>()
  for (const r of liveRows) {
    if (typeof r.source === 'string' && typeof r.target === 'string') {
      // Honor an explicit valid_until on the row, otherwise count it as live.
      const vu = typeof r.valid_until === 'string' ? r.valid_until : null
      if (!vu || vu > isoTs) liveKeys.add(edgeKey(r.source, r.target))
    }
  }
  const expired = new Set<string>()
  for (const e of all) {
    if (!liveKeys.has(edgeKey(e.source, e.target))) {
      expired.add(edgeKey(e.source, e.target))
    }
  }
  return expired
}

export default function TemporalGraphView() {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [relationships, setRelationships] = useState<GraphRelationship[]>([])
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [loading, setLoading] = useState(true)
  // BUG-008 (dashboard-wide follow-on, GOC-28-W06): `nodes`/`relationships`
  // stay at their initial `[]` when a fetch fails (only a transient toast
  // fires), so "No graph data loaded." rendered identically for a genuinely
  // empty temporal graph and a fetch failure.
  const [graphUnavailable, setGraphUnavailable] = useState(false)
  const [expiredEdges, setExpiredEdges] = useState<Set<string>>(new Set())

  // Scrubber range: last 30 days → now, expressed as a 0..100 slider position.
  const range = useMemo(() => {
    const now = Date.now()
    const start = now - 30 * 24 * 60 * 60 * 1000
    return { start, end: now }
  }, [])
  const [sliderPos, setSliderPos] = useState(100)

  const tsForPos = useCallback(
    (pos: number): string => {
      const ms = range.start + ((range.end - range.start) * pos) / 100
      return new Date(ms).toISOString()
    },
    [range],
  )

  const currentTs = tsForPos(sliderPos)

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
      filters: { expiredEdges: expiredEdges.size },
      timeRange: {
        start: new Date(range.start).toISOString(),
        end: new Date(range.end).toISOString(),
        asOf: currentTs,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      allowedActions: [
        { id: 'query-as-of', label: 'Query the graph at the selected time', kind: 'read' },
        { id: 'refresh-graph', label: 'Refresh temporal graph data', kind: 'read' },
        ...(selectedNode ? [{ id: 'inspect-node', label: 'Inspect the selected node', kind: 'read' as const }] : []),
      ],
    }),
    [currentTs, expiredEdges.size, range.end, range.start, selectedNode],
  )
  usePageContextPublisher(pageContext)

  useEffect(() => {
    void fetchGraph()
  }, [])

  const fetchGraph = async () => {
    setLoading(true)
    try {
      const [nodesData, relsData] = await Promise.all([
        fetchValidated('/api/enhanced/graph/nodes', looseArray(graphNodeSchema)).catch(() => null),
        fetchValidated('/api/enhanced/graph/relationships', looseArray(graphRelationshipSchema)).catch(() => null),
      ])
      if (nodesData) setNodes(nodesData)
      if (relsData) setRelationships(relsData)
      const failed = !nodesData || !relsData
      if (failed) toast.error('Failed to load temporal graph')
      setGraphUnavailable(failed)
    } finally {
      setLoading(false)
    }
  }

  // Re-issue the AS OF query whenever the scrubber settles on a timestamp.
  const applyAsOf = useCallback(async (isoTs: string, rels: GraphRelationship[]) => {
    try {
      const liveRows = await fetchValidated('/api/enhanced/graph/query', looseArray(asOfRowSchema), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: withAsOf(BASE_UQL, isoTs) }),
      })
      setExpiredEdges(computeExpiredEdges(rels, liveRows, isoTs))
    } catch (err) {
      toast.error('Temporal query failed')
      console.error(err)
    }
  }, [])

  useEffect(() => {
    if (loading) return
    void applyAsOf(currentTs, relationships)
  }, [sliderPos, loading, relationships, applyAsOf, currentTs])

  const handleUpdateNode = (id: string, properties: Record<string, unknown>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, properties: { ...n.properties, ...properties } } : n)))
  }
  const handleDeleteNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id))
    setRelationships((prev) => prev.filter((e) => e.source !== id && e.target !== id))
  }
  const handleAddNode = (labels: string[], properties: Record<string, unknown>) => {
    setNodes((prev) => [...prev, { id: `node_${Date.now()}`, labels, properties }])
  }

  return (
    <div className="space-y-6 h-[calc(100vh-12rem)] flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <History className="size-6 text-primary" />
            Temporal Graph
          </h2>
          <p className="text-sm text-muted-foreground">
            Scrub through time. Edges expired at the selected instant render greyed and dashed.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Badge variant="outline" className="h-7 bg-muted/20 border-border/40 text-xs">
            Expired: {expiredEdges.size}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void fetchGraph()
            }}
            disabled={loading}
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Time scrubber */}
      <Card className="shrink-0 border-border/40 bg-card/60 backdrop-blur-md">
        <CardContent className="p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{new Date(range.start).toLocaleDateString()}</span>
            <span aria-label="current-timestamp" className="font-mono text-foreground">
              AS OF {new Date(currentTs).toLocaleString()}
            </span>
            <span>now</span>
          </div>
          <Slider
            aria-label="temporal-scrubber"
            value={sliderPos}
            onValueChange={setSliderPos}
            min={0}
            max={100}
            step={1}
          />
        </CardContent>
      </Card>

      {/* Graph canvas, reused unchanged apart from the expiredEdges prop */}
      <Card className="flex-1 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
        <CardContent className="flex-1 p-0 relative overflow-hidden h-full min-h-[450px]">
          {nodes.length > 0 ? (
            <GraphCanvas
              nodes={nodes}
              relationships={relationships}
              onUpdateNode={handleUpdateNode}
              onDeleteNode={handleDeleteNode}
              onAddNode={handleAddNode}
              selectedNodeExternally={selectedNode}
              onSelectNode={setSelectedNode}
              expiredEdges={expiredEdges}
            />
          ) : graphUnavailable ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <UnavailableNotice what="The temporal graph" className="justify-center" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
              <Network className="size-10 text-muted-foreground/30 mb-2" />
              <p className="text-xs">No graph data loaded.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
