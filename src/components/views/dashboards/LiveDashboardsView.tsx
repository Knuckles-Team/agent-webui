/**
 * @file LiveDashboardsView.tsx
 * @description Grafana-style "Live dashboards" shell over the engine observability
 * query APIs. Composes add/removable panels (PromQL metrics, logs, traces) with a
 * shared time-range selector and an auto-refresh interval. Every panel calls the
 * canonical gateway `/graph/*` surface via the shared typed layer (lib/gateway.ts).
 *
 * Panel → API wiring:
 *   - Metrics (PromQL): POST /graph/promql — LIVE (EG-172/302, KG-2.310)
 *   - Traces:           POST /graph/traces — LIVE (EG-163, KG-2.310)
 *   - Logs:             POST /graph/logs   — PLACEHOLDER / read-only until the
 *                       engine log-query surface (EG-162) is exposed as a REST twin.
 *   - Chart (viz):      POST /graph/viz    — LIVE (GOC-88, D-VZ-1 V5): renders a
 *                       live KG SQL query server-side through the eg-viz LOD
 *                       pipeline (`Method::Viz`) — no client-side charting
 *                       library, no matplotlib.
 *
 * Default metric panels query the engine's OWN telemetry (`src/metrics.rs`):
 * `epistemic_graph_requests_total{op}` (counter) and
 * `epistemic_graph_request_duration_seconds{op}` (histogram) — the "op rate" and
 * "p50/p99 latency" panels the Admin/Dashboards MVP calls for.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutDashboard, LineChartIcon, Plus, ScrollTextIcon, GitBranchIcon, ImageIcon } from 'lucide-react'
import { nanoid } from 'nanoid'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PromqlPanel } from './PromqlPanel'
import { LogsPanel } from './LogsPanel'
import { TracesPanel } from './TracesPanel'
import { VizPanel } from './VizPanel'
import { TIME_RANGES, type TimeRange, type VizMark } from './queries'

type PanelType = 'promql' | 'logs' | 'traces' | 'viz'

interface PanelSpec {
  id: string
  type: PanelType
  title: string
  query: string
  /** 'viz' panels only — mark + x/y fields, packed as "mark|x|y" (kept as a
   * single string so PanelSpec stays one flat shape across all panel types). */
  vizSpec?: string
}

/** Auto-refresh interval options (seconds; 0 = off). */
const REFRESH_INTERVALS: { id: string; label: string; seconds: number }[] = [
  { id: 'off', label: 'Off', seconds: 0 },
  { id: '5s', label: '5s', seconds: 5 },
  { id: '10s', label: '10s', seconds: 10 },
  { id: '30s', label: '30s', seconds: 30 },
  { id: '60s', label: '60s', seconds: 60 },
]

// Real engine metric names (src/metrics.rs in epistemic-graph) — NOT placeholders.
const DEFAULT_OP_RATE_QUERY = 'sum(rate(epistemic_graph_requests_total[5m]))'
const DEFAULT_P50_QUERY =
  'histogram_quantile(0.50, sum(rate(epistemic_graph_request_duration_seconds_bucket[5m])) by (le))'
const DEFAULT_P99_QUERY =
  'histogram_quantile(0.99, sum(rate(epistemic_graph_request_duration_seconds_bucket[5m])) by (le))'

function defaultPanels(): PanelSpec[] {
  return [
    { id: nanoid(6), type: 'promql', title: 'Engine op rate', query: DEFAULT_OP_RATE_QUERY },
    { id: nanoid(6), type: 'promql', title: 'p50 latency', query: DEFAULT_P50_QUERY },
    { id: nanoid(6), type: 'promql', title: 'p99 latency', query: DEFAULT_P99_QUERY },
    { id: nanoid(6), type: 'logs', title: 'Logs', query: '' },
    { id: nanoid(6), type: 'traces', title: 'Recent traces', query: '' },
    // The native engine-rendering path (GOC-88) is now the default rendering
    // surface, not an opt-in add — a Chart panel ships in the default set,
    // same as every other panel type. Starts with an empty query (matches the
    // Logs/Traces defaults' pattern) so it never fires a guessed SQL query on
    // load; the panel's own honest-state handling covers the rest.
    { id: nanoid(6), type: 'viz', title: 'Chart', query: '', vizSpec: 'scatter||' },
  ]
}

const ADD_OPTIONS: {
  type: PanelType
  label: string
  icon: typeof LineChartIcon
  title: string
  query: string
  vizSpec?: string
}[] = [
  { type: 'promql', label: 'Metrics', icon: LineChartIcon, title: 'New metric', query: DEFAULT_OP_RATE_QUERY },
  { type: 'logs', label: 'Logs', icon: ScrollTextIcon, title: 'New logs', query: '' },
  { type: 'traces', label: 'Traces', icon: GitBranchIcon, title: 'New traces', query: '' },
  {
    type: 'viz',
    label: 'Chart',
    icon: ImageIcon,
    title: 'New chart',
    query: '',
    vizSpec: 'scatter||',
  },
]

