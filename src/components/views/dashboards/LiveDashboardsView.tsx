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
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutDashboard, LineChartIcon, Plus, ScrollTextIcon, GitBranchIcon } from 'lucide-react'
import { nanoid } from 'nanoid'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PromqlPanel } from './PromqlPanel'
import { LogsPanel } from './LogsPanel'
import { TracesPanel } from './TracesPanel'
import { TIME_RANGES, type TimeRange } from './queries'

type PanelType = 'promql' | 'logs' | 'traces'

interface PanelSpec {
  id: string
  type: PanelType
  title: string
  query: string
}

/** Auto-refresh interval options (seconds; 0 = off). */
const REFRESH_INTERVALS: { id: string; label: string; seconds: number }[] = [
  { id: 'off', label: 'Off', seconds: 0 },
  { id: '5s', label: '5s', seconds: 5 },
  { id: '10s', label: '10s', seconds: 10 },
  { id: '30s', label: '30s', seconds: 30 },
  { id: '60s', label: '60s', seconds: 60 },
]

const DEFAULT_PROMQL = 'rate(kg_requests_total[5m])'

function defaultPanels(): PanelSpec[] {
  return [
    { id: nanoid(6), type: 'promql', title: 'Request rate', query: DEFAULT_PROMQL },
    { id: nanoid(6), type: 'logs', title: 'Logs', query: '' },
    { id: nanoid(6), type: 'traces', title: 'Recent traces', query: '' },
  ]
}

const ADD_OPTIONS: { type: PanelType; label: string; icon: typeof LineChartIcon; title: string; query: string }[] = [
  { type: 'promql', label: 'Metrics', icon: LineChartIcon, title: 'New metric', query: DEFAULT_PROMQL },
  { type: 'logs', label: 'Logs', icon: ScrollTextIcon, title: 'New logs', query: '' },
  { type: 'traces', label: 'Traces', icon: GitBranchIcon, title: 'New traces', query: '' },
]

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
    setPanels((prev) => [...prev, { id: nanoid(6), type, title: opt.title, query: opt.query }])
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
            Live Dashboards
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
