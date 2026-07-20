import React, { useEffect, useRef, useState } from 'react'
import Sigma from 'sigma'
import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import type { SigmaNodeAttributes, SigmaEdgeAttributes, GraphNode, GraphRelationship } from './GraphAdapter'
import { knowledgeGraphToGraphology } from './GraphAdapter'
import { GraphOverlayUI } from './GraphOverlayUI'

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
  // Keep the expired-edge set in a ref so the Sigma edge reducer (registered
  // once at construction) always reads the latest scrubber position without
  // re-creating the renderer.
  const expiredEdgesRef = useRef<ReadonlySet<string> | undefined>(expiredEdges)
  const expiredEdgeColorRef = useRef<string>(expiredEdgeColor)
  expiredEdgesRef.current = expiredEdges
  expiredEdgeColorRef.current = expiredEdgeColor

  // Initialize graph data
  useEffect(() => {
    if (nodes.length === 0) return
    const newGraph = knowledgeGraphToGraphology(nodes, relationships)
    setGraph(newGraph)
    setIsLayoutRunning(true)
  }, [nodes, relationships])

  // Initialize Sigma
  useEffect(() => {
    if (!containerRef.current || !graph) return

    if (!sigmaRef.current) {
      // Use any to bypass strict generic mismatch from Sigma.js v3
      sigmaRef.current = new Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>(graph, containerRef.current, {
        renderEdgeLabels: true,
        allowInvalidContainer: true,
        // Grey + dash edges that are expired at the current scrubber instant.
        edgeReducer: (edge, data) => {
          const expired = expiredEdgesRef.current
          if (!expired || expired.size === 0) return data
          const g = sigmaRef.current?.getGraph()
          if (!g) return data
          const key = edgeKey(g.source(edge), g.target(edge))
          if (expired.has(key)) {
            return { ...data, color: expiredEdgeColorRef.current, type: 'dashed' }
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
      <div ref={containerRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />

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
    </div>
  )
}
