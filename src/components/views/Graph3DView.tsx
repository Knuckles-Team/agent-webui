/**
 * @file Graph3DView.tsx
 * @description The 3D knowledge-graph view: a WebGL force-directed rendering
 * of the graph's CONNECTED core, with click-to-focus, isolate-to-N-hops, and
 * click-to-expand.
 *
 * ## Why this renders the connected core, and says so
 *
 * Measured on the live graph (2026-08-25): 25,221 nodes, 2,617 relationships.
 * The node count is dominated by operational telemetry that carries no edges
 * at all -- RuntimeSignal (15,327), WorkItem (4,534), Concept (2,438) -- while
 * every edge in the graph lives in a much smaller structural core: workflows
 * and their steps, the skills those steps call, the runnables those skills
 * bind, and the MCP servers that serve them. Drawing all 25k would put ~23k
 * unconnected points on screen: more pixels, no more meaning, and a force
 * simulation spending most of its time on nodes with nothing to be pulled by.
 *
 * So the default is the connected core, and the count of what is being left
 * out is stated on screen rather than quietly implied away. `Include
 * unconnected` fetches them anyway when the question is "how big is this
 * really" -- that is a real request to the same route, not a decoration.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, Crosshair, Eye, Layers, Orbit, RefreshCw, Rows3, ScanSearch } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { ApiError, fetchValidated } from '@/lib/api-validation'
import { Graph3DCanvas } from '@/components/knowledge-graph-3d/Graph3DCanvas'
import {
  buildModel,
  graph3dPayloadSchema,
  neighbourhood,
  neighbours,
  type Graph3DModel,
  type Graph3DPayload,
} from '@/components/knowledge-graph-3d/model'
import { cssColorToHex, nodeTypeColor, useIsDarkMode } from '@/components/knowledge-graph/theme-colors'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; payload: Graph3DPayload }
  | { kind: 'empty'; payload: Graph3DPayload }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'error'; reason: string }

/** Hop radii offered by the isolate control. */
const HOP_CHOICES = [1, 2, 3] as const

const numberFormat = new Intl.NumberFormat()

function backgroundHex(isDark: boolean): string {
  if (typeof window === 'undefined') return isDark ? '#0a0d14' : '#f6f7fb'
  const token = window.getComputedStyle(document.documentElement).getPropertyValue('--background')
  const resolved = cssColorToHex(token, isDark ? '#0a0d14' : '#f6f7fb')
  return resolved
}

