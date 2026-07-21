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

  const { nodes, relationships } = schema
    ? ontologySchemaGraphToGraphNodes(schema)
    : { nodes: [] as GraphNode[], relationships: [] }
  const relationshipEdges = (schema?.edges ?? []).map((e) => e.data).filter((d) => d.kind === 'relationship')

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
          <Badge variant="outline" className="h-7 bg-muted/20 border-border/40 text-xs">
            Interfaces: {schema?.counts.interfaces ?? 0}
          </Badge>
          <Badge variant="outline" className="h-7 bg-muted/20 border-border/40 text-xs">
            Object Types: {schema?.counts.object_types ?? 0}
          </Badge>
          <Badge variant="outline" className="h-7 bg-muted/20 border-border/40 text-xs">
            Edges: {schema?.counts.edges ?? 0}
          </Badge>
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
            {loading && nodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                <Loader2 className="size-8 animate-spin mb-3" />
                <p className="text-sm">Loading ontology schema...</p>
              </div>
            ) : nodes.length > 0 ? (
              <GraphCanvas
                nodes={nodes}
                relationships={relationships}
                onUpdateNode={() => undefined}
                onDeleteNode={() => undefined}
                onAddNode={() => undefined}
                selectedNodeExternally={selectedNode}
                onSelectNode={(n) => {
                  setSelectedNode(n)
                  setSelectedEdge(null)
                }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                <Shapes className="size-12 text-muted-foreground/30 mb-3" />
                <p className="text-sm">No ontology schema loaded.</p>
              </div>
            )}
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
              <ScrollArea className="h-full px-4 pb-4">
                {!selectedNode ? (
                  <p className="text-xs text-muted-foreground py-4">Click a node on the canvas to inspect a class.</p>
                ) : (
                  <div className="space-y-2 text-xs">
                    <Badge variant="secondary" className="text-[10px]">
                      {String(selectedNode.properties.kind)}
                    </Badge>
                    {Boolean(selectedNode.properties.description) && (
                      <p className="text-muted-foreground">{String(selectedNode.properties.description)}</p>
                    )}
                    {Array.isArray(selectedNode.properties.properties) &&
                      selectedNode.properties.properties.length > 0 && (
                        <dl className="space-y-1.5 pt-1">
                          {(
                            selectedNode.properties.properties as {
                              name: string
                              type: string
                              required: boolean
                              description?: string
                            }[]
                          ).map((p) => (
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
                      )}
                  </div>
                )}
              </ScrollArea>
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
                {relationshipEdges.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4">No registered link types.</p>
                ) : (
                  <ul className="space-y-1">
                    {relationshipEdges.map((edge) => (
                      <li key={edge.id}>
                        <button
                          type="button"
                          className={`w-full text-left text-xs rounded px-2 py-1.5 hover:bg-muted/50 ${
                            selectedEdge?.id === edge.id ? 'bg-muted/50' : ''
                          }`}
                          onClick={() => {
                            setSelectedEdge(edge)
                            setSelectedNode(null)
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
                )}
                {selectedEdge && (
                  <div className="mt-2 rounded border border-border/40 p-2 text-xs space-y-1">
                    <p>
                      <span className="font-medium">{selectedEdge.label}</span>: {selectedEdge.source} →{' '}
                      {selectedEdge.target}
                    </p>
                    {selectedEdge.cardinality && (
                      <p className="text-muted-foreground">Cardinality: {selectedEdge.cardinality}</p>
                    )}
                    {selectedEdge.edge_type && (
                      <p className="text-muted-foreground">Edge type: {selectedEdge.edge_type}</p>
                    )}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
