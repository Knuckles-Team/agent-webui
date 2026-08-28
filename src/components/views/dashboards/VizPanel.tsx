/**
 * @file VizPanel.tsx
 * @description Native visualization panel (GOC-88, D-VZ-1 lane V5/V8) — plots
 * a live KG SQL query as a chart through the engine's LOD ColumnStore/export
 * pipeline (`Method::Viz`, `graph_viz(action='plot_from_query')`, the real
 * `agent-utilities` MCP tool's REST twin `POST /graph/viz`). No matplotlib,
 * no client-side charting library, no per-view chart code — the image is
 * rendered server-side (Rust) at a bounded primitive/byte budget and this
 * panel just displays the bytes and the LOD metadata that came back with
 * them (tier / exact-vs-approximated / row counts).
 *
 * Three distinct non-data states, never collapsed into one another:
 *   - `unavailable` (route/engine-build unavailable, via `gatewayPost`'s own
 *     404/501/`{degraded:true}` handling) → `CapabilityNotice`.
 *   - the query ran fine but returned zero rows carrying every requested
 *     field (`vizUnavailableReason`) → an explicit "no data" notice quoting
 *     the backend's own reason — NOT rendered as a blank/empty chart.
 *   - a genuine query/render error → `PanelError`.
 * This is the same three-way split `PromqlPanel.tsx` already uses for the
 * promql surface, applied to a surface that renders an image rather than an
 * SVG line — see PanelShell.tsx.
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, ImageIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { PanelShell, CapabilityNotice, PanelError } from './PanelShell'
import { adaptVizResult, plotFromQuery, vizUnavailableReason, VIZ_MARKS, type VizMark } from './queries'

export interface VizPanelProps {
  title: string
  initialQuery: string
  initialMark: VizMark
  initialXField: string
  initialYField: string
  refreshSignal: number
  onRemove?: () => void
}

type VizRenderResult = NonNullable<ReturnType<typeof adaptVizResult>>

type VizRunOutcome =
  | { kind: 'unavailable' }
  | { kind: 'no-data'; reason: string }
  | { kind: 'error'; message: string }
  | { kind: 'render'; render: VizRenderResult }

async function runVizQuery(params: { query: string; mark: VizMark; xField: string; yField: string }): Promise<VizRunOutcome> {
  const r = await plotFromQuery(params)
  if (r.unavailable) return { kind: 'unavailable' }
  if (!r.ok) return { kind: 'error', message: r.error ?? 'Render failed' }
  const reason = vizUnavailableReason(r.data)
  if (reason) return { kind: 'no-data', reason }
  const adapted = adaptVizResult(r.data)
  if (!adapted) return { kind: 'error', message: 'Response did not carry a recognisable rendered image.' }
  return { kind: 'render', render: adapted }
}

function renderVizChartImage(render: VizRenderResult, mark: VizMark, xField: string, yField: string) {
  if (render.format === 'png') {
    return (
      <img
        src={render.dataUrl}
        alt={`${mark} chart of ${yField} vs ${xField}`}
        className="max-w-full rounded-md border"
        data-testid="viz-panel-image"
      />
    )
  }
  return (
    <a href={render.dataUrl} download={`chart.${render.format}`} className="text-sm underline">
      Download {render.format.toUpperCase()} render
    </a>
  )
}

function renderVizChart(render: VizRenderResult, mark: VizMark, xField: string, yField: string) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Badge variant={render.exact ? 'default' : 'secondary'}>{render.exact ? 'exact' : 'approximated'}</Badge>
        <Badge variant="outline">tier: {render.lodTier}</Badge>
        <Badge variant="outline">rows: {render.rowCount.toLocaleString()}</Badge>
        {render.rowsReturned !== undefined && render.rowsReturned !== render.rowsRendered ? (
          <Badge variant="outline">
            {render.rowsRendered?.toLocaleString()} of {render.rowsReturned.toLocaleString()} rows sent
          </Badge>
        ) : null}
        {render.wallTimeMs !== undefined ? <Badge variant="outline">{render.wallTimeMs} ms</Badge> : null}
      </div>
      {renderVizChartImage(render, mark, xField, yField)}
    </div>
  )
}

function renderVizBody({
  routeUnavailable,
  noDataReason,
  error,
  render,
  mark,
  xField,
  yField,
}: {
  routeUnavailable: boolean
  noDataReason: string | null
  error: string | null
  render: VizRenderResult | null
  mark: VizMark
  xField: string
  yField: string
}) {
  if (routeUnavailable) {
    return <CapabilityNotice label="/graph/viz" detail="Wire graph_viz in agent_utilities to see live renders here." />
  }
  if (noDataReason) {
    return (
      <div className="rounded-md border border-amber-500/50 bg-amber-50/50 dark:bg-amber-500/10 p-3 flex items-start gap-2 text-sm">
        <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-muted-foreground">
          No chart rendered — <span className="font-mono">{noDataReason}</span>. This reflects the query's real
          result, not a fabricated empty chart.
        </p>
      </div>
    )
  }
  if (error) return <PanelError message={error} />
  if (!render) return <p className="text-sm text-muted-foreground">Enter a query, x field, and y field, then run.</p>
  return renderVizChart(render, mark, xField, yField)
}

export function VizPanel({
  title,
  initialQuery,
  initialMark,
  initialXField,
  initialYField,
  refreshSignal,
  onRemove,
}: VizPanelProps) {
  const [query, setQuery] = useState(initialQuery)
  const [mark, setMark] = useState<VizMark>(initialMark)
  const [xField, setXField] = useState(initialXField)
  const [yField, setYField] = useState(initialYField)
  const [loading, setLoading] = useState(false)
  const [routeUnavailable, setRouteUnavailable] = useState(false)
  const [noDataReason, setNoDataReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [render, setRender] = useState<ReturnType<typeof adaptVizResult>>(null)

  const run = async () => {
    if (!query.trim() || !xField.trim() || !yField.trim()) return
    setLoading(true)
    setError(null)
    setNoDataReason(null)
    const outcome = await runVizQuery({ query, mark, xField, yField })
    setRouteUnavailable(outcome.kind === 'unavailable')
    setRender(outcome.kind === 'render' ? outcome.render : null)
    setNoDataReason(outcome.kind === 'no-data' ? outcome.reason : null)
    setError(outcome.kind === 'error' ? outcome.message : null)
    setLoading(false)
  }

  // Re-run on every refresh tick (matches PromqlPanel); NOT on every keystroke.
  useEffect(() => {
    void run()
  }, [refreshSignal])

  return (
    <PanelShell
      title={title}
      icon={<ImageIcon className="size-4" />}
      description="POST /graph/viz · plot_from_query"
      loading={loading}
      onRefresh={() => {
        void run()
      }}
      onRemove={onRemove}
    >
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="SQL query"
          value={query}
          spellCheck={false}
          placeholder="SELECT ... FROM nodes ..."
          className="font-mono text-sm flex-1 min-w-[16rem]"
          onChange={(e) => {
            setQuery(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
        />
        <Select
          value={mark}
          onValueChange={(v) => {
            setMark(v as VizMark)
          }}
        >
          <SelectTrigger className="w-[7.5rem]" aria-label="Mark">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIZ_MARKS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          aria-label="x field"
          value={xField}
          placeholder="x field"
          className="font-mono text-sm w-24"
          onChange={(e) => {
            setXField(e.target.value)
          }}
        />
        <Input
          aria-label="y field"
          value={yField}
          placeholder="y field"
          className="font-mono text-sm w-24"
          onChange={(e) => {
            setYField(e.target.value)
          }}
        />
      </div>

      {renderVizBody({ routeUnavailable, noDataReason, error, render, mark, xField, yField })}
    </PanelShell>
  )
}