export default function Graph3DView() {
  const isDark = useIsDarkMode()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [includeIsolated, setIncludeIsolated] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [revealed, setRevealed] = useState<Set<number> | null>(null)
  const [hops, setHops] = useState<(typeof HOP_CHOICES)[number]>(2)
  const [autoRotate, setAutoRotate] = useState(true)
  const [frameToken, setFrameToken] = useState(0)
  const [background, setBackground] = useState(() => backgroundHex(isDark))
  const requestId = useRef(0)

  useEffect(() => {
    setBackground(backgroundHex(isDark))
  }, [isDark])

  const load = useCallback(async (withIsolated: boolean) => {
    const id = requestId.current + 1
    requestId.current = id
    setState({ kind: 'loading' })
    try {
      const payload = await fetchValidated(
        `/api/enhanced/graph/graph3d?include_isolated=${withIsolated ? 'true' : 'false'}`,
        graph3dPayloadSchema,
      )
      if (requestId.current !== id) return
      if (!payload.available) {
        setState({ kind: 'unavailable', reason: 'The graph engine is not reachable yet.' })
        return
      }
      setState(payload.nodes.length === 0 ? { kind: 'empty', payload } : { kind: 'ready', payload })
      setSelected(null)
      setRevealed(null)
    } catch (error) {
      if (requestId.current !== id) return
      // A route that is not deployed yet is a DIFFERENT thing from a route
      // that failed, and the operator needs to be able to tell which.
      if (error instanceof ApiError && (error.status === 404 || error.status === 501)) {
        setState({
          kind: 'unavailable',
          reason: 'The 3D graph route is not served by this backend yet (GET /api/enhanced/graph/graph3d).',
        })
        return
      }
      const reason = error instanceof Error ? error.message : 'Unknown failure'
      setState({ kind: 'error', reason })
      toast.error('Could not load the 3D knowledge graph', { description: reason })
    }
  }, [])

  // `load` resolves its own failures into `state`; it never rejects, so the
  // callback form here is a real no-op handler, not a swallowed error.
  const reload = useCallback(() => {
    load(includeIsolated).catch(() => undefined)
  }, [load, includeIsolated])

  useEffect(() => {
    reload()
  }, [reload])

  const payload = state.kind === 'ready' || state.kind === 'empty' ? state.payload : null
  const model: Graph3DModel | null = useMemo(() => (payload ? buildModel(payload) : null), [payload])

  const visibleMask = useMemo(() => {
    if (!model || !revealed) return null
    const mask = new Uint8Array(model.nodes.length)
    for (const index of revealed) mask[index] = 1
    return mask
  }, [model, revealed])

  const isolate = useCallback(() => {
    if (!model || selected == null) return
    const mask = neighbourhood(model, selected, hops)
    const next = new Set<number>()
    for (let i = 0; i < mask.length; i += 1) if (mask[i] === 1) next.add(i)
    setRevealed(next)
    setFrameToken((token) => token + 1)
  }, [model, selected, hops])

  const expand = useCallback(
    (index: number) => {
      if (!model) return
      setRevealed((current) => {
        if (!current) return current
        const added = neighbours(model, index).filter((n) => !current.has(n))
        if (added.length === 0) {
          toast.info('Nothing further to expand here', {
            description: `${model.nodes[index].name} has no hidden neighbours.`,
          })
          return current
        }
        const next = new Set(current)
        for (const n of added) next.add(n)
        return next
      })
    },
    [model],
  )

  const showAll = useCallback(() => {
    setRevealed(null)
    setFrameToken((token) => token + 1)
  }, [])

  const selectedNode = model && selected != null ? model.nodes[selected] : null
  const selectedNeighbours = useMemo(() => {
    if (!model || selected == null) return []
    return neighbours(model, selected)
      .map((index) => ({ index, node: model.nodes[index], degree: model.degree[index] }))
      .sort((a, b) => b.degree - a.degree)
  }, [model, selected])

  const hiddenNeighbourCount = useMemo(() => {
    if (!model || selected == null || !revealed) return 0
    return neighbours(model, selected).filter((n) => !revealed.has(n)).length
  }, [model, selected, revealed])

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Boxes className="h-6 w-6" /> Knowledge Graph 3D
          </h1>
          <p className="text-sm text-muted-foreground">
            The connected core of the graph, laid out in three dimensions. Drag to orbit, scroll to zoom, click a node
            to focus it, double-click to expand its neighbours.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={includeIsolated}
              onCheckedChange={setIncludeIsolated}
              aria-label="Include unconnected nodes"
            />
            Include unconnected
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={autoRotate} onCheckedChange={setAutoRotate} aria-label="Auto-rotate" />
            <Orbit className="h-3.5 w-3.5" /> Drift
          </label>
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reload
          </Button>
        </div>
      </div>

      {state.kind === 'loading' ? (
        <Card className="flex-1">
          <CardContent className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Reading the graph…
          </CardContent>
        </Card>
      ) : null}

      {state.kind === 'unavailable' || state.kind === 'error' ? (
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-base">
              {state.kind === 'unavailable' ? 'Not available yet' : 'Could not load the graph'}
            </CardTitle>
            <CardDescription>{state.reason}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {state.kind === 'empty' ? (
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-base">No connected nodes</CardTitle>
            <CardDescription>The graph answered successfully and holds no relationships to draw.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {state.kind === 'ready' && model && payload ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <Card className="relative min-h-[420px] overflow-hidden p-0">
            <Graph3DCanvas
              model={model}
              isDark={isDark}
              background={background}
              selected={selected}
              onSelect={setSelected}
              onExpand={expand}
              visibleMask={visibleMask}
              autoRotate={autoRotate}
              frameToken={frameToken}
            />
            <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="font-mono text-[10px]">
                {numberFormat.format(model.nodes.length)} nodes
              </Badge>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {numberFormat.format(model.edges.length)} edges
              </Badge>
              {revealed ? (
                <Badge variant="outline" className="font-mono text-[10px]">
                  showing {numberFormat.format(revealed.size)}
                </Badge>
              ) : null}
              {payload.truncated ? (
                <Badge variant="destructive" className="text-[10px]">
                  truncated at the payload bound
                </Badge>
              ) : null}
            </div>
            <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                onClick={isolate}
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
                      setHops(choice)
                    }}
                    className={`px-2 py-1 text-[11px] transition-colors ${
                      hops === choice ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    {choice} hop{choice > 1 ? 's' : ''}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="secondary" onClick={showAll} disabled={!revealed}>
                <Eye className="mr-1.5 h-3.5 w-3.5" /> Show all
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setFrameToken((token) => token + 1)
                }}
              >
                <Crosshair className="mr-1.5 h-3.5 w-3.5" /> Re-frame
              </Button>
            </div>
          </Card>

          <div className="flex min-h-0 flex-col gap-4">
            <Card className="min-h-0 flex-1">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Layers className="h-4 w-4" /> {selectedNode ? 'Selected' : 'Node types'}
                </CardTitle>
                {selectedNode ? null : (
                  <CardDescription className="text-xs">
                    {numberFormat.format(payload.connected_nodes)} nodes carry at least one edge
                    {includeIsolated
                      ? `; ${numberFormat.format(payload.isolated_nodes)} carry none.`
                      : '. Unconnected nodes are not drawn — turn on “Include unconnected” to load them.'}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="min-h-0 p-0">
                <ScrollArea className="h-[260px] px-4 pb-4">
                  {selectedNode ? (
                    <div className="space-y-3">
                      <div>
                        <div className="text-sm font-medium leading-tight">{selectedNode.name}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ background: nodeTypeColor(selectedNode.type, isDark) }}
                          />
                          {selectedNode.type}
                        </div>
                        <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground/80">
                          {selectedNode.id}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {selectedNeighbours.length} neighbours
                        </Badge>
                        {hiddenNeighbourCount > 0 ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              expand(selected!)
                            }}
                          >
                            <Rows3 className="mr-1.5 h-3.5 w-3.5" /> Expand {hiddenNeighbourCount}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelected(null)
                          }}
                        >
                          Clear
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {selectedNeighbours.map(({ index, node, degree }) => (
                          <button
                            key={node.id}
                            type="button"
                            onClick={() => {
                              setSelected(index)
                            }}
                            className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
                          >
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ background: nodeTypeColor(node.type, isDark) }}
                            />
                            <span className="min-w-0 flex-1 truncate">{node.name}</span>
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{degree}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {model.types.map((type, index) => (
                        <div key={type} className="flex items-center gap-2 px-1.5 py-1 text-xs">
                          <span
                            className="inline-block h-2 w-2 shrink-0 rounded-full"
                            style={{ background: nodeTypeColor(type, isDark) }}
                          />
                          <span className="min-w-0 flex-1 truncate">{type}</span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {numberFormat.format(model.typeCount[index])}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Relationships</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[160px] px-4 pb-4">
                  <div className="space-y-1">
                    {model.relTypes.map((type, index) => (
                      <div key={type} className="flex items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate font-mono">{type}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {numberFormat.format(model.relTypeCount[index])}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  )
}
