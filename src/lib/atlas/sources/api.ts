/**
 * Atlas source control-plane client.
 *
 * These functions are thin, validated adapters over the Atlas HTTP transport.
 * They never send endpoint, DSN, password, token, or connector configuration
 * from the browser.  A source is connected by a server-resolved profile
 * reference, and a sync can only be started from a reviewed preview id.
 */
import type { AtlasFetchResult } from '@/lib/atlas/transport'
import { atlasGet, atlasPost } from '@/lib/atlas/transport'
import { ApiShapeError, validateShape } from '@/lib/api-validation'
import type { z } from 'zod'

import {
  cancelSyncRunRequestSchema,
  cancelSyncRunResponseSchema,
  connectSourceRequestSchema,
  connectSourceResponseSchema,
  sourceCatalogSchema,
  sourceConnectionStatusSchema,
  sourceIdSchema,
  safeSourceDisplayText,
  startSyncRequestSchema,
  startSyncResponseSchema,
  syncPreviewRequestSchema,
  syncPreviewSchema,
  syncRunAggregateSchema,
  type CancelSyncRunRequest,
  type CancelSyncRunResponse,
  type ConnectSourceRequest,
  type ConnectSourceResponse,
  type SourceCatalog,
  type SourceConnectionStatus,
  type StartSyncRequest,
  type StartSyncResponse,
  type SyncPreview,
  type SyncPreviewRequest,
  type SyncRunAggregate,
} from './contracts'

/** The backend route seam for Atlas source discovery and sync control. */
export interface AtlasSourceRoutes {
  catalog: string
  connect: (sourceId: string) => string
  connection: (sourceId: string) => string
  syncPreview: string
  syncRuns: string
  startSync: string
  cancelSync: (runId: string) => string
}

/**
 * Default routes are intentionally isolated in one object.  A deployment that
 * mounts the same control plane under `/api/graph` can provide a route object
 * to the API functions/hooks without forking source UI contracts.
 */
export const DEFAULT_ATLAS_SOURCE_ROUTES: AtlasSourceRoutes = {
  catalog: '/api/enhanced/atlas/sources',
  connect: (sourceId) => `/api/enhanced/atlas/sources/${encodeURIComponent(sourceId)}/connection`,
  connection: (sourceId) => `/api/enhanced/atlas/sources/${encodeURIComponent(sourceId)}/connection`,
  syncPreview: '/api/enhanced/atlas/sync/preview',
  syncRuns: '/api/enhanced/atlas/sync/runs',
  startSync: '/api/enhanced/atlas/sync/runs',
  cancelSync: (runId) => `/api/enhanced/atlas/sync/runs/${encodeURIComponent(runId)}/cancel`,
}

export interface SourceApiContext {
  signal: AbortSignal
  routes?: AtlasSourceRoutes
}

export interface SourceApiPayload<T> extends SourceApiContext {
  payload: T
}

function routesOrDefault(routes: AtlasSourceRoutes | undefined): AtlasSourceRoutes {
  return routes ?? DEFAULT_ATLAS_SOURCE_ROUTES
}

function sanitizeTransportResult<T>(result: AtlasFetchResult<T>): AtlasFetchResult<T> {
  if (result.ok) return result
  return {
    ...result,
    error: result.unavailable ? 'Atlas source capability is unavailable.' : 'Atlas source request failed.',
  }
}

function safeGet<T>(path: string, signal: AbortSignal, schema: z.ZodType<T>): Promise<AtlasFetchResult<T>> {
  return atlasGet(path, signal, schema).then(sanitizeTransportResult)
}

function safePost<T>(
  path: string,
  payload: unknown,
  signal: AbortSignal,
  schema: z.ZodType<T>,
): Promise<AtlasFetchResult<T>> {
  return atlasPost(path, payload, signal, schema).then(sanitizeTransportResult)
}

function validateRequest<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  payload: unknown,
): { valid: true; data: T } | { valid: false; result: AtlasFetchResult<never> } {
  const parsed = schema.safeParse(payload)
  if (parsed.success) return { valid: true, data: parsed.data }
  const firstIssue = parsed.error.issues.at(0)
  const detail = firstIssue
    ? `${firstIssue.path.length > 0 ? firstIssue.path.join('.') : '<root>'}: ${firstIssue.message}`
    : 'request did not match the expected shape'
  return {
    valid: false,
    result: {
      ok: false,
      data: null,
      unavailable: false,
      error: `Invalid Atlas source request for ${endpoint}: ${detail}`,
    },
  }
}

function safeSourceId(sourceId: string): string | null {
  const parsed = sourceIdSchema.safeParse(sourceId)
  return parsed.success ? parsed.data : null
}

function invalidSourceId<T>(operation: string): AtlasFetchResult<T> {
  return {
    ok: false,
    data: null,
    unavailable: false,
    error: `Invalid Atlas source id for ${operation}: source id is not a controlled identifier`,
  }
}

