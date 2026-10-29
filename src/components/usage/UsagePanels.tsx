import { useMemo } from 'react'
import { Activity, BarChart3, Coins, Cpu, Search, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, workspaceButtonClass } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import { StatusMessage } from '@/components/ui/status-message'
import { safeExternalUrl } from '@/lib/safe-url'
import type {
  UsageActivityCell,
  UsageBreakdown,
  UsageSearchHit,
  UsageSessionDetail,
  UsageSessionRow,
  UsageSummary,
  UsageToolStat,
  UsageTraces,
} from '@/lib/api'
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const fmtUsd = (n: number) => `$${n.toFixed(2)}`
const fmtNum = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

function Kpi({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Coins }) {
  return (
    <div className="usage-reading min-w-0 rounded border">
      <div className="flex min-w-0 items-center gap-3 p-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </div>
    </div>
  )
}

function breakdownLabel(key: string): string {
  return key.length > 0 ? key : 'Unknown'
}

function sessionLabel(session: UsageSessionRow): string {
  return session.project.length > 0 ? session.project : session.id
}

/**
 * Horizontal bar rows for a breakdown (cost-weighted). `unavailable` (BUG-008
 * dashboard-wide follow-on, GOC-28-W06) distinguishes "the fetch failed" from
 * "the fetch succeeded and there is genuinely no spend yet" -- both used to
 * render the identical "No data yet." text.
 */
export function UsageBreakdownPanel({ rows, unavailable }: { rows: UsageBreakdown[]; unavailable?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.cost_usd))
  if (unavailable) return <UnavailableNotice what="This breakdown" className="py-4" />
  if (!rows.length) return <Empty>No data yet.</Empty>
  return (
    <div className="space-y-2 overflow-x-auto">
      {rows.map((r) => (
        <div key={r.key} className="flex min-w-[32rem] items-center gap-3 text-sm">
          <div className="w-40 shrink-0 truncate font-mono text-xs" title={r.key}>
            {r.key}
          </div>
          <div
            className="h-3 flex-1 overflow-hidden rounded bg-muted"
            role="progressbar"
            aria-label={`${breakdownLabel(r.key)} cost`}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={r.cost_usd}
            aria-valuetext={fmtUsd(r.cost_usd)}
          >
            <div className="h-full bg-primary" style={{ width: `${(r.cost_usd / max) * 100}%` }} aria-hidden="true" />
          </div>
          <div className="w-20 shrink-0 text-right tabular-nums">{fmtUsd(r.cost_usd)}</div>
          <div className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {fmtNum(r.input_tokens + r.output_tokens)} tok
          </div>
        </div>
      ))}
    </div>
  )
}

