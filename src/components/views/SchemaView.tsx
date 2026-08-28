/**
 * @file SchemaView.tsx
 * @description Ontology TYPE schema (TBox) graph — the headline
 * Ontology-Playground Playground feature (report row #3): render the
 * interface + link-type registries as an interactive node/edge diagram.
 *
 * Thin by design: fetches `GET /api/ontology/schema-graph` (the backend data
 * is already done — `build_schema_graph`) and feeds the Cytoscape-elements
 * payload into the EXISTING `GraphCanvas` (sigma.js/graphology), the same
 * canvas GraphView/VertexView already use for instance data. No new
 * rendering engine — only a payload adapter (`ontologySchemaGraphToGraphNodes`
 * in `GraphAdapter.ts`).
 *
 * Interaction: click a node on the canvas to inspect a class (interface or
 * object type) — properties, description, extends/implements. `GraphCanvas`
 * has no edge-click event, so relationships are inspected via the
 * "Relationships" list panel instead (click a row) rather than extending the
 * shared canvas component.
 */

import { useEffect, useState } from 'react'
import { Shapes, RefreshCw, Loader2, Component, Boxes, Link2, X, Upload } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { GraphCanvas } from '../knowledge-graph/GraphCanvas'
import type { GraphNode, OntologySchemaEdgeData, OntologySchemaGraph } from '../knowledge-graph/GraphAdapter'
import { ontologySchemaGraphToGraphNodes } from '../knowledge-graph/GraphAdapter'
import { api } from '@/lib/api'
import { ImportExportModal } from '@/components/ontology/ImportExportModal'

function renderCanvasPanel({
  loading,
  nodes,
  relationships,
  selectedNode,
  onSelectNode,
}: {
  loading: boolean
  nodes: GraphNode[]
  relationships: ReturnType<typeof ontologySchemaGraphToGraphNodes>['relationships']
  selectedNode: GraphNode | null
  onSelectNode: (n: GraphNode | null) => void
}) {
  if (loading && nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
        <Loader2 className="size-8 animate-spin mb-3" />
        <p className="text-sm">Loading ontology schema...</p>
      </div>
    )
  }
  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
        <Shapes className="size-12 text-muted-foreground/30 mb-3" />
        <p className="text-sm">No ontology schema loaded.</p>
      </div>
    )
  }
  return (
    <GraphCanvas
      nodes={nodes}
      relationships={relationships}
      onUpdateNode={() => undefined}
      onDeleteNode={() => undefined}
      onAddNode={() => undefined}
      selectedNodeExternally={selectedNode}
      onSelectNode={onSelectNode}
    />
  )
}

function renderSelectedNodeProperties(node: GraphNode) {
  const props = node.properties.properties
  if (!Array.isArray(props) || props.length === 0) return null
  const typed = props as { name: string; type: string; required: boolean; description?: string }[]
  return (
    <dl className="space-y-1.5 pt-1">
      {typed.map((p) => (
        <div key={p.name} className="border-b border-border/20 pb-1">
          <dt className="font-medium">
            {p.name}
            <span className="text-muted-foreground font-normal"> ({p.type})</span>
            {!p.required && <span className="text-muted-foreground font-normal"> optional</span>}
          </dt>
          {p.description && <dd className="text-muted-foreground">{p.description}</dd>}
        </div>
      ))}
    </dl>
  )
}

function renderClassInspectorBody(selectedNode: GraphNode | null) {
  if (!selectedNode) {
    return <p className="text-xs text-muted-foreground py-4">Click a node on the canvas to inspect a class.</p>
  }
  return (
    <div className="space-y-2 text-xs">
      <Badge variant="secondary" className="text-[10px]">
        {String(selectedNode.properties.kind)}
      </Badge>
      {Boolean(selectedNode.properties.description) && (
        <p className="text-muted-foreground">{String(selectedNode.properties.description)}</p>
      )}
      {renderSelectedNodeProperties(selectedNode)}
    </div>
  )
}

