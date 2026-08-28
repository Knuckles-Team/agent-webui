import { useState, type ReactNode } from 'react'
import {
  Waypoints,
  RefreshCw,
  Search,
  GitBranch,
  FlaskConical,
  Sparkles,
  Loader2,
  X,
  Trash2,
  RotateCcw,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { GraphCanvas } from '../knowledge-graph/GraphCanvas'
import type { GraphNode, GraphRelationship } from '../knowledge-graph/GraphAdapter'

/**
 * A single object as returned by the ontology object-set routes.
 * The backend serializes ontology objects as `{ id, type, properties }`.
 */
interface OntologyObject {
  id: string
  type: string
  properties: Record<string, unknown>
}

/** Normalized object-set + edge envelope the view consumes. */
interface ObjectSetResponse {
  objects?: OntologyObject[]
  links?: GraphRelationship[]
}

/** Derived-property values envelope. */
interface DeriveResponse {
  values?: Record<string, unknown>
}

/** Aggregate (scenario metric) envelope. */
interface AggregateResponse {
  value: number
  function: string
  property: string
  count: number
}

/** Raw object-set envelope from the backend (`{ids, rows, count}`). */
interface RawObjectSet {
  ids?: string[]
  rows?: Record<string, unknown>[]
  count?: number
}

/** Raw per-object envelope (only the link map is needed for edge building). */
interface RawObject {
  id: string
  object_type?: string | null
  links?: { out?: { type: string; target: string }[]; in?: { type: string; source: string }[] }
  derived?: Record<string, unknown>
}

/** Raw aggregate envelope from the backend. */
interface RawAggregate {
  metric?: string
  field?: string | null
  value?: number
  total_objects?: number
}

const ROW_META = new Set(['id', 'type', '_type', 'object_type'])

/** Coerce an unknown value to a string, defaulting when not a string/number. */
function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

/** Convert a permission-enforced object-set row to the view object shape. */
function rowToObject(row: Record<string, unknown>): OntologyObject {
  const id = asString(row.id)
  const type = asString(row.type ?? row._type ?? row.object_type, 'Object')
  const properties: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (!ROW_META.has(k) && !k.startsWith('_')) properties[k] = v
  }
  return { id, type, properties }
}

/** Parameters for the search-around (graph expansion) request. */
interface SearchAroundRequest {
  ids: string[]
  link_type?: string
  hops?: number
  direction?: 'in' | 'out' | 'both'
  include_seed?: boolean
}

/** Parameters for the aggregate (scenario metric) request. */
interface AggregateRequest {
  ids: string[]
  function: 'sum' | 'avg' | 'min' | 'max' | 'count'
  property: string
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => '')}`)
  return (await res.json()) as T
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => '')}`)
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Ontology data-access — the real, wired calls this view makes against the
// /api/enhanced/ontology/* routes. Exported so the wiring can be unit-tested
// directly (the repo's jsdom + React 19 harness does not mount DOM, so DOM
// assertions are not reliable here; we test the live network contract instead).
// ---------------------------------------------------------------------------

/** Read one object's typed links from the live store and emit graph edges. */
async function fetchObjectLinks(objectId: string): Promise<{ out: GraphRelationship[]; in: GraphRelationship[] }> {
  const raw = await getJson<RawObject>(`/api/enhanced/ontology/object/${encodeURIComponent(objectId)}`)
  const out = (raw.links?.out ?? []).map((l) => ({ source: objectId, type: l.type, target: l.target }))
  const inbound = (raw.links?.in ?? []).map((l) => ({ source: l.source, type: l.type, target: objectId }))
  return { out, in: inbound }
}

/** Flattens each object's out+in links into a single edge list. */
function collectLinkEdges(
  linkResults: ({ out: GraphRelationship[]; in: GraphRelationship[] } | null)[],
): GraphRelationship[] {
  const edges: GraphRelationship[] = []
  for (const res of linkResults) {
    edges.push(...(res?.out ?? []), ...(res?.in ?? []))
  }
  return edges
}

