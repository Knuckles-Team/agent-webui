/**
 * @file transport.ts
 * @description Atlas's HTTP helper: `src/lib/gateway.ts`'s honest-degradation contract,
 * plus the one thing Atlas needs that it does not offer — an `AbortSignal`.
 *
 * Every panel in the workbench re-runs on a filter keystroke. Without cancellation the
 * last response to ARRIVE wins rather than the last one asked for, which shows a user
 * results for a query they have already edited away. `gatewayGet`/`gatewayPost` take no
 * `init`, so Atlas keeps their `{ok, data, unavailable, error}` shape and their
 * 404/501-is-not-an-error rule while threading a signal through.
 *
 * The rules preserved verbatim from `gateway.ts`, because they are the difference
 * between "broken" and "empty" rendering identically:
 *  - HTTP 404/501 → `unavailable`, not an error: the capability is not served yet;
 *  - a body carrying `degraded: true` (au's `engine_surface_tools._degraded`, answered
 *    with HTTP 200) → also `unavailable`, with the backend's own reason;
 *  - the canonical `{status, result}` action-twin envelope is unwrapped.
 */
import type { z } from 'zod'

import { ApiShapeError, validateShape } from '@/lib/api-validation'

export interface AtlasFetchResult<T> {
  ok: boolean
  data: T | null
  /** The route is not served / the engine capability is off. Not an error — a stated absence. */
  unavailable: boolean
  error?: string
}

function unwrapEnvelope(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'result' in raw && 'status' in raw) {
    return (raw as { result: unknown }).result
  }
  return raw
}

function degradedReason(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  if (record.degraded !== true) return null
  return typeof record.error === 'string' ? record.error : 'capability not available'
}

function unavailable<T>(error: string): AtlasFetchResult<T> {
  return { ok: false, data: null, unavailable: true, error }
}

function failed<T>(error: string): AtlasFetchResult<T> {
  return { ok: false, data: null, unavailable: false, error }
}

async function toResult<T>(res: Response, endpoint: string, schema?: z.ZodType<T>): Promise<AtlasFetchResult<T>> {
  if (res.status === 404 || res.status === 501) return unavailable<T>(`HTTP ${String(res.status)}`)
  if (!res.ok) {
    const body = await res.text().catch(() => 'Unknown error')
    return failed<T>(`HTTP ${String(res.status)}: ${body}`)
  }
  const body = unwrapEnvelope(await res.json())
  const degraded = degradedReason(body)
  if (degraded !== null) return unavailable<T>(degraded)
  if (!schema) return { ok: true, data: body as T, unavailable: false }
  try {
    return { ok: true, data: validateShape(schema, body, endpoint), unavailable: false }
  } catch (err) {
    return failed<T>(err instanceof ApiShapeError ? err.message : String(err))
  }
}

async function request<T>(path: string, init: RequestInit, schema?: z.ZodType<T>): Promise<AtlasFetchResult<T>> {
  try {
    return await toResult<T>(await fetch(path, init), path, schema)
  } catch (err) {
    return failed<T>(String(err))
  }
}

/** GET an absolute `/api/...` path with cancellation. */
export function atlasGet<T>(path: string, signal: AbortSignal, schema?: z.ZodType<T>): Promise<AtlasFetchResult<T>> {
  return request<T>(path, { signal }, schema)
}

/** POST a JSON body to an absolute `/api/...` path with cancellation. */
export function atlasPost<T>(
  path: string,
  body: unknown,
  signal: AbortSignal,
  schema?: z.ZodType<T>,
): Promise<AtlasFetchResult<T>> {
  return request<T>(
    path,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal },
    schema,
  )
}
