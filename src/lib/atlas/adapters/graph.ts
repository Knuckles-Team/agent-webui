/**
 * @file adapters/graph.ts
 * @description Reference adapter #1 — the property graph (KG).
 *
 * Reads `GET /api/enhanced/graph/graph3d`, which is the one KG route that returns a
 * CLOSED node+edge payload (every edge's endpoints are present, edges reference nodes
 * by array index). That closure is exactly what {@link ModalityAdapter.toGraph} needs,
 * so this adapter is a straight pass-through into the 2D and 3D renderers.
 *
 * ⚠ This adapter filters CLIENT-SIDE. The route takes no filter parameter today, so
 * every clause is a residual applied in the browser over whatever the server returned
 * — which is stated in `capabilities().notes.filters` and rendered next to the filter
 * bar. When lane WD10-A-BACKEND lands a filterable route, move the clauses into
 * `compile()` and delete the note; do not leave the note lying when it stops being true.
 */
import { Network } from 'lucide-react'

import { graph3dPayloadSchema, type Graph3DPayload } from '@/components/knowledge-graph-3d/model'

import type { ExecuteRequest, IntrospectRequest, ModalityAdapter, PivotRequest } from '../adapter'
import { applyFilterSet, describeFilterSet } from '../filters'
import { atlasGet } from '../transport'
import type {
  AdapterCapabilities,
  FilterSet,
  GraphProjection,
  Pivot,
  ResultSet,
  RowSet,
  SchemaNode,
  SchemaTree,
  Row,
} from '../types'
import { EMPTY_FILTER_SET, MINIMAL_FILTER_OPERATORS } from '../types'

const ID = 'graph'
const GRAPH3D_ROUTE = '/api/enhanced/graph/graph3d'
const NODE_TYPES_ROUTE = '/api/enhanced/graph/node-types'

export interface GraphQuery {
  /** Isolated (degree-0) nodes are excluded by default — they make the 3D view a fog. */
  includeIsolated: boolean
  /** Carried into `execute` because this route has no pushdown; see the file header. */
  filters: FilterSet
}

export interface GraphResultNode extends Row {
  id: string
  name: string
  type: string
  degree: number
}

export interface GraphResultPayload {
  nodes: GraphResultNode[]
  edges: { source: string; target: string; type: string; weight: number }[]
  /** Nodes the server returned, before the client-side residual. */
  serverNodeCount: number
  truncated: boolean
}

interface NodeTypesPayload {
  by_type?: Record<string, number>
  available?: boolean
}

const CAPABILITIES: AdapterCapabilities = {
  introspect: true,
  filters: MINIMAL_FILTER_OPERATORS,
  freeTextSearch: true,
  sort: true,
  // No textual query language on this route. The console renders read-only rather
  // than pretending to be a Cypher box — /cypher is where arbitrary Cypher lives.
  rawQuery: false,
  graphProjection: true,
  pivots: true,
  live: false,
  notes: {
    filters:
      'Filters are applied in the browser to the nodes this route returned — the route accepts no filter parameter yet, so a match count describes the returned page, not the whole graph.',
    rawQuery: 'This modality has no text query language here. Use the Cypher Console for arbitrary Cypher.',
  },
}

function typeChildren(byType: Record<string, number>): SchemaNode[] {
  return Object.entries(byType)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => ({ id: `type:${type}`, label: type, kind: 'collection' as const, count }))
}

const FIELD_NODES: SchemaNode[] = [
  { id: 'name', label: 'name', kind: 'field', dataType: 'string' },
  { id: 'type', label: 'type', kind: 'field', dataType: 'string' },
  { id: 'id', label: 'id', kind: 'field', dataType: 'string' },
  { id: 'degree', label: 'degree', kind: 'field', dataType: 'number' },
]

async function introspect({ signal }: IntrospectRequest): Promise<SchemaTree> {
  const res = await atlasGet<NodeTypesPayload>(NODE_TYPES_ROUTE, signal)
  const byType = res.data?.by_type
  if (!res.ok || !byType) {
    return {
      adapterId: ID,
      roots: [],
      unavailable: true,
      note: res.error ?? 'Node-type breakdown is not served here.',
    }
  }
  return {
    adapterId: ID,
    roots: [
      { id: 'types', label: 'Node types', kind: 'source', children: typeChildren(byType) },
      { id: 'fields', label: 'Fields', kind: 'source', children: FIELD_NODES },
    ],
    unavailable: false,
  }
}

function toResultNodes(payload: Graph3DPayload): GraphResultNode[] {
  const degree = new Uint32Array(payload.nodes.length)
  const inRange = (index: number): boolean => index >= 0 && index < degree.length
  for (const edge of payload.edges) {
    if (inRange(edge.s)) degree[edge.s] += 1
    if (inRange(edge.t)) degree[edge.t] += 1
  }
  return payload.nodes.map((node, index) => ({
    id: node.id,
    name: node.name,
    type: node.type,
    degree: degree[index],
  }))
}

