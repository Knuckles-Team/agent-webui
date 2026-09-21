/**
 * Runtime contracts for Atlas external sources.
 *
 * Atlas never guesses which providers exist or what they can do.  The source
 * catalog is an observation from GraphOS; these schemas validate that
 * observation before it reaches a card or an action.  Connection configuration
 * is deliberately reference-only: the browser may submit a controlled profile
 * reference, but it cannot submit a password, token, URL, DSN, or endpoint.
 */
import { z } from 'zod'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/
const PROFILE_REFERENCE_PATTERN =
  /^(?:env:\/\/[A-Za-z_][A-Za-z0-9_]{0,127}|(?:vault|secret):\/\/[A-Za-z0-9][A-Za-z0-9_./#-]{0,511})$/i
const TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|z|[+-][0-9]{2}:[0-9]{2})$/
const URI_PATTERN = /\b[A-Za-z][A-Za-z0-9+.-]{1,31}:\/\/[^\s]+/i
// Require a transport scheme to start a value or follow a text delimiter.
// Without the boundary, valid opaque IDs such as `run:postgres:42` are
// mistaken for a `postgres:` URL merely because a segment happens to be named
// postgres.
const FORBIDDEN_SCHEME_PATTERN = /(?:^|[\s"'(])(?:jdbc|odbc|postgres(?:ql)?|s3|https?|file|data|body):/i
const USERINFO_PATTERN = /:\/\/[^/\s]*@/i
const INLINE_USERINFO_PATTERN = /\b[A-Za-z][A-Za-z0-9._-]{0,63}:[^\s/@]+@[^\s]+/i
const HOST_PATTERN =
  /(?:\b(?:localhost|(?:[a-z0-9-]+\.)+[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})|\[[0-9a-f:]+\])(?::\d{1,5})?(?:[/?#\s)]|$)/i
const SECRET_ASSIGNMENT_PATTERN =
  /["']?\b(?:user(?:name)?|login|password|passwd|pwd|secret|token|credential)\b["']?\s*[:=]/i
const SECRET_KEY_ASSIGNMENT_PATTERN =
  /["']?\b(?:api[-_ ]?key|access[-_ ]?key|client[-_ ]?secret|private[-_ ]?key|authorization|bearer)\b["']?\s*[:=]/i
const ENDPOINT_ASSIGNMENT_PATTERN = /["']?\b(?:endpoint|dsn|url|uri|host(?:name)?|server|port|address)\b["']?\s*[:=]/i
const SENSITIVE_WORD_PATTERN =
  /\b(?:password|passwd|pwd|secret|token|api[-_ ]?key|access[-_ ]?key|credential|authorization|bearer|dsn|endpoint)\b/i
const SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/

function isPrivateText(value: string): boolean {
  return (
    !URI_PATTERN.test(value) &&
    !FORBIDDEN_SCHEME_PATTERN.test(value) &&
    !USERINFO_PATTERN.test(value) &&
    !INLINE_USERINFO_PATTERN.test(value) &&
    !HOST_PATTERN.test(value) &&
    !SECRET_ASSIGNMENT_PATTERN.test(value) &&
    !SECRET_KEY_ASSIGNMENT_PATTERN.test(value) &&
    !ENDPOINT_ASSIGNMENT_PATTERN.test(value) &&
    !SENSITIVE_WORD_PATTERN.test(value)
  )
}

function isPrivateProfileReference(value: string): boolean {
  const separator = value.indexOf('://')
  const path = separator < 0 ? value : value.slice(separator + 3)
  return (
    !URI_PATTERN.test(path) &&
    !USERINFO_PATTERN.test(value) &&
    !INLINE_USERINFO_PATTERN.test(path) &&
    !HOST_PATTERN.test(path) &&
    !SECRET_ASSIGNMENT_PATTERN.test(path) &&
    !ENDPOINT_ASSIGNMENT_PATTERN.test(path) &&
    !/[=@]/.test(path)
  )
}

function isPrivateScopeValue(value: string): boolean {
  return (
    !URI_PATTERN.test(value) &&
    !FORBIDDEN_SCHEME_PATTERN.test(value) &&
    !INLINE_USERINFO_PATTERN.test(value) &&
    !SECRET_ASSIGNMENT_PATTERN.test(value) &&
    !SECRET_KEY_ASSIGNMENT_PATTERN.test(value) &&
    !ENDPOINT_ASSIGNMENT_PATTERN.test(value) &&
    !/[=]/.test(value)
  )
}

const boundedIdentifier = z
  .string()
  .min(1)
  .max(192)
  .regex(IDENTIFIER_PATTERN)
  .refine(isPrivateText, 'must not contain an endpoint, URL, userinfo, or credential')
const boundedText = z
  .string()
  .min(1)
  .max(2048)
  .refine(isPrivateText, 'must not contain an endpoint, URL, userinfo, or credential')
const optionalText = boundedText.nullable().optional()
const timestamp = z.string().min(20).max(64).regex(TIMESTAMP_PATTERN)
const optionalTimestamp = timestamp.nullable().optional()
const opaqueReference = boundedIdentifier.refine(
  (value) => !/^(?:https?|file|data|body):\/\//i.test(value),
  'must be an opaque controlled reference',
)

/** A provider/source id emitted by the server.  It is not an allow-list. */
export const sourceIdSchema = boundedIdentifier

/**
 * A reference to a profile resolved by the server-side secret/configuration
 * authority.  Uncontrolled URL-like values are intentionally not accepted:
 * this schema only accepts the controlled `env://`, `vault://`, or `secret://`
 * schemes.
 */
export const connectionProfileRefSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(PROFILE_REFERENCE_PATTERN, 'must be a controlled connection profile reference')
  .refine(isPrivateProfileReference, 'must not contain an endpoint, URL, userinfo, or credential')

const scopeValueSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(SCOPE_PATTERN, 'must be a bounded scope discriminator')
  .refine(isPrivateScopeValue, 'must not contain an endpoint, URL, or credential')

export const sourceScopeSchema = z
  .object({
    authority: scopeValueSchema,
    tenant: scopeValueSchema,
    principal: scopeValueSchema,
  })
  .strict()
export type SourceScope = z.infer<typeof sourceScopeSchema>

export const SOURCE_ACTION_CAPABILITIES = {
  explore: ['explore', 'source.explore', 'atlas.source.explore'],
  connect: ['connect', 'source.connect', 'atlas.source.connect'],
  cancel: ['cancel', 'sync.cancel', 'sync_cancel', 'source.sync.cancel', 'atlas.source.sync.cancel'],
} as const
export type SourceAction = keyof typeof SOURCE_ACTION_CAPABILITIES

export const sourceAvailabilityStateSchema = z.enum([
  'available',
  'degraded',
  'unavailable',
  'not_configured',
  'unconfigured',
  'unknown',
])
export type SourceAvailabilityState = z.infer<typeof sourceAvailabilityStateSchema>

export const sourceAvailabilitySchema = z
  .object({
    state: sourceAvailabilityStateSchema,
    reason: optionalText,
    observed_at: optionalTimestamp,
  })
  .strict()
export type SourceAvailability = z.infer<typeof sourceAvailabilitySchema>

/** Query modes are server-declared, bounded slugs.  This keeps UQL and natural
 * language visible while permitting future dialects without a client release. */
export const sourceQueryModeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/)
export type SourceQueryMode = z.infer<typeof sourceQueryModeSchema>

export const sourceCapabilitySchema = boundedIdentifier
export type SourceCapability = z.infer<typeof sourceCapabilitySchema>

export const sourceFreshnessStateSchema = z.enum(['fresh', 'stale', 'syncing', 'unknown'])
export type SourceFreshnessState = z.infer<typeof sourceFreshnessStateSchema>

export const sourceFreshnessSchema = z
  .object({
    state: sourceFreshnessStateSchema,
    observed_at: optionalTimestamp,
    last_success_at: optionalTimestamp,
    age_seconds: z.number().nonnegative().nullable().optional(),
    watermark: boundedText.nullable().optional(),
  })
  .strict()
export type SourceFreshness = z.infer<typeof sourceFreshnessSchema>

/** Provenance is an opaque coordinate, never an endpoint or source payload. */
export const sourceProvenanceSchema = z
  .object({
    source_ref: opaqueReference,
    connector_ref: opaqueReference.nullable().optional(),
    observation_ref: opaqueReference.nullable().optional(),
    observed_at: optionalTimestamp,
  })
  .strict()
export type SourceProvenance = z.infer<typeof sourceProvenanceSchema>

export const sourceConnectionStateSchema = z.enum(['connected', 'disconnected', 'checking', 'unavailable', 'error'])
export type SourceConnectionState = z.infer<typeof sourceConnectionStateSchema>

export const sourceConnectionStatusSchema = z
  .object({
    state: sourceConnectionStateSchema,
    reason: optionalText,
    profile_ref: connectionProfileRefSchema.nullable().optional(),
    checked_at: optionalTimestamp,
    capabilities: z.array(sourceCapabilitySchema).max(128).optional(),
  })
  .strict()
export type SourceConnectionStatus = z.infer<typeof sourceConnectionStatusSchema>

/** One server-owned source/provider descriptor. */
export const sourceProviderSchema = z
  .object({
    source_id: sourceIdSchema,
    label: boundedText,
    description: optionalText,
    availability: sourceAvailabilitySchema,
    query_modes: z.array(sourceQueryModeSchema).max(32),
    capabilities: z.array(sourceCapabilitySchema).max(128),
    connection: sourceConnectionStatusSchema.optional(),
    freshness: sourceFreshnessSchema.optional(),
    provenance: sourceProvenanceSchema.optional(),
  })
  .strict()
export type SourceProvider = z.infer<typeof sourceProviderSchema>

/** A capability must be declared by the server before an action is exposed. */
export function hasSourceCapability(capabilities: readonly string[] | undefined, action: SourceAction): boolean {
  if (!capabilities) return false
  const accepted: readonly string[] = SOURCE_ACTION_CAPABILITIES[action]
  return capabilities.some((capability) => accepted.includes(capability))
}

/** Only a positively observed, ready source may be acted on. */
export function sourceAvailabilityIsReady(availability: SourceAvailability | null | undefined): boolean {
  return availability?.state === 'available'
}

export function sourceActionIsEnabled(provider: SourceProvider, action: SourceAction): boolean {
  return sourceAvailabilityIsReady(provider.availability) && hasSourceCapability(provider.capabilities, action)
}

export const sourceCatalogSchema = z
  .object({
    catalog_version: boundedIdentifier.optional(),
    observed_at: timestamp,
    providers: z.array(sourceProviderSchema).max(512),
    freshness: sourceFreshnessSchema.optional(),
    provenance: sourceProvenanceSchema.optional(),
  })
  .strict()
  .superRefine((catalog, context) => {
    const seen = new Set<string>()
    catalog.providers.forEach((provider, index) => {
      if (seen.has(provider.source_id)) {
        context.addIssue({
          code: 'custom',
          path: ['providers', index, 'source_id'],
          message: 'source_id must be unique within the catalog',
        })
      }
      seen.add(provider.source_id)
    })
  })
export type SourceCatalog = z.infer<typeof sourceCatalogSchema>

/** Response returned after a reference-only profile is associated with a source. */
export const connectSourceRequestSchema = z
  .object({
    source_id: sourceIdSchema,
    connection_profile_ref: connectionProfileRefSchema,
  })
  .strict()
export type ConnectSourceRequest = z.infer<typeof connectSourceRequestSchema>

export const connectSourceResponseSchema = z
  .object({
    source_id: sourceIdSchema,
    connection: sourceConnectionStatusSchema,
    freshness: sourceFreshnessSchema.optional(),
    provenance: sourceProvenanceSchema.optional(),
  })
  .strict()
export type ConnectSourceResponse = z.infer<typeof connectSourceResponseSchema>

export const syncModeSchema = z.enum(['delta', 'full', 'reconcile'])
export type SyncMode = z.infer<typeof syncModeSchema>

export const syncPreviewRequestSchema = z
  .object({
    source_id: sourceIdSchema,
    mode: syncModeSchema,
    connection_profile_ref: connectionProfileRefSchema.optional(),
  })
  .strict()
export type SyncPreviewRequest = z.infer<typeof syncPreviewRequestSchema>

export const syncPreviewChangeCountsSchema = z
  .object({
    added: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  })
  .strict()
export type SyncPreviewChangeCounts = z.infer<typeof syncPreviewChangeCountsSchema>

export const syncPreviewSchema = z
  .object({
    preview_id: boundedIdentifier,
    source_id: sourceIdSchema,
    mode: syncModeSchema,
    generated_at: timestamp,
    changes: syncPreviewChangeCountsSchema,
    will_write: z.boolean(),
    requires_approval: z.boolean(),
    warnings: z.array(boundedText).max(64),
    plan_ref: boundedIdentifier.nullable().optional(),
    freshness: sourceFreshnessSchema.optional(),
    provenance: sourceProvenanceSchema.optional(),
  })
  .strict()
export type SyncPreview = z.infer<typeof syncPreviewSchema>

/** Execution must reference a reviewed preview; it cannot submit raw source config. */
export const startSyncRequestSchema = z
  .object({
    preview_id: boundedIdentifier,
    idempotency_key: boundedIdentifier.optional(),
  })
  .strict()
export type StartSyncRequest = z.infer<typeof startSyncRequestSchema>

export const syncRunStateSchema = z.enum([
  'queued',
  'pending',
  'running',
  'cancelling',
  'succeeded',
  'completed',
  'failed',
  'cancelled',
  'unknown',
])
export type SyncRunState = z.infer<typeof syncRunStateSchema>

export const startSyncResponseSchema = z
  .object({
    run_id: boundedIdentifier,
    source_id: sourceIdSchema,
    state: syncRunStateSchema.optional(),
    accepted_at: optionalTimestamp,
  })
  .strict()
export type StartSyncResponse = z.infer<typeof startSyncResponseSchema>

export const syncRunProgressSchema = z
  .object({
    pages_done: z.number().int().nonnegative().optional(),
    items_seen: z.number().int().nonnegative().optional(),
    items_ingested: z.number().int().nonnegative().optional(),
    items_failed: z.number().int().nonnegative().optional(),
    total_items: z.number().int().nonnegative().nullable().optional(),
  })
  .strict()
export type SyncRunProgress = z.infer<typeof syncRunProgressSchema>

export const syncRunSchema = z
  .object({
    run_id: boundedIdentifier,
    source_id: sourceIdSchema,
    mode: syncModeSchema,
    state: syncRunStateSchema,
    availability: sourceAvailabilitySchema.optional(),
    capabilities: z.array(sourceCapabilitySchema).max(128).optional(),
    started_at: optionalTimestamp,
    updated_at: optionalTimestamp,
    finished_at: optionalTimestamp,
    phase: boundedText.nullable().optional(),
    error: boundedText.nullable().optional(),
    progress: syncRunProgressSchema.optional(),
    freshness: sourceFreshnessSchema.optional(),
    provenance: sourceProvenanceSchema.optional(),
  })
  .strict()
export type SyncRun = z.infer<typeof syncRunSchema>

export const syncRunAggregateCountsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
  })
  .strict()
export type SyncRunAggregateCounts = z.infer<typeof syncRunAggregateCountsSchema>

/** Aggregate status is server-owned; the UI does not infer it from child rows. */
export const syncRunAggregateSchema = z
  .object({
    aggregate_state: syncRunStateSchema,
    observed_at: timestamp,
    counts: syncRunAggregateCountsSchema,
    runs: z.array(syncRunSchema).max(512),
    freshness: sourceFreshnessSchema.optional(),
    provenance: sourceProvenanceSchema.optional(),
  })
  .strict()
  .superRefine((aggregate, context) => {
    const seen = new Set<string>()
    aggregate.runs.forEach((run, index) => {
      if (seen.has(run.run_id)) {
        context.addIssue({
          code: 'custom',
          path: ['runs', index, 'run_id'],
          message: 'run_id must be unique within the aggregate',
        })
      }
      seen.add(run.run_id)
    })
  })
export type SyncRunAggregate = z.infer<typeof syncRunAggregateSchema>

export const cancelSyncRunRequestSchema = z
  .object({
    run_id: boundedIdentifier,
  })
  .strict()
export type CancelSyncRunRequest = z.infer<typeof cancelSyncRunRequestSchema>

export const cancelSyncRunResponseSchema = z
  .object({
    run_id: boundedIdentifier,
    state: syncRunStateSchema,
    observed_at: timestamp,
  })
  .strict()
export type CancelSyncRunResponse = z.infer<typeof cancelSyncRunResponseSchema>

/** Render server-declared query mode slugs without maintaining a provider list. */
export function formatSourceQueryMode(mode: SourceQueryMode): string {
  const canonicalLabel: Readonly<Record<string, string>> = {
    natural_language: 'Natural Language',
    nl: 'Natural Language',
    uql: 'UQL',
    sql: 'SQL',
    cypher: 'Cypher',
    sparql: 'SPARQL',
  }
  const known = canonicalLabel[mode.toLowerCase()]
  if (known) return known
  return mode.replace(/[_:-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

/** Keep profile values out of accidental logs and UI summaries. */
export function isConnectionProfileReference(value: string): boolean {
  return connectionProfileRefSchema.safeParse(value.trim()).success
}

/** Return only text that passed the source privacy policy to a UI surface. */
export function safeSourceDisplayText(
  value: string | null | undefined,
  fallback = 'Details unavailable.',
): string | null {
  if (value === null || value === undefined || value.length === 0) return null
  return isPrivateText(value) ? value : fallback
}
