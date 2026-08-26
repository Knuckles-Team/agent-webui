/**
 * @file contract.ts
 * @description Wire shapes for the server-side LOD (level-of-detail)
 * clustering protocol that VIZ-1 (hierarchical clustering) and VIZ-2 (binary
 * tile protocol) are building. This file is the ONE place that names the
 * contract; everything downstream (`lodGraph.ts`, `LodTransport`
 * implementations, `useLodExplorer.ts`) is written against these types, not
 * against a specific transport's wire format.
 *
 * ## The contract, as briefed
 *
 * ```
 * clusters(graph, level, parent_cluster_id?) ->
 *   { level, clusters: [ {id, label, node_count, edge_count, centroid?, top_node_types} ],
 *     inter_cluster_edges: [ {src_idx, dst_idx, weight} ] }
 * expand(graph, cluster_id) ->
 *   { nodes: [...], edges: [ {src_idx, dst_idx, type} ], child_clusters: [...] }
 * ```
 *
 * VIZ-1/VIZ-2 are running now, so the wire format may still shift. Two things
 * insulate this lane from that:
 *
 *  1. Everything is a zod schema, not a type assertion — the SAME chokepoint
 *     discipline `api-validation.ts` establishes for every other route in
 *     this app (see its file doc). A deviation fails loudly, at the fetch
 *     boundary, with a message naming the field — never a silent `undefined`
 *     three components downstream.
 *  2. `LodTransport` (bottom of this file) is the only surface the UI layer
 *     depends on. `mockTransport.ts` implements it today so this lane is not
 *     blocked on the siblings landing; `httpTransport.ts` implements it
 *     against the real routes and is a drop-in swap once they exist. If the
 *     shape below turns out to be wrong, only `contract.ts` +
 *     `httpTransport.ts` need to change — `lodGraph.ts` and the UI do not.
 *
 * `node_count`/`edge_count` are sizing hints (sphere radius, "N nodes"
 * badges), not attendance rosters — a cluster's members are only enumerated
 * by calling `expand` on it. `centroid` is optional per the contract; when a
 * level's clusters do not carry one, `lodGraph.ts` lays them out locally with
 * the existing force-directed worker (cheap: "there are only a few thousand"
 * per the brief, well inside the worker's small-graph tick budget).
 */

import { z } from 'zod'

/** A 3D point in the same canonical world units the layout worker settles to. */
export const centroidSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
})
export type Centroid = z.infer<typeof centroidSchema>

/** One cluster summary at a given level. */
export const clusterSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  node_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative(),
  centroid: centroidSchema.nullish(),
  /** Most-frequent node types inside the cluster, most frequent first. */
  top_node_types: z.array(z.string()).default([]),
})
export type ClusterSummary = z.infer<typeof clusterSummarySchema>

/**
 * An edge between two clusters AT THE SAME LEVEL, indexing into that level's
 * `clusters` array (NOT a cluster id — mirrors the closed, index-based edge
 * shape `graph3d`'s own payload already uses, so `lodGraph.ts` can reuse the
 * same CSR-building code `model.ts` already has tests for).
 */
export const interClusterEdgeSchema = z.object({
  src_idx: z.number().int().nonnegative(),
  dst_idx: z.number().int().nonnegative(),
  weight: z.number().nonnegative(),
})
export type InterClusterEdge = z.infer<typeof interClusterEdgeSchema>

export const clustersResponseSchema = z.object({
  level: z.number().int().nonnegative(),
  clusters: z.array(clusterSummarySchema),
  inter_cluster_edges: z.array(interClusterEdgeSchema),
})
export type ClustersResponse = z.infer<typeof clustersResponseSchema>

/** One real (leaf) node inside an expanded cluster. */
export const expandNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
})
export type ExpandNode = z.infer<typeof expandNodeSchema>

/** An edge between two of `expand`'s own `nodes`, by array index. */
export const expandEdgeSchema = z.object({
  src_idx: z.number().int().nonnegative(),
  dst_idx: z.number().int().nonnegative(),
  type: z.string(),
})
export type ExpandEdge = z.infer<typeof expandEdgeSchema>

/**
 * A still-collapsed child cluster inside the expanded parent (present when
 * the parent's children are themselves clusters, i.e. `expand` was called
 * above the leaf level).
 */
export const childClusterSchema = clusterSummarySchema
export type ChildCluster = ClusterSummary

export const expandResponseSchema = z.object({
  nodes: z.array(expandNodeSchema),
  edges: z.array(expandEdgeSchema),
  child_clusters: z.array(childClusterSchema).default([]),
})
export type ExpandResponse = z.infer<typeof expandResponseSchema>

/**
 * A page of an otherwise-single response, for progressive rendering.
 *
 * Neither half of the briefed contract is paginated on the wire today — this
 * is this lane's own addition, motivated by deliverable #3 ("render a first
 * frame from the first tile; refine as more arrive"). A `LodTransport`
 * yields these instead of one big payload so the UI can paint as data
 * arrives rather than blocking on the whole response, the same shape of
 * trade-off `layout.worker.ts` already makes for the force simulation
 * (`POST_EVERY` snapshots instead of one final result). `HttpLodTransport`
 * yields exactly one tile per call (whatever the server sends back) until a
 * real tiled endpoint exists; `MockLodTransport` chunks its synthetic
 * response to exercise the progressive path today.
 */
export interface LodTile<T> {
  data: T
  tileIndex: number
  /** `true` on the last tile of this request. */
  done: boolean
}

/** Identifies which graph(s) a request scopes to — same convention `graph3d` uses. */
export type LodGraphScope = string[]

/**
 * The one surface the UI layer depends on. `graph` is the source-graph
 * scope (mirrors `graph3d`'s `source_graphs`), `level` is 0 at the root and
 * increases with depth, `parentClusterId` narrows `clusters()` to one
 * parent's children (omitted at the root).
 */
export interface LodTransport {
  clusters(
    graph: LodGraphScope,
    level: number,
    parentClusterId?: string,
    signal?: AbortSignal,
  ): AsyncIterable<LodTile<ClustersResponse>>

  expand(graph: LodGraphScope, clusterId: string, signal?: AbortSignal): AsyncIterable<LodTile<ExpandResponse>>
}
