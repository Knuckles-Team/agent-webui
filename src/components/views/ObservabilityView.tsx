/**
 * @file ObservabilityView.tsx
 * @description Observability dashboard over the gateway `/graph/*` surface.
 *
 * Two panels:
 *   1. PromQL — run an instant/range PromQL query against `/graph/promql` and
 *      render the returned series as an inline SVG line chart (no chart
 *      dependency) plus a raw series table.
 *   2. Runs — chat/agent execution runs, backed by the ALWAYS-ON KG-native
 *      trace sink via `POST /graph/traces` (`agent_utilities.mcp.tools
 *      .engine_surface_tools.graph_traces`, action `search`/`waterfall`).
 *      Each run is one KG trace; selecting one fetches its `waterfall` —
 *      a flattened Span/Generation node list with a `parentId` per node —
 *      and renders it as a nested-duration DAG (there is no independent
 *      `/api/runs` platform; this IS the run/DAG surface, see PROGRAM.md
 *      Phase D).
 *
 * Both degrade gracefully to a "capability not yet activated" notice when the
 * backend has not wired the dedicated route yet (see lib/gateway.ts), and
 * that "route not activated" state is always rendered distinctly from a
 * genuinely empty result set — never collapsed into the same blank panel.
 */

import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, ChevronRight, GitBranch, Loader2, Play, Search, Workflow } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { gatewayPost } from '@/lib/gateway'

/** A single metric time-series distilled from the PromQL response. */
interface MetricSeries {
  label: string
  points: { t: number; v: number }[]
}

/** One row from `graph_traces action='search'` — one execution run per trace. */
interface RunRow {
  trace_id: string
  name?: string
  status?: string
  duration?: number
  error?: string
}

/** One Span/Generation node from `graph_traces action='waterfall'`. Durations are
 * NESTED (each node's own latency relative to its parent), not absolute offsets —
 * the KG-native trace sink never fabricates concurrent start times it doesn't have. */
interface DagNode {
  id: string
  parentId: string | null
  kind: string
  name: string
  latencyMs: number
  error?: string | null
  model?: string
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
}

