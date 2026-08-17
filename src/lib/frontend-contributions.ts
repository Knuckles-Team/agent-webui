/**
 * @file frontend-contributions.ts
 * @description Typed client + validator for the FrontendContribution.v1 catalog (GOC-24).
 *
 * A package on the agent-utilities side declares its own WebUI integration
 * (navigation placement, read models, governed actions, panels, docs) via a
 * `contribution.json` descriptor discovered from its own
 * `agent_utilities.frontend_providers` entry point -- see
 * `agent-utilities/agent_utilities/core/frontend_providers.py` for the
 * authoritative discovery/validation, which this module mirrors field for
 * field. AU is the schema/provenance authority; this module is a CONSUMER
 * -- it never widens what AU already rejected, and it never fabricates a
 * status AU did not report.
 *
 * "Never fabricate state" (the charter's hard requirement) is enforced at
 * the type level: {@link FrontendContributionRecord.descriptor} is `null`
 * for every non-`OK` record (the zod schema below refuses a payload that
 * pairs a `BLOCKED`/`MISSING` status with a populated descriptor, and a
 * `DEGRADED` record still carries the real parsed descriptor -- degraded
 * means "a referenced capability didn't resolve", not "unknown shape"). A
 * caller that renders `record.descriptor` for anything but an OK/DEGRADED
 * record is rendering a value the schema does not allow to exist; there is
 * no default/placeholder value for a BLOCKED or MISSING record's descriptor
 * to render instead -- callers render `record.reason` and stop, exactly
 * like `McpAppsView`'s `UnavailableNotice` pattern for a backend that
 * returned nothing.
 *
 * Every function here goes through {@link validateShape} (the repo's one
 * runtime-validation boundary, `api-validation.ts`) so a malformed response
 * throws `ApiShapeError` instead of silently becoming a value a caller
 * `.map()`s over.
 */
import { z } from 'zod'
import { validateShape } from './api-validation'
export { ApiShapeError } from './api-validation'

export const FRONTEND_CONTRIBUTION_SCHEMA_VERSION = 'frontend-contribution.v1' as const

export const CONTRIBUTION_STATUSES = ['OK', 'DEGRADED', 'BLOCKED', 'MISSING'] as const
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number]

const RENDERERS = [
  'data-table',
  'metric-cards',
  'timeseries',
  'trace',
  'map',
  'code',
  'evidence',
  'graph',
  'json',
  'list',
  'detail',
] as const

const APPROVAL_CLASSES = ['none', 'read', 'change', 'sensitive', 'destructive'] as const
const CONFIRM_MODES = ['none', 'preflight', 'double'] as const
const PLACEMENTS = ['row', 'toolbar', 'panel', 'bulk'] as const
const REFRESH_MODES = ['event', 'poll', 'manual'] as const

const ID_RE = /^[a-z][a-z0-9_.-]{0,127}$/
const SCOPE_RE = /^[a-z][a-z0-9_.:-]{0,127}$/
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/
/** Same reject-list as the AU-side scan (`frontend_providers.scan_unsafe_content`) --
 * a second, independent check at the consumer boundary, never a substitute for it. */
const UNSAFE_CONTENT_RE =
  /javascript:|data:text\/html|data:application\/|<script|<\/script|on[a-z]+\s*=\s*["']|vbscript:|<iframe|file:\/\//i

const idSchema = z.string().regex(ID_RE, 'must be a lowercase dotted/underscored identifier')
const scopeSchema = z.string().regex(SCOPE_RE, 'must be a lowercase dotted/colon-delimited scope')
const digestSchema = z.string().regex(DIGEST_RE, 'must be sha256:<hex64>')

/** True if any string field anywhere in `value` matches the unsafe-content reject list. */
function containsUnsafeContent(value: unknown): boolean {
  if (typeof value === 'string') return UNSAFE_CONTENT_RE.test(value)
  if (Array.isArray(value)) return value.some(containsUnsafeContent)
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(containsUnsafeContent)
  }
  return false
}

const navSchema = z.strictObject({
  section: z.string().min(1).max(64),
  order: z.number().int().min(0).max(10_000),
})

const refreshPolicySchema = z.strictObject({
  mode: z.enum(REFRESH_MODES),
  fallback_seconds: z.number().int().min(1).max(86_400),
})

const readModelSchema = z.strictObject({
  id: idSchema,
  schema: z.string().min(1).max(4096),
  capability: idSchema,
  renderer: z.enum(RENDERERS),
  refresh: refreshPolicySchema.optional(),
  columns: z.array(z.string().min(1).max(128)).max(64).optional().default([]),
})

const actionSchema = z.strictObject({
  id: idSchema,
  capability: idSchema,
  placement: z.enum(PLACEMENTS),
  confirm: z.enum(CONFIRM_MODES),
  approval_class: z.enum(APPROVAL_CLASSES),
})

const panelSchema = z.strictObject({
  id: idSchema,
  renderer: z.enum(RENDERERS),
})

const provenanceSchema = z.strictObject({
  source: z.literal('package-entry-point'),
  signer_key_id: z.string().min(1).max(256),
  artifact_digest: digestSchema,
})

/**
 * The v1 descriptor shape, mirroring `FrontendContributionV1` in
 * `agent_utilities/core/frontend_providers.py` field for field. `.strictObject`
 * (zod's `extra=forbid` equivalent) rejects an unknown field exactly like the
 * AU-side Pydantic model -- this is a SECOND independent check, not a
 * relaxed mirror of the first; a descriptor AU already rejected can never
 * reach this far (AU is the discovery authority), but a descriptor this
 * client fetches from an untrusted or stale catalog projection is
 * re-validated here rather than trusted blindly.
 */
