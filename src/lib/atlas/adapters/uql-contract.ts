/**
 * @file adapters/uql-contract.ts
 * @description Runtime contracts and lossless decoding for the canonical UQL route.
 *
 * Graph-OS returns UQL through the same `/api/graph/query` action twin used by
 * the other query dialects. Depending on the engine build, the result can expose
 * raw rows beside an EvidenceBundle, or only expose those rows in a reasoning
 * trace. The decoder keeps both forms explicit and never manufactures graph
 * relationships from an evidence claim.
 */
import { z } from 'zod'

import type { Row } from '../types'

const RECORD_SCHEMA = z.record(z.string(), z.unknown())
export const UQL_ROWS_SCHEMA = z.array(RECORD_SCHEMA)
/** Per-connection rows returned by a governed graph-query fan-out. */
export const UQL_TARGETS_SCHEMA = z.record(z.string(), UQL_ROWS_SCHEMA)

const EVIDENCE_FIELDS = new Set([
  'answer_candidate',
  'claims',
  'evidence_spans',
  'source_authority',
  'contradictions',
  'confidence',
  'freshness',
  'policy_exclusions',
  'reasoning_trace',
  'next_actions',
  'error',
])
const EVIDENCE_SIGNAL_FIELDS = new Set([...EVIDENCE_FIELDS].filter((key) => key !== 'error'))

/** The complete EvidenceBundle wire shape, with future fields retained by Zod. */
export const UQL_EVIDENCE_BUNDLE_SCHEMA = z
  .object({
    answer_candidate: z.string().optional(),
    claims: UQL_ROWS_SCHEMA.optional(),
    evidence_spans: z.array(RECORD_SCHEMA).optional(),
    source_authority: RECORD_SCHEMA.optional(),
    contradictions: z.array(RECORD_SCHEMA).optional(),
    confidence: z.number().nullable().optional(),
    freshness: RECORD_SCHEMA.optional(),
    policy_exclusions: z.array(z.string()).optional(),
    reasoning_trace: z.array(RECORD_SCHEMA).optional(),
    next_actions: z.array(z.string()).optional(),
    error: RECORD_SCHEMA.nullable().optional(),
  })
  .loose()
  .refine(
    (value) =>
      Object.keys(value).some((key) => EVIDENCE_SIGNAL_FIELDS.has(key)) ||
      (value.error !== null && value.error !== undefined),
    {
      message: 'UQL response is not an EvidenceBundle or query result.',
    },
  )

const UQL_PROVENANCE_SCHEMA = z
  .object({
    source_graphs: z.array(z.string()).optional(),
    degraded_graphs: z.array(z.string()).optional(),
    graph: z.string().nullable().optional(),
    connection: z.string().nullable().optional(),
    citations: z.array(z.unknown()).optional(),
    truncated: z.boolean().optional(),
    has_more: z.boolean().optional(),
  })
  .strip()

export const UQL_NODE_TYPE_RESPONSE_SCHEMA = z
  .object({
    by_type: z.record(z.string(), z.number()).optional(),
    available: z.boolean().optional(),
    degraded_graphs: z.array(z.string()).optional(),
    partial: z.boolean().optional(),
    source_graphs: z.array(z.string()).optional(),
    truncated: z.boolean().optional(),
  })
  .loose()

export type UqlNodeTypeResponse = z.infer<typeof UQL_NODE_TYPE_RESPONSE_SCHEMA>

const UQL_ROWS_RESPONSE_SCHEMA = z
  .object({
    rows: UQL_ROWS_SCHEMA,
    results: UQL_ROWS_SCHEMA.optional(),
    evidence_bundle: UQL_EVIDENCE_BUNDLE_SCHEMA.nullable().optional(),
    plan: RECORD_SCHEMA.optional(),
    provenance: UQL_PROVENANCE_SCHEMA.optional(),
    source_graphs: z.array(z.string()).optional(),
    degraded_graphs: z.array(z.string()).optional(),
    graph: z.string().nullable().optional(),
    connection: z.string().nullable().optional(),
    truncated: z.boolean().optional(),
    has_more: z.boolean().optional(),
    error: z.unknown().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
  })
  .loose()

const UQL_RESULTS_RESPONSE_SCHEMA = z
  .object({
    results: UQL_ROWS_SCHEMA,
    evidence_bundle: UQL_EVIDENCE_BUNDLE_SCHEMA.nullable().optional(),
    plan: RECORD_SCHEMA.optional(),
    provenance: UQL_PROVENANCE_SCHEMA.optional(),
    source_graphs: z.array(z.string()).optional(),
    degraded_graphs: z.array(z.string()).optional(),
    graph: z.string().nullable().optional(),
    connection: z.string().nullable().optional(),
    truncated: z.boolean().optional(),
    has_more: z.boolean().optional(),
    error: z.unknown().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
  })
  .loose()

