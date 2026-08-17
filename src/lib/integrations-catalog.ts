/**
 * @file integrations-catalog.ts
 * @description GOC-25: typed, testable catalog of every live MCP server /
 * agent package agent-webui discovers -- the shared client the dynamic
 * `/integrations` page (`IntegrationsView.tsx`) is built on.
 *
 * This generalizes BUG-018's fix (`EcosystemView.tsx`'s "Other Integrations"
 * tab, GOC-25's own prior increment): that fix proved a live, unknown
 * package is never silently dropped, but it did so ad hoc, inline in one
 * view, with no reusable client, no descriptor join, and no tests
 * independent of that view's giant fixture. This module is the reusable,
 * independently-tested successor.
 *
 * Two authorities are composed. NEITHER is trusted beyond what it actually
 * returns, and the composition never fabricates a value neither authority
 * reported:
 *
 * 1. `GET /api/enhanced/ecosystem/services` (`list_ecosystem_services`,
 *    `agent/agent_webui/api_extensions.py`) -- the live PARITY authority: a
 *    raw `list[str]` of every agent-package directory the backend actually
 *    discovered. Same endpoint/shape BUG-018 already validates in
 *    `EcosystemView.tsx`; this module re-validates it independently rather
 *    than importing view-local state, so it has no dependency on that view.
 *    This is the ONLY source of "what packages exist" -- a package this
 *    endpoint does not report is never listed, and every package it DOES
 *    report gets an item, full stop.
 * 2. `GET /api/enhanced/frontend-contributions` (GOC-24,
 *    `agent_utilities.core.frontend_providers.discover_frontend_contributions`)
 *    -- the DESCRIPTOR authority for a package's WebUI integration (title,
 *    version, read models, actions). As verified against `main` on
 *    2026-08-16, this route does not exist on the backend yet -- GOC-24's
 *    own consumer client (`frontend-contributions.ts`) is uncommitted work
 *    in a sibling worktree and its module docstring records the same gap
 *    ("this REST route does not exist on the backend yet"). This module
 *    treats that absence as a first-class, honest catalog state
 *    (`descriptorCatalogState: 'unavailable'`), never as a reason to hide
 *    the parity list, and never by fabricating a descriptor. When GOC-24
 *    ships the route this module's fetch simply starts succeeding -- no
 *    caller-side flag flip needed.
 *
 * Charter rule enforced structurally: an item's `status` can be `'available'`
 * (or `'degraded'`) ONLY when a real, per-record schema-valid `OK`/`DEGRADED`
 * descriptor backs it. Every other case -- no descriptor catalog at all, no
 * record for this package, a record whose status is `BLOCKED`/`MISSING`, or
 * a record that fails THIS module's own schema check (a required field
 * missing or wrong-typed) -- resolves to `'blocked'`/`'not_configured'` with
 * an explicit `reason`, never a silently-omitted item and never an item that
 * *looks* available without backing data. A malformed record for package A
 * never blocks package B's descriptor (records are validated one at a time),
 * matching this module's "never let one bad actor hide the rest" precedent
 * (`EcosystemView.tsx`'s `classifyEcosystemList`).
 */
import { z } from 'zod'
import { ApiError, ApiShapeError, fetchValidated, looseArray } from './api-validation'

export const INTEGRATION_STATUSES = ['available', 'degraded', 'blocked', 'not_configured'] as const
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number]

/** A catalog source's own honest state -- mirrors `EcosystemView.tsx`'s
 * `EcoStatus` naming so the two surfaces read consistently, but is defined
 * independently here (no import) to keep this module view-free. */
export type CatalogSourceState = 'ready' | 'empty' | 'unavailable' | 'error'

/** The minimal, safe-to-render subset of a GOC-24 `FrontendContribution.v1`
 * descriptor this module extracts. Deliberately NOT a full mirror of that
 * schema (GOC-24 owns the full vendor contract) -- only fields this
 * catalog's list/detail surface actually renders. */
export interface IntegrationDescriptor {
  title: string
  packageVersion: string | null
  readModelIds: string[]
  actionIds: string[]
}