/** Parse a `PanelSpec.vizSpec` ("mark|xField|yField") back into its parts, with
 * a safe fallback so a malformed/missing spec never crashes the panel. */
function parseVizSpec(spec: string | undefined): { mark: VizMark; xField: string; yField: string } {
  const parts = (spec ?? 'scatter||').split('|')
  const [mark = 'scatter', xField = '', yField = ''] = parts
  const validMark: VizMark = (['scatter', 'line', 'bar', 'area', 'heatmap'] as const).includes(mark as VizMark)
    ? (mark as VizMark)
    : 'scatter'
  return { mark: validMark, xField, yField }
}

export default function LiveDashboardsView() {
  const [panels, setPanels] = useState<PanelSpec[]>(defaultPanels)
  const [rangeId, setRangeId] = useState<string>('1h')
  const [intervalId, setIntervalId] = useState<string>('off')
  const [refreshSignal, setRefreshSignal] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const range: TimeRange = useMemo(() => TIME_RANGES.find((r) => r.id === rangeId) ?? TIME_RANGES[2], [rangeId])

  // Drive auto-refresh: bump refreshSignal on the selected interval.
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    const secs = REFRESH_INTERVALS.find((i) => i.id === intervalId)?.seconds ?? 0
    if (secs > 0) {
      timerRef.current = setInterval(() => {
        setRefreshSignal((s) => s + 1)
      }, secs * 1000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [intervalId])

  const addPanel = (type: PanelType) => {
    const opt = ADD_OPTIONS.find((o) => o.type === type)
    if (!opt) return
    setPanels((prev) => [...prev, { id: nanoid(6), type, title: opt.title, query: opt.query, vizSpec: opt.vizSpec }])
  }

  const removePanel = (id: string) => {
    setPanels((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="space-y-6" data-testid="live-dashboards-view">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LayoutDashboard className="size-6" />
            Status
          </h1>
          <p className="text-muted-foreground text-sm">
            Compose PromQL, logs, and trace panels over the KG observability gateway.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Time-range selector */}
          <Select value={rangeId} onValueChange={setRangeId}>
            <SelectTrigger className="w-[10.5rem]" aria-label="Time range">
              <SelectValue placeholder="Time range" />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Auto-refresh interval */}
          <Select value={intervalId} onValueChange={setIntervalId}>
            <SelectTrigger className="w-[7.5rem]" aria-label="Auto refresh">
              <SelectValue placeholder="Refresh" />
            </SelectTrigger>
            <SelectContent>
              {REFRESH_INTERVALS.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.id === 'off' ? 'Auto: Off' : `Auto: ${i.label}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            onClick={() => {
              setRefreshSignal((s) => s + 1)
            }}
          >
            Refresh all
          </Button>
        </div>
      </div>

      {/* Add-panel toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Add panel:</span>
        {ADD_OPTIONS.map((o) => {
          const Icon = o.icon
          return (
            <Button
              key={o.type}
              variant="secondary"
              size="sm"
              onClick={() => {
                addPanel(o.type)
              }}
            >
              <Plus className="size-4 mr-1" />
              <Icon className="size-4 mr-1" />
              {o.label}
            </Button>
          )
        })}
      </div>

      {/* Panel grid */}
      {panels.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          No panels. Add a Metrics, Logs, or Traces panel to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {panels.map((p) => {
            if (p.type === 'promql') {
              return (
                <PromqlPanel
                  key={p.id}
                  title={p.title}
                  initialQuery={p.query}
                  range={range}
                  refreshSignal={refreshSignal}
                  onRemove={() => {
                    removePanel(p.id)
                  }}
                />
              )
            }
            if (p.type === 'logs') {
              return (
                <LogsPanel
                  key={p.id}
                  title={p.title}
                  range={range}
                  refreshSignal={refreshSignal}
                  onRemove={() => {
                    removePanel(p.id)
                  }}
                />
              )
            }
            if (p.type === 'viz') {
              const { mark, xField, yField } = parseVizSpec(p.vizSpec)
              return (
                <VizPanel
                  key={p.id}
                  title={p.title}
                  initialQuery={p.query}
                  initialMark={mark}
                  initialXField={xField}
                  initialYField={yField}
                  refreshSignal={refreshSignal}
                  onRemove={() => {
                    removePanel(p.id)
                  }}
                />
              )
            }
            return (
              <TracesPanel
                key={p.id}
                title={p.title}
                refreshSignal={refreshSignal}
                onRemove={() => {
                  removePanel(p.id)
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