const UQL_ERROR_RESPONSE_SCHEMA = z
  .object({
    error: z.unknown(),
    message: z.string().optional(),
    status: z.string().optional(),
  })
  .loose()

const UQL_STATUS_RESPONSE_SCHEMA = z
  .object({
    status: z.string(),
    message: z.string().optional(),
    error: z.unknown().optional(),
  })
  .loose()
  .refine((value) => ['error', 'failed', 'degraded'].includes(value.status.toLowerCase()), {
    message: 'UQL status responses must name a failed or degraded operation.',
  })

const UQL_BUNDLE_RESPONSE_SCHEMA = z
  .object({
    evidence_bundle: UQL_EVIDENCE_BUNDLE_SCHEMA,
    plan: RECORD_SCHEMA.optional(),
    provenance: UQL_PROVENANCE_SCHEMA.optional(),
    source_graphs: z.array(z.string()).optional(),
    degraded_graphs: z.array(z.string()).optional(),
    graph: z.string().nullable().optional(),
    connection: z.string().nullable().optional(),
    truncated: z.boolean().optional(),
    has_more: z.boolean().optional(),
  })
  .loose()

const UQL_TARGETS_RESPONSE_SCHEMA = z
  .object({
    targets: UQL_TARGETS_SCHEMA,
    errors: z.record(z.string(), z.unknown()).optional(),
    evidence_bundle: UQL_EVIDENCE_BUNDLE_SCHEMA.nullable().optional(),
    plan: RECORD_SCHEMA.optional(),
    provenance: UQL_PROVENANCE_SCHEMA.optional(),
    source_graphs: z.array(z.string()).optional(),
    degraded_graphs: z.array(z.string()).optional(),
    graph: z.string().nullable().optional(),
    connection: z.string().nullable().optional(),
    truncated: z.boolean().optional(),
    has_more: z.boolean().optional(),
    error: z.unknown().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
  })
  .loose()

/** Accepted post-envelope forms of `/api/graph/query` for scope `uql`. */
export const UQL_RESPONSE_SCHEMA = z.union([
  UQL_ROWS_SCHEMA,
  UQL_ROWS_RESPONSE_SCHEMA,
  UQL_RESULTS_RESPONSE_SCHEMA,
  UQL_ERROR_RESPONSE_SCHEMA,
  UQL_STATUS_RESPONSE_SCHEMA,
  UQL_BUNDLE_RESPONSE_SCHEMA,
  UQL_TARGETS_RESPONSE_SCHEMA,
  UQL_EVIDENCE_BUNDLE_SCHEMA,
])

export type UqlEvidenceBundle = z.infer<typeof UQL_EVIDENCE_BUNDLE_SCHEMA>
export type UqlWireResponse = z.infer<typeof UQL_RESPONSE_SCHEMA>
export type UqlQueryPlan = Record<string, unknown>

const SAFE_REFERENCE = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/
const SAFE_PLAN_FIELDS = new Set([
  'grammar_version',
  'bounded',
  'stage',
  'stages',
  'limit',
  'language',
  'operator',
  'operators',
  'kind',
  'node_type',
  'field',
  'direction',
  'rank',
  'source',
  'sources',
  'query_hash',
  'estimated_rows',
  'estimated_cost',
  'cost',
  'rows',
  'steps',
  'children',
  'input',
  'inputs',
  'output',
  'op',
  'operation',
  'type',
  'name',
  'index',
  'count',
  'offset',
  'window',
  'as_of',
  'mode',
  'strategy',
  'connection',
  'graph',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safePlanValue(value: unknown): unknown {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return SAFE_REFERENCE.test(value) ? value : undefined
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const safe = safePlanValue(item)
      return safe === undefined ? [] : [safe]
    })
  }
  if (!isRecord(value)) return undefined
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]): [string, unknown][] => {
      if (!SAFE_PLAN_FIELDS.has(key)) return []
      const safe = safePlanValue(item)
      return safe === undefined ? [] : [[key, safe]]
    }),
  )
}

/** Keep plan shape useful to Atlas while excluding arbitrary credential fields. */
export function sanitizeUqlPlan(value: unknown): UqlQueryPlan | null {
  const safe = safePlanValue(value)
  return isRecord(safe) && Object.keys(safe).length > 0 ? safe : null
}

export interface UqlQuery {
  text: string
  graph: string | null
  limit: number
}

export interface UqlProvenance {
  sourceGraphs: string[]
  degradedGraphs: string[]
  graph: string | null
  connection: string | null
  citations: unknown[]
}

export type UqlRowSource = 'rows' | 'results' | 'targets' | 'trace' | 'claims' | 'none'

export interface UqlResponseMetadata {
  evidenceBundle: UqlEvidenceBundle | null
  plan: UqlQueryPlan | null
  provenance: UqlProvenance
  rowSource: UqlRowSource
  truncated: boolean
}

export interface UqlPayload {
  rows: Row[]
  metadata: UqlResponseMetadata
}
