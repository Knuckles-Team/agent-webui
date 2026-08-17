/**
 * @file gateway.ts
 * @description Thin client for the canonical Agent-Utilities Knowledge-Graph
 * REST surface (`/graph/*`).
 *
 * The webui backend mounts the SAME canonical gateway route table the API
 * gateway serves (`server.py` → `register_graph_routes(app, prefix='/api')`),
 * so every `/graph/*` route is reachable from the browser at `/api/graph/*`
 * (the Vite dev server proxies `/api` to the backend). These helpers wrap those
 * routes with:
 *   - envelope unwrapping for the canonical `{status, result}` action-twin shape,
 *   - a graceful `unavailable` flag when a capability route is not (yet) served
 *     (404 / 501), so views can render a "capability not yet activated" state
 *     instead of a hard error.
 *
 * The newer capability routes surfaced here (observability PromQL/traces,
 * message broker, KV-cache, federated search, GIS, agent-memory, NL→query and
 * data-analyst) are additive: where the backend has not yet wired a dedicated
 * route the call resolves to `{ unavailable: true }` and the view degrades.
 *
 * A second chokepoint, unified with the first (PROGRAM.md R2): `toResult`
 * takes an OPTIONAL zod schema and, when given one, validates the unwrapped
 * payload through the same `validateShape` boundary `api.ts`'s
 * `getValidated`/`postValidated` use (`./api-validation`) before it becomes
 * `data`. A shape mismatch resolves `ok: false` with a message naming the
 * endpoint and the violation — the same "fail loudly at the boundary,
 * never hand a view an `unknown`" contract, expressed through this module's
 * own `{ok, data, unavailable, error}` result shape instead of a thrown
 * exception (callers here already branch on `ok`, so a thrown error would be
 * a second, inconsistent failure channel for the same module).
 */
import type { z } from 'zod'
import { validateShape, ApiShapeError } from './api-validation'

/** Base path for the canonical KG REST surface as mounted in the webui backend. */
export const GRAPH_BASE = '/api/graph'

/**
 * Base path for the webui backend API surface as a whole — the dashboard plane
 * (`/api/dashboard/*`, e.g. shard topology + daemon status) and the enhanced
 * plane (`/api/enhanced/*`, e.g. graph stats). Distinct from {@link GRAPH_BASE}
 * which targets only the canonical `/graph/*` action-twin routes.
 */
export const API_BASE = '/api'

/** Result envelope returned by every gateway helper. */
export interface GatewayResult<T> {
  /** True when the request succeeded and `data` is populated. */
  ok: boolean
  /** Parsed (and envelope-unwrapped) payload, or `null` on failure. */
  data: T | null
  /**
   * True when the route is not served yet (HTTP 404/501). Distinct from a
   * genuine error so views can show an "activate this capability" hint.
   */
  unavailable: boolean
  /** Human-readable error string when `ok` is false. */
  error?: string
}

/** Unwrap the canonical `{status, result}` action-twin envelope when present. */
function unwrapEnvelope(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'result' in raw && 'status' in raw) {
    return (raw as { result: unknown }).result
  }
  return raw
}

/**
 * True when an already-unwrapped body is the engine-surface tools'
 * `_degraded(...)` payload (`agent_utilities/mcp/tools/engine_surface_tools.py`):
 * `{surface, action, degraded: true, error, tried}`. These tools (PromQL,
 * traces, logs, …) never raise on a missing engine capability — they answer
 * HTTP 200 with this shape instead — so an unwrapped body must be inspected
 * for it explicitly; the HTTP-status check above only ever catches a route
 * that isn't REGISTERED at all (404/501), not one that answered but degraded.
 * Without this, a degraded capability rendered identically to a genuinely
 * empty result (D-W6-10's same "broken vs. empty" defect, one layer up).
 */
function isDegradedSurfacePayload(unwrapped: unknown): boolean {
  return !!unwrapped && typeof unwrapped === 'object' && (unwrapped as Record<string, unknown>).degraded === true
}