/** Drops duplicate `source->type->target` edges, keeping the first occurrence. */
function dedupeEdges(edges: GraphRelationship[]): GraphRelationship[] {
  const seen = new Set<string>()
  const deduped: GraphRelationship[] = []
  for (const e of edges) {
    const key = `${e.source}->${e.type}->${e.target}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(e)
  }
  return deduped
}

/** Keeps only edges that fall entirely within `idSet` (bounded fan-out). */
function edgesWithinSet(edges: GraphRelationship[], idSet: Set<string>): GraphRelationship[] {
  return edges.filter((e) => idSet.has(e.source) && idSet.has(e.target))
}

/** Keeps edges that touch a discovered neighbor AND a seed id. */
function edgesTouchingNeighborAndSeed(
  edges: GraphRelationship[],
  neighborIds: Set<string>,
  seedIds: string[],
): GraphRelationship[] {
  return edges.filter((e) => {
    const touchesNeighbor = neighborIds.has(e.source) || neighborIds.has(e.target)
    const touchesSeed = seedIds.includes(e.source) || seedIds.includes(e.target)
    return touchesNeighbor && touchesSeed
  })
}

/**
 * Seed the graph from an object type / interface. Backed by the real
 * POST /ontology/object-set/search route (`{kind}` → `{ids, rows, count}`),
 * then materializes the intra-set edges from each object's typed links.
 */
export async function fetchObjectSet(type: string): Promise<ObjectSetResponse> {
  const raw = await postJson<RawObjectSet>('/api/enhanced/ontology/object-set/search', { kind: type, query: '' })
  const objects = (raw.rows ?? []).map(rowToObject)
  const idSet = new Set(objects.map((o) => o.id))
  const linkResults = await Promise.all(objects.map((o) => fetchObjectLinks(o.id).catch(() => null)))
  const links = dedupeEdges(edgesWithinSet(collectLinkEdges(linkResults), idSet))
  return { objects, links }
}

/**
 * Expand neighbors of a seed id set. Backed by the real
 * POST /ontology/object-set/search-around route; edges connecting the seed to
 * the discovered neighbors are materialized from the seed objects' links.
 */
export async function fetchSearchAround(req: SearchAroundRequest): Promise<ObjectSetResponse> {
  const raw = await postJson<RawObjectSet>('/api/enhanced/ontology/object-set/search-around', {
    ids: req.ids,
    link_type: req.link_type,
    hops: req.hops ?? 1,
    direction: req.direction ?? 'out',
  })
  const objects = (raw.rows ?? []).map(rowToObject)
  const neighborIds = new Set(objects.map((o) => o.id))
  const seedLinks = await Promise.all(req.ids.map((id) => fetchObjectLinks(id).catch(() => null)))
  const links = dedupeEdges(edgesTouchingNeighborAndSeed(collectLinkEdges(seedLinks), neighborIds, req.ids))
  return { objects, links }
}

/**
 * Derived-property values for a single object. Read from the real
 * GET /ontology/object/{id} payload, whose `derived` map is the computed set.
 */
export async function fetchDerived(objectId: string): Promise<DeriveResponse> {
  const raw = await getJson<RawObject>(`/api/enhanced/ontology/object/${encodeURIComponent(objectId)}`)
  const values: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw.derived ?? {})) {
    values[k] =
      v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)
        ? (v as Record<string, unknown>).value
        : v
  }
  return { values }
}

/**
 * Aggregate a metric over an object-set's ids (scenario metric). Backed by the
 * real POST /ontology/object-set/aggregate route (`{ids, metric, field}`).
 */
export async function fetchAggregate(req: AggregateRequest): Promise<AggregateResponse> {
  const raw = await postJson<RawAggregate>('/api/enhanced/ontology/object-set/aggregate', {
    ids: req.ids,
    metric: req.function,
    field: req.property,
  })
  return {
    value: raw.value ?? 0,
    function: req.function,
    property: req.property,
    count: raw.total_objects ?? req.ids.length,
  }
}

/**
 * Compute the object ids that remain "visible" in a what-if scenario: every id
 * except those the operator has marked removed. This is the id set fed to the
 * scenario aggregate call, while the unmodified id set is the baseline.
 */
export function scenarioVisibleIds(allIds: string[], removed: Set<string>): string[] {
  return allIds.filter((id) => !removed.has(id))
}

/** Convert an ontology object to the GraphNode shape consumed by GraphCanvas. */
export function toGraphNode(obj: OntologyObject): GraphNode {
  return {
    id: obj.id,
    labels: [obj.type],
    properties: obj.properties,
  }
}

/** The graph canvas panel, or an empty-state placeholder when nothing is loaded. */
function graphCanvasPanel({
  graphNodes,
  graphLinks,
  selectedNode,
  onToggleRemoved,
  onSelectNode,
}: {
  graphNodes: GraphNode[]
  graphLinks: GraphRelationship[]
  selectedNode: GraphNode | null
  onToggleRemoved: (id: string) => void
  onSelectNode: (n: GraphNode | null) => void
}): ReactNode {
  return (
    <Card className="lg:col-span-2 border-border/40 bg-card/60 flex flex-col overflow-hidden">
      <CardContent className="flex-1 p-0 relative overflow-hidden min-h-[450px]">
        {graphNodes.length > 0 ? (
          <GraphCanvas
            nodes={graphNodes}
            relationships={graphLinks}
            onUpdateNode={() => undefined}
            onDeleteNode={(id) => {
              onToggleRemoved(id)
            }}
            onAddNode={() => undefined}
            selectedNodeExternally={selectedNode}
            onSelectNode={onSelectNode}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Waypoints className="size-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm">No objects loaded. Enter an object type above and load a seed set.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** The "Expand Node" (search-around) card. */
function expandNodePanel({
  expandLinkType,
  setExpandLinkType,
  expanding,
  selectedNode,
  onExpand,
}: {
  expandLinkType: string
  setExpandLinkType: (value: string) => void
  expanding: boolean
  selectedNode: GraphNode | null
  onExpand: () => void
}): ReactNode {
  return (
    <Card className="border-border/40 bg-card/60 shrink-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <GitBranch className="size-4 text-emerald-400" />
          Expand Node
        </CardTitle>
        <CardDescription className="text-xs">Search-around the selected node along a typed link.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input
          aria-label="Link type"
          placeholder="Link type (blank = any)"
          value={expandLinkType}
          onChange={(e) => {
            setExpandLinkType(e.target.value)
          }}
          className="text-xs"
        />
        <Button onClick={onExpand} disabled={expanding || !selectedNode} size="sm" className="w-full">
          {expanding ? <Loader2 className="size-4 mr-2 animate-spin" /> : <GitBranch className="size-4 mr-2" />}
          Search Around
        </Button>
        {selectedNode && (
          <p className="text-[11px] text-muted-foreground truncate">
            Selected: {(selectedNode.properties.name as string) || selectedNode.id}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** The "Object Types" legend card, or nothing when there is nothing loaded. */
function objectTypesLegend(typeCounts: Record<string, number>): ReactNode {
  if (Object.keys(typeCounts).length === 0) return null
  return (
    <Card className="border-border/40 bg-card/60 shrink-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold">Object Types</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-1.5">
        {Object.entries(typeCounts).map(([type, count]) => (
          <Badge key={type} variant="secondary" className="text-[11px]">
            {type}: {count}
          </Badge>
        ))}
      </CardContent>
    </Card>
  )
}

/** The derived-properties body: loading, the values list, or the empty note. */
function derivedPropertiesBody(
  derivingId: string | null,
  selectedNodeId: string,
  derived: Record<string, unknown> | null,
): ReactNode {
  if (derivingId === selectedNodeId) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
        <Loader2 className="size-4 animate-spin" />
        Deriving...
      </div>
    )
  }
  if (derived && Object.keys(derived).length > 0) {
    return (
      <dl className="space-y-1.5 text-xs">
        {Object.entries(derived).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-border/20 pb-1">
            <dt className="font-medium text-muted-foreground">{k}</dt>
            <dd className="font-mono text-right break-all">{String(v)}</dd>
          </div>
        ))}
      </dl>
    )
  }
  return <p className="text-xs text-muted-foreground py-4">No derived properties for this object.</p>
}

/** The "Derived Properties" card for the selected node, or nothing when
 *  nothing is selected. */
function derivedPropertiesPanel({
  selectedNode,
  scenarioEnabled,
  derivingId,
  derived,
  onToggleRemoved,
  onClearSelection,
}: {
  selectedNode: GraphNode | null
  scenarioEnabled: boolean
  derivingId: string | null
  derived: Record<string, unknown> | null
  onToggleRemoved: (id: string) => void
  onClearSelection: () => void
}): ReactNode {
  if (!selectedNode) return null
  return (
    <Card className="border-border/40 bg-card/60 flex-1 overflow-hidden flex flex-col">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Sparkles className="size-4 text-emerald-400" />
          Derived Properties
        </CardTitle>
        <div className="flex items-center gap-1">
          {scenarioEnabled && (
            <Button
              variant="ghost"
              size="sm"
              title="Mark removed in scenario"
              onClick={() => {
                onToggleRemoved(selectedNode.id)
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="sm" title="Clear selection" onClick={onClearSelection}>
            <X className="size-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full px-4 pb-4">
          {derivedPropertiesBody(derivingId, selectedNode.id, derived)}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

/** The removed-nodes summary + reset row, or nothing when scenario mode is
 *  off or nothing has been removed. */
function removedNodesSummary(scenarioEnabled: boolean, removedCount: number, onReset: () => void): ReactNode {
  if (!scenarioEnabled || removedCount === 0) return null
  return (
    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
      <span>{removedCount} node(s) marked removed</span>
      <Button variant="ghost" size="sm" className="h-6 px-2" onClick={onReset}>
        <RotateCcw className="size-3 mr-1" />
        Reset
      </Button>
    </div>
  )
}

/** The baseline/scenario/delta metric row, or nothing before a recompute. */
function scenarioMetricRow(baseline: number | null, scenarioValue: number | null): ReactNode {
  if (baseline === null || scenarioValue === null) return null
  const delta = scenarioValue - baseline
  return (
    <div className="grid grid-cols-3 gap-2 text-center pt-1">
      <div>
        <p className="text-[10px] text-muted-foreground uppercase">Baseline</p>
        <p className="text-sm font-bold font-mono">{baseline}</p>
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase">Scenario</p>
        <p className="text-sm font-bold font-mono">{scenarioValue}</p>
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase">Delta</p>
        <p className={`text-sm font-bold font-mono ${delta < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
          {delta > 0 ? '+' : ''}
          {delta}
        </p>
      </div>
    </div>
  )
}

/** The "What-If Scenario" card: mode toggle, aggregate controls, removed-node
 *  summary, recompute button, and the baseline/scenario/delta row. */
function scenarioControlsPanel(props: {
  scenarioEnabled: boolean
  setScenarioEnabled: (value: boolean) => void
  aggProperty: string
  setAggProperty: (value: string) => void
  aggFn: 'sum' | 'avg' | 'min' | 'max' | 'count'
  setAggFn: (value: 'sum' | 'avg' | 'min' | 'max' | 'count') => void
  removedCount: number
  onResetRemoved: () => void
  recomputing: boolean
  canRecompute: boolean
  onRecompute: () => void
  baseline: number | null
  scenarioValue: number | null
}): ReactNode {
  const {
    scenarioEnabled,
    setScenarioEnabled,
    aggProperty,
    setAggProperty,
    aggFn,
    setAggFn,
    removedCount,
    onResetRemoved,
    recomputing,
    canRecompute,
    onRecompute,
    baseline,
    scenarioValue,
  } = props
  return (
    <Card className="border-border/40 bg-card/60 shrink-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <FlaskConical className="size-4 text-amber-400" />
          What-If Scenario
        </CardTitle>
        <CardDescription className="text-xs">
          Toggle scenario mode, remove nodes, and recompute a derived metric.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="scenario-toggle" className="text-xs font-medium">
            Scenario mode
          </label>
          <Switch id="scenario-toggle" checked={scenarioEnabled} onCheckedChange={setScenarioEnabled} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Input
            aria-label="Aggregate property"
            placeholder="property"
            value={aggProperty}
            onChange={(e) => {
              setAggProperty(e.target.value)
            }}
            className="text-xs"
          />
          <Select
            value={aggFn}
            onValueChange={(v) => {
              setAggFn(v as typeof aggFn)
            }}
          >
            <SelectTrigger className="text-xs" aria-label="Aggregate function">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sum">sum</SelectItem>
              <SelectItem value="avg">avg</SelectItem>
              <SelectItem value="min">min</SelectItem>
              <SelectItem value="max">max</SelectItem>
              <SelectItem value="count">count</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {removedNodesSummary(scenarioEnabled, removedCount, onResetRemoved)}

        <Button
          onClick={onRecompute}
          disabled={recomputing || !canRecompute}
          size="sm"
          className="w-full bg-amber-600 hover:bg-amber-700"
        >
          {recomputing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <FlaskConical className="size-4 mr-2" />}
          Recompute Metric
        </Button>

        {scenarioMetricRow(baseline, scenarioValue)}
      </CardContent>
    </Card>
  )
}

export default function VertexView() {
  // Object set / graph state
  const [seedType, setSeedType] = useState('')
  const [objects, setObjects] = useState<OntologyObject[]>([])
  const [links, setLinks] = useState<GraphRelationship[]>([])
  const [loading, setLoading] = useState(false)

  // Selection + derived properties
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [derived, setDerived] = useState<Record<string, unknown> | null>(null)
  const [derivingId, setDerivingId] = useState<string | null>(null)

  // Expansion (search-around)
  const [expandLinkType, setExpandLinkType] = useState('')
  const [expanding, setExpanding] = useState(false)

  // Scenario (what-if) controls
  const [scenarioEnabled, setScenarioEnabled] = useState(false)
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [aggProperty, setAggProperty] = useState('value')
  const [aggFn, setAggFn] = useState<'sum' | 'avg' | 'min' | 'max' | 'count'>('sum')
  const [baseline, setBaseline] = useState<number | null>(null)
  const [scenarioValue, setScenarioValue] = useState<number | null>(null)
  const [recomputing, setRecomputing] = useState(false)

  const loadSeedSet = async () => {
    if (!seedType.trim()) {
      toast.error('Enter an object type or interface to seed the graph')
      return
    }
    setLoading(true)
    try {
      const data = await fetchObjectSet(seedType.trim())
      setObjects(data.objects ?? [])
      setLinks(data.links ?? [])
      setRemovedIds(new Set())
      setBaseline(null)
      setScenarioValue(null)
      setSelectedNode(null)
      setDerived(null)
      toast.success(`Loaded ${data.objects?.length ?? 0} objects of type ${seedType.trim()}`)
    } catch (err) {
      toast.error('Failed to load object set')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const expandSelected = async () => {
    if (!selectedNode) {
      toast.error('Select a node to expand')
      return
    }
    setExpanding(true)
    try {
      const data = await fetchSearchAround({
        ids: [selectedNode.id],
        link_type: expandLinkType.trim() || undefined,
        hops: 1,
        direction: 'both',
        include_seed: false,
      })
      const existingIds = new Set(objects.map((o) => o.id))
      const newObjects = (data.objects ?? []).filter((o) => !existingIds.has(o.id))
      if (newObjects.length === 0 && (data.links?.length ?? 0) === 0) {
        toast.info('No new neighbors found')
      } else {
        toast.success(`Expanded with ${newObjects.length} neighbor(s)`)
      }
      setObjects((prev) => [...prev, ...newObjects])
      setLinks((prev) => {
        const seen = new Set(prev.map((l) => `${l.source}->${l.type}->${l.target}`))
        const merged = [...prev]
        for (const l of data.links ?? []) {
          const key = `${l.source}->${l.type}->${l.target}`
          if (!seen.has(key)) {
            seen.add(key)
            merged.push(l)
          }
        }
        return merged
      })
    } catch (err) {
      toast.error('Search-around expansion failed')
      console.error(err)
    } finally {
      setExpanding(false)
    }
  }

  const handleSelectNode = async (node: GraphNode | null) => {
    setSelectedNode(node)
    setDerived(null)
    if (!node) return
    setDerivingId(node.id)
    try {
      const data = await fetchDerived(node.id)
      setDerived(data.values ?? {})
    } catch (err) {
      toast.error('Failed to derive properties')
      console.error(err)
    } finally {
      setDerivingId(null)
    }
  }

  const toggleRemoved = (id: string) => {
    setRemovedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const recomputeScenario = async () => {
    if (objects.length === 0) {
      toast.error('Load an object set first')
      return
    }
    setRecomputing(true)
    try {
      const allIds = objects.map((o) => o.id)
      const visibleIds = scenarioVisibleIds(allIds, removedIds)

      const [baseRes, scenarioRes] = await Promise.all([
        fetchAggregate({ ids: allIds, function: aggFn, property: aggProperty }),
        fetchAggregate({ ids: visibleIds, function: aggFn, property: aggProperty }),
      ])
      setBaseline(baseRes.value)
      setScenarioValue(scenarioRes.value)
      toast.success('Scenario metric recomputed')
    } catch (err) {
      toast.error('Failed to recompute scenario metric')
      console.error(err)
    } finally {
      setRecomputing(false)
    }
  }

  // Hide removed nodes from the canvas when scenario mode is active.
  const visibleObjects = scenarioEnabled ? objects.filter((o) => !removedIds.has(o.id)) : objects
  const visibleNodeIds = new Set(visibleObjects.map((o) => o.id))
  const graphNodes: GraphNode[] = visibleObjects.map(toGraphNode)
  const graphLinks = links.filter((l) => visibleNodeIds.has(l.source) && visibleNodeIds.has(l.target))

  const typeCounts = visibleObjects.reduce<Record<string, number>>((acc, o) => {
    const t = o.type || 'Object'
    acc[t] = (acc[t] || 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6 h-[calc(100vh-12rem)] flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Waypoints className="size-6 text-emerald-400" />
            Vertex Explorer
          </h1>
          <p className="text-sm text-muted-foreground">
            Interactive object-set graph: expand via search-around, inspect derived properties, and run what-if
            scenarios over the ontology.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Badge variant="outline" className="h-7 bg-muted/20 border-border/40 text-xs">
            Objects: {visibleObjects.length}
          </Badge>
          <Badge variant="outline" className="h-7 bg-muted/20 border-border/40 text-xs">
            Links: {graphLinks.length}
          </Badge>
        </div>
      </div>

      {/* Seed controls */}
      <div className="flex flex-col sm:flex-row gap-2 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            aria-label="Seed object type"
            placeholder="Seed object type or interface (e.g. Position)"
            className="pl-9"
            value={seedType}
            onChange={(e) => {
              setSeedType(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void loadSeedSet()
            }}
          />
        </div>
        <Button
          onClick={() => {
            void loadSeedSet()
          }}
          disabled={loading}
        >
          {loading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <RefreshCw className="size-4 mr-2" />}
          Load Object Set
        </Button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden">
        {/* Graph canvas */}
        {graphCanvasPanel({
          graphNodes,
          graphLinks,
          selectedNode,
          onToggleRemoved: toggleRemoved,
          onSelectNode: (n) => {
            void handleSelectNode(n)
          },
        })}

        {/* Inspector + scenario panel */}
        <div className="flex flex-col gap-4 overflow-hidden">
          {expandNodePanel({
            expandLinkType,
            setExpandLinkType,
            expanding,
            selectedNode,
            onExpand: () => {
              void expandSelected()
            },
          })}

          {objectTypesLegend(typeCounts)}

          {derivedPropertiesPanel({
            selectedNode,
            scenarioEnabled,
            derivingId,
            derived,
            onToggleRemoved: toggleRemoved,
            onClearSelection: () => {
              void handleSelectNode(null)
            },
          })}

          {scenarioControlsPanel({
            scenarioEnabled,
            setScenarioEnabled,
            aggProperty,
            setAggProperty,
            aggFn,
            setAggFn,
            removedCount: removedIds.size,
            onResetRemoved: () => {
              setRemovedIds(new Set())
            },
            recomputing,
            canRecompute: objects.length > 0,
            onRecompute: () => {
              void recomputeScenario()
            },
            baseline,
            scenarioValue,
          })}
        </div>
      </div>
    </div>
  )
}
