/**
 * @file projection.ts
 * @description The shared `toGraph` projections, and the bridges into the two
 * renderers that already exist.
 *
 * This file is the whole answer to "render it in 3D whether it was kg, sql, kv or
 * sparql". Three general projections turn the three non-graph result shapes into
 * `{nodes, edges}`; two bridges hand that to the sigma canvas and the three.js scene.
 * A new modality reaches for one of these before writing its own.
 *
 * | shape  | projection      | rule                                                   |
 * |--------|-----------------|--------------------------------------------------------|
 * | rows   | rowsToGraph     | row = node; edge per `linkColumns` value matching a key |
 * | triples| triplesToGraph  | ?s/?o = nodes, ?p = edge type; literals become leaves   |
 * | tree   | treeToGraph     | path segment = node, parent->child = `contains` edge    |
 *
 * A time series is NOT a graph and has no entry here on purpose.
 */
import type { Graph3DPayload } from '@/components/knowledge-graph-3d/model'
import type { GraphNode, GraphRelationship } from '@/components/knowledge-graph/GraphAdapter'

import { toDisplayText } from './text'
import type { GraphProjection, GraphProjectionEdge, GraphProjectionNode, Row, RowSet, SchemaNode } from './types'
import { ATLAS_GRAPH_NODE_BUDGET, EMPTY_GRAPH_PROJECTION } from './types'

/** Column names treated as a row's identity when `keyColumn` is not given, best first. */
const KEY_COLUMN_HINTS = ['id', 'iri', 'uri', 'key', 'name', 'uid']

export interface RowsToGraphOptions {
  /** Column holding each row's identity. Falls back to a hint, then to the row index. */
  keyColumn?: string
  labelColumn?: string
  /** Column holding a per-row class, used for colour and the legend. */
  typeColumn?: string
  /** Columns whose value is a foreign key into `keyColumn` — this is what makes edges. */
  linkColumns?: readonly string[]
  /** Node type when no `typeColumn` is given. */
  defaultType?: string
  budget?: number
}

/** The first column name matching a hint, else the first column, else null. */
export function inferKeyColumn(rowSet: RowSet): string | null {
  const keys = rowSet.columns.map((column) => column.key)
  const hinted = KEY_COLUMN_HINTS.find((hint) => keys.some((key) => key.toLowerCase() === hint))
  if (hinted) return keys.find((key) => key.toLowerCase() === hinted) ?? null
  return keys[0] ?? null
}

function cellText(row: Row, column: string | undefined, fallback: string): string {
  if (!column) return fallback
  const text = toDisplayText(row[column])
  return text === '' ? fallback : text
}

function buildRowNodes(rowSet: RowSet, options: RowsToGraphOptions, keyColumn: string | null): GraphProjectionNode[] {
  const budget = options.budget ?? ATLAS_GRAPH_NODE_BUDGET
  const defaultType = options.defaultType ?? 'Row'
  return rowSet.rows.slice(0, budget).map((row, index) => ({
    id: cellText(row, keyColumn ?? undefined, `row:${String(index)}`),
    label: cellText(row, options.labelColumn ?? keyColumn ?? undefined, `row ${String(index + 1)}`),
    type: cellText(row, options.typeColumn, defaultType),
    properties: row,
  }))
}

function buildRowEdges(
  rowSet: RowSet,
  options: RowsToGraphOptions,
  nodes: GraphProjectionNode[],
  keyColumn: string | null,
): GraphProjectionEdge[] {
  const linkColumns = options.linkColumns ?? []
  if (linkColumns.length === 0) return []
  const known = new Set(nodes.map((node) => node.id))
  const edges: GraphProjectionEdge[] = []
  rowSet.rows.slice(0, nodes.length).forEach((row, index) => {
    const source = cellText(row, keyColumn ?? undefined, `row:${String(index)}`)
    for (const column of linkColumns) {
      const target = cellText(row, column, '')
      if (target !== '' && known.has(target) && target !== source) {
        edges.push({ source, target, type: column })
      }
    }
  })
  return edges
}

/**
 * Rows as a graph: each row is a node, each `linkColumns` value that matches another
 * row's key is an edge.
 *
 * Without `linkColumns` the honest result is a node CLOUD with no edges — still
 * useful in 3D as a coloured point field, and the `note` says exactly that rather
 * than letting a reader conclude the data has no relationships.
 */
export function rowsToGraph(rowSet: RowSet, options: RowsToGraphOptions = {}): GraphProjection {
  if (rowSet.rows.length === 0) return EMPTY_GRAPH_PROJECTION
  const keyColumn = options.keyColumn ?? inferKeyColumn(rowSet)
  const nodes = buildRowNodes(rowSet, options, keyColumn)
  const edges = buildRowEdges(rowSet, options, nodes, keyColumn)
  const truncated = nodes.length < rowSet.rows.length
  const note =
    edges.length === 0 ? 'No link columns declared, so rows project as an unconnected node cloud.' : undefined
  return { nodes, edges, truncated, note }
}

export interface TripleBinding {
  subject: unknown
  predicate: unknown
  object: unknown
}

