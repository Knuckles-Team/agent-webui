/**
 * @file readiness-api.ts
 * @description Typed client for the GraphOS `graphos.readiness.v1` snapshot
 * (GOC-02, `agent_utilities/knowledge_graph/readiness.py`).
 *
 * An independent audit of this program found that health/readiness can
 * report GREEN before the graph can actually answer a query — a liveness
 * probe (a socket that answers) is not proof a real query resolves. The
 * governing rule this program recorded eleven separate violations of: never
 * trust a signal about state; check state. The backend snapshot exists to
 * close exactly that gap (a real synthetic `code_context` query, not merely
 * "the engine process is up") — this module's job is to get that snapshot in
 * front of an operator WITHOUT re-deriving or softening it: no client-side
 * "probably fine" fallback, no treating a validation failure as `unavailable`
 * silently coerced into anything resembling "ready".
 *
 * Reached over the SAME canonical `/graph/analyze` action-twin route every
 * other focused analysis action uses (`gatewayPost`, `./gateway.ts`) —
 * `POST /api/graph/analyze {action:"readiness"}` — never a bespoke endpoint.
 */
import { z } from 'zod'
import { gatewayPost, type GatewayResult } from './gateway'
import { looseArray } from './api-validation'

export const READINESS_STATES = ['ready', 'degraded', 'unavailable', 'stale', 'not_configured'] as const
export type ReadinessState = (typeof READINESS_STATES)[number]

/** One readiness check result. Every check carries `state`; the remaining
 * fields vary per check kind (see readiness.py's module docstring) — this
 * stays loose (`[k: string]: unknown`) rather than modeling every check's
 * exact field union, and callers read named fields defensively. */
export interface ReadinessCheck {
  state: ReadinessState
  reason?: string | null
  detail?: Record<string, unknown> | null
  latency_ms?: number | null
  [key: string]: unknown
}

export interface ReadinessPrincipal {
  subject: string | null
  tenant: string | null
  policy_epoch: number | null
}

export interface ReadinessRefresh {
  mode: string
  cursor: string | null
  next_due_at: string | null
}

/** The seven checks `collect_readiness_snapshot()` always populates. */
export interface ReadinessChecks {
  engine: ReadinessCheck
  identity_policy: ReadinessCheck
  catalog: ReadinessCheck
  source_sync: ReadinessCheck
  synthetic_query: ReadinessCheck
  dense_index: ReadinessCheck
  sparse_index: ReadinessCheck
}

export interface ReadinessSnapshot {
  schema_version: string
  snapshot_id: string
  observed_at: string
  principal: ReadinessPrincipal
  overall: ReadinessState
  checks: ReadinessChecks
  required_failures: string[]
  degraded_reasons: string[]
  refresh: ReadinessRefresh
}

const readinessStateSchema = z.enum(READINESS_STATES)

const readinessCheckSchema = z
  .object({
    state: readinessStateSchema,
    reason: z.string().nullable().optional(),
    detail: z.record(z.string(), z.unknown()).nullable().optional(),
    latency_ms: z.number().nullable().optional(),
  })
  .loose()

const readinessSnapshotSchema: z.ZodType<ReadinessSnapshot> = z.object({
  schema_version: z.string(),
  snapshot_id: z.string(),
  observed_at: z.string(),
  principal: z.object({
    subject: z.string().nullable(),
    tenant: z.string().nullable(),
    policy_epoch: z.number().nullable(),
  }),
  overall: readinessStateSchema,
  checks: z.object({
    engine: readinessCheckSchema,
    identity_policy: readinessCheckSchema,
    catalog: readinessCheckSchema,
    source_sync: readinessCheckSchema,
    synthetic_query: readinessCheckSchema,
    dense_index: readinessCheckSchema,
    sparse_index: readinessCheckSchema,
  }) as unknown as z.ZodType<ReadinessChecks>,
  required_failures: looseArray(z.string()),
  degraded_reasons: looseArray(z.string()),
  refresh: z.object({
    mode: z.string(),
    cursor: z.string().nullable(),
    next_due_at: z.string().nullable(),
  }),
})

export interface FetchReadinessOptions {
  /** Optional override for the synthetic-query canary's probe text. */
  query?: string
  /** Optional exact `:Code` anchor for the synthetic-query canary. */
  nodeId?: string
}

/**
 * Fetch one live `graphos.readiness.v1` snapshot. Every call re-runs every
 * check server-side, including the synthetic-query canary — there is no
 * client-side cache here, matching the backend's own "never cached, never
 * re-served" contract.
 *
 * A schema violation resolves `ok:false` (via `gatewayPost`'s shared
 * validation boundary) rather than handing the caller a snapshot shaped
 * object it can misread as ready.
 */
export function fetchReadinessSnapshot(
  options: FetchReadinessOptions = {},
): Promise<GatewayResult<ReadinessSnapshot>> {
  return gatewayPost<ReadinessSnapshot>(
    '/analyze',
    { action: 'readiness', query: options.query ?? '', node_id: options.nodeId ?? '' },
    readinessSnapshotSchema,
  )
}

/** True iff the snapshot's overall rollup is `ready`. Mirrors the backend's
 * own `readiness.is_snapshot_ready` — the ONE place a caller should gate a
 * capability/action on readiness, never re-deriving the rollup client-side. */
export function isReadinessReady(snapshot: ReadinessSnapshot): boolean {
  return snapshot.overall === 'ready'
}

/** Ordered check names for a stable render order (matches the backend's own
 * check-collection order in `collect_readiness_snapshot`). */
export const READINESS_CHECK_ORDER: (keyof ReadinessChecks)[] = [
  'engine',
  'identity_policy',
  'catalog',
  'source_sync',
  'synthetic_query',
  'dense_index',
  'sparse_index',
]

export const READINESS_CHECK_LABELS: Record<keyof ReadinessChecks, string> = {
  engine: 'Engine',
  identity_policy: 'Identity / Policy',
  catalog: 'Catalog',
  source_sync: 'Source Sync',
  synthetic_query: 'Synthetic Query',
  dense_index: 'Dense Index',
  sparse_index: 'Sparse Index',
}