/** A run's summary header + its full DAG (`graph_traces action='waterfall'`'s `result`). */
interface RunWaterfall {
  trace: {
    id: string
    name?: string
    status?: string
    latencyMs?: number | null
    costUsd?: number
    inputTokens?: number
    outputTokens?: number
    toolCalls?: number
  }
  nodes: DagNode[]
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

/** Unwrap the `graph_traces`/`graph_promql` engine-surface tools' own
 * `{surface, action, result}` envelope, which sits one layer inside the
 * canonical `{status, result}` envelope `gatewayPost` already strips (see
 * `lib/gateway.ts`'s `isDegradedSurfacePayload` doc comment). Returns `null`
 * for a shape that doesn't match (defensive — never throws on live data). */
function surfaceResult(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  return 'result' in obj ? obj.result : null
}

function adaptRunRows(raw: unknown): RunRow[] {
  const result = surfaceResult(raw)
  if (!Array.isArray(result)) return []
  return (result as Record<string, unknown>[]).map((r) => ({
    trace_id: asStr(r.trace_id) || asStr(r.id),
    name: typeof r.name === 'string' ? r.name : undefined,
    status: typeof r.status === 'string' ? r.status : undefined,
    duration: typeof r.duration === 'number' ? r.duration : undefined,
    error: typeof r.error === 'string' ? r.error : undefined,
  }))
}

function adaptWaterfall(raw: unknown, fallbackId: string): RunWaterfall | null {
  const result = surfaceResult(raw)
  if (!result || typeof result !== 'object') return null
  const obj = result as Record<string, unknown>
  const t = (obj.trace ?? {}) as Record<string, unknown>
  const nodesRaw = Array.isArray(obj.nodes) ? (obj.nodes as Record<string, unknown>[]) : []
  return {
    trace: {
      id: asStr(t.id, fallbackId),
      name: typeof t.name === 'string' ? t.name : undefined,
      status: typeof t.status === 'string' ? t.status : undefined,
      latencyMs: typeof t.latencyMs === 'number' ? t.latencyMs : null,
      costUsd: typeof t.costUsd === 'number' ? t.costUsd : undefined,
      inputTokens: typeof t.inputTokens === 'number' ? t.inputTokens : undefined,
      outputTokens: typeof t.outputTokens === 'number' ? t.outputTokens : undefined,
      toolCalls: typeof t.toolCalls === 'number' ? t.toolCalls : undefined,
    },
    nodes: nodesRaw.map((n) => ({
      id: asStr(n.id),
      parentId: typeof n.parentId === 'string' ? n.parentId : null,
      kind: asStr(n.kind, 'span'),
      name: asStr(n.name, 'unnamed'),
      latencyMs: asNumber(n.latencyMs),
      error: typeof n.error === 'string' ? n.error : null,
      model: typeof n.model === 'string' ? n.model : undefined,
      costUsd: typeof n.costUsd === 'number' ? n.costUsd : undefined,
      inputTokens: typeof n.inputTokens === 'number' ? n.inputTokens : undefined,
      outputTokens: typeof n.outputTokens === 'number' ? n.outputTokens : undefined,
    })),
  }
}

/** One node in the rendered DAG, recursively rendering its own children (looked
 * up from `childrenByParent`) so the tree is a single self-contained component
 * rather than a coordinator/row split. */
function DagNodeRow({
  node,
  depth,
  childrenByParent,
}: {
  node: DagNode
  depth: number
  childrenByParent: Map<string, DagNode[]>
}) {
  const [open, setOpen] = useState(true)
  const kids = childrenByParent.get(node.id) ?? []
  const failed = node.error != null && node.error !== ''
  return (
    <li>
      <div
        className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/40"
        style={{ paddingLeft: `${String(depth * 16)}px` }}
      >
        {kids.length > 0 ? (
          <button
            type="button"
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => {
              setOpen((v) => !v)
            }}
            className="shrink-0 text-muted-foreground"
          >
            <ChevronRight className={open ? 'size-3 rotate-90 transition-transform' : 'size-3 transition-transform'} />
          </button>
        ) : (
          <span className="inline-block size-3 shrink-0" />
        )}
        <Badge variant={failed ? 'destructive' : 'outline'} className="shrink-0 font-mono text-[10px]">
          {node.kind}
        </Badge>
        <span className="truncate font-mono" title={node.name}>
          {node.name}
        </span>
        {node.model && <span className="shrink-0 text-muted-foreground">({node.model})</span>}
        <span className="ml-auto shrink-0 font-mono text-muted-foreground">{node.latencyMs}ms</span>
        {typeof node.costUsd === 'number' && (
          <span className="shrink-0 font-mono text-muted-foreground">${node.costUsd.toFixed(4)}</span>
        )}
      </div>
      {failed && (
        <div
          className="text-destructive/90 truncate text-[11px]"
          style={{ paddingLeft: `${String(depth * 16 + 24)}px` }}
        >
          {node.error}
        </div>
      )}
      {open && kids.length > 0 && (
        <ul>
          {kids.map((child) => (
            <DagNodeRow key={child.id} node={child} depth={depth + 1} childrenByParent={childrenByParent} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Render a run's Span/Generation nodes as a nested-duration DAG, built from each
 * node's `parentId` (the KG-native sink reports nesting, not concurrent start
 * offsets — see {@link RunWaterfall}'s doc comment). Never assumes a single root:
 * any node whose parent isn't itself in the node set is rendered at depth 0 too,
 * so a malformed/partial graph still shows every node rather than silently
 * dropping some. */
function RunDag({ waterfall }: { waterfall: RunWaterfall }) {
  const { trace, nodes } = waterfall
  if (nodes.length === 0) return <p className="text-muted-foreground text-sm">No spans recorded for this run.</p>

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const childrenByParent = new Map<string, DagNode[]>()
  const roots: DagNode[] = []
  for (const node of nodes) {
    const parent = node.parentId
    if (parent && parent !== trace.id && byId.has(parent)) {
      const list = childrenByParent.get(parent) ?? []
      list.push(node)
      childrenByParent.set(parent, list)
    } else {
      roots.push(node)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-md bg-muted/40 p-2">
          <div className="text-muted-foreground">Status</div>
          <div className="font-semibold">{trace.status ?? '—'}</div>
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <div className="text-muted-foreground">Latency</div>
          <div className="font-semibold">{trace.latencyMs ?? '—'}ms</div>
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <div className="text-muted-foreground">Tool calls</div>
          <div className="font-semibold">{trace.toolCalls ?? nodes.length}</div>
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <div className="text-muted-foreground">Cost</div>
          <div className="font-semibold">{trace.costUsd ? `$${trace.costUsd.toFixed(4)}` : '—'}</div>
        </div>
      </div>
      <ul className="max-h-96 space-y-0.5 overflow-auto rounded-md border p-2" aria-label="Run execution DAG">
        {roots.map((node) => (
          <DagNodeRow key={node.id} node={node} depth={0} childrenByParent={childrenByParent} />
        ))}
      </ul>
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

  const [runQuery, setRunQuery] = useState('')
  const [runs, setRuns] = useState<RunRow[]>([])
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsUnavailable, setRunsUnavailable] = useState(false)

  const [dag, setDag] = useState<RunWaterfall | null>(null)
  const [dagLoading, setDagLoading] = useState(false)
  const [dagUnavailable, setDagUnavailable] = useState(false)
  const [dagError, setDagError] = useState<string | null>(null)

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

  /** List execution runs — each KG-native trace IS one run (one chat/agent-graph
   * execution): `POST /graph/traces {action:'search'}` (`graph_traces`,
   * CONCEPT:AU-KG.coordination.engine-message-broker). There is no separate
   * `/api/runs` platform (see PROGRAM.md Phase D) — this is the run list. */
  const loadRuns = async () => {
    setRunsLoading(true)
    const r = await gatewayPost<unknown>('/traces', { action: 'search', query: runQuery.trim(), limit: 50 })
    setRunsUnavailable(r.unavailable)
    if (r.ok) {
      const parsed = adaptRunRows(r.data)
      setRuns(parsed)
      setSelectedRun(parsed[0]?.trace_id ?? null)
    } else {
      setRuns([])
      setSelectedRun(null)
    }
    setRunsLoading(false)
  }

  /** Fetch one run's full DAG: `POST /graph/traces {action:'waterfall', trace_id}`
   * — the same tool's flattened Span/Generation node list, parent-linked. */
  const loadDag = async (traceId: string) => {
    setDagLoading(true)
    setDagError(null)
    const r = await gatewayPost<unknown>('/traces', { action: 'waterfall', trace_id: traceId })
    setDagUnavailable(r.unavailable)
    if (r.ok) {
      const parsed = adaptWaterfall(r.data, traceId)
      setDag(parsed)
      if (!parsed && !r.unavailable) setDagError('Run DAG response did not match the expected shape.')
    } else {
      setDag(null)
      if (!r.unavailable) setDagError(r.error ?? 'Failed to load run DAG')
    }
    setDagLoading(false)
  }

  useEffect(() => {
    void runPromql()
    void loadRuns()
  }, [])

  useEffect(() => {
    if (selectedRun) void loadDag(selectedRun)
    else setDag(null)
  }, [selectedRun])

  return (
    <div className="space-y-6" data-testid="observability-view">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="size-6" />
          Observability
        </h1>
        <p className="text-muted-foreground text-sm">
          PromQL metrics and chat/agent-graph execution runs over the KG gateway.
        </p>
      </div>

      <Tabs defaultValue="metrics">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="metrics" className="gap-2">
            <Activity className="size-4" />
            Metrics (PromQL)
          </TabsTrigger>
          <TabsTrigger value="runs" className="gap-2">
            <GitBranch className="size-4" />
            Runs
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

        <TabsContent value="runs" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Execution Runs</CardTitle>
                <CardDescription>
                  Chat and agent-graph execution runs, from `/graph/traces` — select one to see its DAG.
                </CardDescription>
              </div>
              <Button
                onClick={() => {
                  void loadRuns()
                }}
                disabled={runsLoading}
              >
                {runsLoading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Search className="size-4 mr-2" />}
                Search
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                aria-label="Run search"
                placeholder="service, operation, or trace id…"
                value={runQuery}
                onChange={(e) => {
                  setRunQuery(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void loadRuns()
                }}
              />
              {runsUnavailable ? (
                <CapabilityNotice label="/graph/traces" />
              ) : runs.length === 0 ? (
                <p className="text-muted-foreground text-sm" data-testid="observability-runs-empty">
                  {runsLoading ? 'Loading runs…' : 'No runs found.'}
                </p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-4">
                  <div className="space-y-1" aria-label="Run list">
                    {runs.map((run) => (
                      <button
                        type="button"
                        key={run.trace_id}
                        onClick={() => {
                          setSelectedRun(run.trace_id)
                        }}
                        className={
                          'w-full text-left rounded border p-2 hover:bg-muted/50 transition-colors ' +
                          (run.trace_id === selectedRun ? 'bg-accent' : '')
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-xs">{run.name ?? run.trace_id}</span>
                          {run.status && (
                            <Badge variant={run.status.toLowerCase().includes('err') ? 'destructive' : 'outline'}>
                              {run.status}
                            </Badge>
                          )}
                        </div>
                        {run.duration !== undefined && (
                          <span className="text-xs text-muted-foreground">{run.duration} total</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Workflow className="size-4" />
                        {dag?.trace.name ?? selectedRun ?? 'Run DAG'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {dagLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" /> Loading run DAG…
                        </div>
                      ) : dagUnavailable ? (
                        <CapabilityNotice label="/graph/traces (waterfall)" />
                      ) : dagError ? (
                        <pre className="rounded border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive whitespace-pre-wrap break-words">
                          {dagError}
                        </pre>
                      ) : dag ? (
                        <RunDag waterfall={dag} />
                      ) : (
                        <p className="text-muted-foreground text-sm">Select a run to see its execution DAG.</p>
                      )}
                    </CardContent>
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
