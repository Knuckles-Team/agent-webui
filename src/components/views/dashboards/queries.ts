/**
 * @file queries.ts
 * @description Query helpers + response adapters for the Live Dashboards view.
 *
 * Every call goes through the shared {@link gatewayPost} helper (the SAME typed
 * gateway layer the other `/graph/*` views use) — this module invents no second
 * API mechanism. It targets the engine's observability action-twins:
 *   - PromQL  → `POST /graph/promql`  (real, CONCEPT:KG-2.310 / EG-172,302)
 *   - Traces  → `POST /graph/traces`  (real, CONCEPT:KG-2.310 / EG-163)
 *   - Logs    → `POST /graph/logs`    (route is registered — the previous
 *                HTTP 405 was a genuinely unregistered path, D-W6-ISO-2 — but
 *                the engine build's own log-QUERY surface, distinct from its
 *                log-INGEST listener, doesn't exist on the wire client yet, so
 *                it still answers a clean `{degraded: true}` at HTTP 200 and
 *                the panel still degrades read-only; EG-162)
 *
 * The adapters tolerate several upstream shapes and NEVER fabricate points: an
 * unrecognised/empty payload yields an empty result, not synthetic data.
 */

import { gatewayPost, type GatewayResult } from '@/lib/gateway'

/** A time range expressed as an offset window ending "now". */
export interface TimeRange {
  /** Stable id used in selects. */
  id: string
  /** Human label, e.g. "Last 1 hour". */
  label: string
  /** Window width in seconds. */
  seconds: number
  /** Suggested PromQL range step (e.g. `30s`). */
  step: string
}

/** Selectable dashboard time ranges (Grafana-style quick ranges). */
export const TIME_RANGES: TimeRange[] = [
  { id: '5m', label: 'Last 5 minutes', seconds: 5 * 60, step: '15s' },
  { id: '15m', label: 'Last 15 minutes', seconds: 15 * 60, step: '30s' },
  { id: '1h', label: 'Last 1 hour', seconds: 60 * 60, step: '60s' },
  { id: '6h', label: 'Last 6 hours', seconds: 6 * 60 * 60, step: '300s' },
  { id: '24h', label: 'Last 24 hours', seconds: 24 * 60 * 60, step: '900s' },
]

/** Resolve a {@link TimeRange} to concrete unix-second bounds ending now. */
export function rangeBounds(range: TimeRange, now: number = Date.now()): { start: number; end: number } {
  const end = Math.floor(now / 1000)
  return { start: end - range.seconds, end }
}

/** A single metric time-series distilled from a PromQL response. */
export interface MetricSeries {
  label: string
  points: { t: number; v: number }[]
}

/** One log line from the (future) log-query surface. */
export interface LogLine {
  timestamp: number
  message: string
  level?: string
  stream?: string
}

/** One span in a trace. */
export interface TraceSpan {
  name: string
  start: number
  duration: number
  service?: string
  status?: string
}

/** A trace summary + its spans. */
export interface TraceRecord {
  trace_id: string
  name?: string
  duration?: number
  span_count?: number
  spans?: TraceSpan[]
}

export function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

export function asStr(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}

/**
 * Adapt a Prometheus-style response (`data.result[]` with `values`/`value`) or
 * a flat `{series:[{label,points}]}` payload into {@link MetricSeries}[].
 */
export function adaptSeries(raw: unknown): MetricSeries[] {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>

  // Flat shape: { series: [{ label, points:[{t,v}] }] }
  if (Array.isArray(obj.series)) {
    return (obj.series as Record<string, unknown>[]).map((s, i) => ({
      label: typeof s.label === 'string' ? s.label : `series ${String(i + 1)}`,
      points: Array.isArray(s.points)
        ? (s.points as Record<string, unknown>[]).map((p) => ({ t: asNumber(p.t), v: asNumber(p.v) }))
        : [],
    }))
  }

  // Prometheus shape: { data: { result: [{ metric, values:[[t,v]] | value:[t,v] }] } }
  const data = obj.data as Record<string, unknown> | undefined
  const result = (data?.result ?? obj.result) as Record<string, unknown>[] | undefined
  if (!Array.isArray(result)) return []
  return result.map((r, i) => {
    const metric = r.metric as Record<string, unknown> | undefined
    const metricLabel = metric ? Object.values(metric).find((v): v is string => typeof v === 'string') : undefined
    const label = metricLabel ?? `series ${String(i + 1)}`
    const values = r.values as [unknown, unknown][] | undefined
    const single = r.value as [unknown, unknown] | undefined
    const rows = values ?? (single ? [single] : [])
    return { label, points: rows.map(([t, v]) => ({ t: asNumber(t), v: asNumber(v) })) }
  })
}

