/**
 * @file Graph3DLodView.tsx
 * @description The level-of-detail 3D knowledge-graph view: the SAME
 * renderer `Graph3DView.tsx` uses (`Graph3DCanvas` → `Graph3DScene`, two
 * draw calls, instanced meshes, bloom, DOF, focus-plus-context, hover,
 * click-to-pin, relationship filter — all unmodified), but fed by
 * `useLodExplorer` instead of one `GET /api/enhanced/graph/graph3d` fetch.
 *
 * ## Why a separate view rather than a mode toggle on `Graph3DView`
 *
 * `Graph3DView` answers "show me the connected core" with one fetch and one
 * `Graph3DModel`. This view answers a different question — "show me the
 * TOP of a graph too large to fetch at all, and let me drill in" — with a
 * server-paced, progressively-tiled, expandable HIERARCHY. The two data
 * flows are different enough (see `useLodExplorer.ts`'s file doc) that
 * folding them into one component's state machine would obscure both. What
 * they share — the canvas, the interaction feel, the effect toggles — is
 * shared by construction: both hand `Graph3DCanvas` a `Graph3DModel` built
 * by `buildModel`, so a cluster pseudo-node gets hover/click/focus-plus-
 * context/bloom for free, with zero cluster-aware code in `scene.ts` beyond
 * the two small additive hooks (`sizeOverride`, `setEmphasis`) documented in
 * `lodGraph.ts`'s file doc.
 *
 * ## What "the same product, zoomed" means here
 *
 * A cluster pseudo-node is just a `Graph3DNode` with a bigger radius
 * (`node_count`-derived, not degree-derived — `lodGraph.ts`). Hovering,
 * clicking, isolating, filtering by relationship type, all work on it
 * exactly as they would on a real node, because the renderer cannot tell
 * the difference. The one LOD-specific interaction is expand-on-demand:
 * double-click (or the side panel's "Expand" button) fetches a cluster's
 * children and folds them into the SAME rendered scene in place of its
 * pseudo-node (`useLodExplorer.expand`), the camera glides to the new
 * region (`followIndex` → `selected`, which the existing `focusNode` effect
 * already flies to), and the region's former siblings recede — dimmed, not
 * hidden — via `emphasisMask`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, Crosshair, Eye, Filter, Layers, Orbit, RefreshCw, ScanSearch, Sparkles, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fetchValidated, looseArray } from '@/lib/api-validation'
import { Graph3DCanvas } from '@/components/knowledge-graph-3d/Graph3DCanvas'
import { neighbourhood, neighbours } from '@/components/knowledge-graph-3d/model'
import type { EffectSettings } from '@/components/knowledge-graph-3d/scene'
import { NodeTypeBreakdown, type NodeTypeBreakdownData } from '@/components/knowledge-graph/NodeTypeBreakdown'
import { cssColorToHex, nodeTypeColor, useIsDarkMode } from '@/components/knowledge-graph/theme-colors'
import { MockLodTransport } from '@/lib/kg-lod/mockTransport'
import { useLodExplorer } from '@/lib/kg-lod/useLodExplorer'

/**
 * The transport swap point. `MockLodTransport` (`mockTransport.ts`) is what
 * lets this view run today, ahead of VIZ-1/VIZ-2 landing — see that file's
 * doc. Once the real routes exist and have been confirmed against this
 * lane's `contract.ts`, replace this with `new HttpLodTransport()`
 * (`httpTransport.ts`); nothing else in this file, `useLodExplorer.ts`, or
 * `lodGraph.ts` needs to change.
 */
const LOD_TRANSPORT = new MockLodTransport()

/** Every graph the engine knows, same convention `graph3d` uses for its own `source_graphs`. */
const LOD_GRAPH_SCOPE: string[] = []

const HOP_CHOICES = [1, 2, 3] as const
const DEFAULT_HOPS = 2

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

const numberFormat = new Intl.NumberFormat()