function edgesAmong(payload: Graph3DPayload, kept: Set<string>): GraphResultPayload['edges'] {
  return payload.edges.flatMap((edge) => {
    const source = payload.nodes[edge.s]?.id
    const target = payload.nodes[edge.t]?.id
    if (!source || !target || !kept.has(source) || !kept.has(target)) return []
    return [{ source, target, type: edge.r, weight: edge.w }]
  })
}

function emptyResult(degraded: string | null, elapsedMs: number): ResultSet<GraphResultPayload> {
  return {
    adapterId: ID,
    shape: 'graph',
    payload: { nodes: [], edges: [], serverNodeCount: 0, truncated: false },
    stats: { elapsedMs, rowCount: 0, truncated: false },
    degraded,
    sources: [],
  }
}

async function execute({ query, signal }: ExecuteRequest<GraphQuery>): Promise<ResultSet<GraphResultPayload>> {
  const started = Date.now()
  const route = `${GRAPH3D_ROUTE}?include_isolated=${query.includeIsolated ? 'true' : 'false'}`
  const res = await atlasGet<Graph3DPayload>(route, signal, graph3dPayloadSchema)
  const payload = res.data
  if (!res.ok || !payload) return emptyResult(res.error ?? 'The graph engine is not reachable.', Date.now() - started)
  if (!payload.available) return emptyResult('The graph engine is not reachable yet.', Date.now() - started)

  const matched = applyFilterSet(toResultNodes(payload), query.filters) as GraphResultNode[]
  const kept = new Set(matched.map((node) => node.id))
  return {
    adapterId: ID,
    shape: 'graph',
    payload: {
      nodes: matched,
      edges: edgesAmong(payload, kept),
      serverNodeCount: payload.nodes.length,
      truncated: payload.truncated,
    },
    stats: {
      elapsedMs: Date.now() - started,
      rowCount: matched.length,
      truncated: payload.truncated || matched.length < payload.nodes.length,
      note:
        matched.length < payload.nodes.length
          ? `${String(matched.length)} of ${String(payload.nodes.length)} returned nodes matched in the browser.`
          : undefined,
    },
    degraded: payload.degraded_graphs.length > 0 ? `Skipped graphs: ${payload.degraded_graphs.join(', ')}` : null,
    sources: payload.source_graphs,
  }
}

function toRows(result: ResultSet<GraphResultPayload>): RowSet {
  return {
    columns: [
      { key: 'id', label: 'id', type: 'string' },
      { key: 'name', label: 'name', type: 'string' },
      { key: 'type', label: 'type', type: 'string' },
      { key: 'degree', label: 'degree', type: 'number' },
    ],
    rows: result.payload.nodes,
  }
}

function toGraph(result: ResultSet<GraphResultPayload>): GraphProjection {
  return {
    nodes: result.payload.nodes.map((node) => ({
      id: node.id,
      label: node.name || node.id,
      type: node.type,
      properties: node,
    })),
    edges: result.payload.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: edge.type,
      weight: edge.weight,
    })),
    truncated: result.payload.truncated,
  }
}

/** True for something that can be the subject of a SPARQL triple pattern. */
function looksLikeIri(value: string): boolean {
  return /^(https?:|urn:)\S+$/i.test(value)
}

function pivots({ selection }: PivotRequest<GraphResultPayload>): Pivot[] {
  const offers: Pivot[] = []
  const type = typeof selection.data.type === 'string' ? selection.data.type : selection.type
  if (type) {
    offers.push({
      id: `graph:type:${type}`,
      label: `All ${type} nodes`,
      description: 'Re-run this modality filtered to the selected node type.',
      targetAdapterId: ID,
      filters: { ...EMPTY_FILTER_SET, clauses: [{ id: 'pivot-type', field: 'type', op: 'eq', value: type }] },
    })
  }
  if (looksLikeIri(selection.id)) {
    offers.push({
      id: `sparql:describe:${selection.id}`,
      label: 'Describe in SPARQL',
      description: 'Open this entity in the RDF modality and list its predicates.',
      targetAdapterId: 'sparql',
      filters: EMPTY_FILTER_SET,
      seedQuery: `SELECT ?p ?o WHERE { <${selection.id}> ?p ?o } LIMIT 100`,
    })
  }
  return offers
}

const graphAdapter: ModalityAdapter<GraphQuery, GraphResultPayload> = {
  id: ID,
  label: 'Knowledge Graph',
  description: 'Entities and the relationships between them, as the engine stores them.',
  icon: Network,
  capabilities: () => CAPABILITIES,
  introspect,
  compile: ({ filters }) => ({ includeIsolated: false, filters }),
  describe: (query) => `nodes ${describeFilterSet(query.filters)}`,
  execute,
  toRows,
  toGraph,
  pivots,
}

export default graphAdapter
