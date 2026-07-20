/**
 * @file ObservabilityView.tsx
 * @description Observability dashboard over the gateway `/graph/*` surface.
 *
 * Two panels:
 *   1. PromQL — run an instant/range PromQL query against `/graph/promql` and
 *      render the returned series as an inline SVG line chart (no chart
 *      dependency) plus a raw series table.
 *   2. Traces — search recent traces via `/graph/traces` and render a simple
 *      span waterfall for the selected trace.
 *
 * Both degrade gracefully to a "capability not yet activated" notice when the
 * backend has not wired the dedicated route yet (see lib/gateway.ts).
 */

import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, GitBranch, Loader2, Play, Search } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { gatewayGet, gatewayPost } from '@/lib/gateway'

/** A single metric time-series distilled from the PromQL response. */
interface MetricSeries {
  label: string
  points: { t: number; v: number }[]
}

/** One span in a trace (start/duration are seconds/ms as reported upstream). */
interface TraceSpan {
  name: string
  start: number
  duration: number
  service?: string
  status?: string
}

/** A trace summary + its spans. */
interface TraceRecord {
  trace_id: string
  name?: string
  duration?: number
  span_count?: number
  spans?: TraceSpan[]
}

const DEFAULT_PROMQL = 'rate(kg_requests_total[5m])'

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function asStr(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}

/**
 * Adapt a Prometheus-style response (`data.result[]` with `values`/`value`) or
 * a flat `{series:[{label,points}]}` payload into {@link MetricSeries}[].
 */
function adaptSeries(raw: unknown): MetricSeries[] {
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

/** Minimal dependency-free SVG line chart for a set of series. */
function LineChart({ series }: { series: MetricSeries[] }) {
  const width = 640
  const height = 200
  const pad = 24

  const flat = series.flatMap((s) => s.points)
  if (flat.length === 0) return <p className="text-muted-foreground text-sm">No data points.</p>

  const ts = flat.map((p) => p.t)
  const vs = flat.map((p) => p.v)
  const tMin = Math.min(...ts)
  const tMax = Math.max(...ts)
  const vMin = Math.min(...vs)
  const vMax = Math.max(...vs)
  const tSpan = tMax - tMin || 1
  const vSpan = vMax - vMin || 1

  const x = (t: number) => pad + ((t - tMin) / tSpan) * (width - 2 * pad)
  const y = (v: number) => height - pad - ((v - vMin) / vSpan) * (height - 2 * pad)
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7']

  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className="w-full h-auto"
      role="img"
      aria-label="metric chart"
    >
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="stroke-border" strokeWidth={1} />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="stroke-border" strokeWidth={1} />
      {series.map((s, i) => {
        if (s.points.length === 0) return null
        const pts = s.points.map((p) => `${String(x(p.t))},${String(y(p.v))}`).join(' ')
        const color = colors[i % colors.length]
        return s.points.length === 1 ? (
          <circle key={s.label} cx={x(s.points[0].t)} cy={y(s.points[0].v)} r={3} fill={color} />
        ) : (
          <polyline key={s.label} points={pts} fill="none" stroke={color} strokeWidth={1.5} />
        )
      })}
    </svg>
  )
}

/** Span waterfall for a single trace, positioned by start offset + duration. */
function Waterfall({ trace }: { trace: TraceRecord }) {
  const spans = trace.spans ?? []
  if (spans.length === 0) return <p className="text-muted-foreground text-sm">No spans recorded for this trace.</p>
  const starts = spans.map((s) => s.start)
  const ends = spans.map((s) => s.start + s.duration)
  const t0 = Math.min(...starts)
  const t1 = Math.max(...ends)
  const span = t1 - t0 || 1

  return (
    <div className="space-y-1">
      {spans.map((s, i) => {
        const left = ((s.start - t0) / span) * 100
        const width = Math.max((s.duration / span) * 100, 1)
        const failed = (s.status ?? '').toLowerCase().includes('err')
        return (
          <div key={`${s.name}-${String(i)}`} className="flex items-center gap-2 text-xs">
            <span className="w-40 truncate font-mono text-muted-foreground" title={s.name}>
              {s.name}
            </span>
            <div className="relative flex-1 h-4 rounded bg-muted/40">
              <div
                className={failed ? 'absolute h-4 rounded bg-destructive' : 'absolute h-4 rounded bg-primary'}
                style={{ left: `${String(left)}%`, width: `${String(width)}%` }}
                title={`${s.service ?? 'span'} · ${String(s.duration)}`}
              />
            </div>
            <span className="w-16 text-right font-mono text-muted-foreground">{s.duration}</span>
          </div>
        )
      })}
    </div>
  )
}

function CapabilityNotice({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-50/50 dark:bg-amber-500/10 p-3 flex items-start gap-2 text-sm">
      <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="text-muted-foreground">
        The <span className="font-mono">{label}</span> gateway route is not activated on this backend yet. Wire it in
        <span className="font-mono"> agent_utilities.gateway.graph_api</span> to see live data here.
      </p>
    </div>
  )
}