function backgroundHex(isDark: boolean): string {
  if (typeof window === 'undefined') return isDark ? '#0a0d14' : '#f6f7fb'
  const token = window.getComputedStyle(document.documentElement).getPropertyValue('--background')
  return cssColorToHex(token, isDark ? '#0a0d14' : '#f6f7fb')
}

function renderCanvasBadges({
  clusterCount,
  leafCount,
  edgeCount,
  expandedCount,
  pendingCount,
}: {
  clusterCount: number
  leafCount: number
  edgeCount: number
  expandedCount: number
  pendingCount: number
}) {
  return (
    <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
      <Badge variant="secondary" className="font-mono text-[10px]">
        {numberFormat.format(clusterCount)} clusters
      </Badge>
      {leafCount > 0 ? (
        <Badge variant="secondary" className="font-mono text-[10px]">
          {numberFormat.format(leafCount)} real nodes
        </Badge>
      ) : null}
      <Badge variant="secondary" className="font-mono text-[10px]">
        {numberFormat.format(edgeCount)} edges in view
      </Badge>
      {expandedCount > 0 ? (
        <Badge variant="outline" className="text-[10px]">
          {expandedCount} cluster{expandedCount === 1 ? '' : 's'} expanded
        </Badge>
      ) : null}
      {pendingCount > 0 ? (
        <Badge variant="outline" className="text-[10px]">
          <RefreshCw className="mr-1 h-3 w-3 animate-spin" /> loading {pendingCount}
        </Badge>
      ) : null}
    </div>
  )
}

