/**
 * Typed model for the WEBUI-API-R003.1 route census: the checked-in record of
 * every browser-facing route in `api_extensions.py`, its owning Graph OS
 * operation (or UI-local/retire disposition), caller and scope.
 *
 * This is the typed model plus validation and the refusal test only. The
 * architecture lint rule that reads this census to reject a new
 * unclassified domain route, and the census data file itself, are
 * WEBUI-API-R003.2.
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
  })
  .strict()
  .refine((entry) => entry.disposition !== 'generated-operation' || entry.owning_operation !== null, {
    message: 'a generated-operation route must name its owning operation',
    path: ['owning_operation'],
  })

export type RouteCensusEntry = z.infer<typeof routeCensusEntrySchema>

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
