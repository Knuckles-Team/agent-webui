/**
 * Typed model for the WEBUI-API-R003.1 route census: the checked-in record of
 * every browser-facing route in `api_extensions.py`, its owning Arbora
 * operation (or UI-local/retire disposition), caller, scope, effect class and
 * migration state.
 *
 * This module owns the typed model and the source-to-census check used by the
 * WEBUI-API-R003.2 architecture gate. The checked-in data lives beside this
 * module in `route-census.json` and is validated before any route is served.
 */
import { z } from 'zod'

export const ROUTE_DISPOSITIONS = ['ui-local', 'session-protocol', 'generated-operation', 'retire'] as const
export type RouteDisposition = (typeof ROUTE_DISPOSITIONS)[number]

export const routeCensusEntrySchema = z
  .object({
    route: z.string().min(1),
    disposition: z.enum(ROUTE_DISPOSITIONS),
    owning_operation: z.string().min(1).nullable(),
    caller: z.string().min(1),
    scope: z.string().min(1).nullable(),
    // R003.2 records these fields in the checked-in census. They remain
    // optional at the R003.1 model boundary so existing typed fixtures can
    // continue to validate independently of the source inventory gate.
    effect_class: z.string().min(1).optional(),
    migration_state: z.string().min(1).optional(),
  })
  .strict()
  .refine((entry) => entry.disposition !== 'generated-operation' || entry.owning_operation !== null, {
    message: 'a generated-operation route must name its owning operation',
    path: ['owning_operation'],
  })

export type RouteCensusEntry = z.infer<typeof routeCensusEntrySchema>

export interface DomainRoute {
  readonly method: string
  readonly path: string
  readonly line: number
}

const ROUTER_DECORATOR = /^\s*@router\.(get|post|put|patch|delete|options|head|api_route)\(\s*(['"])([^'"]+)\2/gm
const API_EXTENSIONS_PREFIX = '/api/enhanced'
const API_EXTENSIONS_SOURCE = 'agent/agent_webui/api_extensions.py'

/** Extract the browser-facing routes declared by the enhanced host router. */
export function extractDomainRoutes(source: string): DomainRoute[] {
  const routes: DomainRoute[] = []
  for (const match of source.matchAll(ROUTER_DECORATOR)) {
    const method = match[1].toUpperCase()
    const path = `${API_EXTENSIONS_PREFIX}${match[3]}`
    const line = source.slice(0, match.index).split('\n').length
    routes.push({ method, path, line })
  }
  return routes
}

function routeKey(method: string, path: string): string {
  return `${method} ${path}`
}

export class RouteCensusLintError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`route census lint failed:\n${problems.map((problem) => `- ${problem}`).join('\n')}`)
    this.name = 'RouteCensusLintError'
    this.problems = problems
  }
}

interface CensusParseResult {
  readonly entries: RouteCensusEntry[]
  readonly problems: string[]
}

function censusMetadataProblems(value: unknown, route: string): string[] {
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  const problems: string[] = []
  if (typeof record.effect_class !== 'string' || record.effect_class.trim() === '')
    problems.push(`census entry ${route} must declare effect_class`)
  if (typeof record.migration_state !== 'string' || record.migration_state.trim() === '')
    problems.push(`census entry ${route} must declare migration_state`)
  return problems
}

function parseCensusEntries(rawEntries: readonly unknown[]): CensusParseResult {
  const entries: RouteCensusEntry[] = []
  const problems: string[] = []
  for (const value of rawEntries) {
    try {
      const entry = validateRouteCensusEntry(value)
      entries.push(entry)
      problems.push(...censusMetadataProblems(value, entry.route))
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { entries, problems }
}

function indexSourceRoutes(sourceRoutes: readonly DomainRoute[]): {
  readonly byKey: Map<string, DomainRoute>
  readonly problems: string[]
} {
  const byKey = new Map<string, DomainRoute>()
  const problems: string[] = []
  for (const route of sourceRoutes) {
    const key = routeKey(route.method, route.path)
    const previous = byKey.get(key)
    if (previous) problems.push(`duplicate source route ${key} at lines ${previous.line} and ${route.line}`)
    byKey.set(key, route)
  }
  return { byKey, problems }
}

function indexCensusEntries(entries: readonly RouteCensusEntry[]): {
  readonly byKey: Map<string, RouteCensusEntry>
  readonly problems: string[]
} {
  const byKey = new Map<string, RouteCensusEntry>()
  const problems: string[] = []
  for (const entry of entries) {
    const previous = byKey.get(entry.route)
    if (previous) problems.push(`duplicate census entry ${entry.route}`)
    byKey.set(entry.route, entry)
  }
  return { byKey, problems }
}

function coverageProblems(
  sourceRoutes: readonly DomainRoute[],
  sourceByKey: ReadonlyMap<string, DomainRoute>,
  censusByKey: ReadonlyMap<string, RouteCensusEntry>,
  entries: readonly RouteCensusEntry[],
): string[] {
  const problems: string[] = []
  for (const route of sourceRoutes) {
    const key = routeKey(route.method, route.path)
    if (!censusByKey.has(key))
      problems.push(`missing census entry for ${key} (${API_EXTENSIONS_SOURCE}:${route.line})`)
  }
  for (const entry of entries) {
    if (!sourceByKey.has(entry.route)) problems.push(`stale census entry ${entry.route}`)
  }
  return problems
}

/**
 * Validate the checked-in census against the source router. The comparison is
 * exact in both directions: a new decorator must be classified, and a stale
 * row cannot hide a removed or renamed route.
 */
export function lintRouteCensus(source: string, rawEntries: unknown): RouteCensusEntry[] {
  if (!Array.isArray(rawEntries)) throw new RouteCensusLintError(['route census data must be an array'])

  const { entries, problems: parseProblems } = parseCensusEntries(rawEntries)
  const sourceRoutes = extractDomainRoutes(source)
  const sourceIndex = indexSourceRoutes(sourceRoutes)
  const censusIndex = indexCensusEntries(entries)
  const problems = [...parseProblems, ...sourceIndex.problems, ...censusIndex.problems]
  if (sourceRoutes.length === 0) problems.push(`no ${API_EXTENSIONS_SOURCE} router decorators were found`)
  problems.push(...coverageProblems(sourceRoutes, sourceIndex.byKey, censusIndex.byKey, entries))

  if (problems.length > 0) throw new RouteCensusLintError(problems)
  return entries
}

export class RouteCensusError extends Error {
  readonly route: string
  constructor(route: string, reason: string) {
    super(`route census entry for "${route}" is invalid: ${reason}`)
    this.name = 'RouteCensusError'
    this.route = route
  }
}

/** Reject an unclassified or malformed census row loudly, at the one place every
 *  entry is parsed, instead of letting a bad disposition reach the lint rule. */
export function validateRouteCensusEntry(value: unknown): RouteCensusEntry {
  const parsed = routeCensusEntrySchema.safeParse(value)
  if (parsed.success) return parsed.data
  const route = typeof value === 'object' && value !== null && 'route' in value ? String(value.route) : 'unknown'
  throw new RouteCensusError(route, parsed.error.issues.map((issue) => issue.message).join('; '))
}