export interface IntegrationCatalogItem {
  packageId: string
  status: IntegrationStatus
  /** Human-readable reason. Required (non-null) for every status except
   * `'available'`, where it is always `null` -- there is nothing to explain
   * about a package that resolved cleanly. */
  reason: string | null
  descriptor: IntegrationDescriptor | null
}

export interface IntegrationsCatalog {
  items: IntegrationCatalogItem[]
  liveCatalogState: CatalogSourceState
  liveCatalogReason: string | null
  descriptorCatalogState: CatalogSourceState
  descriptorCatalogReason: string | null
  /** Client-side ISO timestamp of when THIS composition ran -- never a
   * backend-claimed value, and never presented as a backend `observed_at`. */
  observedAt: string
}

/** Resource budget (lane doc: "Browser catalog page ≤100 entries"). */
export const MAX_CATALOG_ITEMS = 100

// ---------------------------------------------------------------------------
// Live parity authority
// ---------------------------------------------------------------------------

const liveCatalogSchema = looseArray(z.string().min(1).max(256))

interface LiveCatalogResult {
  state: CatalogSourceState
  reason: string | null
  ids: string[]
}

async function fetchLiveServiceCatalog(): Promise<LiveCatalogResult> {
  try {
    const ids = await fetchValidated('/api/enhanced/ecosystem/services', liveCatalogSchema)
    return { state: ids.length > 0 ? 'ready' : 'empty', reason: null, ids }
  } catch (err) {
    if (err instanceof ApiShapeError) {
      return { state: 'error', reason: err.message, ids: [] }
    }
    if (err instanceof ApiError) {
      return {
        state: 'error',
        reason: `Live catalog HTTP ${err.status}${err.body ? `: ${err.body.slice(0, 200)}` : ''}`,
        ids: [],
      }
    }
    return { state: 'unavailable', reason: 'The live integration catalog could not be reached.', ids: [] }
  }
}

// ---------------------------------------------------------------------------
// Descriptor authority (GOC-24) -- best-effort, gap is expected today
// ---------------------------------------------------------------------------

const DESCRIPTOR_STATUSES = ['OK', 'DEGRADED', 'BLOCKED', 'MISSING'] as const

/** Loose top-level envelope: only enough shape to iterate `packages` as
 * unknown records -- each record is validated on its own below so one bad
 * record can never invalidate the whole response. */
const rawDescriptorCatalogSchema = z.object({
  packages: looseArray(z.record(z.string(), z.unknown())),
})

const descriptorRecordSchema = z.object({
  package_id: z.string().min(1).max(256),
  status: z.enum(DESCRIPTOR_STATUSES),
  reason: z.string().nullable().optional(),
  descriptor: z
    .object({
      title: z.string().min(1).max(256),
      package_version: z.string().min(1).max(128).nullable().optional(),
      read_models: z.array(z.object({ id: z.string().min(1).max(128) })).optional(),
      actions: z.array(z.object({ id: z.string().min(1).max(128) })).optional(),
    })
    .nullable()
    .optional(),
})
type DescriptorRecord = z.infer<typeof descriptorRecordSchema>

type DescriptorEntry = { valid: true; record: DescriptorRecord } | { valid: false; reason: string }

interface DescriptorCatalogResult {
  state: CatalogSourceState
  reason: string | null
  recordsById: Map<string, DescriptorEntry>
}

