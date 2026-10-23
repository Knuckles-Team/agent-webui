/**
 * @file PanelBody.tsx
 * @description Renders one panel's result (WEBUI-DASH-R002): table, line, bar or KPI.
 * Loading, empty, error and unavailable are distinct states. Charts and KPIs always
 * come with a data-table alternative.
 */
import type { ReactNode } from 'react'
import type { Panel } from '@/lib/dashboards/model'
import type { Cell, QueryOutcome, RowSet } from '@/lib/dashboards/query'
import { ChartSvg } from './ChartSvg'

const TABLE_ROWS = 50

function numeric(value: Cell | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function pickColumns(data: RowSet, panel: Panel): { x: string; y: string | null } {
  const y =
    panel.options.y && data.columns.includes(panel.options.y)
      ? panel.options.y
      : (data.columns.find((c) => data.rows.some((r) => numeric(r[c]) !== null)) ?? null)
  const x =
    panel.options.x && data.columns.includes(panel.options.x)
      ? panel.options.x
      : (data.columns.find((c) => c !== y) ?? data.columns[0])
  return { x, y }
}

export function DataTable({ data, caption }: { data: RowSet; caption: string }) {
  const rows = data.rows.slice(0, TABLE_ROWS)
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {data.columns.map((c) => (
              <th key={c} scope="col" className="sticky top-0 border-b bg-card px-2 py-1 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="odd:bg-muted/40">
              {data.columns.map((c) => (
                <td key={c} className="px-2 py-1 align-top">
                  {String(row[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.rows.length > TABLE_ROWS && (
        <p className="p-1 text-xs text-muted-foreground">
          Showing {TABLE_ROWS} of {data.rows.length} rows.
        </p>
      )}
    </div>
  )
}

function KpiBody({ panel, data, y }: { panel: Panel; data: RowSet; y: string }) {
  const value = numeric(data.rows[0]?.[y])
  const raw = String(data.rows[0]?.[y] ?? 'unavailable')
  return (
    <div>
      <p className="text-3xl font-semibold tabular-nums" aria-label={`${panel.title}: ${raw}`}>
        {value === null ? '—' : value.toLocaleString()}
      </p>
      <p className="text-xs text-muted-foreground">
        {y}, first of {data.rows.length} row{data.rows.length === 1 ? '' : 's'}
      </p>
    </div>
  )
}

function ChartBody({ panel, data, x, y }: { panel: Panel; data: RowSet; x: string; y: string }) {
  const points = data.rows.flatMap((row) => {
    const v = numeric(row[y])
    return v === null ? [] : [{ label: String(row[x] ?? ''), value: v }]
  })
  const values = points.map((p) => p.value)
  const kind = panel.viz === 'line' ? 'line' : 'bar'
  const summary = `${kind === 'line' ? 'Line' : 'Bar'} chart of ${y} by ${x}, ${String(points.length)} points, from ${String(Math.min(...values))} to ${String(Math.max(...values))}.`
  return (
    <figure className="space-y-2">
      <ChartSvg kind={kind} labels={points.map((p) => p.label)} values={values} summary={summary} />
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Data table</summary>
        <DataTable data={data} caption={`${panel.title} data`} />
      </details>
    </figure>
  )
}

function Message({ role, tone, children }: { role?: 'alert' | 'status'; tone: string; children: ReactNode }) {
  return (
    <p role={role} className={`text-sm ${tone}`}>
      {children}
    </p>
  )
}

function ResultBody({ panel, data }: { panel: Panel; data: RowSet }) {
  if (panel.viz === 'table') return <DataTable data={data} caption={`${panel.title} results`} />
  const { x, y } = pickColumns(data, panel)
  if (y === null) {
    return (
      <Message tone="text-muted-foreground">No numeric column to draw. Set a y column in the panel settings.</Message>
    )
  }
  return panel.viz === 'kpi' ? (
    <KpiBody panel={panel} data={data} y={y} />
  ) : (
    <ChartBody panel={panel} data={data} x={x} y={y} />
  )
}

export function PanelBody({
  panel,
  outcome,
  loading,
}: {
  panel: Panel
  outcome: QueryOutcome | undefined
  loading: boolean
}) {
  if (loading)
    return (
      <Message role="status" tone="text-muted-foreground">
        Loading…
      </Message>
    )
  if (!outcome) return <Message tone="text-muted-foreground">No result yet.</Message>
  if (outcome.state === 'error') {
    return (
      <Message role="alert" tone="text-destructive">
        This panel could not load: {outcome.error}
      </Message>
    )
  }
  if (outcome.state === 'empty') return <Message tone="text-muted-foreground">{outcome.note}</Message>
  return <ResultBody panel={panel} data={outcome.data} />
}