async function toResult<T>(res: Response, endpoint: string, schema?: z.ZodType<T>): Promise<GatewayResult<T>> {
  if (res.status === 404 || res.status === 501) {
    return { ok: false, data: null, unavailable: true, error: `HTTP ${String(res.status)}` }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => 'Unknown error')
    return { ok: false, data: null, unavailable: false, error: `HTTP ${String(res.status)}: ${body}` }
  }
  const raw: unknown = await res.json()
  const unwrapped = unwrapEnvelope(raw)
  if (isDegradedSurfacePayload(unwrapped)) {
    const detail = (unwrapped as Record<string, unknown>).error
    return {
      ok: false,
      data: null,
      unavailable: true,
      error: typeof detail === 'string' ? detail : 'capability not available',
    }
  }
  if (!schema) return { ok: true, data: unwrapped as T, unavailable: false }
  try {
    return { ok: true, data: validateShape(schema, unwrapped, endpoint), unavailable: false }
  } catch (err) {
    const message = err instanceof ApiShapeError ? err.message : String(err)
    return { ok: false, data: null, unavailable: false, error: message }
  }
}

/**
 * GET a gateway route relative to {@link GRAPH_BASE}. When `schema` is given,
 * the unwrapped payload is validated through the shared `./api-validation`
 * boundary before `data` is populated — a shape mismatch resolves
 * `ok: false` with a descriptive `error` rather than handing the caller an
 * `unknown` cast to `T`.
 */
export async function gatewayGet<T>(path: string, schema?: z.ZodType<T>): Promise<GatewayResult<T>> {
  try {
    const res = await fetch(`${GRAPH_BASE}${path}`)
    return await toResult<T>(res, `${GRAPH_BASE}${path}`, schema)
  } catch (err) {
    return { ok: false, data: null, unavailable: false, error: String(err) }
  }
}

/** POST a JSON body to a gateway route relative to {@link GRAPH_BASE}. See {@link gatewayGet} for `schema`. */
export async function gatewayPost<T>(path: string, body?: unknown, schema?: z.ZodType<T>): Promise<GatewayResult<T>> {
  try {
    const res = await fetch(`${GRAPH_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    return await toResult<T>(res, `${GRAPH_BASE}${path}`, schema)
  } catch (err) {
    return { ok: false, data: null, unavailable: false, error: String(err) }
  }
}

/**
 * GET an arbitrary `/api/...` route (relative to {@link API_BASE}) — e.g.
 * `/dashboard/daemon/shards` or `/enhanced/graph/stats`. Shares the same
 * envelope-unwrapping + graceful `unavailable` handling as {@link gatewayGet},
 * so the Admin console reads the dashboard/enhanced planes with one mechanism.
 * See {@link gatewayGet} for `schema`.
 */
export async function apiGet<T>(path: string, schema?: z.ZodType<T>): Promise<GatewayResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`)
    return await toResult<T>(res, `${API_BASE}${path}`, schema)
  } catch (err) {
    return { ok: false, data: null, unavailable: false, error: String(err) }
  }
}

/** POST a JSON body to an arbitrary `/api/...` route (relative to {@link API_BASE}). See {@link gatewayGet} for `schema`. */
export async function apiPost<T>(path: string, body?: unknown, schema?: z.ZodType<T>): Promise<GatewayResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    return await toResult<T>(res, `${API_BASE}${path}`, schema)
  } catch (err) {
    return { ok: false, data: null, unavailable: false, error: String(err) }
  }
}

/**
 * POST a `FormData` body (a file upload) to an arbitrary `/api/...` route
 * (relative to {@link API_BASE}) — e.g. `/enhanced/voice/transcribe`. Shares
 * {@link apiPost}'s envelope-unwrapping and graceful `unavailable` (404/501)
 * handling; the only difference is the body shape (no JSON `Content-Type`,
 * so the browser sets its own multipart boundary). See {@link gatewayGet}
 * for `schema`.
 */
export async function apiPostForm<T>(
  path: string,
  formData: FormData,
  schema?: z.ZodType<T>,
): Promise<GatewayResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: formData })
    return await toResult<T>(res, `${API_BASE}${path}`, schema)
  } catch (err) {
    return { ok: false, data: null, unavailable: false, error: String(err) }
  }
}
