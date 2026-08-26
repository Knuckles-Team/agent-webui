/**
 * @file lodGraph.ts
 * @description Adapter from the LOD contract (`contract.ts`) to the SAME
 * `Graph3DModel` shape `model.ts` already defines and `scene.ts` already
 * knows how to draw. This is the load-bearing design decision of the whole
 * client lane: a cluster is represented as an ordinary `Graph3DNode` (bigger,
 * sized by member count instead of degree) and an inter-cluster edge as an
 * ordinary `Graph3DEdge`. Nothing in `scene.ts`, `Graph3DCanvas.tsx`, or the
 * interaction layer (hover, click-to-pin, focus-plus-context, relationship
 * filter, bloom, DOF, category colour) needs to know a "cluster" is a
 * different kind of thing — it draws the same two draw calls either way. The
 * only two additions this required in `scene.ts` are additive and optional:
 * `setModel`'s `sizeOverride` parameter and `setEmphasis` (see that file).
 *
 * A `LodScope` is one screenful of the LOD hierarchy: the root level's
 * clusters, or one cluster's children. `useLodExplorer.ts` merges scopes
 * together (siblings + a freshly expanded cluster's children) into the
 * model actually handed to `Graph3DCanvas`.
 */

import {
  buildModel,
  type Graph3DEdge,
  type Graph3DModel,
  type Graph3DNode,
  type Graph3DPayload,
} from '@/components/knowledge-graph-3d/model'
import { defaultNodeSize } from '@/components/knowledge-graph-3d/scene'

import type { ClusterSummary, ClustersResponse, ExpandResponse } from './contract'

export type LodNodeKind = 'cluster' | 'leaf'

/** Per-node metadata, parallel to `LodScope.model.nodes`. */
export interface LodNodeMeta {
  kind: LodNodeKind
  /** `kind === 'cluster'` only: the cluster id this pseudo-node represents. */
  clusterId?: string
  nodeCount?: number
  edgeCount?: number
  /** Depth this cluster lives at (0 = root). Absent for leaf nodes. */
  level?: number
  /**
   * The cluster id whose expansion produced this node, stamped by
   * `useLodExplorer` when it folds a fetched child scope in. Not set by
   * `clustersToScope`/`expandToScope` themselves (root-level clusters and a
   * freshly-fetched scope's own nodes have no origin yet) — this is UI
   * state riding on the same meta array, not part of the wire adaptation.
   */
  originClusterId?: string
}

export interface LodScope {
  model: Graph3DModel
  /** `meta[i]` describes `model.nodes[i]`. */
  meta: LodNodeMeta[]
  /** One radius per node, in `setModel`'s `sizeOverride` units. */
  sizeHints: Float32Array
  /**
   * Flat `[x0,y0,z0, x1,y1,z1, ...]`, normalized the same way
   * `layout.worker.ts` normalizes a settled layout (p92 distance from
   * centroid rescaled to `CANONICAL_RADIUS`) — or `null` when this scope
   * has any node the server did not place, in which case the caller should
   * fall back to the existing force-directed worker instead (cheap: LOD
   * scopes are "only a few thousand" nodes per the brief).
   */
  fixedPositions: Float32Array | null
}

/** Keep in lockstep with `layout.worker.ts`'s own constant of the same name. */
const CANONICAL_RADIUS = 300
const CLUSTER_SIZE_MIN = 3.5
const CLUSTER_SIZE_MAX = 46

function toPayload(nodes: Graph3DNode[], edges: Graph3DEdge[]): Graph3DPayload {
  return {
    nodes,
    edges,
    total_nodes: nodes.length,
    total_relationships: edges.length,
    engine_total_nodes: null,
    engine_total_relationships: null,
    connected_nodes: nodes.length,
    isolated_nodes: 0,
    truncated: false,
    source_graphs: [],
    degraded_graphs: [],
    available: true,
  }
}

/** A cluster's radius grows with sqrt(node_count), the same shape the plain view uses for degree — capped so a 500k-node cluster is prominent, not a planet. */
function clusterSize(nodeCount: number): number {
  const raw = 2.4 + 1.7 * Math.sqrt(nodeCount)
  return Math.min(CLUSTER_SIZE_MAX, Math.max(CLUSTER_SIZE_MIN, raw))
}

function clusterToGraph3DNode(c: ClusterSummary): Graph3DNode {
  return { id: c.id, type: c.top_node_types[0] ?? 'Cluster', name: c.label }
}

