import { z } from 'zod'
import { fetchValidated, looseArray } from '@/lib/api-validation'
import type { NodeTypeBreakdownData } from './NodeTypeBreakdown'

import type { GraphNode, GraphRelationship } from './GraphAdapter'
export type { GraphNode, GraphRelationship } from './GraphAdapter'

export interface GraphStats {
  total_nodes: number
  total_relationships: number
  // Absent (older backend) is treated as available — only an explicit `false`
  // means the engine reported itself unreachable/uninitialized. Distinct from
  // a genuinely empty graph: see GraphLoadStatus's 'unavailable' kind below.
  available?: boolean
  // Union-read provenance. The backend has always returned these; this schema
  // used to strip them, so a read that silently skipped a whole graph rendered
  // byte-identically to a complete one. Kept and surfaced (see the `partial`
  // banner in the render) — that is the defect class this program has now hit
  // four separate times.
  source_graphs?: string[]
  degraded_graphs?: string[]
  partial?: boolean
}

// D-WUI-6 (hostile-payload update, additive to the pre-existing
// usePageContextPublisher/PageContextProvider defect this item already
// tracks) — GraphView crashed on `null`/`{}`/error-body responses because
// none of the three fetches checked `res.ok` or validated the shape before
// casting. Validating each independently (rather than one schema over
// `Promise.all`'s tuple) means one bad endpoint doesn't wipe out data that
// loaded fine from the other two.
const graphNodeSchema: z.ZodType<GraphNode> = z.object({
  id: z.string(),
  labels: looseArray(z.string()),
  properties: z.record(z.string(), z.unknown()),
})
const graphRelationshipSchema: z.ZodType<GraphRelationship> = z.object({
  source: z.string(),
  type: z.string(),
  target: z.string(),
})
const graphStatsSchema: z.ZodType<GraphStats> = z.object({
  total_nodes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  total_relationships: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  // Not stripped: `available: false` is how the backend distinguishes "the
  // engine is unreachable/uninitialized" from a real, connected, empty graph
  // (both otherwise render as total_nodes: 0). Dropping this field here was
  // the actual bug — the API always returned it honestly, but the schema
  // discarded it before the component ever saw it. `partial`/`degraded_graphs`
  // were being dropped the same way, for the same reason, with the same
  // consequence: a degraded read rendered as an authoritative one.
  available: z.boolean().optional(),
  source_graphs: looseArray(z.string()).optional(),
  degraded_graphs: looseArray(z.string()).optional(),
  partial: z.boolean().optional(),
})

// `/graph/node-types` — the real engine-side `GROUP BY`. Loaded independently
// of `/graph/stats` because it is 10-80x more expensive (measured 5.5s-22.4s
// vs ~0.1-1.6s on the same graph); coupling them meant the fast, trustworthy
// totals waited on the slow aggregate, or the aggregate was cut to fit.
const nodeTypeBreakdownSchema: z.ZodType<NodeTypeBreakdownData> = z.object({
  by_type: z.record(z.string(), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
  type_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  total_typed_nodes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  truncated: z.boolean(),
  available: z.boolean(),
  source_graphs: looseArray(z.string()),
  degraded_graphs: looseArray(z.string()),
  partial: z.boolean(),
})

/** Existing same-origin read facades; provider authorization remains authoritative. */
export const readGraphStats = (signal?: AbortSignal) =>
  fetchValidated('/api/enhanced/graph/stats', graphStatsSchema, { signal })
export const readGraphNodes = (type: string | null, signal?: AbortSignal) =>
  fetchValidated(
    type === null ? '/api/enhanced/graph/nodes' : `/api/enhanced/graph/nodes?node_type=${encodeURIComponent(type)}`,
    looseArray(graphNodeSchema),
    { signal },
  )
export const readGraphRelationships = (signal?: AbortSignal) =>
  fetchValidated('/api/enhanced/graph/relationships', looseArray(graphRelationshipSchema), { signal })
export const readGraphNodeTypes = (signal?: AbortSignal) =>
  fetchValidated('/api/enhanced/graph/node-types', nodeTypeBreakdownSchema, { signal })