async function fetchDescriptorCatalog(): Promise<DescriptorCatalogResult> {
  let res: Response
  try {
    res = await fetch('/api/enhanced/frontend-contributions', { credentials: 'same-origin' })
  } catch {
    return { state: 'unavailable', reason: 'The descriptor catalog could not be reached.', recordsById: new Map() }
  }

  if (!res.ok) {
    if (res.status === 404) {
      // Expected today (GOC-24 gap, see module docstring) -- an honest
      // "not deployed yet", not an error.
      return {
        state: 'unavailable',
        reason: 'No WebUI integration descriptor service is deployed yet (GOC-24 pending).',
        recordsById: new Map(),
      }
    }
    const body = await res.text().catch(() => '')
    return {
      state: 'error',
      reason: `Descriptor catalog HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      recordsById: new Map(),
    }
  }

  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    return { state: 'error', reason: 'Descriptor catalog response was not valid JSON.', recordsById: new Map() }
  }

  const parsedTop = rawDescriptorCatalogSchema.safeParse(raw)
  if (!parsedTop.success) {
    return {
      state: 'error',
      reason: 'Descriptor catalog response did not match the expected envelope (missing/invalid `packages`).',
      recordsById: new Map(),
    }
  }

  const recordsById = new Map<string, DescriptorEntry>()
  for (const rawRecord of parsedTop.data.packages) {
    const idResult = z.string().min(1).max(256).safeParse(rawRecord.package_id)
    if (!idResult.success) continue // cannot attribute to any package; safe to skip (not the parity source)
    const parsed = descriptorRecordSchema.safeParse(rawRecord)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>'
      recordsById.set(idResult.data, {
        valid: false,
        reason: `Descriptor record failed validation at '${path}': ${issue.message}.`,
      })
      continue
    }
    recordsById.set(idResult.data, { valid: true, record: parsed.data })
  }

  return { state: parsedTop.data.packages.length > 0 ? 'ready' : 'empty', reason: null, recordsById }
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

function composeItem(packageId: string, descriptors: DescriptorCatalogResult): IntegrationCatalogItem {
  if (descriptors.state !== 'ready' && descriptors.state !== 'empty') {
    return {
      packageId,
      status: 'not_configured',
      reason: descriptors.reason ?? 'No WebUI integration descriptor service is available yet.',
      descriptor: null,
    }
  }

  const entry = descriptors.recordsById.get(packageId)
  if (!entry) {
    return {
      packageId,
      status: 'not_configured',
      reason: 'No descriptor has been published for this package yet.',
      descriptor: null,
    }
  }
  if (!entry.valid) {
    return { packageId, status: 'blocked', reason: entry.reason, descriptor: null }
  }

  const record = entry.record
  if (record.status === 'BLOCKED' || record.status === 'MISSING') {
    return {
      packageId,
      status: 'blocked',
      reason: record.reason ?? 'The backend blocked this package.',
      descriptor: null,
    }
  }
  if (!record.descriptor) {
    return {
      packageId,
      status: 'blocked',
      reason: `Descriptor record reported '${record.status}' but carried no descriptor payload.`,
      descriptor: null,
    }
  }

  const descriptor: IntegrationDescriptor = {
    title: record.descriptor.title,
    packageVersion: record.descriptor.package_version ?? null,
    readModelIds: (record.descriptor.read_models ?? []).map((m) => m.id),
    actionIds: (record.descriptor.actions ?? []).map((a) => a.id),
  }
  return {
    packageId,
    status: record.status === 'DEGRADED' ? 'degraded' : 'available',
    reason: record.status === 'DEGRADED' ? (record.reason ?? 'This integration is degraded.') : null,
    descriptor,
  }
}

/**
 * Fetch and compose the live `/integrations` catalog. Always resolves (never
 * throws) -- a fetch/shape failure on either authority is reported as an
 * explicit `*CatalogState`, and the live-catalog failure additionally yields
 * an empty `items` list (there is no parity authority left to enumerate
 * against), rather than a caller ever seeing a plausible-looking partial
 * result mis-attributed to success.
 */
export async function fetchIntegrationsCatalog(): Promise<IntegrationsCatalog> {
  const [live, descriptors] = await Promise.all([fetchLiveServiceCatalog(), fetchDescriptorCatalog()])

  const items =
    live.state === 'ready' || live.state === 'empty'
      ? live.ids
          .slice()
          .sort((a, b) => a.localeCompare(b))
          .slice(0, MAX_CATALOG_ITEMS)
          .map((packageId) => composeItem(packageId, descriptors))
      : []

  return {
    items,
    liveCatalogState: live.state,
    liveCatalogReason: live.reason,
    descriptorCatalogState: descriptors.state,
    descriptorCatalogReason: descriptors.reason,
    observedAt: new Date().toISOString(),
  }
}
