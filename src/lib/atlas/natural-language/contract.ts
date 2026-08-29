/**
 * @file natural-language/contract.ts
 * @description The browser contract for agent-utilities' NL query gateway twin.
 *
 * The gateway accepts the request fields (`text`, `execute`) and returns the canonical
 * EvidenceBundle envelope.  In particular, the generated query is not a
 * top-level response field and query rows are not a `results` field: both are
 * evidence carried by the `reasoning_trace` / `claims` fields.  Keeping that
 * distinction in one runtime-validated contract prevents callers from turning
 * a malformed or older response into a plausible empty answer.
 */
import { z } from 'zod'

import { validateShape } from '@/lib/api-validation'

/** Absolute browser route served by the agent-utilities gateway. */
export const NATURAL_LANGUAGE_QUERY_ROUTE = '/api/graph/nl-query'

/** The request fields emitted by this governed browser client. */
export const NATURAL_LANGUAGE_QUERY_REQUEST_SCHEMA = z.strictObject({
  text: z.string().trim().min(1),
  execute: z.boolean(),
})

export type NaturalLanguageQueryRequest = z.infer<typeof NATURAL_LANGUAGE_QUERY_REQUEST_SCHEMA>

/** Build the exact request body accepted by `/graph/nl-query`. */
export function createNaturalLanguageQueryRequest(text: string, execute = true): NaturalLanguageQueryRequest {
  return NATURAL_LANGUAGE_QUERY_REQUEST_SCHEMA.parse({ text, execute })
}

const JSON_OBJECT_SCHEMA = z.record(z.string(), z.unknown())

/** One bounded planner/executor attempt preserved by the backend trace. */
export const NATURAL_LANGUAGE_QUERY_ATTEMPT_SCHEMA = z.looseObject({
  attempt: z.number().optional(),
  phase: z.string().optional(),
  dialect: z.string().optional(),
  query: z.string().nullable().optional(),
  error_code: z.string().optional(),
  error: z.string().optional(),
  grammar_version: z.string().optional(),
})

export type NaturalLanguageQueryAttempt = z.infer<typeof NATURAL_LANGUAGE_QUERY_ATTEMPT_SCHEMA>

/** Generated plan metadata nested in an EvidenceBundle reasoning trace entry. */
export const NATURAL_LANGUAGE_QUERY_PLAN_SCHEMA = z.looseObject({
  grammar_version: z.string().nullable().optional(),
  dialect: z.string().nullable().optional(),
  query: z.string().nullable().optional(),
  corrections: z.array(z.unknown()).optional(),
  bounded: z.boolean().optional(),
})

export type NaturalLanguageQueryPlan = z.infer<typeof NATURAL_LANGUAGE_QUERY_PLAN_SCHEMA>

/**
 * A trace entry is intentionally loose after its known fields.  The bundle is
 * the authority for future trace metadata; unknown trace keys are retained by
 * Zod instead of being silently stripped, while the fields this client reads
 * still have strict primitive/collection types.
 */
export const NATURAL_LANGUAGE_QUERY_TRACE_SCHEMA = z.looseObject({
  step: z.string().optional(),
  question: z.string().optional(),
  dialect: z.string().nullable().optional(),
  generated_query: z.string().nullable().optional(),
  schema: z.unknown().optional(),
  planner: z.string().nullable().optional(),
  plan: NATURAL_LANGUAGE_QUERY_PLAN_SCHEMA.nullable().optional(),
  attempts: z.array(NATURAL_LANGUAGE_QUERY_ATTEMPT_SCHEMA).optional(),
})

export type NaturalLanguageQueryTrace = z.infer<typeof NATURAL_LANGUAGE_QUERY_TRACE_SCHEMA>