function renderCanvasControls({
  selected,
  onIsolate,
  hops,
  onHopsChange,
  onShowAll,
  showAllDisabled,
  onReframe,
}: {
  selected: number | null
  onIsolate: () => void
  hops: (typeof HOP_CHOICES)[number]
  onHopsChange: (h: (typeof HOP_CHOICES)[number]) => void
  onShowAll: () => void
  showAllDisabled: boolean
  onReframe: () => void
}) {
  return (
    <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-1.5">
      <Button
        size="sm"
        variant="secondary"
        onClick={onIsolate}
        disabled={selected == null}
        title="Show only this node's neighbourhood"
      >
        <ScanSearch className="mr-1.5 h-3.5 w-3.5" /> Isolate
      </Button>
      <div className="flex overflow-hidden rounded-md border bg-background/80 backdrop-blur">
        {HOP_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => {
              onHopsChange(choice)
            }}
            title="How many hops of context a selection reveals"
            className={`px-2 py-1 text-[11px] transition-colors ${
              hops === choice ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
          >
            {choice} hop{choice > 1 ? 's' : ''}
          </button>
        ))}
      </div>
      <Button size="sm" variant="secondary" onClick={onShowAll} disabled={showAllDisabled}>
        <Eye className="mr-1.5 h-3.5 w-3.5" /> Show all
      </Button>
      <Button size="sm" variant="secondary" onClick={onReframe}>
        <Crosshair className="mr-1.5 h-3.5 w-3.5" /> Re-frame
      </Button>
    </div>
  )
}

interface SelectedNodeType {
  id: string
  name: string
  type: string
}

interface SelectedMetaType {
  kind: string
  level?: number | null
  nodeCount?: number
  edgeCount?: number
  clusterId?: string | null
}

function renderClusterExpandControls({
  selectedMeta,
  isExpanded,
  isPending,
  onCollapse,
  onExpand,
}: {
  selectedMeta: SelectedMetaType
  isExpanded: boolean
  isPending: boolean
  onCollapse: () => void
  onExpand: () => void
}) {
  if (selectedMeta.kind !== 'cluster') return null
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className="text-[10px]">
          {numberFormat.format(selectedMeta.nodeCount ?? 0)} members
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          ~{numberFormat.format(selectedMeta.edgeCount ?? 0)} internal edges
        </Badge>
      </div>
      {isExpanded ? (
        <Button size="sm" variant="outline" onClick={onCollapse}>
          <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Collapse
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onExpand} disabled={isPending}>
          <Boxes className="mr-1.5 h-3.5 w-3.5" />
          {isPending ? 'Expanding…' : 'Expand'}
        </Button>
      )}
    </div>
  )
}

function renderNeighboursList({
  neighbours,
  isDark,
  onSelect,
}: {
  neighbours: { index: number; node: SelectedNodeType; degree: number }[]
  isDark: boolean
  onSelect: (index: number) => void
}) {
  return (
    <div className="space-y-1">
      {neighbours.map(({ index, node, degree }) => (
        <button
          key={node.id}
          type="button"
          onClick={() => {
            onSelect(index)
          }}
          className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
        >
          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: nodeTypeColor(node.type, isDark) }} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{degree}</span>
        </button>
      ))}
    </div>
  )
}

function renderSelectedPanel({
  selectedNode,
  selectedMeta,
  isDark,
  isExpanded,
  isPending,
  onCollapse,
  onExpand,
  neighbours,
  onSelectNeighbour,
  onUnpin,
}: {
  selectedNode: SelectedNodeType
  selectedMeta: SelectedMetaType
  isDark: boolean
  isExpanded: boolean
  isPending: boolean
  onCollapse: () => void
  onExpand: () => void
  neighbours: { index: number; node: SelectedNodeType; degree: number }[]
  onSelectNeighbour: (index: number) => void
  onUnpin: () => void
}) {
  return (
    <Card className="min-h-0 flex-1">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {selectedMeta.kind === 'cluster' ? <Boxes className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
          {selectedMeta.kind === 'cluster' ? 'Cluster' : 'Node'}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 p-0">
        <ScrollArea className="h-[300px] px-4 pb-4">
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium leading-tight">{selectedNode.name}</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: nodeTypeColor(selectedNode.type, isDark) }}
                />
                {selectedNode.type}
                {selectedMeta.level != null ? <span className="opacity-60">· level {selectedMeta.level}</span> : null}
              </div>
              <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground/80">{selectedNode.id}</div>
            </div>

            {renderClusterExpandControls({ selectedMeta, isExpanded, isPending, onCollapse, onExpand })}

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {neighbours.length} neighbours in view
              </Badge>
              <Button size="sm" variant="ghost" onClick={onUnpin}>
                Unpin
              </Button>
            </div>
            {renderNeighboursList({ neighbours, isDark, onSelect: onSelectNeighbour })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function renderRelTypesList({
  relTypes,
  relTypeCount,
  hiddenRelTypes,
  onToggle,
}: {
  relTypes: string[]
  relTypeCount: number[]
  hiddenRelTypes: Set<string>
  onToggle: (type: string) => void
}) {
  return (
    <div className="space-y-0.5">
      {relTypes.map((type, index) => {
        const hidden = hiddenRelTypes.has(type)
        return (
          <button
            key={type}
            type="button"
            onClick={() => {
              onToggle(type)
            }}
            className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted ${
              hidden ? 'opacity-40' : ''
            }`}
          >
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-sm border ${
                hidden ? 'border-muted-foreground' : 'border-primary bg-primary'
              }`}
            />
            <span className="min-w-0 flex-1 truncate font-mono">{type}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {numberFormat.format(relTypeCount[index])}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function renderLoadError(error: string | null) {
  if (!error) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Could not load</CardTitle>
        <CardDescription>{error}</CardDescription>
      </CardHeader>
    </Card>
  )
}

function renderRootLoadingOverlay(rootLoading: boolean) {
  if (!rootLoading) return null
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 text-sm text-muted-foreground backdrop-blur-sm">
      <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Reading the top level…
    </div>
  )
}

function resolveSelection(
  model: { nodes: SelectedNodeType[] },
  scope: { meta: SelectedMetaType[] },
  selected: number | null,
): { node: SelectedNodeType; meta: SelectedMetaType } | null {
  if (selected == null) return null
  return { node: model.nodes[selected], meta: scope.meta[selected] }
}

function renderTypesRelsTabs({
  nodeCount,
  clusterCount,
  leafCount,
  breakdown,
  breakdownLoading,
  breakdownError,
  highlightType,
  onSelectType,
  relTypes,
  relTypeCount,
  hiddenRelTypes,
  onToggleRelType,
}: {
  nodeCount: number
  clusterCount: number
  leafCount: number
  breakdown: NodeTypeBreakdownData | null
  breakdownLoading: boolean
  breakdownError: string | null
  highlightType: string | null
  onSelectType: (type: string | null) => void
  relTypes: string[]
  relTypeCount: number[]
  hiddenRelTypes: Set<string>
  onToggleRelType: (type: string) => void
}) {
  return (
    <Tabs defaultValue="types" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="w-full">
        <TabsTrigger value="types" className="flex-1 text-xs">
          Node types
        </TabsTrigger>
        <TabsTrigger value="rels" className="flex-1 text-xs">
          <Filter className="mr-1 h-3 w-3" /> Relationships
        </TabsTrigger>
      </TabsList>
      <TabsContent value="types" className="min-h-0 flex-1">
        <Card className="h-full">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">
              The whole graph&apos;s type distribution, from the engine&apos;s own aggregate — for scale, not what is
              currently drawn (that is {numberFormat.format(nodeCount)} nodes: {clusterCount} clusters and{' '}
              {leafCount} real). Click a type to keep only matching nodes on the canvas.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 p-0">
            <ScrollArea className="h-[300px] px-4 pb-4">
              <NodeTypeBreakdown
                data={breakdown}
                loading={breakdownLoading}
                error={breakdownError}
                selectedType={highlightType}
                onSelectType={onSelectType}
              />
            </ScrollArea>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="rels" className="min-h-0 flex-1">
        <Card className="h-full">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">
              {relTypes.length} relationship types currently in view (cluster links plus any real edges inside
              expanded clusters). Untick one to drop its edges.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 p-0">
            <ScrollArea className="h-[290px] px-4 pb-4">
              {renderRelTypesList({ relTypes, relTypeCount, hiddenRelTypes, onToggle: onToggleRelType })}
            </ScrollArea>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}

export default function Graph3DLodView() {
  const isDark = useIsDarkMode()
  const explorer = useLodExplorer({ transport: LOD_TRANSPORT, graph: LOD_GRAPH_SCOPE })
  const { scope } = explorer
  const model = scope.model

  const [breakdown, setBreakdown] = useState<NodeTypeBreakdownData | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(true)
  const [breakdownError, setBreakdownError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [revealed, setRevealed] = useState<Set<number> | null>(null)
  const [hops, setHops] = useState<(typeof HOP_CHOICES)[number]>(DEFAULT_HOPS)
  const [autoRotate, setAutoRotate] = useState(true)
  const [bloom, setBloom] = useState(true)
  const [depthOfField, setDepthOfField] = useState(false)
  const [hiddenRelTypes, setHiddenRelTypes] = useState<Set<string>>(() => new Set())
  const [highlightType, setHighlightType] = useState<string | null>(null)
  const [frameToken, setFrameToken] = useState(0)
  const [background, setBackground] = useState(() => backgroundHex(isDark))

  useEffect(() => {
    setBackground(backgroundHex(isDark))
  }, [isDark])

  // A tile landing, an expand, or a collapse all reshape `model` (new node
  // indices throughout — `buildModel` is rebuilt from scratch every time,
  // see `lodGraph.ts`), so any index-keyed local selection state from the
  // PREVIOUS shape is meaningless against the new one.
  useEffect(() => {
    setSelected(null)
    setRevealed(null)
  }, [model])

  // The camera follows the newest expansion: `followIndex` is an index into
  // the JUST-UPDATED `scope`, and selecting it reuses the canvas's existing
  // `focusNode` effect (see `Graph3DCanvas`'s `selected` effect) rather than
  // this view inventing a second camera-move path.
  useEffect(() => {
    if (explorer.followIndex != null) setSelected(explorer.followIndex)
  }, [explorer.followIndex])

  useEffect(() => {
    let cancelled = false
    setBreakdownLoading(true)
    fetchValidated('/api/enhanced/graph/node-types', nodeTypeBreakdownSchema)
      .then((data) => {
        if (cancelled) return
        setBreakdown(data)
        setBreakdownError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setBreakdown(null)
        setBreakdownError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setBreakdownLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const effects: EffectSettings = useMemo(() => ({ bloom, depthOfField }), [bloom, depthOfField])

  const relationshipFilter = useMemo(() => {
    if (hiddenRelTypes.size === 0) return null
    return new Set(model.relTypes.filter((type) => !hiddenRelTypes.has(type)))
  }, [model, hiddenRelTypes])

  const visibleMask = useMemo(() => {
    if (!revealed && !highlightType) return null
    const mask = new Uint8Array(model.nodes.length)
    if (revealed) {
      for (const index of revealed) mask[index] = 1
    } else {
      mask.fill(1)
    }
    if (highlightType) {
      for (let i = 0; i < mask.length; i += 1) {
        if (model.nodes[i].type !== highlightType) mask[i] = 0
      }
    }
    return mask
  }, [model, revealed, highlightType])

  const isolate = useCallback(() => {
    if (selected == null) return
    const mask = neighbourhood(model, selected, hops)
    const next = new Set<number>()
    for (let i = 0; i < mask.length; i += 1) if (mask[i] === 1) next.add(i)
    setRevealed(next)
    setFrameToken((token) => token + 1)
  }, [model, selected, hops])

  const showAll = useCallback(() => {
    setRevealed(null)
    setHighlightType(null)
    setFrameToken((token) => token + 1)
  }, [])

  const toggleRelType = useCallback((type: string) => {
    setHiddenRelTypes((current) => {
      const next = new Set(current)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const selection = resolveSelection(model, scope, selected)
  const selectedNeighbours = useMemo(() => {
    if (selected == null) return []
    return neighbours(model, selected)
      .map((index) => ({ index, node: model.nodes[index], degree: model.degree[index] }))
      .sort((a, b) => b.degree - a.degree)
  }, [model, selected])

  const onExpandDoubleClick = useCallback(
    (index: number) => {
      const meta = scope.meta[index]
      const node = model.nodes[index]
      if (meta.kind !== 'cluster' || !meta.clusterId) {
        toast.info('Nothing further to expand here', {
          description: `${node.name} is a real node, not a cluster.`,
        })
        return
      }
      explorer
        .expand(meta.clusterId)
        .then((outcome) => {
          if (outcome === 'no-children') {
            toast.info('Nothing inside this cluster', { description: `${node.name} has no members to reveal.` })
          }
        })
        .catch(() => undefined)
    },
    [scope, model, explorer],
  )

  const selectedClusterId = selection?.meta.clusterId

  const expandSelected = useCallback(() => {
    if (!selectedClusterId) return
    explorer.expand(selectedClusterId).catch(() => undefined)
  }, [selectedClusterId, explorer])

  const collapseSelected = useCallback(() => {
    if (!selectedClusterId) return
    explorer.collapse(selectedClusterId)
  }, [selectedClusterId, explorer])

  const clusterCount = scope.meta.filter((m) => m.kind === 'cluster').length
  const leafCount = scope.meta.filter((m) => m.kind === 'leaf').length

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Layers className="h-6 w-6" /> Knowledge Graph 3D — LOD
          </h1>
          <p className="text-sm text-muted-foreground">
            The graph at scale: clusters at the top, sized by member count. Double-click a cluster (or hover it and
            press Expand) to drill in — its children fold into view, the camera follows, and the rest of the graph
            recedes without disappearing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={autoRotate} onCheckedChange={setAutoRotate} aria-label="Auto-rotate" />
            <Orbit className="h-3.5 w-3.5" /> Drift
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={bloom} onCheckedChange={setBloom} aria-label="Bloom" />
            <Sparkles className="h-3.5 w-3.5" /> Bloom
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={depthOfField} onCheckedChange={setDepthOfField} aria-label="Depth of field" />
            Depth of field
          </label>
          <Button variant="outline" size="sm" onClick={explorer.reload}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reload
          </Button>
          <Button variant="outline" size="sm" onClick={explorer.reset} disabled={explorer.expandedIds.size === 0}>
            <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Collapse all
          </Button>
        </div>
      </div>

      {renderLoadError(explorer.error)}

      {/*
        `h-[70vh]` (a viewport-relative unit, ALWAYS definite, unlike an
        ancestor-percentage chain) rather than the `min-h-[440px]`-only sizing
        `Graph3DView.tsx` uses. Found live-browser-screenshotting this view:
        the app's shared route wrapper (`App.tsx`'s `mx-auto w-full` around
        every non-chart route) has no height rule at all, so `h-full` on this
        card's canvas container resolves against an INDEFINITE ancestor and
        falls back to content-based auto-sizing. `Graph3DCanvas`'s own canvas
        element is `style.height:100%` too, so under that indefinite chain
        its LAYOUT size falls back to its `width`/`height` HTML ATTRIBUTES
        (the WebGL drawing-buffer size `scene.ts`'s `resize()` writes) —
        which the surrounding ResizeObserver then reads back as a NEW,
        larger container size and writes an even larger buffer size for,
        without bound. Confirmed live: canvas height 676px -> 964px ->
        1324px over three seconds, rendering solid black throughout (nothing
        in frame, camera framed against whatever size existed at that
        instant). `Graph3DView.tsx` shares the exact same vulnerable
        structure and very likely has the identical bug — untested there
        only because its data flow depends on a live `/api/enhanced/graph/
        graph3d` fetch this environment has no backend for, so its canvas
        never actually mounts under either the hostile-render test harness
        (route-render.hostile.test.tsx, jsdom's ResizeObserver mock is
        inert) or this manual check. The real fix belongs in the shared
        wrapper (or scene.ts's resize floor); out of scope to change here
        without auditing every other route that wrapper serves, so this
        card breaks the circularity locally instead.
      */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="relative h-[70vh] min-h-[440px] overflow-hidden p-0">
          {renderRootLoadingOverlay(explorer.rootLoading)}
          <Graph3DCanvas
            model={model}
            isDark={isDark}
            background={background}
            selected={selected}
            onSelect={setSelected}
            onExpand={onExpandDoubleClick}
            visibleMask={visibleMask}
            autoRotate={autoRotate}
            frameToken={frameToken}
            effects={effects}
            contextHops={hops}
            relationshipFilter={relationshipFilter}
            sizeOverride={scope.sizeHints}
            emphasisMask={explorer.emphasisMask}
            fixedPositions={scope.fixedPositions}
          />
          {renderCanvasBadges({
            clusterCount,
            leafCount,
            edgeCount: model.edges.length,
            expandedCount: explorer.expandedIds.size,
            pendingCount: explorer.pending.size,
          })}
          {renderCanvasControls({
            selected,
            onIsolate: isolate,
            hops,
            onHopsChange: setHops,
            onShowAll: showAll,
            showAllDisabled: !revealed && !highlightType,
            onReframe: () => {
              setFrameToken((token) => token + 1)
            },
          })}
        </Card>

        <div className="flex min-h-0 flex-col gap-4">
          {selection
            ? renderSelectedPanel({
                selectedNode: selection.node,
                selectedMeta: selection.meta,
                isDark,
                isExpanded: explorer.expandedIds.has(selection.meta.clusterId ?? ''),
                isPending: explorer.pending.has(selection.meta.clusterId ?? ''),
                onCollapse: collapseSelected,
                onExpand: expandSelected,
                neighbours: selectedNeighbours,
                onSelectNeighbour: setSelected,
                onUnpin: () => {
                  setSelected(null)
                },
              })
            : renderTypesRelsTabs({
                nodeCount: model.nodes.length,
                clusterCount,
                leafCount,
                breakdown,
                breakdownLoading,
                breakdownError,
                highlightType,
                onSelectType: setHighlightType,
                relTypes: model.relTypes,
                relTypeCount: model.relTypeCount,
                hiddenRelTypes,
                onToggleRelType: toggleRelType,
              })}
        </div>
      </div>
    </div>
  )
}