/** Fetch the server-owned provider catalog. */
export function fetchSourceCatalog({ signal, routes }: SourceApiContext): Promise<AtlasFetchResult<SourceCatalog>> {
  return safeGet(routesOrDefault(routes).catalog, signal, sourceCatalogSchema)
}

/** Fetch one source's last server-observed connection status. */
export function fetchSourceConnection({
  signal,
  routes,
  sourceId,
}: SourceApiContext & { sourceId: string }): Promise<AtlasFetchResult<SourceConnectionStatus>> {
  const selectedRoutes = routesOrDefault(routes)
  const validSourceId = safeSourceId(sourceId)
  if (!validSourceId) return Promise.resolve(invalidSourceId('connection status'))
  return safeGet(selectedRoutes.connection(validSourceId), signal, sourceConnectionStatusSchema)
}

/** Associate an already provisioned profile reference with a source. */
export function connectSource({
  signal,
  routes,
  payload,
}: SourceApiPayload<ConnectSourceRequest>): Promise<AtlasFetchResult<ConnectSourceResponse>> {
  const selectedRoutes = routesOrDefault(routes)
  const valid = validateRequest('Atlas source connect', connectSourceRequestSchema, payload)
  if (!valid.valid) return Promise.resolve(valid.result)
  const endpoint = selectedRoutes.connect(valid.data.source_id)
  return safePost(endpoint, valid.data, signal, connectSourceResponseSchema)
}

/** Ask the backend for a non-mutating, digest/provenance-bearing sync preview. */
export function previewSourceSync({
  signal,
  routes,
  payload,
}: SourceApiPayload<SyncPreviewRequest>): Promise<AtlasFetchResult<SyncPreview>> {
  const endpoint = 'Atlas source sync preview'
  const valid = validateRequest(endpoint, syncPreviewRequestSchema, payload)
  if (!valid.valid) return Promise.resolve(valid.result)
  return safePost(routesOrDefault(routes).syncPreview, valid.data, signal, syncPreviewSchema)
}

/** Start only the exact preview selected by the operator. */
export function startSourceSync({
  signal,
  routes,
  payload,
}: SourceApiPayload<StartSyncRequest>): Promise<AtlasFetchResult<StartSyncResponse>> {
  const endpoint = 'Atlas source sync start'
  const valid = validateRequest(endpoint, startSyncRequestSchema, payload)
  if (!valid.valid) return Promise.resolve(valid.result)
  return safePost(routesOrDefault(routes).startSync, valid.data, signal, startSyncResponseSchema)
}

/** Fetch the server-owned aggregate status and its bounded run rows. */
export function fetchSourceRuns({
  signal,
  routes,
  sourceId,
}: SourceApiContext & { sourceId?: string }): Promise<AtlasFetchResult<SyncRunAggregate>> {
  const selectedRoutes = routesOrDefault(routes)
  if (sourceId === undefined) return safeGet(selectedRoutes.syncRuns, signal, syncRunAggregateSchema)
  const validSourceId = safeSourceId(sourceId)
  if (!validSourceId) return Promise.resolve(invalidSourceId('sync run status'))
  const query = `?source_id=${encodeURIComponent(validSourceId)}`
  return safeGet(`${selectedRoutes.syncRuns}${query}`, signal, syncRunAggregateSchema)
}

/** Request cancellation by the server-owned run id. */
export function cancelSourceRun({
  signal,
  routes,
  payload,
}: SourceApiPayload<CancelSyncRunRequest>): Promise<AtlasFetchResult<CancelSyncRunResponse>> {
  const selectedRoutes = routesOrDefault(routes)
  const valid = validateRequest('Atlas source run cancellation', cancelSyncRunRequestSchema, payload)
  if (!valid.valid) return Promise.resolve(valid.result)
  const endpoint = selectedRoutes.cancelSync(valid.data.run_id)
  return safePost(endpoint, valid.data, signal, cancelSyncRunResponseSchema)
}

/**
 * Convert a validated operation result to data for React Query mutation hooks.
 * Unavailable routes remain a first-class error with `unavailable=true`, while
 * shape/network failures remain ordinary errors; callers can render both
 * states without conflating a missing capability with a failed request.
 */
export function requireSourceData<T>(result: AtlasFetchResult<T>): T {
  if (result.ok && result.data !== null) return result.data
  const message = safeSourceDisplayText(result.error, 'Atlas source request failed.') ?? 'Atlas source request failed.'
  throw new AtlasSourceApiError(message, result.unavailable)
}

export class AtlasSourceApiError extends Error {
  readonly unavailable: boolean

  constructor(message: string, unavailable: boolean) {
    super(safeSourceDisplayText(message, 'Atlas source request failed.') ?? 'Atlas source request failed.')
    this.name = 'AtlasSourceApiError'
    this.unavailable = unavailable
  }
}

/** Validate a fixture or adapter payload without sending it over the network. */
export function parseSourceContract<T>(schema: z.ZodType<T>, value: unknown, endpoint = 'Atlas source contract'): T {
  try {
    return validateShape(schema, value, endpoint)
  } catch (error) {
    if (error instanceof ApiShapeError) throw error
    throw new Error(String(error))
  }
}
