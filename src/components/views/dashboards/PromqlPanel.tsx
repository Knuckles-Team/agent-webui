/**
 * @file PromqlPanel.tsx
 * @description PromQL metrics panel — enter a PromQL expression, render the
 * returned range series as an SVG line chart. Re-queries on range change and on
 * every auto-refresh tick. Wired to the real `POST /graph/promql` action-twin.
 */

import { useEffect, useState } from 'react'
import { LineChartIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { LineChart, chartColor } from './LineChart'
import { PanelShell, CapabilityNotice, PanelError } from './PanelShell'
import { adaptSeries, queryPromql, type MetricSeries, type TimeRange } from './queries'

export interface PromqlPanelProps {
  title: string
  initialQuery: string
  range: TimeRange
  refreshSignal: number
  onRemove?: () => void
}

export function PromqlPanel({ title, initialQuery, range, refreshSignal, onRemove }: PromqlPanelProps) {
  const [query, setQuery] = useState(initialQuery)
  const [series, setSeries] = useState<MetricSeries[]>([])
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (q: string) => {
    if (!q.trim()) return
    setLoading(true)
    setError(null)
    const r = await queryPromql(q, range)
    setUnavailable(r.unavailable)
    if (r.ok) {
      setSeries(adaptSeries(r.data))
    } else {
      setSeries([])
      if (!r.unavailable) setError(r.error ?? 'Query failed')
    }
    setLoading(false)
  }

  // Re-query on range change and on each refresh tick.
  useEffect(() => {
    void run(query)
  }, [range.id, refreshSignal])

  return (
    <PanelShell
      title={title}
      icon={<LineChartIcon className="size-4" />}
      description="POST /graph/promql · range query"
      loading={loading}
      onRefresh={() => {
        void run(query)
      }}
      onRemove={onRemove}
    >
      <Input
        aria-label="PromQL query"
        value={query}
        spellCheck={false}
        className="font-mono text-sm"
        onChange={(e) => {
          setQuery(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void run(query)
        }}
      />
      {unavailable ? (
        <CapabilityNotice label="/graph/promql" />
      ) : error ? (
        <PanelError message={error} />
      ) : (
        <>
          <LineChart series={series} />
          {series.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {series.map((s, i) => (
                <span key={s.label} className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full" style={{ backgroundColor: chartColor(i) }} />
                  <span className="font-mono text-muted-foreground truncate max-w-[16rem]" title={s.label}>
                    {s.label}
                  </span>
                  <Badge variant="outline">{s.points.at(-1)?.v ?? '-'}</Badge>
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </PanelShell>
  )
}
