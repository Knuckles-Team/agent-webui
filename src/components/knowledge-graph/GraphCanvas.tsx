import React, { useEffect, useRef, useState } from 'react'
import Sigma from 'sigma'
import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import type { SigmaNodeAttributes, SigmaEdgeAttributes, GraphNode, GraphRelationship } from './GraphAdapter'
import { knowledgeGraphToGraphology } from './GraphAdapter'
import { GraphOverlayUI } from './GraphOverlayUI'
import { GraphLegend } from './GraphLegend'
import { GRAPH_ENGINE_RENDER_NODE_THRESHOLD, renderGraphNodesOnlyViaEngine } from './engineGraphRender'
import { adaptVizResult } from '../views/dashboards/queries'
import { pickReadableTextColor, resolveThemeColors, useIsDarkMode } from './theme-colors'

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

// Minimal shape of what sigma's hover-drawing function actually reads —
// looser than sigma's own (unexported) `NodeHoverDrawingFunction` type so
// this file doesn't need to reach into sigma's internal declaration paths.
interface HoverDrawData {
  x: number
  y: number
  size: number
  label?: string | null
}
interface HoverDrawSettings {
  labelSize: number
  labelFont: string
  labelWeight: string
}

/**
 * Themed replacement for sigma's built-in `drawDiscNodeHover`
 * (`sigma/dist/index-*.esm.js`), which hardcodes the hover box to a fixed
 * white fill (`context.fillStyle = "#FFF"`) — fine with black text in light
 * mode, but the previous canvas already forced light node-label text for
 * dark-mode legibility, so hovering a node in dark mode drew that same
 * light text on the ALWAYS-white hover box: invisible. This mirrors the
 * original's exact box geometry (pill for wide labels, disc otherwise) but
 * fills it with the current theme's card color and picks its own text color
 * against THAT fill, so hover stays readable in both themes independent of
 * the canvas-background label color used elsewhere.
 */
function drawThemedNodeHover(
  context: CanvasRenderingContext2D,
  data: HoverDrawData,
  settings: HoverDrawSettings,
  isDark: boolean,
): void {
  const size = settings.labelSize
  const font = settings.labelFont
  const weight = settings.labelWeight
  context.font = `${weight} ${String(size)}px ${font}`

  const theme = resolveThemeColors(isDark)
  const boxColor = theme.card
  const textColor = pickReadableTextColor(boxColor)

  context.fillStyle = boxColor
  context.strokeStyle = theme.border
  context.lineWidth = 1
  context.shadowOffsetX = 0
  context.shadowOffsetY = 0
  context.shadowBlur = 8
  context.shadowColor = isDark ? '#000000' : 'rgba(15, 23, 42, 0.35)'

  const PADDING = 2
  if (typeof data.label === 'string') {
    const textWidth = context.measureText(data.label).width
    const boxWidth = Math.round(textWidth + 5)
    const boxHeight = Math.round(size + 2 * PADDING)
    const radius = Math.max(data.size, size / 2) + PADDING
    const angleRadian = Math.asin(boxHeight / 2 / radius)
    const xDeltaCoord = Math.sqrt(Math.abs(Math.pow(radius, 2) - Math.pow(boxHeight / 2, 2)))
    context.beginPath()
    context.moveTo(data.x + xDeltaCoord, data.y + boxHeight / 2)
    context.lineTo(data.x + radius + boxWidth, data.y + boxHeight / 2)
    context.lineTo(data.x + radius + boxWidth, data.y - boxHeight / 2)
    context.lineTo(data.x + xDeltaCoord, data.y - boxHeight / 2)
    context.arc(data.x, data.y, radius, angleRadian, -angleRadian)
    context.closePath()
    context.fill()
    context.stroke()
  } else {
    context.beginPath()
    context.arc(data.x, data.y, data.size + PADDING, 0, Math.PI * 2)
    context.closePath()
    context.fill()
    context.stroke()
  }
  context.shadowOffsetX = 0
  context.shadowOffsetY = 0
  context.shadowBlur = 0

  if (data.label) {
    context.fillStyle = textColor
    context.fillText(data.label, data.x + data.size + 3, data.y + size / 3)
  }
}

