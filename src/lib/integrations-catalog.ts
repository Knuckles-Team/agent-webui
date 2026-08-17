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
 * 2. `GET /api/enhanced/frontend-contributions` (GOC-24) -- the DESCRIPTOR
 *    authority. This module does NOT re-implement that schema: it consumes
 *    the canonical `fetchFrontendContributions()` client from
 *    `./frontend-contributions.ts` (GOC-24, merged same wave), which owns
 *    the full `FrontendContribution.v1` vendor contract and its own
 *    "never fabricate state" structural guarantee (a `BLOCKED`/`MISSING`
 *    record's `descriptor` is `null` at the TYPE level -- see that module's
 *    docstring). Duplicating that schema here would be exactly the
 *    "parallel lanes produce duplicate implementations" trap; this module
 *    is a thin, catalog-shaped CONSUMER of it, nothing more.
 *
 *    As verified against `main` on 2026-08-16, the REST route itself
 *    (`/api/enhanced/frontend-contributions`) does not exist on the backend
 *    yet -- `frontend-contributions.ts`'s own module docstring records the
 *    gap ("AU has no REST/MCP twin ... in this lane"). This module treats
 *    that absence as a first-class, honest catalog state
 *    (`descriptorCatalogState: 'unavailable'`), never as a reason to hide
 *    the parity list, and never by fabricating a descriptor. When GOC-24's
 *    follow-up ships the route, `fetchFrontendContributions()` simply
 *    starts succeeding -- no caller-side flag flip needed here.
 *
 * Charter rule enforced structurally: an item's `status` can be `'available'`
 * (or `'degraded'`) ONLY when `fetchFrontendContributions()` itself reports a
 * real `OK`/`DEGRADED` record for that package -- this module never widens
 * what that client already validated or rejected. Every other case -- no
 * descriptor catalog at all, no record for this package, a record whose
 * status is `BLOCKED`/`MISSING`, or the WHOLE descriptor catalog failing its
 * own schema (GOC-24's schema validates the catalog atomically, so one
 * malformed record fails every record, not just itself -- this module
 * mirrors that atomicity rather than papering over it with a laxer,
 * per-record fallback) -- resolves to `'blocked'`/`'not_configured'` with an
 * explicit `reason`, never a silently-omitted item and never an item that
 * *looks* available without backing data.
 */
import { z } from 'zod'
import { ApiError, ApiShapeError, fetchValidated, looseArray } from './api-validation'
import { fetchFrontendContributions, type FrontendContributionRecord } from './frontend-contributions'

export const INTEGRATION_STATUSES = ['available', 'degraded', 'blocked', 'not_configured'] as const
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number]

/** A catalog source's own honest state -- mirrors `EcosystemView.tsx`'s
 * `EcoStatus` naming so the two surfaces read consistently, but is defined
 * independently here (no import) to keep this module view-free. */
export type CatalogSourceState = 'ready' | 'empty' | 'unavailable' | 'error'

/** The safe-to-render subset of a GOC-24 `FrontendContribution.v1`
 * descriptor this catalog's list/detail surface actually renders. Field
 * values are copied verbatim from `frontend-contributions.ts`'s validated
 * record -- never re-derived or guessed. */
export interface IntegrationDescriptor {
  title: string
  packageVersion: string
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

/** Resource budget (lane doc: "Browser catalog page ≤100 entries"); matches
 * `frontend-contributions.ts`'s own `.max(100)` on the descriptor catalog. */
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
// Descriptor authority (GOC-24, consumed via `frontend-contributions.ts`)
// ---------------------------------------------------------------------------

interface DescriptorCatalogResult {
  state: CatalogSourceState
  reason: string | null
  recordsById: Map<string, FrontendContributionRecord>
}

async function fetchDescriptorCatalog(): Promise<DescriptorCatalogResult> {
  try {
    const catalog = await fetchFrontendContributions()
    const recordsById = new Map(catalog.packages.map((record) => [record.package_id, record]))
    return { state: catalog.packages.length > 0 ? 'ready' : 'empty', reason: null, recordsById }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // Expected today (GOC-24 gap, see module docstring) -- an honest
      // "not deployed yet", not an error.
      return {
        state: 'unavailable',
        reason: 'No WebUI integration descriptor service is deployed yet (GOC-24 pending).',
        recordsById: new Map(),
      }
    }
    if (err instanceof ApiError) {
      return {
        state: 'error',
        reason: `Descriptor catalog HTTP ${err.status}${err.body ? `: ${err.body.slice(0, 200)}` : ''}`,
        recordsById: new Map(),
      }
    }
    if (err instanceof ApiShapeError) {
      return { state: 'error', reason: err.message, recordsById: new Map() }
    }
    return { state: 'unavailable', reason: 'The descriptor catalog could not be reached.', recordsById: new Map() }
  }
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

  const record = descriptors.recordsById.get(packageId)
  if (!record) {
    return {
      packageId,
      status: 'not_configured',
      reason: 'No descriptor has been published for this package yet.',
      descriptor: null,
    }
  }

  if (record.status === 'BLOCKED' || record.status === 'MISSING') {
    return { packageId, status: 'blocked', reason: record.reason, descriptor: null }
  }

  // `record.status` is now narrowed to 'OK' | 'DEGRADED' -- `frontend-
  // contributions.ts`'s discriminated union guarantees `descriptor` is
  // non-null for both (structurally, not by convention).
  const descriptor: IntegrationDescriptor = {
    title: record.descriptor.title,
    packageVersion: record.descriptor.package_version,
    readModelIds: record.descriptor.read_models.map((m) => m.id),
    actionIds: record.descriptor.actions.map((a) => a.id),
  }
  return {
    packageId,
    status: record.status === 'DEGRADED' ? 'degraded' : 'available',
    reason: record.status === 'DEGRADED' ? record.reason : null,
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