function Heatmap({ cells }: { cells: UsageActivityCell[] }) {
  const max = Math.max(1, ...cells.map((c) => c.sessions))
  const grid = useMemo(() => {
    const m = new Map<string, UsageActivityCell>()
    cells.forEach((c) => m.set(`${c.day_of_week}-${c.hour}`, c))
    return m
  }, [cells])
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full min-w-[640px] border-separate border-spacing-0.5"
        aria-label="Session activity by day and hour"
      >
        <caption className="sr-only">Sessions and cost by day of week and hour.</caption>
        <thead>
          <tr>
            <th scope="col" className="pr-2 text-right text-[10px] font-normal text-muted-foreground">
              Day / hour
            </th>
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} scope="col" className="px-1 text-center text-[9px] font-normal text-muted-foreground">
                <span aria-hidden="true">{h % 6 === 0 ? h : ''}</span>
                <span className="sr-only">{h}:00</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((d, di) => (
            <tr key={d}>
              <th scope="row" className="pr-2 text-right text-[10px] font-normal text-muted-foreground">
                {d}
              </th>
              {Array.from({ length: 24 }, (_, h) => {
                const c = grid.get(`${di}-${h}`)
                const intensity = c ? 0.15 + (c.sessions / max) * 0.85 : 0
                const description = c
                  ? `${d} ${h}:00 — ${c.sessions} sessions, ${fmtUsd(c.cost_usd)}`
                  : `${d} ${h}:00 — no sessions`
                return (
                  <td key={`${d}-${h}`} className="p-0" title={description}>
                    <div
                      className="mx-auto aspect-square w-4 rounded-[2px]"
                      aria-hidden="true"
                      style={{
                        backgroundColor: c
                          ? `color-mix(in srgb, var(--primary) ${intensity * 100}%, transparent)`
                          : 'var(--muted)',
                      }}
                    />
                    <span className="sr-only">{description}</span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The shared OVERSTORY-DESIGN-R006 empty-state primitive, centered the way this view's
 * tab bodies already were -- every call site below passes its own specific
 * copy via `label`, so the visible text is unchanged. */
function Empty({ children }: { children: string }) {
  return (
    <div className="py-8 flex justify-center">
      <StatusMessage status="empty" label={children} />
    </div>
  )
}

function toolBadgeVariant(successRate: number): 'default' | 'secondary' | 'destructive' {
  if (successRate >= 0.9) return 'default'
  if (successRate >= 0.5) return 'secondary'
  return 'destructive'
}

export function UsageToolsPanel({ unavailable, tools }: { unavailable: boolean; tools: UsageToolStat[] }) {
  if (unavailable) return <UnavailableNotice what="Tool/skill call stats" />
  if (tools.length === 0) return <Empty>No tool calls recorded yet.</Empty>
  const maxCalls = Math.max(1, ...tools.map((tool) => tool.calls))
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[36rem] space-y-1">
        {tools.map((t) => (
          <div key={`${t.name}-${t.category}`} className="flex items-center gap-3 text-sm">
            <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="w-44 shrink-0 truncate font-mono text-xs">{t.name}</span>
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {t.category}
            </Badge>
            <div
              className="h-2 flex-1 overflow-hidden rounded bg-muted"
              role="progressbar"
              aria-label={`${t.name} calls`}
              aria-valuemin={0}
              aria-valuemax={maxCalls}
              aria-valuenow={t.calls}
              aria-valuetext={`${t.calls} calls`}
            >
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min(100, (t.calls / maxCalls) * 100)}%` }}
                aria-hidden="true"
              />
            </div>
            <span className="w-12 text-right tabular-nums">{t.calls}</span>
            <Badge variant={toolBadgeVariant(t.success_rate)} className="w-14 shrink-0 justify-center text-[10px]">
              {Math.round(t.success_rate * 100)}%
            </Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

export function UsageActivityPanel({
  unavailable,
  activity,
}: {
  unavailable: boolean
  activity: UsageActivityCell[]
}) {
  if (unavailable) return <UnavailableNotice what="Activity data" />
  if (activity.length === 0) return <Empty>No activity yet.</Empty>
  return <Heatmap cells={activity} />
}

export function UsageSessionsPanel({
  unavailable,
  sessions,
  onOpenDetail,
}: {
  unavailable: boolean
  sessions: UsageSessionRow[]
  onOpenDetail: (id: string) => void
}) {
  if (unavailable) return <UnavailableNotice what="The session list" />
  if (sessions.length === 0) return <Empty>No sessions yet.</Empty>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm" aria-label="Usage sessions">
        <caption className="sr-only">Sessions ordered by cost.</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="pb-2">
              Project
            </th>
            <th scope="col" className="pb-2">
              Agent
            </th>
            <th scope="col" className="pb-2 text-right">
              Msgs
            </th>
            <th scope="col" className="pb-2 text-right">
              Cost
            </th>
            <th scope="col" className="pb-2 text-center">
              Grade
            </th>
            <th scope="col" className="pb-2 text-right">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="border-t hover:bg-muted/50">
              <td className="py-1.5 font-mono text-xs">{s.project || '—'}</td>
              <td className="py-1.5">
                <Badge variant="outline" className="text-[10px]">
                  {s.agent}
                </Badge>
              </td>
              <td className="py-1.5 text-right tabular-nums">{s.message_count}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtUsd(s.cost_usd)}</td>
              <td className="py-1.5 text-center">
                {s.health_grade && (
                  <Badge variant="secondary" className="text-[10px]">
                    {s.health_grade}
                  </Badge>
                )}
              </td>
              <td className="py-1.5 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11"
                  aria-label={`Open session ${sessionLabel(s)}`}
                  onClick={() => {
                    onOpenDetail(s.id)
                  }}
                >
                  Open
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function UsageSearchPanel({
  searchQ,
  onSearchQChange,
  onRunSearch,
  hits,
  onOpenDetail,
}: {
  searchQ: string
  onSearchQChange: (v: string) => void
  onRunSearch: () => void
  hits: UsageSearchHit[]
  onOpenDetail: (id: string) => void
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <label htmlFor="usage-search" className="sr-only">
          Search sessions and messages
        </label>
        <Input
          id="usage-search"
          maxLength={128}
          className="min-h-11 min-w-0 flex-1"
          placeholder="Search…"
          value={searchQ}
          onChange={(e) => {
            onSearchQChange(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRunSearch()
          }}
        />
        <Button type="button" className="min-h-11" onClick={onRunSearch}>
          <Search className="mr-2 h-4 w-4" aria-hidden="true" />
          Search
        </Button>
      </div>
      {hits.map((h, i) => (
        <button
          key={`${h.session_id}-${h.ordinal}-${i}`}
          type="button"
          className={cn(workspaceButtonClass, 'block w-full text-left')}
          onClick={() => {
            onOpenDetail(h.session_id)
          }}
        >
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">
              {h.agent}
            </Badge>
            <span>{h.project}</span>
            <span>·</span>
            <span>{h.role}</span>
          </span>
          <span className="mt-1 block">{h.snippet}</span>
        </button>
      ))}
    </>
  )
}

export function UsageTracesPanel({ traces }: { traces: UsageTraces }) {
  return (
    <>
      {traces.traces.map((t) => {
        const traceUrl = safeExternalUrl(t.url)
        if (!traceUrl) return null
        return (
          <a
            key={t.session_id}
            href={traceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(workspaceButtonClass, 'block w-full text-left')}
          >
            <span className="font-mono text-xs">{t.session_id}</span>
            <span className="ml-2 text-muted-foreground">{t.project}</span>
          </a>
        )
      })}
    </>
  )
}

function kpiValue(unavailable: boolean, value: string): string {
  return unavailable ? '—' : value
}

function kpiCost(unavailable: boolean, summary: UsageSummary | null): string {
  return kpiValue(unavailable, fmtUsd(summary?.totals.cost_usd ?? 0))
}

function kpiTokens(unavailable: boolean, summary: UsageSummary | null): string {
  const totals = summary?.totals
  return kpiValue(unavailable, `${fmtNum(totals?.input_tokens ?? 0)} / ${fmtNum(totals?.output_tokens ?? 0)}`)
}

function kpiCacheRate(unavailable: boolean, summary: UsageSummary | null): string {
  return kpiValue(unavailable, `${Math.round((summary?.cache_hit_rate ?? 0) * 100)}%`)
}

function kpiSessions(unavailable: boolean, summary: UsageSummary | null): string {
  return kpiValue(unavailable, fmtNum(summary?.session_count ?? 0))
}

export function UsageKpis({
  summaryUnavailable,
  summary,
}: {
  summaryUnavailable: boolean
  summary: UsageSummary | null
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:grid-cols-4">
      <Kpi label="Total cost" value={kpiCost(summaryUnavailable, summary)} icon={Coins} />
      <Kpi label="Tokens (in/out)" value={kpiTokens(summaryUnavailable, summary)} icon={Cpu} />
      <Kpi label="Cache hit rate" value={kpiCacheRate(summaryUnavailable, summary)} icon={Activity} />
      <Kpi label="Sessions" value={kpiSessions(summaryUnavailable, summary)} icon={BarChart3} />
    </div>
  )
}

export function UsageSessionPanel({ detail, timeline }: { detail: UsageSessionDetail; timeline: boolean }) {
  return (
    <article
      aria-label={timeline ? 'Session timeline' : 'Usage session detail'}
      className="min-w-0 space-y-3 [overflow-wrap:anywhere]"
    >
      <h3 className="font-medium">{detail.session.project || detail.session.id}</h3>
      <p className="text-sm">
        Session: {detail.session.id} · {detail.session.agent} · {detail.session.message_count} messages ·{' '}
        {fmtUsd(detail.session.cost_usd)}
      </p>
      {!timeline ? (
        <dl className="grid gap-1 text-sm">
          <dt>Origin</dt>
          <dd>{detail.session.origin}</dd>
          <dt>Outcome</dt>
          <dd>{detail.session.outcome || 'Not reported'}</dd>
          <dt>Health grade</dt>
          <dd>{detail.session.health_grade ?? 'Not reported'}</dd>
        </dl>
      ) : (
        <>
          {detail.messages.length === 0 && <Empty>No messages recorded for this session.</Empty>}
          <ol className="space-y-2" aria-label="Session messages">
            {detail.messages.map((m) => (
              <li key={m.ordinal} className="usage-reading rounded border p-2 text-sm">
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant={m.role === 'user' ? 'secondary' : 'outline'}>{m.role}</Badge>
                  <span>Message {m.ordinal}</span>
                  {m.model && <span>{m.model}</span>}
                  <span>{fmtNum(m.output_tokens)} out</span>
                  {m.has_tool_use && <span>Tool use</span>}
                </div>
                <p className="mt-1 whitespace-pre-wrap">{m.content}</p>
              </li>
            ))}
          </ol>
          {detail.tool_calls.length > 0 && (
            <section aria-label="Session tool calls">
              <h4 className="font-medium">Tool calls</h4>
              <ul>
                {detail.tool_calls.map((tc, i) => (
                  <li key={i}>
                    {tc.skill_name ?? tc.tool_name} ({tc.category}) · {tc.status}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {detail.usage_events.length > 0 && (
            <section aria-label="Session usage events">
              <h4 className="font-medium">Usage events</h4>
              <ul>
                {detail.usage_events.map((event, i) => (
                  <li key={i}>
                    {event.model}: {event.input_tokens} in / {event.output_tokens} out ·{' '}
                    {event.cost_usd === undefined ? 'Cost not reported' : fmtUsd(event.cost_usd)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </article>
  )
}