/**
 * Composite sigma's layered canvases (edges/nodes/labels/hovers/…, each a
 * separate `<canvas>` — `Sigma.getCanvases()`) into a single PNG data URL, so
 * a "Download PNG" button works for ANY view built on this canvas (report
 * row #31: PNG/screenshot export). Draws each layer 1:1 at its own native
 * pixel size (no CSS-vs-devicePixelRatio rescaling needed) over an opaque
 * background matching the canvas's current theme background so the export
 * isn't transparent. Returns `null` when sigma has no layers yet (nothing
 * rendered).
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

// ── Renderer mode seam (D-VZ-1/GOC-88 KG-view adoption) ────────────────────
// Below GRAPH_ENGINE_RENDER_NODE_THRESHOLD, sigma's client-side force layout
// stays the default (full interactivity: hover/click/drag/select). Above it,
// the client-side layout degrades the same way the engine's own layout
// switches strategy, so the engine's at-scale render is RECOMMENDED — but
// never silently substituted: today the engine can only render caller-
// supplied graph nodes WITHOUT edges (see engineGraphRender.ts's module doc
// for the confirmed wire-contract reason), so switching modes is an
// explicit, visibly-labeled user action, never automatic. This is the seam
// the interactive WebGPU render path (owned by another lane) plugs into.
type RenderMode = 'interactive' | 'engine-preview'

type EnginePreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable'; detail: string }
  | { status: 'no-data' }
  | { status: 'error'; message: string }
  | { status: 'ready'; dataUrl: string; rowCount: number }

/** Own the engine-preview render's async lifecycle: trigger it, and reset it whenever it would go stale. */
function useEnginePreview(nodeCount: number, effectiveMode: RenderMode) {
  const [enginePreview, setEnginePreview] = useState<EnginePreviewState>({ status: 'idle' })

  const runEnginePreview = async () => {
    setEnginePreview({ status: 'loading' })
    const r = await renderGraphNodesOnlyViaEngine(nodeCount, { title: 'Knowledge graph — node overview' })
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
  }, [nodeCount, effectiveMode])

  return { enginePreview, runEnginePreview }
}

interface UseSigmaGraphParams {
  nodes: GraphNode[]
  relationships: GraphRelationship[]
  effectiveMode: RenderMode
  isDark: boolean
  onSelectNode: (node: GraphNode | null) => void
  expiredEdges?: ReadonlySet<string>
  expiredEdgeColor: string
}

/**
 * Own the Sigma instance's full lifecycle: graph construction, sigma
 * construction/update, the edge-reducer/theme/expiry refs it reads live, and
 * the force-atlas2 layout pass. Same refs, same effects, same dependency
 * arrays as before this was a hook -- only where the state lives moved.
 */
