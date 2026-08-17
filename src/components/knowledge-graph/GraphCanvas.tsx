import React, { useEffect, useRef, useState } from 'react'
import Sigma from 'sigma'
import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import type { SigmaNodeAttributes, SigmaEdgeAttributes, GraphNode, GraphRelationship } from './GraphAdapter'
import { knowledgeGraphToGraphology } from './GraphAdapter'
import { GraphOverlayUI } from './GraphOverlayUI'
import { GRAPH_ENGINE_RENDER_NODE_THRESHOLD, renderGraphNodesOnlyViaEngine } from './engineGraphRender'
import { adaptVizResult } from '../views/dashboards/queries'

interface GraphCanvasProps {
  nodes: GraphNode[]
  relationships: GraphRelationship[]
  onUpdateNode: (id: string, properties: Record<string, unknown>) => void
  onDeleteNode: (id: string) => void
  onAddNode: (labels: string[], properties: Record<string, unknown>) => void
  selectedNodeExternally?: GraphNode | null
  onSelectNode: (node: GraphNode | null) => void
  /**
   * Edge keys (`${source}|${target}`) that are expired at the current view.
   * Used by the temporal scrubber: matching edges render greyed + dashed via a
   * Sigma edge reducer. Optional — omitting it leaves edges rendered normally.
   */
  expiredEdges?: ReadonlySet<string>
  /** Render color for expired edges (defaults to the design-system grey). */
  expiredEdgeColor?: string
}

/** Stable key for an edge, matching graphology's source/target ordering. */
export const edgeKey = (source: string, target: string): string => `${source}|${target}`

/**
 * Composite sigma's layered canvases (edges/nodes/labels/hovers/…, each a
 * separate `<canvas>` — `Sigma.getCanvases()`) into a single PNG data URL, so
 * a "Download PNG" button works for ANY view built on this canvas (report
 * row #31: PNG/screenshot export). Draws each layer 1:1 at its own native
 * pixel size (no CSS-vs-devicePixelRatio rescaling needed) over an opaque
 * background matching the canvas's `bg-slate-900` so the export isn't
 * transparent. Returns `null` when sigma has no layers yet (nothing rendered).
 */