export const frontendContributionSchema = z
  .strictObject({
    schema_version: z.literal(FRONTEND_CONTRIBUTION_SCHEMA_VERSION),
    package_id: idSchema,
    package_version: z.string().min(1).max(128),
    descriptor_version: z.number().int().min(1).max(1000),
    descriptor_digest: digestSchema,
    title: z.string().min(1).max(128),
    icon: z.string().min(1).max(64),
    nav: navSchema,
    required_scopes: z.array(scopeSchema).max(64).default([]),
    read_models: z.array(readModelSchema).min(1).max(64),
    actions: z.array(actionSchema).max(64).default([]),
    panels: z.array(panelSchema).max(32).default([]),
    realtime_topics: z.array(scopeSchema).max(64).default([]),
    empty_state: z.string().min(1).max(4096),
    docs_ref: z
      .string()
      .max(4096)
      .refine((value) => value.startsWith('pkg:'), 'docs_ref must use the pkg: scheme'),
    provenance: provenanceSchema,
    extensions: z.record(z.string(), z.unknown()).default({}),
  })
  .refine((value) => value.read_models.some((model) => model.id === 'health' || model.id === 'inventory'), {
    message: "descriptor must include a 'health' or 'inventory' read model",
  })
  .refine((value) => !containsUnsafeContent(value), {
    message: 'descriptor contains unsafe/executable content',
  })

export type FrontendContributionV1 = z.infer<typeof frontendContributionSchema>

/**
 * One package's discovery outcome. `descriptor` is `null` for every status
 * except `OK`/`DEGRADED` -- see the module docstring: this is the
 * "never fabricate state" invariant enforced structurally, not by caller
 * discipline.
 */
export const frontendContributionRecordSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('OK'),
    package_id: idSchema,
    provider_name: z.string().min(1).max(256),
    reason: z.null(),
    descriptor: frontendContributionSchema,
    descriptor_digest: digestSchema,
    registration_digest: z.string().min(1).max(256),
    source_digest: z.string().min(1).max(256).nullable(),
  }),
  z.strictObject({
    status: z.literal('DEGRADED'),
    package_id: idSchema,
    provider_name: z.string().min(1).max(256),
    reason: z.string().min(1).max(4096),
    descriptor: frontendContributionSchema,
    descriptor_digest: digestSchema,
    registration_digest: z.string().min(1).max(256),
    source_digest: z.string().min(1).max(256).nullable(),
  }),
  z.strictObject({
    status: z.literal('BLOCKED'),
    package_id: z.string().min(1).max(256),
    provider_name: z.string().min(1).max(256),
    reason: z.string().min(1).max(4096),
    descriptor: z.null(),
    descriptor_digest: z.null(),
    registration_digest: z.string().min(1).max(256),
    source_digest: z.null(),
  }),
  z.strictObject({
    status: z.literal('MISSING'),
    package_id: z.string().min(1).max(256),
    provider_name: z.string().min(1).max(256),
    reason: z.string().min(1).max(4096),
    descriptor: z.null(),
    descriptor_digest: z.null(),
    registration_digest: z.string().min(1).max(256),
    source_digest: z.null(),
  }),
])
// `reason` being null exactly when `status === 'OK'` is already enforced
// structurally by the per-variant field types above (the OK arm's `reason`
// is `z.null()`; every other arm's is `z.string().min(1)`) -- no separate
// `.refine` is needed, and adding one would be dead code the type system
// already proves unreachable.

export type FrontendContributionRecord = z.infer<typeof frontendContributionRecordSchema>

export const frontendContributionCatalogSchema = z.strictObject({
  catalog_epoch: digestSchema,
  packages: z.array(frontendContributionRecordSchema).max(100),
})

export type FrontendContributionCatalog = z.infer<typeof frontendContributionCatalogSchema>

/**
 * Fetch and validate the frontend-contribution catalog. Any shape violation
 * (including a record that tries to pair a BLOCKED status with a populated
 * descriptor) throws {@link ApiShapeError} rather than returning a value a
 * caller could render as real state.
 */
export async function fetchFrontendContributions(): Promise<FrontendContributionCatalog> {
  // NOTE (GOC-24 gap, tracked in the AU-side handoff): this REST route does
  // not exist on the backend yet -- AU's discover_frontend_contributions()
  // has no REST/MCP twin in this lane (see
  // agent-utilities/docs/architecture/frontend-contributions.md, "What this
  // lane did NOT do"). This client is the CONSUMER contract, shipped ahead
  // of the route so GOC-25's route work has a validated target to call into
  // -- do not remove the /api/enhanced/* prefix convention when that lands.
  const endpoint = '/api/enhanced/frontend-contributions'
  const response = await fetch(endpoint, { credentials: 'same-origin' })
  if (!response.ok) {
    const body = await response.text()
    const { ApiError } = await import('./api-validation')
    throw new ApiError(response.status, body)
  }
  const raw: unknown = await response.json()
  return validateShape(frontendContributionCatalogSchema, raw, endpoint)
}

/** Records whose descriptor is safe to render (OK or DEGRADED only). */
export function renderableContributions(
  catalog: FrontendContributionCatalog,
): Extract<FrontendContributionRecord, { descriptor: FrontendContributionV1 }>[] {
  return catalog.packages.filter(
    (record): record is Extract<FrontendContributionRecord, { descriptor: FrontendContributionV1 }> =>
      record.status === 'OK' || record.status === 'DEGRADED',
  )
}