function tripleTerm(value: unknown): { id: string; label: string; type: string } {
  const text = toDisplayText(value)
  const isIri = /^(https?:|urn:|[a-z][\w-]*:)/i.test(text)
  if (isIri) return { id: text, label: shortenIri(text), type: 'Resource' }
  return { id: `lit:${text}`, label: text, type: 'Literal' }
}

/** The fragment/last path segment of an IRI — what a human reads in a legend. */
export function shortenIri(iri: string): string {
  const hash = iri.lastIndexOf('#')
  if (hash >= 0 && hash < iri.length - 1) return iri.slice(hash + 1)
  const slash = iri.lastIndexOf('/')
  if (slash >= 0 && slash < iri.length - 1) return iri.slice(slash + 1)
  return iri
}

/**
 * Triples as a graph: subject and object become nodes, the predicate becomes the
 * edge type. Literals are keyed `lit:<text>` so two rows sharing a literal share one
 * node — which is what makes a SPARQL result look like a graph rather than a fan.
 */
export function triplesToGraph(triples: readonly TripleBinding[], budget = ATLAS_GRAPH_NODE_BUDGET): GraphProjection {
  const nodes = new Map<string, GraphProjectionNode>()
  const edges: GraphProjectionEdge[] = []
  let truncated = false
  for (const triple of triples) {
    const subject = tripleTerm(triple.subject)
    const object = tripleTerm(triple.object)
    if (nodes.size >= budget && !(nodes.has(subject.id) && nodes.has(object.id))) {
      truncated = true
      continue
    }
    nodes.set(subject.id, { id: subject.id, label: subject.label, type: subject.type })
    nodes.set(object.id, { id: object.id, label: object.label, type: object.type })
    const predicate = toDisplayText(triple.predicate)
    edges.push({ source: subject.id, target: object.id, type: shortenIri(predicate === '' ? 'related' : predicate) })
  }
  return { nodes: [...nodes.values()], edges, truncated }
}

interface TreeWalkState {
  nodes: GraphProjectionNode[]
  edges: GraphProjectionEdge[]
  budget: number
  truncated: boolean
}

function walkTree(node: SchemaNode, parentId: string | null, state: TreeWalkState): void {
  if (state.nodes.length >= state.budget) {
    state.truncated = true
    return
  }
  state.nodes.push({ id: node.id, label: node.label, type: node.kind, properties: { count: node.count ?? null } })
  if (parentId !== null) state.edges.push({ source: parentId, target: node.id, type: 'contains' })
  for (const child of node.children ?? []) walkTree(child, node.id, state)
}

/**
 * A tree as a graph: every path segment is a node, every parent→child a `contains`
 * edge. This is how a KV namespace or a blob prefix becomes a legible radial tree in
 * 3D without its adapter writing any graph code.
 */
export function treeToGraph(roots: readonly SchemaNode[], budget = ATLAS_GRAPH_NODE_BUDGET): GraphProjection {
  const state: TreeWalkState = { nodes: [], edges: [], budget, truncated: false }
  for (const root of roots) walkTree(root, null, state)
  return { nodes: state.nodes, edges: state.edges, truncated: state.truncated }
}

// ---------------------------------------------------------------------------
// Bridges into the two renderers that already exist
// ---------------------------------------------------------------------------

/**
 * `GraphProjection` → the sigma canvas's node/relationship pair.
 *
 * `node_type` (not `type`, not `label`) is the backend's canonical class property and
 * is what `resolveNodeType` reads for colouring, so it is written into `properties`.
 */
export function graphProjectionToSigma(projection: GraphProjection): {
  nodes: GraphNode[]
  relationships: GraphRelationship[]
} {
  const nodes = projection.nodes.map((node) => ({
    id: node.id,
    labels: [node.type],
    properties: { ...node.properties, node_type: node.type, name: node.label },
  }))
  const known = new Set(projection.nodes.map((node) => node.id))
  const relationships = projection.edges
    .filter((edge) => known.has(edge.source) && known.has(edge.target))
    .map((edge) => ({ source: edge.source, type: edge.type, target: edge.target }))
  return { nodes, relationships }
}

/**
 * `GraphProjection` → the three.js scene's index-addressed payload.
 *
 * ⚠ Edges whose endpoints are not in `nodes` are DROPPED here — the 3D model is CSR
 * adjacency over array indices, so a dangling endpoint has no index to point at. Emit
 * closed projections.
 */
export function graphProjectionToGraph3DPayload(projection: GraphProjection): Graph3DPayload {
  const indexById = new Map(projection.nodes.map((node, index) => [node.id, index]))
  const edges = projection.edges.flatMap((edge) => {
    const s = indexById.get(edge.source)
    const t = indexById.get(edge.target)
    if (s === undefined || t === undefined || s === t) return []
    return [{ s, t, r: edge.type, w: edge.weight ?? 1 }]
  })
  const connected = new Set(edges.flatMap((edge) => [edge.s, edge.t]))
  return {
    nodes: projection.nodes.map((node) => ({ id: node.id, type: node.type, name: node.label })),
    edges,
    total_nodes: projection.nodes.length,
    total_relationships: edges.length,
    engine_total_nodes: null,
    engine_total_relationships: null,
    connected_nodes: connected.size,
    isolated_nodes: projection.nodes.length - connected.size,
    truncated: projection.truncated,
    source_graphs: [],
    degraded_graphs: [],
    available: true,
  }
}
