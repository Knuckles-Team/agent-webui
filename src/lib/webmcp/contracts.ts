/**
 * Zod contracts for the small, UI-local WebMCP surface.
 *
 * These schemas are intentionally narrower than the application's internal
 * types. In particular, page selections and Atlas selections do not carry
 * arbitrary `data` properties, and Atlas state never includes console text,
 * submitted queries, result payloads, or adapter options.
 */
import { z } from 'zod'
import type { PageContextEnvelope, PageContextFilterValue } from '@/lib/page-context'
import type { AtlasState } from '@/lib/atlas/workbench'
import type { FilterSet, Selection } from '@/lib/atlas/types'

const boundedString = (max: number) => z.string().max(max)
const finiteNumber = z.number()

// Route query parameters and filter field names are application data. Redact
// names that conventionally carry credentials before page state is handed to
// a browser agent; the allowlist of tools is not a reason to echo secrets.
const SENSITIVE_NAME_PATTERN =
  /(?:api[-_]?key|authorization|client[-_]?secret|cookie|credential|password|private[-_]?key|secret|token)/i

function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME_PATTERN.test(name)
}

function redactRoute(route: string): string {
  try {
    const url = new URL(route, 'http://agent-webui.local')
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveName(key)) url.searchParams.delete(key)
    }
    return `${url.pathname}${url.search}`
  } catch {
    return '/'
  }
}

function redactPageFilters(filters: Record<string, PageContextFilterValue>): Record<string, PageContextFilterValue> {
  return Object.fromEntries(Object.entries(filters).filter(([key]) => !isSensitiveName(key)))
}

const pageContextScalarSchema = z.union([boundedString(256), finiteNumber, z.boolean(), z.null()])
const pageContextFilterValueSchema = z.union([pageContextScalarSchema, z.array(pageContextScalarSchema).max(16)])
const pageContextFiltersSchema = z
  .record(boundedString(64), pageContextFilterValueSchema)
  .refine((filters) => Object.keys(filters).length <= 16, 'page context has too many filters')

const pageSelectionSchema = z
  .object({
    kind: boundedString(64),
    id: boundedString(256),
    label: boundedString(256).optional(),
  })
  .strict()

const isoTimestamp = z.iso.datetime({ offset: true })

const pageTimeRangeSchema = z
  .object({
    start: isoTimestamp.optional(),
    end: isoTimestamp.optional(),
    asOf: isoTimestamp.optional(),
    timezone: boundedString(64).optional(),
  })
  .strict()

/** Public context deliberately omits `allowedActions`, which includes write/execute affordances. */
export const PublicPageContextSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    route: boundedString(512),
    view: boundedString(128),
    selection: z.array(pageSelectionSchema).max(16),
    filters: pageContextFiltersSchema,
    timeRange: pageTimeRangeSchema.optional(),
    capturedAt: isoTimestamp,
  })
  .strict()

export type PublicPageContext = z.infer<typeof PublicPageContextSchema>

export function toPublicPageContext(envelope: PageContextEnvelope): PublicPageContext {
  const publicContext = {
    schemaVersion: envelope.schemaVersion,
    route: redactRoute(envelope.route),
    view: envelope.view,
    selection: envelope.selection.map(({ kind, id, label }) => ({
      kind,
      id,
      ...(label === undefined ? {} : { label }),
    })),
    filters: redactPageFilters(envelope.filters),
    ...(envelope.timeRange === undefined ? {} : { timeRange: envelope.timeRange }),
    capturedAt: envelope.capturedAt,
  }
  return PublicPageContextSchema.parse(publicContext)
}

export const EmptyToolInputSchema = z.object({}).strict()

export const NavigateInputSchema = z
  .object({
    /** Same-origin in-app path, never an external URL. */
    path: boundedString(512).min(1),
  })
  .strict()

export const NavigateOutputSchema = z
  .object({
    navigated: z.literal(true),
    path: boundedString(512),
    routeId: boundedString(128),
    view: boundedString(128),
  })
  .strict()