export default function ObservabilityView() {
  const [promql, setPromql] = useState(DEFAULT_PROMQL)
  const [series, setSeries] = useState<MetricSeries[]>([])
  const [metricLoading, setMetricLoading] = useState(false)
  const [metricUnavailable, setMetricUnavailable] = useState(false)
  const [metricError, setMetricError] = useState<string | null>(null)

  const [traceQuery, setTraceQuery] = useState('')
  const [traces, setTraces] = useState<TraceRecord[]>([])
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceUnavailable, setTraceUnavailable] = useState(false)

  const runPromql = async () => {
    setMetricLoading(true)
    setMetricError(null)
    const now = Math.floor(Date.now() / 1000)
    const r = await gatewayPost<unknown>('/promql', {
      query: promql,
      start: now - 3600,
      end: now,
      step: 60,
    })
    setMetricUnavailable(r.unavailable)
    if (r.ok) setSeries(adaptSeries(r.data))
    else {
      setSeries([])
      if (!r.unavailable) setMetricError(r.error ?? 'Query failed')
    }
    setMetricLoading(false)
  }

  const loadTraces = async () => {
    setTraceLoading(true)
    const qs = traceQuery.trim() ? `?q=${encodeURIComponent(traceQuery.trim())}` : ''
    const r = await gatewayGet<unknown>(`/traces${qs}`)
    setTraceUnavailable(r.unavailable)
    if (r.ok && r.data) {
      const raw = r.data as Record<string, unknown>
      const list = (Array.isArray(raw) ? raw : (raw.traces ?? [])) as Record<string, unknown>[]
      const parsed: TraceRecord[] = list.map((t) => ({
        trace_id: asStr(t.trace_id) || asStr(t.id),
        name: typeof t.name === 'string' ? t.name : undefined,
        duration: typeof t.duration === 'number' ? t.duration : undefined,
        span_count:
          typeof t.span_count === 'number' ? t.span_count : Array.isArray(t.spans) ? t.spans.length : undefined,
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
      setTraces(parsed)
      setSelectedTrace(parsed[0]?.trace_id ?? null)
    } else {
      setTraces([])
      setSelectedTrace(null)
    }
    setTraceLoading(false)
  }

  useEffect(() => {
    void runPromql()
    void loadTraces()
  }, [])

  const activeTrace = useMemo(() => traces.find((t) => t.trace_id === selectedTrace) ?? null, [traces, selectedTrace])

  return (
    <div className="space-y-6" data-testid="observability-view">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="size-6" />
          Observability
        </h1>
        <p className="text-muted-foreground text-sm">PromQL metrics and distributed traces over the KG gateway.</p>
      </div>

      <Tabs defaultValue="metrics">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="metrics" className="gap-2">
            <Activity className="size-4" />
            Metrics (PromQL)
          </TabsTrigger>
          <TabsTrigger value="traces" className="gap-2">
            <GitBranch className="size-4" />
            Traces
          </TabsTrigger>
        </TabsList>

        <TabsContent value="metrics" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>PromQL Query</CardTitle>
                <CardDescription>Runs against `/graph/promql` (last hour, 60s step).</CardDescription>
              </div>
              <Button
                onClick={() => {
                  void runPromql()
                }}
                disabled={metricLoading}
              >
                {metricLoading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Play className="size-4 mr-2" />}
                Run
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                aria-label="PromQL query"
                value={promql}
                onChange={(e) => {
                  setPromql(e.target.value)
                }}
                className="font-mono text-sm"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runPromql()
                }}
              />
              {metricUnavailable ? (
                <CapabilityNotice label="/graph/promql" />
              ) : metricError ? (
                <pre className="rounded border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive whitespace-pre-wrap break-words">
                  {metricError}
                </pre>
              ) : (
                <>
                  <LineChart series={series} />
                  {series.length > 0 && (
                    <div className="rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-2 font-medium">Series</th>
                            <th className="text-left p-2 font-medium">Points</th>
                            <th className="text-left p-2 font-medium">Last value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {series.map((s) => (
                            <tr key={s.label} className="border-t">
                              <td className="p-2 font-mono text-xs">{s.label}</td>
                              <td className="p-2">{s.points.length}</td>
                              <td className="p-2 font-mono">{s.points.at(-1)?.v ?? '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="traces" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Trace Search</CardTitle>
                <CardDescription>Searches `/graph/traces` and renders a span waterfall.</CardDescription>
              </div>
              <Button
                onClick={() => {
                  void loadTraces()
                }}
                disabled={traceLoading}
              >
                {traceLoading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Search className="size-4 mr-2" />}
                Search
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                aria-label="Trace search"
                placeholder="service, operation, or trace id…"
                value={traceQuery}
                onChange={(e) => {
                  setTraceQuery(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void loadTraces()
                }}
              />
              {traceUnavailable ? (
                <CapabilityNotice label="/graph/traces" />
              ) : traces.length === 0 ? (
                <p className="text-muted-foreground text-sm">No traces found.</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-4">
                  <div className="space-y-1">
                    {traces.map((t) => (
                      <button
                        type="button"
                        key={t.trace_id}
                        onClick={() => {
                          setSelectedTrace(t.trace_id)
                        }}
                        className={
                          'w-full text-left rounded border p-2 hover:bg-muted/50 transition-colors ' +
                          (t.trace_id === selectedTrace ? 'bg-accent' : '')
                        }
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate font-mono text-xs">{t.name ?? t.trace_id}</span>
                          <Badge variant="outline">{t.span_count ?? 0}</Badge>
                        </div>
                        {t.duration !== undefined && (
                          <span className="text-xs text-muted-foreground">{t.duration} total</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        {activeTrace?.name ?? activeTrace?.trace_id ?? 'Trace'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>{activeTrace ? <Waterfall trace={activeTrace} /> : null}</CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
