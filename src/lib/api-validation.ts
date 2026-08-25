/**
 * @file api-validation.ts
 * @description The ONE runtime-validation boundary every API client module in
 * this repo (api.ts, gateway.ts, admin-api.ts) and every
 * view that still calls `fetch()` directly routes through.
 *
 * Why this exists (PROGRAM.md R2 / D-WUI-7..25, D-WUI-6): 21 of 39 routes
 * crashed the ErrorBoundary under a hostile payload. Root cause was
 * identical across all of them — a raw `fetch(...).then(r => r.json())`
 * result was stored into component state with a `Promise<T>` type-level
 * assertion (`as Promise<T>` / a bare generic) and NO runtime check, then
 * unconditionally `.filter()`/`.map()`'d. TypeScript's `T` is erased at
 * runtime; asserting a shape does not make it true. `e.filter is not a
 * function` is the visible symptom of that gap.
 *
 * The fix is at the chokepoint (fix-priority ladder #2 in
 * `program/02-ownership-and-duplicate-discipline.md`): every response is
 * validated HERE, once, before any caller — API client method or view —
 * ever sees it. A shape violation is rejected LOUDLY (ladder step 4) with an
 * error naming the endpoint and what was expected, never silently coerced
 * into a plausible-looking wrong value and never left to throw mid-render.
 * Callers catch that error and render an explicit error state instead of
 * tripping the ErrorBoundary.
 */
import { z } from 'zod'

/**
 * Custom error class for API-related (HTTP-level) failures. Defined here
 * (rather than in api.ts) so this module never needs to import back from
 * api.ts — api.ts imports and re-exports this instead, keeping the existing
 * `import { ApiError } from '@/lib/api'` call sites unchanged while avoiding
 * a circular module dependency between the fetch layer and the validation
 * layer that wraps it.
 */
export class ApiError extends Error {
  /** HTTP status code */
  public status: number
  /** Raw response body text */
  public body: string

  constructor(status: number, body: string) {
    super(`API ${status}: ${body}`)
    this.status = status
    this.body = body
    this.name = 'ApiError'
  }
}

/** Thrown when a response fails its declared schema. Never masked/caught-and-ignored. */
export class ApiShapeError extends Error {
  readonly endpoint: string
  readonly issues: z.core.$ZodIssue[]

  constructor(endpoint: string, issues: z.core.$ZodIssue[]) {
    const detail = issues
      .slice(0, 3)
      .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '<root>'}: ${issue.message}`)
      .join('; ')
    super(`API shape violation at ${endpoint}: response did not match the expected shape (${detail})`)
    this.name = 'ApiShapeError'
    this.endpoint = endpoint
    this.issues = issues
  }
}

/**
 * Validate `raw` against `schema`. Returns the parsed (and now genuinely
 * typed) value, or throws {@link ApiShapeError} naming `endpoint` and the
 * mismatch. This is the single call every validated client path goes
 * through — `getValidated`/`postValidated` in api.ts, `toResult` in
 * gateway.ts, and every other validated client path all call this same
 * function rather than re-implementing shape checking.
 */
export function validateShape<T>(schema: z.ZodType<T>, raw: unknown, endpoint: string): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new ApiShapeError(endpoint, parsed.error.issues)
  }
  return parsed.data
}

// ---------------------------------------------------------------------------
// Reusable shape fragments for the `.filter`/`.map`-crash class specifically:
// a response that a view treats as an array (or an array under a named key)
// but the backend can legitimately return `null`, `{}`, or an error envelope
// for (a cold cache, an unconfigured capability, a 500 body shaped like
// `{detail: "..."}`). These make "an array-typed value that isn't actually an
// array" unrepresentable past this boundary — ladder step 3.
// ---------------------------------------------------------------------------

/**
 * An array of `item`. Unlike `z.array(item)` alone, this treats `null` /
 * `undefined` (a legitimate "nothing yet" response from several routes) as
 * an empty array rather than a validation failure — the two states a caller
 * actually needs to distinguish are "empty" and "wrong shape entirely", not
 * "empty" and "absent". A non-null, non-array value (`{}`, a string, a
 * number) still fails validation and throws, because THAT is the case the
 * view could not safely `.filter()`/`.map()` over.
 */
export function looseArray<Item extends z.ZodType>(item: Item) {
  return z.preprocess((value) => value ?? [], z.array(item))
}

/** A plain JSON object (including `{}`), rejecting arrays/null/primitives. */
export function looseObject() {
  return z.record(z.string(), z.unknown())
}

/** Anything JSON-shaped; use only where the caller genuinely does not care about shape. */
export const jsonUnknown = z.unknown()

/**
 * Fetch `path` and validate the parsed JSON body against `schema`. This is
 * the drop-in replacement for the `fetch(path).then(r => r.json())` pattern
 * views used directly (bypassing api.ts entirely) — every one of D-WUI-8,
 * -9, -12, -14, -15, -16, -17, -18, -19, -20, -22, -24, -25 and the D-WUI-6
 * update did exactly that. A non-2xx response throws {@link ApiError}
 * (status + body preserved for the caller to render); a 2xx response that
 * fails `schema` throws {@link ApiShapeError} naming this endpoint.
 */
export async function fetchValidated<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const body = await res.text().catch(() => 'Unknown error')
    throw new ApiError(res.status, body)
  }
  const raw: unknown = await res.json()
  return validateShape(schema, raw, path)
}
