/**
 * @file LogsPanel.tsx
 * @description Logs panel — filter by stream + free-text over a time range and
 * render a paginated log table. Targets `POST /graph/logs`.
 *
 * READ-ONLY / PLACEHOLDER: `/graph/logs` is now a registered REST route
 * (D-W6-ISO-2 fixed its prior HTTP 405 — the path did not exist at all), but
 * the engine's own log-QUERY surface (EG-162) still doesn't exist on the wire
 * client (only its log-INGEST listener does), so the call resolves
 * `unavailable` and the panel shows a capability notice instead of fabricating
 * log lines. When the engine ships a log-query RPC, the same code path renders
 * live rows with no UI change.
 */

import { useEffect, useState } from 'react'
import { ScrollTextIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PanelShell, CapabilityNotice, PanelError } from './PanelShell'
import { adaptLogs, queryLogs, type LogLine, type TimeRange } from './queries'

const PAGE_SIZE = 25

function levelClass(level?: string): string {
  const l = (level ?? '').toLowerCase()
  if (l.includes('err') || l.includes('fatal') || l.includes('crit')) return 'text-destructive'
  if (l.includes('warn')) return 'text-amber-600 dark:text-amber-400'
  return 'text-muted-foreground'
}

function fmtTime(ts: number): string {
  if (!ts) return '-'
  const ms = ts > 1e12 ? ts : ts * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? '-' : d.toISOString().replace('T', ' ').replace('Z', '')
}

export interface LogsPanelProps {
  title: string
  range: TimeRange
  refreshSignal: number
  onRemove?: () => void
}

export function LogsPanel({ title, range, refreshSignal, onRemove }: LogsPanelProps) {
  const [stream, setStream] = useState('')
  const [filter, setFilter] = useState('')
  const [logs, setLogs] = useState<LogLine[]>([])
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const run = async () => {
    setLoading(true)
    setError(null)
    const r = await queryLogs(stream, range, filter)
    setUnavailable(r.unavailable)
    if (r.ok) {
      setLogs(adaptLogs(r.data))
      setPage(0)
    } else {
      setLogs([])
      if (!r.unavailable) setError(r.error ?? 'Query failed')
    }
    setLoading(false)
  }

  useEffect(() => {
    void run()
  }, [range.id, refreshSignal])

  const pageCount = Math.max(1, Math.ceil(logs.length / PAGE_SIZE))
  const shown = logs.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  return (
    <PanelShell
      title={title}
      icon={<ScrollTextIcon className="size-4" />}
      description="POST /graph/logs · stream + time-range filter"
      badge={
        unavailable ? (
          <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
            read-only
          </Badge>
        ) : undefined
      }
      loading={loading}
      onRefresh={() => {
        void run()
      }}
      onRemove={onRemove}
    >
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Log stream"
          placeholder="stream (e.g. graph-os)…"
          value={stream}
          className="max-w-[14rem] text-sm"
          onChange={(e) => {
            setStream(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
        />
        <Input
          aria-label="Log filter"
          placeholder="filter text…"
          value={filter}
          className="flex-1 min-w-[10rem] text-sm"
          onChange={(e) => {
            setFilter(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
        />
      </div>

      {unavailable ? (
        <CapabilityNotice
          label="/graph/logs"
          detail="The engine log-query surface (EG-162) is not exposed as a REST twin yet — only PromQL and traces are. This panel is read-only until it lands."
        />
      ) : error ? (
        <PanelError message={error} />
      ) : logs.length === 0 ? (
        <p className="text-muted-foreground text-sm">No log lines for this stream / range.</p>
      ) : (
        <>
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 font-medium w-44">Time</th>
                  <th className="text-left p-2 font-medium w-16">Level</th>
                  <th className="text-left p-2 font-medium w-28">Stream</th>
                  <th className="text-left p-2 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l, i) => (
                  <tr key={`${String(l.timestamp)}-${String(i)}`} className="border-t align-top">
                    <td className="p-2 font-mono whitespace-nowrap">{fmtTime(l.timestamp)}</td>
                    <td className={`p-2 font-mono uppercase ${levelClass(l.level)}`}>{l.level ?? '-'}</td>
                    <td className="p-2 font-mono truncate">{l.stream ?? '-'}</td>
                    <td className="p-2 font-mono whitespace-pre-wrap break-words">{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pageCount > 1 ? (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {logs.length} lines · page {page + 1} / {pageCount}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => {
                    setPage((p) => Math.max(0, p - 1))
                  }}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount - 1}
                  onClick={() => {
                    setPage((p) => Math.min(pageCount - 1, p + 1))
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </PanelShell>
  )
}
