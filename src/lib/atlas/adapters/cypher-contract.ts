/**
 * @file adapters/cypher-contract.ts
 * @description Cypher query/result contracts and governed response decoding.
 *
 * The graph route has two wire shapes in production: a direct row envelope and an
 * EvidenceBundle whose final reasoning-trace payload contains the raw rows. Keeping
 * the schema and normalization here makes the adapter's transport seam explicit and
 * prevents each caller from inventing its own interpretation of partial results.
 */
import { z } from 'zod'

import type { FilterValue, Row } from '../types'

export interface CypherQuery {
  text: string
  params: Record<string, FilterValue>
  graph: string | null
  /** The single server-enforced terminal LIMIT, or null before validation. */
  limit: number | null
}

export interface CypherResponseMetadata {
  /** The post-transport response body. `atlasPost` unwraps `{status, result}` once. */
  raw: unknown
  claims: unknown[] | null
  reasoningTrace: unknown[] | null
  sourceGraphs: string[]
  degradedGraphs: string[]
  /** Explicit backend signals only; row-count equality is not evidence of truncation. */
  truncated: boolean | null
  hasMore: boolean | null
  nextCursor: string | null
}

export interface CypherPayload {
  rows: Row[]
  connection: string | null
  graph: string | null
  errors: Record<string, unknown> | null
  /** Raw response metadata is kept beside normalized rows for the Raw renderer. */
  metadata?: CypherResponseMetadata
}

const ROW_SCHEMA = z.record(z.string(), z.unknown())
const TRACE_ENTRY_SCHEMA = z
  .object({
    payload: z
      .object({
        rows: z.array(ROW_SCHEMA).optional(),
      })
      .loose()
      .optional(),
  })
  .loose()

const RESPONSE_METADATA_SHAPE = {
  connection: z.string().nullable().optional(),
  graph: z.string().nullable().optional(),
  errors: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.unknown().optional(),
  status: z.string().optional(),
  claims: z.array(z.unknown()).optional(),
  reasoning_trace: z.array(TRACE_ENTRY_SCHEMA).optional(),
  source_graphs: z.array(z.string()).optional(),
  degraded_graphs: z.array(z.string()).optional(),
  truncated: z.boolean().optional(),
  has_more: z.boolean().optional(),
  next_cursor: z.string().nullable().optional(),
  partial: z.boolean().optional(),
}

export const CYPHER_RESPONSE_SCHEMA = z.union([
  z.array(ROW_SCHEMA),
  z
    .object({
      rows: z.array(ROW_SCHEMA),
      ...RESPONSE_METADATA_SHAPE,
    })
    .loose(),
  z
    .object({
      ...RESPONSE_METADATA_SHAPE,
      reasoning_trace: z.array(TRACE_ENTRY_SCHEMA),
    })
    .loose(),
  z
    .object({
      status: z.string(),
      message: z.string().optional(),
      error: z.unknown().optional(),
    })
    .loose(),
  z.object({ error: z.unknown() }).loose(),
])

export const NODE_TYPE_RESPONSE_SCHEMA = z
  .object({
    by_type: z.record(z.string(), z.number()).optional(),
    available: z.boolean().optional(),
    degraded_graphs: z.array(z.string()).optional(),
    partial: z.boolean().optional(),
    source_graphs: z.array(z.string()).optional(),
    truncated: z.boolean().optional(),
  })
  .loose()

export type CypherResponse = z.infer<typeof CYPHER_RESPONSE_SCHEMA>
export type NodeTypeResponse = z.infer<typeof NODE_TYPE_RESPONSE_SCHEMA>

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => nonEmptyString(item) !== null)
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function explicitBoolean(...values: unknown[]): boolean | null {
  const value = values.find((candidate) => typeof candidate === 'boolean')
  return typeof value === 'boolean' ? value : null
}

function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return record(value[key]) ? value[key] : null
}

function sourceGraphsFrom(value: Record<string, unknown>): string[] {
  const provenance = nestedRecord(value, 'provenance') ?? {}
  return [...stringList(value.source_graphs), ...stringList(provenance.source_graphs)]
}