export function compositeSigmaCanvasesToPngDataUrl(
  canvases: Record<string, HTMLCanvasElement>,
  backgroundColor = '#0f172a',
): string | null {
  const keys = Object.keys(canvases)
  if (keys.length === 0) return null
  const out = document.createElement('canvas')
  out.width = canvases[keys[0]].width
  out.height = canvases[keys[0]].height
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, out.width, out.height)
  // Known back-to-front render order first; any other/future layer key still
  // gets drawn (just potentially mis-ordered relative to the known layers).
  // `Object.hasOwn` (not a value-truthiness check) since every layer canvas
  // is itself always truthy — what varies is whether the key is present.
  const knownOrder = ['edges', 'edgeLabels', 'nodes', 'labels', 'hovers']
  for (const key of knownOrder) {
    if (Object.hasOwn(canvases, key)) ctx.drawImage(canvases[key], 0, 0)
  }
  for (const key of keys) {
    if (!knownOrder.includes(key)) ctx.drawImage(canvases[key], 0, 0)
  }
  return out.toDataURL('image/png')
}

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  nodes,
  relationships,
  onUpdateNode,
  onDeleteNode,
  onAddNode,
  selectedNodeExternally,
  onSelectNode,
  expiredEdges,
  expiredEdgeColor = '#4b5563',
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null)
  const [graph, setGraph] = useState<Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null)
  const [isLayoutRunning, setIsLayoutRunning] = useState(false)

  // ── Renderer mode seam (D-VZ-1/GOC-88 KG-view adoption) ──────────────────
  // Below GRAPH_ENGINE_RENDER_NODE_THRESHOLD, sigma's client-side force layout
  // stays the default (full interactivity: hover/click/drag/select). Above
  // it, the client-side layout degrades the same way the engine's own layout
  // switches strategy, so the engine's at-scale render is RECOMMENDED — but
  // never silently substituted: today the engine can only render caller-
  // supplied graph nodes WITHOUT edges (see engineGraphRender.ts's module
  // doc for the confirmed wire-contract reason), so switching modes is an
  // explicit, visibly-labeled user action, never automatic. This is the seam
  // the interactive WebGPU render path (owned by another lane) plugs into.
  type RenderMode = 'interactive' | 'engine-preview'
  const recommendedMode: RenderMode =
    nodes.length > GRAPH_ENGINE_RENDER_NODE_THRESHOLD ? 'engine-preview' : 'interactive'
  const [modeOverride, setModeOverride] = useState<'auto' | RenderMode>('auto')
  const effectiveMode: RenderMode = modeOverride === 'auto' ? recommendedMode : modeOverride
  type EnginePreviewState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'unavailable'; detail: string }
    | { status: 'no-data' }
    | { status: 'error'; message: string }
    | { status: 'ready'; dataUrl: string; rowCount: number }
  const [enginePreview, setEnginePreview] = useState<EnginePreviewState>({ status: 'idle' })

  const runEnginePreview = async () => {
    setEnginePreview({ status: 'loading' })
    const r = await renderGraphNodesOnlyViaEngine(nodes.length, { title: 'Knowledge graph — node overview' })
    if (r.unavailable) {
      setEnginePreview({ status: 'unavailable', detail: r.error ?? '/graph/viz is not activated on this backend' })
      return
    }
    if (!r.ok) {
      setEnginePreview({ status: 'error', message: r.error ?? 'render failed' })
      return
    }
    const adapted = adaptVizResult(r.data)
    if (!adapted) {
      setEnginePreview({ status: 'error', message: 'Response did not carry a recognisable rendered image.' })
      return
    }
    if (adapted.rowCount === 0) {
      setEnginePreview({ status: 'no-data' })
      return
    }
    setEnginePreview({ status: 'ready', dataUrl: adapted.dataUrl, rowCount: adapted.rowCount })
  }

  // Reset the preview when the underlying node set changes size-class or the
  // component is asked to re-enter engine-preview mode — a stale image from a
  // previous graph must never linger under a "ready" caption.
  useEffect(() => {
    setEnginePreview({ status: 'idle' })
  }, [nodes.length, effectiveMode])
  // Keep the expired-edge set in a ref so the Sigma edge reducer (registered
  // once at construction) always reads the latest scrubber position without
  // re-creating the renderer.
  const expiredEdgesRef = useRef<ReadonlySet<string> | undefined>(expiredEdges)
  const expiredEdgeColorRef = useRef<string>(expiredEdgeColor)
  expiredEdgesRef.current = expiredEdges
  expiredEdgeColorRef.current = expiredEdgeColor

  // Initialize graph data — skipped in engine-preview mode: building the full
  // graphology graph + running forceAtlas2 is exactly the client-side cost
  // this mode exists to avoid for a graph too large to lay out interactively.
  useEffect(() => {
    if (nodes.length === 0 || effectiveMode !== 'interactive') return
    const newGraph = knowledgeGraphToGraphology(nodes, relationships)
    setGraph(newGraph)
    setIsLayoutRunning(true)
  }, [nodes, relationships, effectiveMode])

  // Initialize Sigma
  useEffect(() => {
    if (!containerRef.current || !graph) return

    if (!sigmaRef.current) {
      // Use any to bypass strict generic mismatch from Sigma.js v3
      sigmaRef.current = new Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>(graph, containerRef.current, {
        renderEdgeLabels: true,
        allowInvalidContainer: true,
        // Grey + thin edges that are expired at the current scrubber instant.
        // D-WUI-6: this used to also set `type: 'dashed'`, but Sigma only
        // renders edge types it has a registered WebGL program for (`line`/
        // `arrow`/... via `settings.edgeProgramClasses`) — no `dashed`
        // program is registered here, so `Sigma.render()` threw "could not
        // find a suitable program for edge type \"dashed\"!" the instant any
        // edge was actually marked expired (a real crash, not a test
        // artifact — any AS OF query that expires at least one edge trips
        // it). Color + a thinner stroke give the same "this edge is expired"
        // signal without asserting an edge type the renderer can't draw.
        edgeReducer: (edge, data) => {
          const expired = expiredEdgesRef.current
          if (!expired || expired.size === 0) return data
          const g = sigmaRef.current?.getGraph()
          if (!g) return data
          const key = edgeKey(g.source(edge), g.target(edge))
          if (expired.has(key)) {
            return { ...data, color: expiredEdgeColorRef.current, size: Math.min(data.size, 1) }
          }
          return data
        },
      })

      // Register click events
      sigmaRef.current.on('clickNode', (e) => {
        const nodeId = e.node
        const nodeData = nodes.find((n) => n.id === nodeId)
        if (nodeData) {
          onSelectNode(nodeData)
        }
      })

      sigmaRef.current.on('clickStage', () => {
        onSelectNode(null)
      })
    } else {
      sigmaRef.current.setGraph(graph)
    }

    return () => {
      // Don't kill sigma on re-render, only on unmount
    }
  }, [graph, nodes, onSelectNode])

  // Re-run the edge reducer when the expired-edge set changes (scrubber moved).
  useEffect(() => {
    if (sigmaRef.current) {
      sigmaRef.current.refresh()
    }
  }, [expiredEdges, expiredEdgeColor])

  // Cleanup Sigma entirely only when component unmounts
  useEffect(() => {
    return () => {
      if (sigmaRef.current) {
        sigmaRef.current.kill()
        sigmaRef.current = null
      }
    }
  }, [])

  // Handle layout
  useEffect(() => {
    if (!graph || graph.order === 0) return

    if (isLayoutRunning) {
      // We run synchronous iterations for an initial spread
      forceAtlas2.assign(graph, {
        iterations: 150,
        settings: forceAtlas2.inferSettings(graph),
      })

      setIsLayoutRunning(false)
      if (sigmaRef.current) {
        sigmaRef.current.refresh()
      }
    }
  }, [graph, isLayoutRunning])

  const downloadPng = () => {
    if (!sigmaRef.current) return
    const dataUrl = compositeSigmaCanvasesToPngDataUrl(sigmaRef.current.getCanvases())
    if (!dataUrl) return
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `graph-${String(Date.now())}.png`
    link.click()
  }

  return (
    <div className="relative w-full h-full bg-slate-900 rounded-lg overflow-hidden z-0">
      {/* The sigma container stays mounted in BOTH modes (never unmount/remount
          it — sigma's own ref would otherwise go stale) — it's simply given no
          graph to attach to while in engine-preview mode (see the gated
          "Initialize graph data" effect above), and visually covered by the
          engine-preview overlay below. */}
      <div ref={containerRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />

      {/* Renderer-mode badge + manual override — ALWAYS visible, in both
          modes, so the active renderer is never ambiguous (silent switching
          between two renderers with different capabilities is its own
          defect). */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <span
          data-testid="graph-render-mode-badge"
          className="bg-slate-800/90 text-white text-xs px-2 py-1 rounded shadow"
        >
          {effectiveMode === 'interactive'
            ? 'Renderer: Interactive (sigma)'
            : 'Renderer: At-scale (engine) — node preview'}
          {modeOverride === 'auto' ? ` · ${String(nodes.length)} nodes` : ' · manual'}
        </span>
        <button
          data-testid="graph-render-mode-toggle"
          onClick={() => {
            setModeOverride(effectiveMode === 'interactive' ? 'engine-preview' : 'interactive')
          }}
          className="bg-slate-800 text-white px-2 py-1 rounded shadow hover:bg-slate-700 text-xs"
        >
          Switch to {effectiveMode === 'interactive' ? 'at-scale (engine)' : 'interactive'}
        </button>
        {modeOverride !== 'auto' ? (
          <button
            onClick={() => {
              setModeOverride('auto')
            }}
            className="bg-slate-800 text-white px-2 py-1 rounded shadow hover:bg-slate-700 text-xs"
          >
            Reset to auto
          </button>
        ) : null}
      </div>

      {effectiveMode === 'interactive' ? (
        <>
          {/* HUD Controls */}
          <div className="absolute bottom-4 right-4 flex gap-2 z-10">
            <button
              onClick={() => {
                setIsLayoutRunning(true)
              }}
              className="bg-slate-800 text-white px-4 py-2 rounded shadow hover:bg-slate-700 text-sm"
            >
              Untangle Graph
            </button>
            <button
              onClick={() => {
                if (sigmaRef.current) void sigmaRef.current.getCamera().animatedReset()
              }}
              className="bg-slate-800 text-white px-4 py-2 rounded shadow hover:bg-slate-700 text-sm"
            >
              Reset View
            </button>
            <button
              onClick={downloadPng}
              className="bg-slate-800 text-white px-4 py-2 rounded shadow hover:bg-slate-700 text-sm"
            >
              Download PNG
            </button>
          </div>

          <GraphOverlayUI
            selectedNode={selectedNodeExternally ?? null}
            onClose={() => {
              onSelectNode(null)
            }}
            onSave={(updatedProps: Record<string, unknown>) => {
              if (selectedNodeExternally) onUpdateNode(selectedNodeExternally.id, updatedProps)
              onSelectNode(null)
            }}
            onDelete={() => {
              if (selectedNodeExternally) onDeleteNode(selectedNodeExternally.id)
              onSelectNode(null)
            }}
            onAddNode={onAddNode}
          />
        </>
      ) : (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6 bg-slate-900">
          <div className="max-w-lg w-full space-y-3 text-sm">
            <div className="rounded-md border border-amber-500/50 bg-amber-50/10 p-3 flex items-start gap-2">
              <span aria-hidden className="mt-0.5">
                ⚠
              </span>
              <p className="text-slate-200">
                {String(nodes.length)} nodes exceeds the interactive layout's recommended size. The engine's
                graph-native render surface can preview node positions at scale, but{' '}
                <strong>cannot yet accept the graph&apos;s edges</strong> — a real, currently-open engine wire-
                contract limitation (only one dataset per render request; see{' '}
                <span className="font-mono">engineGraphRender.ts</span>), not a bug in this view. A preview never looks
                like a complete graph: it renders nodes only, and says so.
              </p>
            </div>

            {enginePreview.status === 'idle' ? (
              <div className="flex gap-2">
                <button
                  data-testid="graph-engine-preview-run"
                  onClick={() => {
                    void runEnginePreview()
                  }}
                  className="bg-slate-800 text-white px-3 py-2 rounded shadow hover:bg-slate-700 text-sm"
                >
                  Preview node positions (engine, no edges)
                </button>
              </div>
            ) : enginePreview.status === 'loading' ? (
              <p className="text-slate-400">Rendering…</p>
            ) : enginePreview.status === 'unavailable' ? (
              <div
                data-testid="graph-engine-preview-unavailable"
                className="rounded-md border border-amber-500/50 bg-amber-50/10 p-3 text-slate-200"
              >
                The <span className="font-mono">/graph/viz</span> route is not activated on this backend yet.{' '}
                {enginePreview.detail}
              </div>
            ) : enginePreview.status === 'no-data' ? (
              <div
                data-testid="graph-engine-preview-no-data"
                className="rounded-md border border-amber-500/50 bg-amber-50/10 p-3 text-slate-200"
              >
                The engine returned zero rendered nodes for this dataset — not a fabricated empty image.
              </div>
            ) : enginePreview.status === 'error' ? (
              <pre
                data-testid="graph-engine-preview-error"
                className="rounded border border-destructive/50 bg-destructive/10 p-3 text-xs text-red-200 whitespace-pre-wrap break-words"
              >
                {enginePreview.message}
              </pre>
            ) : (
              <div className="space-y-2">
                <img
                  src={enginePreview.dataUrl}
                  alt={`Engine node-position preview of ${String(enginePreview.rowCount)} nodes (no edges)`}
                  className="max-w-full rounded-md border border-slate-700"
                  data-testid="graph-engine-preview-image"
                />
                <p className="text-slate-400 text-xs">
                  Engine preview — {enginePreview.rowCount.toLocaleString()} node positions only, edges omitted (engine
                  limitation, not this graph's real topology).
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
