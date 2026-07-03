/**
 * @file queries.ts
 * @description Query helpers + response adapters for the Live Dashboards view.
 *
 * Every call goes through the shared {@link gatewayPost} helper (the SAME typed
 * gateway layer the other `/graph/*` views use) — this module invents no second
 * API mechanism. It targets the engine's observability action-twins:
 *   - PromQL  → `POST /graph/promql`  (real, CONCEPT:KG-2.310 / EG-172,302)
 *   - Traces  → `POST /graph/traces`  (real, CONCEPT:KG-2.310 / EG-163)
 *   - Logs    → `POST /graph/logs`    (NOT yet a REST twin — resolves
 *                `unavailable` and the panel degrades read-only; EG-162)
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
