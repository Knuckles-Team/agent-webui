/**
 * @file model.ts
 * @description Wire shape + derived graph model for the 3D knowledge-graph view.
 *
 * The backend route (`GET /api/enhanced/graph/graph3d`, api_extensions.py)
 * returns a CLOSED payload: every edge's two endpoints are present in `nodes`,
 * and an edge references them by ARRAY INDEX rather than repeating the id.
 * That is the whole reason this view does not reuse `/graph/nodes` +
 * `/graph/relationships` -- see that route's own docstring for the two
 * measured reasons (a 256-item cap that makes the two lists not connect, and a
 * full property bag per node that the renderer never draws).
 *
 * Everything here is pure data: no three.js, no React. `buildModel` turns the
 * wire payload into the flat typed arrays the renderer uploads to the GPU and
 * the CSR adjacency the interaction layer walks. Kept separate so both are
 * unit-testable without a WebGL context.
 */

import { z } from 'zod'

/** One node as the backend sends it. */
export interface Graph3DNode {
  id: string
  type: string
  name: string
}

/** One edge; `s`/`t` index into the node array, `w` is parallel-edge count. */
export interface Graph3DEdge {
  s: number
  t: number
  r: string
  w: number
}

export interface Graph3DPayload {
  nodes: Graph3DNode[]
  edges: Graph3DEdge[]
  total_nodes: number
  total_relationships: number
  /**
   * The ENGINE's own gauges for the same graphs, or `null` when they could not
   * be read. `total_*` above describe this payload; these describe the graph
   * the payload was drawn from, and on the live system the two disagree by a
   * lot -- see the route's `_engine_graph_sizes` docstring. The UI states the
   * gap rather than picking one number and calling it "the graph".
   */
  engine_total_nodes: number | null
  engine_total_relationships: number | null
  connected_nodes: number
  isolated_nodes: number
  truncated: boolean
  source_graphs: string[]
  degraded_graphs: string[]
  available: boolean
}

export const graph3dNodeSchema: z.ZodType<Graph3DNode> = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
})

export const graph3dEdgeSchema: z.ZodType<Graph3DEdge> = z.object({
  s: z.number(),
  t: z.number(),
  r: z.string(),
  w: z.number(),
})

export const graph3dPayloadSchema: z.ZodType<Graph3DPayload> = z.object({
  nodes: z.array(graph3dNodeSchema),
  edges: z.array(graph3dEdgeSchema),
  total_nodes: z.number(),
  total_relationships: z.number(),
  engine_total_nodes: z.number().nullable(),
  engine_total_relationships: z.number().nullable(),
  connected_nodes: z.number(),
  isolated_nodes: z.number(),
  truncated: z.boolean(),
  source_graphs: z.array(z.string()),
  degraded_graphs: z.array(z.string()),
  available: z.boolean(),
})

/**
 * The renderer-facing model.
 *
 * `adjOffset`/`adjTarget`/`adjEdge` are a CSR (compressed sparse row)
 * adjacency: node `i`'s neighbours are `adjTarget[adjOffset[i] .. adjOffset[i+1])`
 * and the edge that produced each one is `adjEdge[...]` at the same position.
 * One flat allocation instead of N arrays -- a BFS over it does no allocation
 * at all, which is what keeps "isolate to 2 hops" instant on click.
 */
export interface Graph3DModel {
  nodes: Graph3DNode[]
  edges: Graph3DEdge[]
  /** Undirected degree per node (parallel edges counted once each). */
  degree: Uint32Array
  adjOffset: Uint32Array
  adjTarget: Uint32Array
  adjEdge: Uint32Array
  /** Distinct node types, most frequent first. */
  types: string[]
  /** Per-node index into `types`. */
  typeIndex: Uint16Array
  /** Node count per entry of `types`. */
  typeCount: number[]
  /** Distinct relationship types, most frequent first. */
  relTypes: string[]
  relTypeCount: number[]
  /** Index of each node in `nodes`, by node id. */
  indexById: Map<string, number>
}

const EMPTY_MODEL: Graph3DModel = {
  nodes: [],
  edges: [],
  degree: new Uint32Array(0),
  adjOffset: new Uint32Array(1),
  adjTarget: new Uint32Array(0),
  adjEdge: new Uint32Array(0),
  types: [],
  typeIndex: new Uint16Array(0),
  typeCount: [],
  relTypes: [],
  relTypeCount: [],
  indexById: new Map(),
}

interface CsrAdjacency {
  degree: Uint32Array
  adjOffset: Uint32Array
  adjTarget: Uint32Array
  adjEdge: Uint32Array
}