// ---------------------------------------------------------------------------
// Atlas's modality-neutral filter and selection subset
// ---------------------------------------------------------------------------

const atlasScalarSchema = z.union([boundedString(256), finiteNumber, z.boolean()])
const atlasFilterValueSchema = z.union([atlasScalarSchema, z.array(atlasScalarSchema).max(16)])

const atlasFilterClauseSchema = z
  .object({
    id: boundedString(128).min(1),
    field: boundedString(128).min(1),
    op: z.enum(['eq', 'neq', 'contains', 'startsWith', 'gt', 'gte', 'lt', 'lte', 'in', 'exists', 'missing']),
    value: atlasFilterValueSchema.optional(),
  })
  .strict()

const atlasSortSchema = z
  .object({
    field: boundedString(128).min(1),
    direction: z.enum(['asc', 'desc']),
  })
  .strict()

export const AtlasFilterSetSchema = z
  .object({
    search: boundedString(512),
    combinator: z.enum(['and', 'or']),
    clauses: z.array(atlasFilterClauseSchema).max(16),
    sort: atlasSortSchema.nullable(),
    limit: finiteNumber.int().min(0).max(5_000),
  })
  .strict()

export type AtlasFilterSetInput = z.infer<typeof AtlasFilterSetSchema>

export const AtlasSelectionSchema = z
  .object({
    kind: z.enum(['node', 'edge', 'row', 'cell']),
    id: boundedString(256).min(1),
    label: boundedString(256),
    type: boundedString(128).optional(),
  })
  .strict()

export const AtlasSelectionValueSchema = AtlasSelectionSchema.nullable()
export const AtlasSelectionInputSchema = z
  .object({
    selection: AtlasSelectionValueSchema,
  })
  .strict()
export type AtlasSelectionInput = z.infer<typeof AtlasSelectionInputSchema>

const publicAtlasSelectionSchema = AtlasSelectionValueSchema
const publicAtlasContextSchema = z
  .object({
    graph: boundedString(256).nullable(),
    limit: finiteNumber.int().min(0).max(5_000),
  })
  .strict()

export const PublicAtlasStateSchema = z
  .object({
    adapterId: boundedString(128),
    filters: AtlasFilterSetSchema,
    selection: publicAtlasSelectionSchema,
    rendererId: boundedString(128).nullable(),
    context: publicAtlasContextSchema,
  })
  .strict()

export type PublicAtlasState = z.infer<typeof PublicAtlasStateSchema>

/** Omit credential-shaped field names from local Atlas filter echoes. */
export function toPublicAtlasFilters(filters: FilterSet): FilterSet {
  const clauses = filters.clauses.filter((clause) => !isSensitiveName(clause.field))
  const sort = filters.sort && !isSensitiveName(filters.sort.field) ? filters.sort : null
  return { ...filters, clauses, sort }
}

/** Strip Atlas result properties before a state snapshot crosses the browser-agent boundary. */
export function toPublicAtlasState(state: AtlasState): PublicAtlasState {
  const selection = state.selection ? toPublicAtlasSelection(state.selection) : null
  return PublicAtlasStateSchema.parse({
    adapterId: state.adapterId,
    filters: toPublicAtlasFilters(state.filters),
    selection,
    rendererId: state.rendererId,
    context: { graph: state.ctx.graph, limit: state.ctx.limit },
  })
}

function toPublicAtlasSelection(selection: Selection): z.infer<typeof AtlasSelectionSchema> {
  return {
    kind: selection.kind,
    id: selection.id,
    label: selection.label,
    ...(selection.type === undefined ? {} : { type: selection.type }),
  }
}

/** Reconstitute the app's typed selection with an empty data bag. */
export function selectionFromToolInput(input: AtlasSelectionInput): Selection | null {
  const selection = input.selection
  if (selection === null) return null
  return {
    kind: selection.kind,
    id: selection.id,
    label: selection.label,
    ...(selection.type === undefined ? {} : { type: selection.type }),
    data: {},
  }
}