function degradedGraphsFrom(value: Record<string, unknown>): string[] {
  const provenance = nestedRecord(value, 'provenance') ?? {}
  return [...stringList(value.degraded_graphs), ...stringList(provenance.degraded_graphs)]
}

function responseMetadata(raw: unknown, detail: Record<string, unknown> | null = null): CypherResponseMetadata {
  const root = record(raw) ? raw : {}
  const details = detail ?? {}
  const graph = nonEmptyString(details.graph) ?? nonEmptyString(root.graph)
  return {
    raw,
    claims: Array.isArray(root.claims) ? root.claims : null,
    reasoningTrace: Array.isArray(root.reasoning_trace) ? root.reasoning_trace : null,
    sourceGraphs: uniqueStrings([
      ...sourceGraphsFrom(root),
      ...sourceGraphsFrom(details),
      ...(graph === null ? [] : [graph]),
    ]),
    degradedGraphs: uniqueStrings([...degradedGraphsFrom(root), ...degradedGraphsFrom(details)]),
    truncated: explicitBoolean(details.truncated, root.truncated),
    hasMore: explicitBoolean(details.has_more, root.has_more),
    nextCursor: nonEmptyString(details.next_cursor) ?? nonEmptyString(root.next_cursor),
  }
}

function payloadFromRows(
  rows: Row[],
  raw: unknown,
  detail: Record<string, unknown> | null = record(raw) ? raw : null,
): CypherPayload {
  const root = record(raw) ? raw : {}
  const detailErrors = detail?.errors
  const rootErrors = root.errors
  return {
    rows,
    connection: nonEmptyString(detail?.connection) ?? nonEmptyString(root.connection),
    graph: nonEmptyString(detail?.graph) ?? nonEmptyString(root.graph),
    errors: record(detailErrors) ? detailErrors : record(rootErrors) ? rootErrors : null,
    metadata: responseMetadata(raw, detail),
  }
}

export function responseError(value: unknown): string | null {
  if (!record(value)) return null
  if (value.status === 'error') {
    return typeof value.message === 'string' ? value.message : 'Cypher query failed.'
  }
  if (typeof value.error === 'string') return value.error
  if (value.error === null || value.error === undefined) return null
  if (!record(value.error)) return 'Cypher query failed.'
  if (typeof value.error.message === 'string') return value.error.message
  return typeof value.error.code === 'string' ? `Cypher query failed (${value.error.code}).` : 'Cypher query failed.'
}

function payloadFromTrace(value: Record<string, unknown>): CypherPayload | null {
  if (!Array.isArray(value.reasoning_trace)) return null
  const trace = value.reasoning_trace as unknown[]
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const entry = trace[index]
    if (!record(entry) || !record(entry.payload) || !Array.isArray(entry.payload.rows)) continue
    if (!entry.payload.rows.every(record)) continue
    return payloadFromRows(entry.payload.rows, value, entry.payload)
  }
  return null
}

export function parsePayload(value: unknown): { payload: CypherPayload | null; error: string | null } {
  if (Array.isArray(value)) {
    return value.every(record)
      ? { payload: payloadFromRows(value, value), error: null }
      : { payload: null, error: 'Cypher route returned a non-row result.' }
  }
  if (!record(value)) return { payload: null, error: 'Cypher route returned an invalid result shape.' }
  if (Array.isArray(value.rows)) {
    return value.rows.every(record)
      ? { payload: payloadFromRows(value.rows, value), error: null }
      : { payload: null, error: 'Cypher route returned a non-row result.' }
  }
  const traced = payloadFromTrace(value)
  return traced
    ? { payload: traced, error: null }
    : { payload: null, error: 'Cypher response did not expose its raw query rows.' }
}

export function partialReason(payload: CypherPayload): string | null {
  const failedTargets = payload.errors ? Object.keys(payload.errors) : []
  const degradedGraphs = payload.metadata?.degradedGraphs ?? []
  if (failedTargets.length > 0) return `Some graph query targets failed: ${failedTargets.join(', ')}`
  if (degradedGraphs.length > 0) return `Skipped graphs: ${degradedGraphs.join(', ')}`
  const raw = payload.metadata?.raw
  return record(raw) && raw.partial === true ? 'The graph query returned a partial result.' : null
}