/** Adapt an upstream log payload into {@link LogLine}[] (never fabricates). */
export function adaptLogs(raw: unknown): LogLine[] {
  if (!raw) return []
  const list = (Array.isArray(raw) ? raw : ((raw as Record<string, unknown>).logs ?? [])) as unknown
  if (!Array.isArray(list)) return []
  return (list as Record<string, unknown>[]).map((l) => ({
    timestamp: asNumber(l.timestamp ?? l.time ?? l.ts),
    message: asStr(l.message ?? l.msg ?? l.line ?? l.body),
    level: typeof l.level === 'string' ? l.level : typeof l.severity === 'string' ? l.severity : undefined,
    stream: typeof l.stream === 'string' ? l.stream : typeof l.source === 'string' ? l.source : undefined,
  }))
}

/** Adapt an upstream trace payload into {@link TraceRecord}[]. */
export function adaptTraces(raw: unknown): TraceRecord[] {
  if (!raw) return []
  const list = (Array.isArray(raw) ? raw : ((raw as Record<string, unknown>).traces ?? [])) as unknown
  if (!Array.isArray(list)) return []
  return (list as Record<string, unknown>[]).map((t) => ({
    trace_id: asStr(t.trace_id) || asStr(t.id),
    name: typeof t.name === 'string' ? t.name : undefined,
    duration: typeof t.duration === 'number' ? t.duration : undefined,
    span_count: typeof t.span_count === 'number' ? t.span_count : Array.isArray(t.spans) ? t.spans.length : undefined,
    spans: Array.isArray(t.spans)
      ? (t.spans as Record<string, unknown>[]).map((s) => ({
          name: asStr(s.name, 'span'),
          start: asNumber(s.start),
          duration: asNumber(s.duration),
          service: typeof s.service === 'string' ? s.service : undefined,
          status: typeof s.status === 'string' ? s.status : undefined,
        }))
      : undefined,
  }))
}

/**
 * Run a range PromQL query over `POST /graph/promql`.
 *
 * Body mirrors the `graph_promql` action-twin contract: `action='range'` with
 * unix-second `start`/`end` and a PromQL `step` (e.g. `30s`).
 */
export async function queryPromql(query: string, range: TimeRange): Promise<GatewayResult<unknown>> {
  const { start, end } = rangeBounds(range)
  return gatewayPost<unknown>('/promql', {
    action: 'range',
    query,
    start: String(start),
    end: String(end),
    step: range.step,
  })
}

/**
 * Search traces over `POST /graph/traces` (the `graph_traces` action-twin).
 * A blank `query` returns the most recent traces (capped by `limit`).
 */
export async function queryTraces(query: string, limit = 20): Promise<GatewayResult<unknown>> {
  const body: Record<string, unknown> = { action: 'search', limit }
  if (query.trim()) body.query = query.trim()
  return gatewayPost<unknown>('/traces', body)
}

/**
 * Query the log surface over `POST /graph/logs`.
 *
 * NOTE: this route is not yet wired as a gateway REST twin (only PromQL/traces
 * are exposed from the engine observability surface today). The call therefore
 * resolves to `{ unavailable: true }` and the Logs panel renders a read-only
 * placeholder rather than fabricating log lines.
 */
// ── Native visualization (D-VZ-1 V5, graph_viz) ─────────────────────────────

/** Marks a flat SQL result set can drive (matches `_VIZ_QUERY_MARKS` in
 * `agent_utilities/mcp/tools/engine_surface_tools.py` — 'graph' node-link
 * marks need a node/edge dataset shape a query row set can't provide, so
 * they're intentionally excluded from this panel). */
export const VIZ_MARKS = ['scatter', 'line', 'bar', 'area', 'heatmap'] as const
export type VizMark = (typeof VIZ_MARKS)[number]

export interface VizPlotParams {
  query: string
  mark: VizMark
  xField: string
  yField: string
  colorField?: string
  sizeField?: string
  title?: string
  widthPx?: number
  heightPx?: number
  format?: 'png' | 'svg' | 'pdf'
}

/**
 * Render a chart from a live KG SQL query over `POST /graph/viz`
 * (`graph_viz` action='plot_from_query', D-VZ-1 V5, the `agent_utilities`
 * MCP tool's REST twin). The engine build/route ITSELF being unavailable
 * (404/501, or the tools' own `{degraded: true}` shape) is already resolved
 * to `unavailable: true` by `gatewayPost`'s envelope handling; a query that
 * ran fine but returned zero rows for the requested fields carries its OWN
 * `{unavailable: true, reason}` inside `data` — see {@link vizUnavailableReason}.
 */