const SAFE_SOURCE_AUTHORITY_KEYS = new Set([
  'authority',
  'graph',
  'id',
  'kind',
  'label',
  'name',
  'ref',
  'source',
  'source_id',
  'source_type',
  'version',
])
const SENSITIVE_KEY_PATTERN = new RegExp(
  [
    String.raw`(?:access[_-]?key|api[_-]?key|authorization|connection|cookie|`,
    String.raw`credential|database|dsn|endpoint|host|password|port|private[_-]?key|`,
    String.raw`secret|token|uri|url|user(?:name)?)`,
  ].join(''),
  'i',
)
const SENSITIVE_URI_PATTERN = /\b[a-z][a-z0-9+.-]{1,31}:\/\/[^\s<>"']+/gi
const SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  [
    String.raw`\b(?:dsn|endpoint|url|uri|connection(?:[_ -]?string)?|database|host|`,
    String.raw`password|port|secret|token|api[_ -]?key|user(?:name)?)\s*[:=]\s*`,
    String.raw`(?:"[^"]*"|'[^']*'|[^,;\s]+)`,
  ].join(''),
  'gi',
)
const SENSITIVE_HOST_PATTERN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{2,5})?(?!\.[a-z0-9])\b/gi

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

/** Remove URI and key/value credentials from user-visible text. */
export function redactNaturalLanguageText(text: string): string {
  return text
    .replace(SENSITIVE_URI_PATTERN, '[redacted endpoint]')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '[redacted]')
    .replace(SENSITIVE_HOST_PATTERN, '[redacted host]')
}

/** Recursively remove sensitive object keys and redact endpoint-like strings for display. */
export function redactNaturalLanguageValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[redacted nested value]'
  if (typeof value === 'string') return redactNaturalLanguageText(value)
  if (Array.isArray(value)) return value.map((entry) => redactNaturalLanguageValue(entry, depth + 1))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSensitiveKey(key))
      .map(([key, entry]) => [key, redactNaturalLanguageValue(entry, depth + 1)]),
  )
}

type SafeSourceAuthorityValue = string | number | boolean | null

function safeSourceAuthorityValue(value: unknown): SafeSourceAuthorityValue | undefined {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  return typeof value === 'string' ? redactNaturalLanguageText(value) : undefined
}

