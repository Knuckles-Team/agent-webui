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
 */

/** Base path for the canonical KG REST surface as mounted in the webui backend. */
export const GRAPH_BASE = '/api/graph'

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

async function toResult<T>(res: Response): Promise<GatewayResult<T>> {
  if (res.status === 404 || res.status === 501) {
    return { ok: false, data: null, unavailable: true, error: `HTTP ${String(res.status)}` }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => 'Unknown error')
    return { ok: false, data: null, unavailable: false, error: `HTTP ${String(res.status)}: ${body}` }
  }
  const raw: unknown = await res.json()
  return { ok: true, data: unwrapEnvelope(raw) as T, unavailable: false }
}

/** GET a gateway route relative to {@link GRAPH_BASE}. */
export async function gatewayGet<T>(path: string): Promise<GatewayResult<T>> {
  try {
    const res = await fetch(`${GRAPH_BASE}${path}`)
    return await toResult<T>(res)
  } catch (err) {
    return { ok: false, data: null, unavailable: false, error: String(err) }
  }
}

/** POST a JSON body to a gateway route relative to {@link GRAPH_BASE}. */
export async function gatewayPost<T>(path: string, body?: unknown): Promise<GatewayResult<T>> {
  try {
    const res = await fetch(`${GRAPH_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    return await toResult<T>(res)
  } catch (err) {
    return { ok: false, data: null, unavailable: false, error: String(err) }
  }
}
