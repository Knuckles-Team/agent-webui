/**
 * @file contract.ts
 * @description Wire shapes for the bounded JSON hierarchy preview. This is the
 * VIZ-1-shaped contract currently available to the WebUI; VIZ-2 binary tiles
 * and streaming are not implemented by this lane. This file is the ONE place
 * that names the contract; everything downstream (`lodGraph.ts`, `LodTransport`
 * implementations, `useLodExplorer.ts`) is written against these types, not
 * against a specific transport's wire format.
 *
 * ## The contract, as briefed
 *
 * ```
 * refresh(graph) ->
 *   { available, status, graph, authority_scoped, version, freshness,
 *     observed_at, transport: "json-hierarchy-preview", streaming: false }
 * clusters(graph, level, parent_cluster_id?) ->
 *   { level, clusters: [ {id, label, node_count, edge_count, centroid?, top_node_types} ],
 *     inter_cluster_edges: [ {src_idx, dst_idx, weight} ] }
 * expand(graph, cluster_id) ->
 *   { nodes: [...], edges: [ {src_idx, dst_idx, type} ], child_clusters: [...] }
 * ```
 *
 * The native VIZ-2 binary/tiled protocol is not claimed here. Two things
 * insulate the preview lane from future contract changes:
 *
 *  1. Everything is a zod schema, not a type assertion — the SAME chokepoint
 *     discipline `api-validation.ts` establishes for every other route in
 *     this app (see its file doc). A deviation fails loudly, at the fetch
 *     boundary, with a message naming the field — never a silent `undefined`
 *     three components downstream.
 *  2. `LodTransport` (bottom of this file) is the only surface the UI layer
 *     depends on. `httpTransport.ts` is the production implementation;
 *     `mockTransport.ts` remains an explicit test/demo fixture only. If the
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

/** A response status is explicit so an unavailable graph never looks empty. */
export const lodStatusSchema = z.enum(['ready', 'unavailable'])
export type LodStatus = z.infer<typeof lodStatusSchema>

/**
 * Raised by the production transport when the authenticated graph gateway
 * cannot serve hierarchy data. This is intentionally distinct from a shape
 * or network error so the view can explain "unavailable" instead of implying
 * that the graph has zero clusters.
 */
export class LodUnavailableError extends Error {
  readonly status = 'unavailable' as const

  constructor(message = 'Knowledge Graph hierarchy is unavailable') {
    super(message)
    this.name = 'LodUnavailableError'
  }
}

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
  /** Weighted edge count; finite fractional values are valid. */
  edge_count: z.number().nonnegative(),
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
  /** Always present on the authenticated production route; optional for legacy test/demo tiles. */
  available: z.boolean().optional(),
  status: lodStatusSchema.optional(),
  reason: z.string().optional(),
  /** Production marker; omitted only by legacy local fixtures. */
  transport: z.literal('json-hierarchy-preview').optional(),
  streaming: z.literal(false).optional(),
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
  /** Always present on the authenticated production route; optional for legacy test/demo tiles. */
  available: z.boolean().optional(),
  status: lodStatusSchema.optional(),
  reason: z.string().optional(),
  /** Production marker; omitted only by legacy local fixtures. */
  transport: z.literal('json-hierarchy-preview').optional(),
  streaming: z.literal(false).optional(),
})
export type ExpandResponse = z.infer<typeof expandResponseSchema>

/** The graph selected by the authenticated WebUI session for LOD requests. */
export const lodScopeResponseSchema = z.object({
  available: z.boolean(),
  status: lodStatusSchema,
  graph: z.string().nullable(),
  reason: z.string().optional(),
})
export type LodScopeResponse = z.infer<typeof lodScopeResponseSchema>

/**
 * Authenticated hierarchy refresh receipt. A ready receipt is the feature
 * gate for JSON clusters/expand: without an authority-scoped proof, a source
 * version, and a fresh observation, the preview stays unavailable.
 */
export const lodHierarchyRefreshResponseSchema = z.object({
  available: z.boolean(),
  status: lodStatusSchema,
  graph: z.string().nullable(),
  authority_scoped: z.boolean(),
  version: z.number().int().nonnegative().nullish(),
  freshness: z.enum(['fresh', 'stale', 'unknown']).nullish(),
  observed_at: z.string().nullish(),
  transport: z.literal('json-hierarchy-preview'),
  streaming: z.literal(false),
  reason: z.string().optional(),
})
export type LodHierarchyRefreshResponse = z.infer<typeof lodHierarchyRefreshResponseSchema>

/**
 * A page of an otherwise-single response. The JSON preview currently yields
 * one complete tile per request; this wrapper remains useful to the local
 * state machine and explicit test fixture, but it is not a VIZ-2 stream.
 *
 * `HttpLodTransport` yields exactly one tile per call (whatever the server
 * sends back); `MockLodTransport` may split synthetic data to exercise local
 * state transitions, but neither is evidence of binary/tiled production
 * support.
 */
export interface LodTile<T> {
  data: T
  tileIndex: number
  /** `true` on the last tile of this request. */
  done: boolean
}

/** Identifies the graph a request scopes to; production LOD requests require exactly one. */
export type LodGraphScope = string[]

/**
 * The one surface the UI layer depends on. `graph` is the source-graph
 * scope (mirrors `graph3d`'s `source_graphs`), `level` is 0 at the root and
 * increases with depth, `parentClusterId` narrows `clusters()` to one
 * parent's children (omitted at the root).
 */
export interface LodTransport {
  /**
   * Authenticate and refresh the hierarchy, returning freshness/version
   * evidence. The production implementation calls this before `clusters` or
   * `expand`; the explicit synthetic fixture intentionally remains offline.
   */
  refresh(graph: LodGraphScope, signal?: AbortSignal): Promise<LodHierarchyRefreshResponse>

  clusters(
    graph: LodGraphScope,
    level: number,
    parentClusterId?: string,
    signal?: AbortSignal,
  ): AsyncIterable<LodTile<ClustersResponse>>

  expand(graph: LodGraphScope, clusterId: string, signal?: AbortSignal): AsyncIterable<LodTile<ExpandResponse>>
}