/** Allow only non-credential source labels into the provenance panel. */
export function sourceAuthorityForDisplay(
  authority: Record<string, unknown> | null | undefined,
): Record<string, SafeSourceAuthorityValue> | null {
  if (!authority) return null
  const entries = Object.entries(authority)
    .filter(([key]) => SAFE_SOURCE_AUTHORITY_KEYS.has(key) && !isSensitiveKey(key))
    .flatMap(([key, value]) => {
      const safeValue = safeSourceAuthorityValue(value)
      return safeValue === undefined ? [] : [[key, safeValue] as const]
    })
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

export interface NaturalLanguageQueryPlanDisplay {
  grammar_version: string | null
  dialect: string | null
  query: string | null
  corrections: unknown[]
  bounded: boolean | null
}

function displayText(value: string | null | undefined): string | null {
  return typeof value === 'string' ? redactNaturalLanguageText(value) : null
}

/** Project planner metadata to fields safe for the reasoning-trace panel. */
export function planForDisplay(plan: NaturalLanguageQueryPlan): NaturalLanguageQueryPlanDisplay {
  return {
    grammar_version: displayText(plan.grammar_version),
    dialect: displayText(plan.dialect),
    query: displayText(plan.query),
    corrections: Array.isArray(plan.corrections)
      ? plan.corrections.map((entry) => redactNaturalLanguageValue(entry))
      : [],
    bounded: typeof plan.bounded === 'boolean' ? plan.bounded : null,
  }
}

export interface NaturalLanguageQueryAttemptDisplay {
  attempt: number | null
  phase: string | null
  dialect: string | null
  query: string | null
  error_code: string | null
  error: string | null
  grammar_version: string | null
}

/** Project planner attempts to known, non-sensitive audit fields. */
export function attemptForDisplay(attempt: NaturalLanguageQueryAttempt): NaturalLanguageQueryAttemptDisplay {
  return {
    attempt: typeof attempt.attempt === 'number' ? attempt.attempt : null,
    phase: displayText(attempt.phase),
    dialect: displayText(attempt.dialect),
    query: displayText(attempt.query),
    error_code: displayText(attempt.error_code),
    error: displayText(attempt.error),
    grammar_version: displayText(attempt.grammar_version),
  }
}

/**
 * Canonical EvidenceBundle response used by the NL gateway route.
 *
 * The top-level object is strict on purpose.  A response containing the old
 * flat `generated_query`/`results` fields is rejected instead of being adapted
 * into this contract.  Optional fields mirror EvidenceBundle's additive
 * defaults, while `answer_candidate`, `claims`, and `reasoning_trace` are the
 * required grounding surface every successful bundle must carry.
 */
export const NATURAL_LANGUAGE_QUERY_RESPONSE_SCHEMA = z.strictObject({
  answer_candidate: z.string(),
  claims: z.array(JSON_OBJECT_SCHEMA),
  evidence_spans: z.array(JSON_OBJECT_SCHEMA).optional(),
  source_authority: JSON_OBJECT_SCHEMA.nullable().optional(),
  contradictions: z.array(JSON_OBJECT_SCHEMA).optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  freshness: JSON_OBJECT_SCHEMA.nullable().optional(),
  policy_exclusions: z.array(z.string()).optional(),
  reasoning_trace: z.array(NATURAL_LANGUAGE_QUERY_TRACE_SCHEMA),
  next_actions: z.array(z.string()).optional(),
  error: JSON_OBJECT_SCHEMA.nullable().optional(),
})

export type NaturalLanguageQueryBundle = z.infer<typeof NATURAL_LANGUAGE_QUERY_RESPONSE_SCHEMA>

/** Short aliases for callers that refer to the response by its EvidenceBundle name. */
export const EVIDENCE_BUNDLE_SCHEMA = NATURAL_LANGUAGE_QUERY_RESPONSE_SCHEMA
export type EvidenceBundle = NaturalLanguageQueryBundle

/** Decode a gateway result outside the transport boundary (e.g. in a unit test). */
export function decodeNaturalLanguageQueryResponse(raw: unknown): NaturalLanguageQueryBundle {
  return validateShape(NATURAL_LANGUAGE_QUERY_RESPONSE_SCHEMA, raw, NATURAL_LANGUAGE_QUERY_ROUTE)
}

/** Alias that makes the decoding boundary read naturally at call sites. */
export const parseNaturalLanguageQueryResponse = decodeNaturalLanguageQueryResponse

/** Find the generated query only where the EvidenceBundle contract places it. */
export function generatedQueryFromBundle(bundle: NaturalLanguageQueryBundle): string | null {
  for (let index = bundle.reasoning_trace.length - 1; index >= 0; index -= 1) {
    const generated = bundle.reasoning_trace[index].generated_query
    if (typeof generated === 'string' && generated.trim() !== '') return generated
  }
  return null
}

/** Return the generated query after applying the display redaction policy. */
export function generatedQueryForDisplay(bundle: NaturalLanguageQueryBundle): string | null {
  const query = generatedQueryFromBundle(bundle)
  return query ? redactNaturalLanguageText(query) : null
}

/** Return every generated plan preserved in the reasoning trace. */
export function plansFromBundle(bundle: NaturalLanguageQueryBundle): NaturalLanguageQueryPlan[] {
  return bundle.reasoning_trace.flatMap((entry) => (entry.plan ? [entry.plan] : []))
}

/** Return only allowlisted planner fields for the visible reasoning trace. */
export function plansForDisplay(bundle: NaturalLanguageQueryBundle): NaturalLanguageQueryPlanDisplay[] {
  return plansFromBundle(bundle).map(planForDisplay)
}

/** Return every bounded attempt preserved in the reasoning trace. */
export function attemptsFromBundle(bundle: NaturalLanguageQueryBundle): NaturalLanguageQueryAttempt[] {
  return bundle.reasoning_trace.flatMap((entry) => entry.attempts ?? [])
}

/** Return only allowlisted attempt fields for the visible reasoning trace. */
export function attemptsForDisplay(bundle: NaturalLanguageQueryBundle): NaturalLanguageQueryAttemptDisplay[] {
  return attemptsFromBundle(bundle).map(attemptForDisplay)
}

/** Extract a stable error message without treating arbitrary bundle fields as text. */
export function bundleErrorMessage(bundle: NaturalLanguageQueryBundle): string | null {
  if (!bundle.error) return null
  const message = bundle.error.message
  if (typeof message === 'string' && message.trim() !== '') return message
  const code = bundle.error.code
  if (typeof code === 'string' && code.trim() !== '') return `Operation failed (${code}).`
  return 'The gateway reported that the NL query failed.'
}