function useSigmaGraph({
  nodes,
  relationships,
  effectiveMode,
  isDark,
  onSelectNode,
  expiredEdges,
  expiredEdgeColor,
}: UseSigmaGraphParams) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null)
  const [graph, setGraph] = useState<Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null)
  const [isLayoutRunning, setIsLayoutRunning] = useState(false)

  // Keep the expired-edge set in a ref so the Sigma edge reducer (registered
  // once at construction) always reads the latest scrubber position without
  // re-creating the renderer.
  const expiredEdgesRef = useRef<ReadonlySet<string> | undefined>(expiredEdges)
  const expiredEdgeColorRef = useRef<string>(expiredEdgeColor)
  expiredEdgesRef.current = expiredEdges
  expiredEdgeColorRef.current = expiredEdgeColor

  // Same ref pattern as expiredEdgesRef above: the hover renderer is
  // registered once at Sigma construction, so it reads theme through a ref
  // rather than closing over a stale `isDark` from its first render.
  const isDarkRef = useRef<boolean>(isDark)
  isDarkRef.current = isDark

  // Initialize graph data — skipped in engine-preview mode: building the full
  // graphology graph + running forceAtlas2 is exactly the client-side cost
  // this mode exists to avoid for a graph too large to lay out interactively.
  useEffect(() => {
    if (nodes.length === 0 || effectiveMode !== 'interactive') return
    const newGraph = knowledgeGraphToGraphology(nodes, relationships, isDark)
    setGraph(newGraph)
    setIsLayoutRunning(true)
  }, [nodes, relationships, effectiveMode, isDark])

  // Initialize Sigma
  useEffect(() => {
    if (!containerRef.current || !graph) return

    if (!sigmaRef.current) {
      // Use any to bypass strict generic mismatch from Sigma.js v3
      sigmaRef.current = new Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>(graph, containerRef.current, {
        renderEdgeLabels: true,
        allowInvalidContainer: true,
        // THE FIX for the reported defect: sigma's own default is
        // `labelColor: { color: "#000" }` — pure black, unconditionally
        // (`sigma/settings`'s `DEFAULT_SETTINGS`). `{ attribute: 'labelColor'
        // }` makes it read each node's own `labelColor` attribute instead,
        // which GraphAdapter's `knowledgeGraphToGraphology` always sets to a
        // WCAG-AA color against the canvas background for the CURRENT theme
        // (see that function's comment for why "canvas background" is the
        // right target, not the node fill). `color` here is only the
        // fallback for the one case a node's own attribute is somehow
        // missing — resolved fresh so it still matches the initial theme.
        labelColor: {
          attribute: 'labelColor',
          color: pickReadableTextColor(resolveThemeColors(isDarkRef.current).card),
        },
        // Sigma's built-in hover renderer hardcodes a white box — see
        // `drawThemedNodeHover`'s doc comment above for why that breaks in
        // dark mode. `isDarkRef` (not the `isDark` prop) so this stays live
        // across theme toggles without re-constructing the Sigma instance.
        defaultDrawNodeHover: (context, data, settings) => {
          drawThemedNodeHover(context, data, settings, isDarkRef.current)
        },
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

  // Keep the Sigma-instance-level label-color fallback in sync with the live
  // theme too (belt-and-braces: every node's own `labelColor` attribute is
  // already recomputed on theme change via the graph-rebuild effect above,
  // so this only matters for the rare node missing that attribute).
  // `defaultDrawNodeHover` doesn't need a matching update — it already reads
  // theme live through `isDarkRef` on every hover paint.
  useEffect(() => {
    if (!sigmaRef.current) return
    sigmaRef.current.setSetting('labelColor', {
      attribute: 'labelColor',
      color: pickReadableTextColor(resolveThemeColors(isDark).card),
    })
    sigmaRef.current.refresh()
  }, [isDark])

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

  return { containerRef, sigmaRef, setIsLayoutRunning }
}

interface EnginePreviewPaneProps {
  nodeCount: number
  enginePreview: EnginePreviewState
  onRunPreview: () => void
}

/** The engine at-scale render mode's overlay: warning, trigger, and one state-typed result pane. */
function EnginePreviewPane({ nodeCount, enginePreview, onRunPreview }: EnginePreviewPaneProps): React.ReactElement {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6 bg-card">
      <div className="max-w-lg w-full space-y-3 text-sm">
        <div className="rounded-md border border-amber-500/50 bg-amber-50/10 p-3 flex items-start gap-2">
          <span aria-hidden className="mt-0.5">
            ⚠
          </span>
          <p className="text-foreground">
            {String(nodeCount)} nodes exceeds the interactive layout's recommended size. The engine's graph-native
            render surface can preview node positions at scale, but{' '}
            <strong>cannot yet accept the graph&apos;s edges</strong> — a real, currently-open engine wire-contract
            limitation (only one dataset per render request; see{' '}
            <span className="font-mono">engineGraphRender.ts</span>), not a bug in this view. A preview never looks
            like a complete graph: it renders nodes only, and says so.
          </p>
        </div>

        {enginePreview.status === 'idle' ? (
          <div className="flex gap-2">
            <button
              data-testid="graph-engine-preview-run"
              onClick={onRunPreview}
              className="bg-slate-800 text-white px-3 py-2 rounded shadow hover:bg-slate-700 text-sm"
            >
              Preview node positions (engine, no edges)
            </button>
          </div>
        ) : enginePreview.status === 'loading' ? (
          <p className="text-muted-foreground">Rendering…</p>
        ) : enginePreview.status === 'unavailable' ? (
          <div
            data-testid="graph-engine-preview-unavailable"
            className="rounded-md border border-amber-500/50 bg-amber-50/10 p-3 text-foreground"
          >
            The <span className="font-mono">/graph/viz</span> route is not activated on this backend yet.{' '}
            {enginePreview.detail}
          </div>
        ) : enginePreview.status === 'no-data' ? (
          <div
            data-testid="graph-engine-preview-no-data"
            className="rounded-md border border-amber-500/50 bg-amber-50/10 p-3 text-foreground"
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
              className="max-w-full rounded-md border border-border"
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
  )
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
  // Live theme: drives node/edge/label colors below and re-renders the
  // canvas the instant the user (or the system) toggles dark/light — see
  // theme-colors.ts's module doc for why sigma needs this pushed to it
  // explicitly (it draws on raw <canvas>, which can't see CSS variables).
  const isDark = useIsDarkMode()

  const recommendedMode: RenderMode =
    nodes.length > GRAPH_ENGINE_RENDER_NODE_THRESHOLD ? 'engine-preview' : 'interactive'
  const [modeOverride, setModeOverride] = useState<'auto' | RenderMode>('auto')
  const effectiveMode: RenderMode = modeOverride === 'auto' ? recommendedMode : modeOverride

  const { enginePreview, runEnginePreview } = useEnginePreview(nodes.length, effectiveMode)

  const { containerRef, sigmaRef, setIsLayoutRunning } = useSigmaGraph({
    nodes,
    relationships,
    effectiveMode,
    isDark,
    onSelectNode,
    expiredEdges,
    expiredEdgeColor,
  })

  const downloadPng = () => {
    if (!sigmaRef.current) return
    // Match the exported PNG's background to whatever the canvas is
    // actually showing right now (theme-resolved), not a permanently-dark
    // default — a light-mode export with a dark-navy background would look
    // broken next to the on-screen canvas.
    const dataUrl = compositeSigmaCanvasesToPngDataUrl(sigmaRef.current.getCanvases(), resolveThemeColors(isDark).card)
    if (!dataUrl) return
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `graph-${String(Date.now())}.png`
    link.click()
  }

  return (
    // `bg-card` (not a hardcoded slate) — this is the fix for the reported
    // defect: the canvas background now tracks the active theme (light/dark/
    // glass), and every color drawn onto it below (node fills, labels, edges)
    // is computed against THIS token, so they stay legible regardless of
    // which theme is active.
    <div className="relative w-full h-full bg-card rounded-lg overflow-hidden z-0">
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

          <GraphLegend nodes={nodes} isDark={isDark} />

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
        <EnginePreviewPane
          nodeCount={nodes.length}
          enginePreview={enginePreview}
          onRunPreview={() => {
            void runEnginePreview()
          }}
        />
      )}
    </div>
  )
}