/** Rescale a list of raw points exactly the way `layout.worker.ts` rescales a settled layout, so cluster sizes/camera framing calibrate against the same world scale as a force-laid-out scope. */
function normalizeCentroids(points: readonly { x: number; y: number; z: number }[]): Float32Array {
  const n = points.length
  const out = new Float32Array(n * 3)
  let cx = 0
  let cy = 0
  let cz = 0
  for (const p of points) {
    cx += p.x
    cy += p.y
    cz += p.z
  }
  cx /= n
  cy /= n
  cz /= n
  const radii = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    const dx = points[i].x - cx
    const dy = points[i].y - cy
    const dz = points[i].z - cz
    out[i * 3] = dx
    out[i * 3 + 1] = dy
    out[i * 3 + 2] = dz
    radii[i] = Math.sqrt(dx * dx + dy * dy + dz * dz)
  }
  const sorted = Float64Array.from(radii).sort()
  const p92 = sorted[Math.floor((n - 1) * 0.92)]
  const scale = p92 > 1e-6 ? CANONICAL_RADIUS / p92 : 1
  for (let i = 0; i < out.length; i += 1) out[i] *= scale
  return out
}

/** Build a scope from a `clusters()` response: every node is a cluster pseudo-node. */
export function clustersToScope(resp: ClustersResponse): LodScope {
  const nodes = resp.clusters.map(clusterToGraph3DNode)
  const edges: Graph3DEdge[] = resp.inter_cluster_edges.map((e) => ({
    s: e.src_idx,
    t: e.dst_idx,
    r: 'CLUSTER_LINK',
    w: e.weight,
  }))
  const model = buildModel(toPayload(nodes, edges))
  const meta: LodNodeMeta[] = resp.clusters.map((c) => ({
    kind: 'cluster',
    clusterId: c.id,
    nodeCount: c.node_count,
    edgeCount: c.edge_count,
    level: resp.level,
  }))
  const sizeHints = new Float32Array(resp.clusters.map((c) => clusterSize(c.node_count)))
  const allCentroids = resp.clusters.length > 0 && resp.clusters.every((c) => c.centroid != null)
  const fixedPositions = allCentroids ? normalizeCentroids(resp.clusters.map((c) => c.centroid!)) : null
  return { model, meta, sizeHints, fixedPositions }
}

/**
 * Build a scope from an `expand()` response: real leaf nodes first (indices
 * `0..nodes.length-1`, matching `ExpandEdge`'s own indexing so no remap is
 * needed), then any still-collapsed `child_clusters` appended after.
 *
 * `parentLevel` is the level of the cluster that was expanded; children are
 * one level deeper.
 */
export function expandToScope(resp: ExpandResponse, parentLevel: number): LodScope {
  const leafNodes = resp.nodes.map((n): Graph3DNode => ({ id: n.id, type: n.type, name: n.name }))
  const clusterNodes = resp.child_clusters.map(clusterToGraph3DNode)
  const nodes = [...leafNodes, ...clusterNodes]
  const edges: Graph3DEdge[] = resp.edges.map((e) => ({ s: e.src_idx, t: e.dst_idx, r: e.type, w: 1 }))
  const model = buildModel(toPayload(nodes, edges))

  const sizeHints = new Float32Array(nodes.length)
  for (let i = 0; i < resp.nodes.length; i += 1) sizeHints[i] = defaultNodeSize(model.degree[i] ?? 0)
  for (let i = 0; i < resp.child_clusters.length; i += 1) {
    sizeHints[resp.nodes.length + i] = clusterSize(resp.child_clusters[i].node_count)
  }

  const leafMeta: LodNodeMeta[] = resp.nodes.map(() => ({ kind: 'leaf' }))
  const clusterMeta: LodNodeMeta[] = resp.child_clusters.map((c) => ({
    kind: 'cluster',
    clusterId: c.id,
    nodeCount: c.node_count,
    edgeCount: c.edge_count,
    level: parentLevel + 1,
  }))
  const meta = [...leafMeta, ...clusterMeta]

  // Fixed positions only apply when EVERY node in the scope has a server
  // placement — a real node from `expand()` never carries a centroid (only
  // clusters do), so this is only non-null when the cluster expanded
  // straight into more clusters (an intermediate level) and every one of
  // them was placed. Otherwise the caller force-lays-out the whole scope,
  // which is the documented fallback and cheap at this size either way.
  const allCentroids =
    resp.nodes.length === 0 &&
    resp.child_clusters.length > 0 &&
    resp.child_clusters.every((c) => c.centroid != null)
  const fixedPositions = allCentroids ? normalizeCentroids(resp.child_clusters.map((c) => c.centroid!)) : null

  return { model, meta, sizeHints, fixedPositions }
}