/** Two-pass CSR (compressed sparse row) adjacency build -- no per-node arrays. */
function buildCsrAdjacency(nodeCount: number, edges: Graph3DEdge[]): CsrAdjacency {
  const degree = new Uint32Array(nodeCount)
  for (const e of edges) {
    degree[e.s] += 1
    degree[e.t] += 1
  }
  const adjOffset = new Uint32Array(nodeCount + 1)
  for (let i = 0; i < nodeCount; i += 1) adjOffset[i + 1] = adjOffset[i] + degree[i]
  const cursor = adjOffset.slice(0, nodeCount)
  const adjTarget = new Uint32Array(adjOffset[nodeCount])
  const adjEdge = new Uint32Array(adjOffset[nodeCount])
  for (let k = 0; k < edges.length; k += 1) {
    const e = edges[k]
    adjTarget[cursor[e.s]] = e.t
    adjEdge[cursor[e.s]] = k
    cursor[e.s] += 1
    adjTarget[cursor[e.t]] = e.s
    adjEdge[cursor[e.t]] = k
    cursor[e.t] += 1
  }
  return { degree, adjOffset, adjTarget, adjEdge }
}

interface TypeVocabulary {
  types: string[]
  typeCount: number[]
  typeIndex: Uint16Array
}

/** Distinct node types, most frequent first (so the legend reads well), plus each node's index into that list. */
function buildTypeVocabulary(nodes: Graph3DNode[]): TypeVocabulary {
  const nodeCount = nodes.length
  const typeTally = new Map<string, number>()
  for (const n of nodes) typeTally.set(n.type, (typeTally.get(n.type) ?? 0) + 1)
  const typeEntries = [...typeTally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const types = typeEntries.map(([t]) => t)
  const typeCount = typeEntries.map(([, c]) => c)
  const typeSlot = new Map(types.map((t, i) => [t, i]))
  const typeIndex = new Uint16Array(nodeCount)
  for (let i = 0; i < nodeCount; i += 1) typeIndex[i] = typeSlot.get(nodes[i].type) ?? 0
  return { types, typeCount, typeIndex }
}

interface RelTypeVocabulary {
  relTypes: string[]
  relTypeCount: number[]
}

/** Distinct relationship types, most frequent first. */
function buildRelTypeVocabulary(edges: Graph3DEdge[]): RelTypeVocabulary {
  const relTally = new Map<string, number>()
  for (const e of edges) relTally.set(e.r, (relTally.get(e.r) ?? 0) + 1)
  const relEntries = [...relTally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return { relTypes: relEntries.map(([t]) => t), relTypeCount: relEntries.map(([, c]) => c) }
}

/** Build the derived model. Malformed edges are dropped, never thrown on. */
export function buildModel(payload: Graph3DPayload): Graph3DModel {
  const nodeCount = payload.nodes.length
  if (nodeCount === 0) return EMPTY_MODEL

  const edges = payload.edges.filter((e) => e.s >= 0 && e.s < nodeCount && e.t >= 0 && e.t < nodeCount && e.s !== e.t)
  const { degree, adjOffset, adjTarget, adjEdge } = buildCsrAdjacency(nodeCount, edges)
  const { types, typeCount, typeIndex } = buildTypeVocabulary(payload.nodes)
  const { relTypes, relTypeCount } = buildRelTypeVocabulary(edges)

  const indexById = new Map<string, number>()
  for (let i = 0; i < nodeCount; i += 1) indexById.set(payload.nodes[i].id, i)

  return {
    nodes: payload.nodes,
    edges,
    degree,
    adjOffset,
    adjTarget,
    adjEdge,
    types,
    typeIndex,
    typeCount,
    relTypes,
    relTypeCount,
    indexById,
  }
}

/**
 * Every node within `hops` of `root`, as a `Uint8Array` mask.
 *
 * Allocation-free over the CSR adjacency apart from the mask and the frontier,
 * so this runs on every click without a frame budget worry.
 */
export function neighbourhood(model: Graph3DModel, root: number, hops: number): Uint8Array {
  const mask = new Uint8Array(model.nodes.length)
  if (root < 0 || root >= mask.length) return mask
  mask[root] = 1
  let frontier = [root]
  for (let depth = 0; depth < hops && frontier.length > 0; depth += 1) {
    const next: number[] = []
    for (const node of frontier) {
      for (let k = model.adjOffset[node]; k < model.adjOffset[node + 1]; k += 1) {
        const nb = model.adjTarget[k]
        if (mask[nb] === 0) {
          mask[nb] = 1
          next.push(nb)
        }
      }
    }
    frontier = next
  }
  return mask
}

/** The immediate neighbours of `node`, de-duplicated, as node indices. */
export function neighbours(model: Graph3DModel, node: number): number[] {
  if (node < 0 || node >= model.nodes.length) return []
  const seen = new Set<number>()
  for (let k = model.adjOffset[node]; k < model.adjOffset[node + 1]; k += 1) {
    seen.add(model.adjTarget[k])
  }
  return [...seen]
}
