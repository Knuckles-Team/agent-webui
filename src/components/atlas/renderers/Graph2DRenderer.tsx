/**
 * @file Graph2DRenderer.tsx
 * @description The existing sigma.js canvas, driven by a {@link GraphProjection}.
 *
 * The whole file is a shim: `GraphCanvas` already does force-directed layout, theming,
 * hover and selection. Atlas's contribution is that it now receives a projection from
 * ANY modality — a SQL join graph and an RDF triple graph land here identically.
 *
 * Atlas is read-only, so the canvas's mutation callbacks are deliberate no-ops rather
 * than wired-up handlers: a data explorer that could silently write to the graph is a
 * different and much more dangerous product.
 */
import { useMemo } from 'react'
import { Network } from 'lucide-react'

import { GraphCanvas } from '@/components/knowledge-graph/GraphCanvas'
import type { GraphNode } from '@/components/knowledge-graph/GraphAdapter'
import { graphProjectionToSigma } from '@/lib/atlas/projection'
import type { AtlasRenderer, RendererProps } from '@/lib/atlas/renderers'
import type { Selection } from '@/lib/atlas/types'

/** Sigma paints every node every frame; past this the LOD view is the honest answer. */
export const GRAPH_2D_NODE_LIMIT = 3000

function noop(): void {
  /* Atlas is a read-only explorer — see the file header. */
}

function toSelection(node: GraphNode): Selection {
  const name = node.properties.name
  return {
    kind: 'node',
    id: node.id,
    label: typeof name === 'string' && name ? name : node.id,
    type: node.labels[0],
    data: node.properties,
  }
}

function Graph2DRendererBody({ projection, selection, onSelect }: RendererProps) {
  const graph = projection.graph
  const { nodes, relationships } = useMemo(
    () => (graph ? graphProjectionToSigma(graph) : { nodes: [], relationships: [] }),
    [graph],
  )
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selection?.id) ?? null, [nodes, selection?.id])

  if (nodes.length > GRAPH_2D_NODE_LIMIT) {
    return (
      <p className="text-muted-foreground p-4 text-sm" data-testid="atlas-graph2d-oversize">
        {nodes.length.toLocaleString()} nodes is beyond what this canvas draws smoothly. Narrow the filters, or use the
        level-of-detail explorer at <code>/graph-3d/lod</code>.
      </p>
    )
  }

  return (
    <div className="h-full w-full" data-testid="atlas-graph2d">
      <GraphCanvas
        nodes={nodes}
        relationships={relationships}
        onUpdateNode={noop}
        onDeleteNode={noop}
        onAddNode={noop}
        selectedNodeExternally={selectedNode}
        onSelectNode={(node) => {
          onSelect(node ? toSelection(node) : null)
        }}
      />
    </div>
  )
}

export const graph2dRenderer: AtlasRenderer = {
  id: 'graph2d',
  label: '2D graph',
  icon: Network,
  priority: 90,
  prefers: ['graph'],
  accepts: (projection) => (projection.graph?.nodes.length ?? 0) > 0,
  component: Graph2DRendererBody,
}
