/**
 * @file TracesPanel.tsx
 * @description Traces panel — search recent traces and render a span timeline
 * (waterfall) for the selected trace. Wired to the real `POST /graph/traces`
 * action-twin (search).
 */

import { useEffect, useMemo, useState } from 'react'
import { GitBranchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { PanelShell, CapabilityNotice, PanelError } from './PanelShell'
import { adaptTraces, queryTraces, type TraceRecord } from './queries'

/** Span waterfall for a single trace, positioned by start offset + duration. */
function Waterfall({ trace }: { trace: TraceRecord }) {
  const spans = trace.spans ?? []
  if (spans.length === 0) {
    return <p className="text-muted-foreground text-sm">No spans recorded for this trace.</p>
  }
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

export interface TracesPanelProps {
  title: string
  refreshSignal: number
  onRemove?: () => void
}

export function TracesPanel({ title, refreshSignal, onRemove }: TracesPanelProps) {
  const [search, setSearch] = useState('')
  const [traces, setTraces] = useState<TraceRecord[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setLoading(true)
    setError(null)
    const r = await queryTraces(search)
    setUnavailable(r.unavailable)
    if (r.ok) {
      const parsed = adaptTraces(r.data)
      setTraces(parsed)
      setSelected(parsed[0]?.trace_id ?? null)
    } else {
      setTraces([])
      setSelected(null)
      if (!r.unavailable) setError(r.error ?? 'Query failed')
    }
    setLoading(false)
  }

  useEffect(() => {
    void run()
  }, [refreshSignal])

  const active = useMemo(() => traces.find((t) => t.trace_id === selected) ?? null, [traces, selected])

  return (
    <PanelShell
      title={title}
      icon={<GitBranchIcon className="size-4" />}
      description="POST /graph/traces · search + span timeline"
      loading={loading}
      onRefresh={() => {
        void run()
      }}
      onRemove={onRemove}
    >
      <Input
        aria-label="Trace search"
        placeholder="service, operation, or trace id…"
        value={search}
        className="text-sm"
        onChange={(e) => {
          setSearch(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void run()
        }}
      />
      {unavailable ? (
        <CapabilityNotice label="/graph/traces" />
      ) : error ? (
        <PanelError message={error} />
      ) : traces.length === 0 ? (
        <p className="text-muted-foreground text-sm">No traces found.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-3">
          <div className="space-y-1 max-h-64 overflow-auto pr-1">
            {traces.map((t) => (
              <button
                type="button"
                key={t.trace_id}
                onClick={() => {
                  setSelected(t.trace_id)
                }}
                className={
                  'w-full text-left rounded border p-2 hover:bg-muted/50 transition-colors ' +
                  (t.trace_id === selected ? 'bg-accent' : '')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs">{t.name ?? t.trace_id}</span>
                  <Badge variant="outline">{t.span_count ?? 0}</Badge>
                </div>
                {t.duration !== undefined ? (
                  <span className="text-xs text-muted-foreground">{t.duration} total</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="rounded-md border p-3">{active ? <Waterfall trace={active} /> : null}</div>
        </div>
      )}
    </PanelShell>
  )
}
