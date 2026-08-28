/**
 * @file ColumnDetailPanel.tsx
 * @description Pane 2 (design §4) — per-column detail for the selected relation.
 * Structural facts (type, nullable, PK) come straight from the `CatalogRelation`
 * pane 1 already fetched; row count / distinct ratio / length histogram / sample
 * values are computed lazily, per selected column, via `catalog-api.ts`'s
 * {@link fetchColumnStats} (client-side SQL over `POST /graph/table
 * {action:'query'}` — there is no server-side "compute once, share with the
 * recommender" pass yet; see the lane report).
 */
import { useEffect, useState } from 'react'
import { AlertCircle, Key, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { fetchColumnStats } from './catalog-api'
import type { CatalogColumn, CatalogRelation, ColumnStats, LoadState } from './types'

interface ColumnDetailPanelProps {
  relation: CatalogRelation
  selectedColumn: string | null
  onSelectColumn: (column: string) => void
}

function ColumnListRow({
  column,
  isSelected,
  onSelect,
}: {
  column: CatalogColumn
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={
        'w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs rounded hover:bg-muted/50' +
        (isSelected ? ' bg-muted' : '')
      }
    >
      <span className="flex items-center gap-1.5 min-w-0">
        {column.primaryKey === true && <Key className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />}
        <span className="font-mono truncate">{column.name}</span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
        <span className="font-mono">{column.dataType || 'unknown'}</span>
        {column.nullable && <Badge variant="outline">null</Badge>}
      </span>
    </button>
  )
}

function HistogramBar({ bucket, count, max }: { bucket: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 font-mono text-muted-foreground">{bucket}</span>
      <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${String(pct)}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right tabular-nums">{count}</span>
    </div>
  )
}

function StatsBody({ state }: { state: LoadState<ColumnStats> }) {
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Computing statistics…
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="flex items-start gap-2 text-xs text-destructive">
        <AlertCircle className="size-3 mt-0.5 shrink-0" />
        <span>{state.message}</span>
      </div>
    )
  }
  if (state.status !== 'loaded') return null
  const { data } = state
  const maxBucket = Math.max(0, ...data.lengthHistogram.map((b) => b.count))
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Rows" value={data.rowCount === null ? '—' : data.rowCount.toLocaleString()} />
        <Stat
          label="Distinct ratio"
          value={data.distinctRatio === null ? '—' : `${(data.distinctRatio * 100).toFixed(1)}%`}
        />
      </div>
      {data.lengthHistogram.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Length distribution</p>
          {data.lengthHistogram.map((b) => (
            <HistogramBar key={b.bucket} bucket={b.bucket} count={b.count} max={maxBucket} />
          ))}
        </div>
      )}
      {data.sampleValues.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Sample values</p>
          <div className="flex flex-wrap gap-1">
            {data.sampleValues.map((v, i) => (
              <Badge key={`${v}-${String(i)}`} variant="outline" className="font-mono text-[10px] max-w-40 truncate">
                {v}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-mono text-sm">{value}</p>
    </div>
  )
}

export default function ColumnDetailPanel({ relation, selectedColumn, onSelectColumn }: ColumnDetailPanelProps) {
  const [stats, setStats] = useState<LoadState<ColumnStats>>({ status: 'idle' })

  useEffect(() => {
    if (!selectedColumn) {
      setStats({ status: 'idle' })
      return
    }
    setStats({ status: 'loading' })
    let cancelled = false
    void fetchColumnStats({ schema: relation.schema, table: relation.name }, selectedColumn).then((result) => {
      if (cancelled) return
      setStats(
        result === null
          ? { status: 'error', message: 'The engine returned no readable statistics for this column.' }
          : { status: 'loaded', data: result },
      )
    })
    return () => {
      cancelled = true
    }
  }, [relation.schema, relation.name, selectedColumn])

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-base font-mono">
          {relation.schema}.{relation.name}
        </CardTitle>
        <CardDescription>{relation.columns.length} column(s)</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto grid grid-cols-2 gap-3">
        <div className="space-y-0.5 border-r pr-3">
          {relation.columns.map((c) => (
            <ColumnListRow
              key={c.name}
              column={c}
              isSelected={c.name === selectedColumn}
              onSelect={() => {
                onSelectColumn(c.name)
              }}
            />
          ))}
        </div>
        <div>
          {selectedColumn ? (
            <StatsBody state={stats} />
          ) : (
            <p className="text-xs text-muted-foreground">Select a column to see its statistics.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