/**
 * Merge scope `b`'s nodes/edges onto the end of scope `a`'s (used to fold
 * a freshly expanded cluster's children into the currently-rendered set).
 * Edge indices in `b` are shifted by `a`'s node count. Duplicate node ids
 * (same node reachable two ways) keep `a`'s copy and drop `b`'s.
 */
export function mergeScopes(a: LodScope, b: LodScope): LodScope {
  const offset = a.model.nodes.length
  const existingIds = new Set(a.model.nodes.map((n) => n.id))
  const keepMask: boolean[] = b.model.nodes.map((n) => !existingIds.has(n.id))
  const remap = new Int32Array(b.model.nodes.length).fill(-1)
  let next = offset
  const nodes: Graph3DNode[] = [...a.model.nodes]
  const meta: LodNodeMeta[] = [...a.meta]
  const sizeHints: number[] = [...a.sizeHints]
  for (let i = 0; i < b.model.nodes.length; i += 1) {
    if (!keepMask[i]) continue
    remap[i] = next
    next += 1
    nodes.push(b.model.nodes[i])
    meta.push(b.meta[i])
    sizeHints.push(b.sizeHints[i])
  }
  const edges: Graph3DEdge[] = [...a.model.edges]
  for (const e of b.model.edges) {
    const s = remap[e.s]
    const t = remap[e.t]
    if (s === -1 || t === -1) continue // an endpoint was a duplicate we dropped — see class doc
    edges.push({ ...e, s, t })
  }

  let fixedPositions: Float32Array | null = null
  if (a.fixedPositions && b.fixedPositions) {
    fixedPositions = new Float32Array(nodes.length * 3)
    fixedPositions.set(a.fixedPositions, 0)
    for (let i = 0; i < b.model.nodes.length; i += 1) {
      if (remap[i] === -1) continue
      fixedPositions[remap[i] * 3] = b.fixedPositions[i * 3]
      fixedPositions[remap[i] * 3 + 1] = b.fixedPositions[i * 3 + 1]
      fixedPositions[remap[i] * 3 + 2] = b.fixedPositions[i * 3 + 2]
    }
  }

  return {
    model: buildModel(toPayload(nodes, edges)),
    meta,
    sizeHints: Float32Array.from(sizeHints),
    fixedPositions,
  }
}

/**
 * The inverse of folding a cluster's children in: drop the cluster
 * pseudo-node `nodeId` (and any edges touching it) from `scope`, remapping
 * the remaining edge indices. Used both to fold an expanded cluster's
 * children in (its own pseudo-node has to go first) and to collapse an
 * expansion back down. A no-op (returns `scope` unchanged) if `nodeId` is
 * not present.
 */
export function removeClusterNode(scope: LodScope, nodeId: string): LodScope {
  const idx = scope.model.nodes.findIndex((n) => n.id === nodeId)
  if (idx === -1) return scope

  const remap = new Int32Array(scope.model.nodes.length)
  let next = 0
  for (let i = 0; i < scope.model.nodes.length; i += 1) {
    if (i === idx) {
      remap[i] = -1
      continue
    }
    remap[i] = next
    next += 1
  }

  const nodes = scope.model.nodes.filter((_, i) => i !== idx)
  const meta = scope.meta.filter((_, i) => i !== idx)
  const sizeHints = Array.from(scope.sizeHints).filter((_, i) => i !== idx)
  const edges: Graph3DEdge[] = scope.model.edges
    .filter((e) => e.s !== idx && e.t !== idx)
    .map((e) => ({ ...e, s: remap[e.s], t: remap[e.t] }))

  let fixedPositions: Float32Array | null = null
  if (scope.fixedPositions) {
    fixedPositions = new Float32Array(nodes.length * 3)
    for (let i = 0; i < scope.model.nodes.length; i += 1) {
      if (remap[i] === -1) continue
      fixedPositions[remap[i] * 3] = scope.fixedPositions[i * 3]
      fixedPositions[remap[i] * 3 + 1] = scope.fixedPositions[i * 3 + 1]
      fixedPositions[remap[i] * 3 + 2] = scope.fixedPositions[i * 3 + 2]
    }
  }

  return {
    model: buildModel(toPayload(nodes, edges)),
    meta,
    sizeHints: Float32Array.from(sizeHints),
    fixedPositions,
  }
}

/** An empty scope — the initial state before the first tile lands. */
export function emptyScope(): LodScope {
  return { model: buildModel(toPayload([], [])), meta: [], sizeHints: new Float32Array(0), fixedPositions: null }
}