function renderRelationshipsList({
  relationshipEdges,
  selectedEdge,
  onSelectEdge,
}: {
  relationshipEdges: OntologySchemaEdgeData[]
  selectedEdge: OntologySchemaEdgeData | null
  onSelectEdge: (edge: OntologySchemaEdgeData) => void
}) {
  if (relationshipEdges.length === 0) {
    return <p className="text-xs text-muted-foreground py-4">No registered link types.</p>
  }
  return (
    <ul className="space-y-1">
      {relationshipEdges.map((edge) => (
        <li key={edge.id}>
          <button
            type="button"
            className={`w-full text-left text-xs rounded px-2 py-1.5 hover:bg-muted/50 ${
              selectedEdge?.id === edge.id ? 'bg-muted/50' : ''
            }`}
            onClick={() => {
              onSelectEdge(edge)
            }}
          >
            <span className="font-medium">{edge.label}</span>
            <span className="text-muted-foreground">
              : {edge.source} → {edge.target}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function renderSelectedEdgeDetail(edge: OntologySchemaEdgeData) {
  return (
    <div className="mt-2 rounded border border-border/40 p-2 text-xs space-y-1">
      <p>
        <span className="font-medium">{edge.label}</span>: {edge.source} → {edge.target}
      </p>
      {edge.cardinality && <p className="text-muted-foreground">Cardinality: {edge.cardinality}</p>}
      {edge.edge_type && <p className="text-muted-foreground">Edge type: {edge.edge_type}</p>}
    </div>
  )
}

function deriveSchemaGraphNodes(schema: OntologySchemaGraph | null) {
  if (!schema) return { nodes: [] as GraphNode[], relationships: [] as ReturnType<typeof ontologySchemaGraphToGraphNodes>['relationships'] }
  return ontologySchemaGraphToGraphNodes(schema)
}

function deriveRelationshipEdges(schema: OntologySchemaGraph | null): OntologySchemaEdgeData[] {
  return (schema?.edges ?? []).map((e) => e.data).filter((d) => d.kind === 'relationship')
}

function renderSchemaHeaderBadges(schema: OntologySchemaGraph | null) {
  return (
    <>
      <Badge variant="outline" className="h-7 bg-muted/20 border-border/40 text-xs">
        Interfaces: {schema?.counts.interfaces ?? 0}
      </Badge>
      <Badge variant="outline" className="h-7 bg-muted/20 border-border/40 text-xs">
        Object Types: {schema?.counts.object_types ?? 0}
      </Badge>
      <Badge variant="outline" className="h-7 bg-muted/20 border-border/40 text-xs">
        Edges: {schema?.counts.edges ?? 0}
      </Badge>
    </>
  )
}

export default function SchemaView() {
  const [schema, setSchema] = useState<OntologySchemaGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<OntologySchemaEdgeData | null>(null)
  const [importExportOpen, setImportExportOpen] = useState(false)

  const loadSchema = async () => {
    setLoading(true)
    try {
      const result = await api.getOntologySchemaGraph()
      setSchema(result)
    } catch (err) {
      toast.error('Failed to load ontology schema graph')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSchema()
  }, [])

  const { nodes, relationships } = deriveSchemaGraphNodes(schema)
  const relationshipEdges = deriveRelationshipEdges(schema)

  return (
    <div className="space-y-6 h-[calc(100vh-12rem)] flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shapes className="size-6 text-emerald-400" />
            Ontology Schema
          </h1>
          <p className="text-sm text-muted-foreground">
            The ontology's own type schema (TBox): interfaces, object types, and their relationships — pan, zoom, and
            click a class to inspect it.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {renderSchemaHeaderBadges(schema)}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setImportExportOpen(true)
            }}
          >
            <Upload className="size-4 mr-1" />
            Import / Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void loadSchema()
            }}
            disabled={loading}
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <ImportExportModal
        open={importExportOpen}
        onOpenChange={setImportExportOpen}
        onImported={() => {
          void loadSchema()
        }}
      />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden">
        {/* Graph canvas */}
        <Card className="lg:col-span-2 border-border/40 bg-card/60 flex flex-col overflow-hidden">
          <CardContent className="flex-1 p-0 relative overflow-hidden min-h-[450px]">
            {renderCanvasPanel({
              loading,
              nodes,
              relationships,
              selectedNode,
              onSelectNode: (n) => {
                setSelectedNode(n)
                setSelectedEdge(null)
              },
            })}
          </CardContent>
        </Card>

        {/* Inspector panel */}
        <div className="flex flex-col gap-4 overflow-hidden">
          {/* Legend */}
          <Card className="border-border/40 bg-card/60 shrink-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">Legend</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Component className="size-3.5 text-[#0078d4]" /> Interface
              </span>
              <span className="flex items-center gap-1.5">
                <Boxes className="size-3.5 text-[#107c10]" /> Object Type
              </span>
            </CardContent>
          </Card>

          {/* Selected class inspector */}
          <Card className="border-border/40 bg-card/60 flex-1 overflow-hidden flex flex-col min-h-[160px]">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Component className="size-4 text-emerald-400" />
                {selectedNode ? (selectedNode.properties.name as string) : 'Selected Class'}
              </CardTitle>
              {selectedNode && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="Clear selection"
                  onClick={() => {
                    setSelectedNode(null)
                  }}
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full px-4 pb-4">{renderClassInspectorBody(selectedNode)}</ScrollArea>
            </CardContent>
          </Card>

          {/* Relationships list — click-to-inspect (GraphCanvas has no edge-click event) */}
          <Card className="border-border/40 bg-card/60 flex-1 overflow-hidden flex flex-col min-h-[160px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Link2 className="size-4 text-emerald-400" />
                Relationships ({relationshipEdges.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full px-4 pb-4">
                {renderRelationshipsList({
                  relationshipEdges,
                  selectedEdge,
                  onSelectEdge: (edge) => {
                    setSelectedEdge(edge)
                    setSelectedNode(null)
                  },
                })}
                {selectedEdge && renderSelectedEdgeDetail(selectedEdge)}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
