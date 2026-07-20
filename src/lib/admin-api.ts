/**
 * @file admin-api.ts
 * @description Typed API layer for the Admin console view.
 *
 * Mirrors the pattern of {@link file://./gateway.ts}: a thin, typed wrapper over
 * the SAME gateway/backend REST surface the rest of the webui consumes — never a
 * second fetch mechanism. Every call routes through the shared `apiGet` /
 * `apiPost` / `gatewayPost` helpers so envelope-unwrapping and the graceful
 * `unavailable` degradation (HTTP 404/501) are identical to every other view.
 *
 * The epistemic-graph engine (roadmap "Admin console UI") exposes admin surfaces
 * for tenants, shards, RBAC (EG-092/EG-303) and online backup/PITR (EG-090).
 * Some of those are reachable today over the browser-facing REST surface and
 * some are only reachable over the engine's UDS/MessagePack client — this module
 * documents, per call, which is which so panels can honestly mark themselves
 * read-only/placeholder instead of fabricating data.
 */

import { apiGet, apiPost, gatewayPost, type GatewayResult } from './gateway'

// ── Shards (REAL) ───────────────────────────────────────────────────────────
// GET /api/dashboard/daemon/shards → shard_topology_status() (CONCEPT:OS-5.28).

/** One engine shard endpoint in the topology + its live reachability/breaker. */
export interface ShardEndpoint {
  endpoint: string
  local: boolean
  reachable?: boolean
  breaker?: string
}

/** Engine shard topology as reported by `shard_topology_status()`. */
export interface ShardTopology {
  mode: 'single' | 'sharded'
  default_graph?: string
  endpoints: ShardEndpoint[]
}

/** Consolidated KG background daemon status (CONCEPT:KG-2.8). */
export interface DaemonStatus {
  role?: string
  running?: boolean
  threads?: string[] | number
  jobs?: unknown[]
  queue_depth?: number
  [k: string]: unknown
}

export function fetchShardTopology(): Promise<GatewayResult<ShardTopology>> {
  return apiGet<ShardTopology>('/dashboard/daemon/shards')
}

export function fetchDaemonStatus(): Promise<GatewayResult<DaemonStatus>> {
  return apiGet<DaemonStatus>('/dashboard/daemon/status')
}

// ── Tenants (REAL, partial) ──────────────────────────────────────────────────
// Aggregate node/edge counts: GET /api/enhanced/graph/stats.
// Indexed source tenants (source_system): GET /api/enhanced/code/instances.
// Multi-tenant/graph ENUMERATION is not exposed over REST today (the engine's
// per-tenant catalog is UDS-only), so the tenant list is derived from the
// default graph + indexed sources rather than a fabricated multi-tenant table.

/** Aggregate Knowledge-Graph statistics for a tenant/graph. */
export interface GraphStats {
  total_nodes: number
  total_relationships: number
  by_type: Record<string, number>
}

/** Indexed code source-systems (the ingested GitLab-style tenants). */
export interface CodeInstances {
  source_systems: string[]
}

export function fetchGraphStats(): Promise<GatewayResult<GraphStats>> {
  return apiGet<GraphStats>('/enhanced/graph/stats')
}

export function fetchCodeInstances(): Promise<GatewayResult<CodeInstances>> {
  return apiGet<CodeInstances>('/enhanced/code/instances')
}

// ── RBAC (PLACEHOLDER / read-only probe) ─────────────────────────────────────
// The engine RBAC admin (EG-092 roles/grants + EG-303 durable persistence) is a
// `Method::RbacAdmin` op reachable only over the epistemic_graph UDS client
// (`client.rbac.*`) — there is NO browser-facing REST route yet. We probe the
// closest existing surface (`POST /api/graph/configure` action=rbac_list); when
// the backend has not wired it the result resolves to `unavailable` and the
// panel renders a clearly-labeled read-only state instead of inventing grants.

/** A durable RBAC role (EG-092). */
export interface RbacRole {
  name: string
  description?: string
}

/** A resource/action grant bound to a role (EG-092). */
export interface RbacGrant {
  role: string
  resource?: string
  action?: string
  effect?: string
}

/** An agent identity known to the RBAC kernel. */
export interface AgentIdentity {
  id: string
  roles?: string[]
}

/** The RBAC policy snapshot the engine's `rbac.list()` returns. */
export interface RbacPolicy {
  roles: RbacRole[]
  grants: RbacGrant[]
  identities?: AgentIdentity[]
}

/**
 * Attempt to read the live RBAC policy over the gateway. Resolves to
 * `unavailable` when the RBAC REST twin is not wired (the common case today).
 */
export function fetchRbacPolicy(): Promise<GatewayResult<RbacPolicy>> {
  return gatewayPost<RbacPolicy>('/configure', { action: 'rbac_list' })
}

// ── Backup / PITR (PLACEHOLDER / read-only probe) ────────────────────────────
// Online backup + point-in-time restore is EG-090 — a `Method::Backup` engine
// op reachable over the UDS client, not (yet) over REST. We probe
// `POST /api/graph/configure` action=backup_status and degrade to a labeled
// placeholder; trigger controls stay disabled until the REST twin exists.

/** A single backup/snapshot record as the engine backup API would report it. */
export interface BackupRecord {
  id: string
  created_at?: string
  size_bytes?: number
  shard?: string
  lsn?: string
}

/** Backup subsystem status (EG-090). */
export interface BackupStatus {
  backups: BackupRecord[]
  pitr_window?: { earliest?: string; latest?: string }
  last_backup_at?: string
}

/**
 * Attempt to read backup/PITR status over the gateway. Resolves to
 * `unavailable` when the backup REST twin is not wired (the common case today).
 */
export function fetchBackupStatus(): Promise<GatewayResult<BackupStatus>> {
  return gatewayPost<BackupStatus>('/configure', { action: 'backup_status' })
}

/**
 * Attempt to trigger an online backup over the gateway. Present so the wiring is
 * one line once the REST twin lands; today it resolves `unavailable` and the UI
 * keeps the control disabled + labeled.
 */
export function triggerBackup(): Promise<GatewayResult<BackupRecord>> {
  return apiPost<BackupRecord>('/graph/configure', { action: 'backup_create' })
}
