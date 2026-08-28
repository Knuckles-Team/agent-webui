/**
 * @file Graph3DRenderer.tsx
 * @description The existing three.js scene, driven by a {@link GraphProjection}.
 *
 * This file is the owner's ask made literal: "render the information in 3d whether it
 * was kg, sql, kv, sparql". It contains no modality knowledge at all — it accepts a
 * projection with at least one node and hands it to `Graph3DCanvas`. Every modality
 * that implements `toGraph` gets 3D by doing nothing else.
 */
import { useEffect, useMemo, useState } from 'react'
import { Boxes } from 'lucide-react'

import { Graph3DCanvas } from '@/components/knowledge-graph-3d/Graph3DCanvas'
import { buildModel } from '@/components/knowledge-graph-3d/model'
import { cssColorToHex, useIsDarkMode } from '@/components/knowledge-graph/theme-colors'
import type { Graph3DModel } from '@/components/knowledge-graph-3d/model'
import { graphProjectionToGraph3DPayload } from '@/lib/atlas/projection'
import type { AtlasRenderer, RendererProps } from '@/lib/atlas/renderers'
import type { Selection } from '@/lib/atlas/types'

/** Beyond this the browser is the bottleneck; `/graph-3d/lod` is the answer, not a bigger buffer. */
export const GRAPH_3D_NODE_LIMIT = 60_000

const EFFECTS = { bloom: true, depthOfField: false }

/** The app's own `--background` token, so the scene sits in the page rather than on it. */
function backgroundHex(isDark: boolean): string {
  const fallback = isDark ? '#0a0d14' : '#f6f7fb'
  if (typeof window === 'undefined') return fallback
  const token = window.getComputedStyle(document.documentElement).getPropertyValue('--background')
  return cssColorToHex(token, fallback)
}

/** One scene node as the renderer-agnostic {@link Selection} every panel understands. */
function nodeSelection(model: Graph3DModel, index: number): Selection | null {
  if (index < 0 || index >= model.nodes.length) return null
  const node = model.nodes[index]
  return { kind: 'node', id: node.id, label: node.name || node.id, type: node.type, data: { ...node } }
}

function Graph3DRendererBody({ projection, selection, onSelect }: RendererProps) {
  const isDark = useIsDarkMode()
  const [background, setBackground] = useState(() => backgroundHex(isDark))
  useEffect(() => {
    setBackground(backgroundHex(isDark))
  }, [isDark])

  const graph = projection.graph
  const model = useMemo(
    () => buildModel(graphProjectionToGraph3DPayload(graph ?? { nodes: [], edges: [], truncated: false })),
    [graph],
  )
  const selectedIndex = useMemo(
    () => (selection ? (model.indexById.get(selection.id) ?? null) : null),
    [model, selection],
  )

  if (model.nodes.length > GRAPH_3D_NODE_LIMIT) {
    return (
      <p className="text-muted-foreground p-4 text-sm" data-testid="atlas-graph3d-oversize">
        {model.nodes.length.toLocaleString()} nodes exceeds what this scene uploads to the GPU. Use the level-of-detail
        explorer at <code>/graph-3d/lod</code>, which streams clusters instead.
      </p>
    )
  }

  return (
    <div className="h-full w-full" data-testid="atlas-graph3d">
      <Graph3DCanvas
        model={model}
        isDark={isDark}
        background={background}
        selected={selectedIndex}
        onSelect={(index) => {
          onSelect(index === null ? null : nodeSelection(model, index))
        }}
        onExpand={() => {
          /* Expansion is a modality-specific traversal; Atlas offers it as a pivot instead. */
        }}
        visibleMask={null}
        autoRotate={false}
        frameToken={model.nodes.length}
        effects={EFFECTS}
        contextHops={1}
        relationshipFilter={null}
      />
    </div>
  )
}

export const graph3dRenderer: AtlasRenderer = {
  id: 'graph3d',
  label: '3D graph',
  icon: Boxes,
  priority: 85,
  prefers: ['graph'],
  accepts: (projection) => (projection.graph?.nodes.length ?? 0) > 0,
  component: Graph3DRendererBody,
}