export async function plotFromQuery(params: VizPlotParams): Promise<GatewayResult<unknown>> {
  return gatewayPost<unknown>('/viz', {
    action: 'plot_from_query',
    query: params.query,
    mark: params.mark,
    x_field: params.xField,
    y_field: params.yField,
    color_field: params.colorField ?? '',
    size_field: params.sizeField ?? '',
    title: params.title ?? '',
    width_px: params.widthPx ?? 900,
    height_px: params.heightPx ?? 560,
    format: params.format ?? 'png',
  })
}

/** When a successful (HTTP 200, `ok: true`) `graph_viz` response body is the
 * tool's own explicit "the query returned no usable rows" answer, return the
 * backend's reason string; otherwise `null` — this is the "0 rows is real
 * information, not route unavailability" case `gatewayPost`'s own
 * `unavailable` flag does not cover (that only catches a missing/degraded
 * ROUTE, not an empty RESULT), so the panel must check for it explicitly
 * rather than render nothing and call it done. */
export function vizUnavailableReason(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const rec = body as Record<string, unknown>
  if (rec.unavailable !== true) return null
  return typeof rec.reason === 'string' ? rec.reason : 'the query returned no usable rows'
}

/** One rendered chart, decoded from a successful `graph_viz` response body
 * (`plot_from_query`/`export_chart`). `null` for any shape this doesn't
 * recognise — never guesses at an image from a partial/malformed payload. */
export interface VizRenderInfo {
  dataUrl: string
  format: string
  exact: boolean
  lodTier: string
  rowCount: number
  rowsReturned?: number
  rowsRendered?: number
  wallTimeMs?: number
}

/** Decode the base64 image payload out of a `graph_viz` `result.bytes`
 * envelope, or `undefined` for any shape that isn't one. */
function extractVizBase64(result: Record<string, unknown>): string | undefined {
  const bytesField = result.bytes as Record<string, unknown> | undefined
  return bytesField && typeof bytesField.__bytes_b64__ === 'string' ? bytesField.__bytes_b64__ : undefined
}

/** LOD/exactness/row-count fields decoded from `result.view_result`. */
function extractVizViewFields(viewResult: Record<string, unknown>): {
  exact: boolean
  lodTier: string
  rowCount: number
  wallTimeMs?: number
} {
  return {
    exact: viewResult.exact === true,
    lodTier: typeof viewResult.lod_tier === 'string' ? viewResult.lod_tier : 'unknown',
    rowCount: typeof viewResult.row_count === 'number' ? viewResult.row_count : 0,
    wallTimeMs: typeof viewResult.wall_time_ms === 'number' ? viewResult.wall_time_ms : undefined,
  }
}

/** Top-level row-count telemetry the tool reports alongside `result`. */
function extractVizRowCounts(rec: Record<string, unknown>): { rowsReturned?: number; rowsRendered?: number } {
  return {
    rowsReturned: typeof rec.rows_returned === 'number' ? rec.rows_returned : undefined,
    rowsRendered: typeof rec.rows_rendered === 'number' ? rec.rows_rendered : undefined,
  }
}

export function adaptVizResult(body: unknown): VizRenderInfo | null {
  if (!body || typeof body !== 'object') return null
  const rec = body as Record<string, unknown>
  const result = rec.result as Record<string, unknown> | undefined
  if (!result || typeof result !== 'object') return null
  const b64 = extractVizBase64(result)
  if (!b64) return null
  const contentType = typeof result.content_type === 'string' ? result.content_type : 'application/octet-stream'
  const viewResult = (result.view_result ?? {}) as Record<string, unknown>
  return {
    dataUrl: `data:${contentType};base64,${b64}`,
    format: typeof result.format === 'string' ? result.format : 'png',
    ...extractVizViewFields(viewResult),
    ...extractVizRowCounts(rec),
  }
}

export async function queryLogs(
  stream: string,
  range: TimeRange,
  filter: string,
  limit = 200,
): Promise<GatewayResult<unknown>> {
  const { start, end } = rangeBounds(range)
  const body: Record<string, unknown> = {
    action: 'query',
    start: String(start),
    end: String(end),
    limit,
  }
  if (stream.trim()) body.stream = stream.trim()
  if (filter.trim()) body.query = filter.trim()
  return gatewayPost<unknown>('/logs', body)
}
