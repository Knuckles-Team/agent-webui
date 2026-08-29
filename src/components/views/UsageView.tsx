/**
 * @file UsageView.tsx
 * @description Usage / cost / observability dashboard (CONCEPT:ECO-4.41).
 *
 * Native view over the gateway's /api/observability/* surface — assimilates the
 * agentsview feature set: usage/cost summary, cost by model/project/agent, token
 * counts, tool/skill/db-call metrics, a day×hour activity heatmap, a session
 * browser + detail timeline, full-text search, session-shape archetypes, and
 * Langfuse trace links. Covers both ingested external agent logs and our own
 * runtime telemetry (the `origin` filter). House style: Tailwind + shadcn, no
 * chart library.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Activity, BarChart3, Coins, Cpu, Info, RefreshCw, Search, Users, Wrench } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { safeExternalUrl } from '@/lib/safe-url'
import { useIdentity } from '@/lib/auth'
import { roleAtLeast } from '@/lib/nav-registry'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import {
  api,
  type UsageActivityCell,
  type UsageBreakdown,
  type UsageSearchHit,
  type UsageSessionDetail,
  type UsageSessionRow,
  type UsageSummary,
  type UsageToolStat,
  type UsageTraces,
} from '@/lib/api'

/**
 * What each real LLM-token source actually captures today (verified against
 * `agent_utilities/usage/models.py` + `usage_api.py` + a repo-wide grep for
 * `dspy`, not assumed). Rendered instead of inventing a counter for a source
 * that isn't wired: a dashboard that silently shows 0 for an uninstrumented
 * source is worse than one that says so.
 */
type SourceStatus = 'captured' | 'partial' | 'not-instrumented'
interface SourceInfo {
  label: string
  status: SourceStatus
  note: string
}
function sourceRows(langfuseEnabled: boolean): SourceInfo[] {
  return [
    {
      label: 'Direct LLM calls',
      status: 'captured',
      note: 'Every model call (input/output/cache/reasoning tokens + cost) is recorded per session and per message — this is what the totals, and the Models/Projects/Agents tabs, are built from.',
    },
    {
      label: 'MCP tool & skill calls',
      status: 'partial',
      note: 'Call counts and success rate are recorded per tool (see the Tools & Skills tab), and the LLM turns that invoke them count toward the totals above — but no token/cost figure is attributed to an individual tool call. There is no per-tool-call cost breakdown to show.',
    },
    {
      label: 'Langfuse captures',
      status: langfuseEnabled ? 'captured' : 'not-instrumented',
      note: langfuseEnabled
        ? 'A Langfuse exporter is configured — trace references for runtime sessions are available in the Traces tab.'
        : 'No Langfuse exporter is configured on this deployment, so no Langfuse trace data exists to show here.',
    },
    {
      label: 'DSPy',
      status: 'not-instrumented',
      note: 'agent-utilities has no DSPy integration today (no dependency, no call site, no token capture) — this is not a filtered-out or zero-usage number, DSPy usage genuinely is not tracked anywhere in the codebase.',
    },
  ]
}
const SOURCE_STATUS_STYLE: Record<SourceStatus, string> = {
  captured: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  partial: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  'not-instrumented': 'bg-muted text-muted-foreground',
}
const SOURCE_STATUS_LABEL: Record<SourceStatus, string> = {
  captured: 'Captured',
  partial: 'Partially captured',
  'not-instrumented': 'Not instrumented',
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const fmtUsd = (n: number) => `$${n.toFixed(2)}`
const fmtNum = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

function Kpi({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Coins }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
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
function BarRows({ rows, unavailable }: { rows: UsageBreakdown[]; unavailable?: boolean }) {
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

function Empty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{children}</div>
}

function toolBadgeVariant(successRate: number): 'default' | 'secondary' | 'destructive' {
  if (successRate >= 0.9) return 'default'
  if (successRate >= 0.5) return 'secondary'
  return 'destructive'
}

function renderToolsTab({ unavailable, tools }: { unavailable: boolean; tools: UsageToolStat[] }) {
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

function renderActivityTab({ unavailable, activity }: { unavailable: boolean; activity: UsageActivityCell[] }) {
  if (unavailable) return <UnavailableNotice what="Activity data" />
  if (activity.length === 0) return <Empty>No activity yet.</Empty>
  return <Heatmap cells={activity} />
}

function renderSessionsTab({
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

function renderSearchTab({
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
          className="min-w-0 flex-1"
          placeholder="Search…"
          value={searchQ}
          onChange={(e) => {
            onSearchQChange(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRunSearch()
          }}
        />
        <Button type="button" onClick={onRunSearch}>
          <Search className="mr-2 h-4 w-4" aria-hidden="true" />
          Search
        </Button>
      </div>
      {hits.map((h, i) => (
        <button
          key={`${h.session_id}-${h.ordinal}-${i}`}
          type="button"
          className="w-full rounded border p-2 text-left text-sm hover:bg-muted/50"
          onClick={() => {
            onOpenDetail(h.session_id)
          }}
        >
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
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

function renderTracesTab({ traces }: { traces: UsageTraces }) {
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
            className="block rounded border p-2 text-sm hover:bg-muted/50"
          >
            <span className="font-mono text-xs">{t.session_id}</span>
            <span className="ml-2 text-muted-foreground">{t.project}</span>
          </a>
        )
      })}
    </>
  )
}

function renderSessionDetailSheet({ detail, onClose }: { detail: UsageSessionDetail | null; onClose: () => void }) {
  return (
    <Sheet
      open={!!detail}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {detail && (
          <>
            <SheetHeader>
              <SheetTitle>{detail.session.project || detail.session.id}</SheetTitle>
              <SheetDescription>
                {detail.session.agent} · {detail.session.message_count} messages · {fmtUsd(detail.session.cost_usd)}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-2">
              {detail.messages.map((m) => (
                <div key={m.ordinal} className="rounded border p-2 text-sm">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={m.role === 'user' ? 'secondary' : 'outline'} className="text-[10px]">
                      {m.role}
                    </Badge>
                    {m.model && <span className="font-mono">{m.model}</span>}
                    {m.output_tokens > 0 && <span>{fmtNum(m.output_tokens)} out</span>}
                    {m.has_tool_use && <Wrench className="h-3 w-3" aria-hidden="true" />}
                  </div>
                  <div className="mt-1 line-clamp-4 whitespace-pre-wrap">{m.content}</div>
                </div>
              ))}
              {detail.tool_calls.length > 0 && (
                <div className="pt-2">
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">Tool calls</div>
                  <div className="flex flex-wrap gap-1">
                    {detail.tool_calls.map((tc, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">
                        {tc.skill_name ?? tc.tool_name} ({tc.category})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

interface AdminTenantBarProps {
  isAdmin: boolean
  tenantPlaceholder: string
  tenantInput: string
  onTenantInputChange: (v: string) => void
  tenantFilter: string | undefined
  onViewTenant: () => void
}

function renderAdminTenantBar({
  isAdmin,
  tenantPlaceholder,
  tenantInput,
  onTenantInputChange,
  tenantFilter,
  onViewTenant,
}: AdminTenantBarProps) {
  if (!isAdmin) return null
  return (
    <div className="flex items-center gap-1.5">
      <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <label htmlFor="usage-tenant" className="sr-only">
        Tenant ID
      </label>
      <Input
        id="usage-tenant"
        placeholder={tenantPlaceholder}
        value={tenantInput}
        onChange={(e) => {
          onTenantInputChange(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onViewTenant()
        }}
        className="h-8 w-44 text-xs"
      />
      <Button variant="outline" size="sm" className="h-8" onClick={onViewTenant}>
        View tenant
      </Button>
      {tenantFilter && (
        <Badge variant="secondary" className="text-[10px]">
          viewing: {tenantFilter}
        </Badge>
      )}
    </div>
  )
}

function renderAdminTenantNotice({
  isAdmin,
  tenantFilter,
  defaultTenant,
}: {
  isAdmin: boolean
  tenantFilter: string | undefined
  defaultTenant: string | null | undefined
}) {
  if (!isAdmin) return null
  return (
    <p className="text-xs text-muted-foreground">
      Admin view: showing tenant <span className="font-mono">{tenantFilter ?? defaultTenant ?? 'your own'}</span>.
      There is no single "every tenant" query — the server requires naming one tenant at a time (never an implicit
      all-tenant read), so switch tenants above to look at another one.
    </p>
  )
}

function renderDataSourceBadges({ traces }: { traces: UsageTraces | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs">
      <span className="flex items-center gap-1 font-medium text-muted-foreground">
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        Data sources:
      </span>
      {sourceRows(Boolean(traces?.enabled)).map((s) => (
        <Tooltip key={s.label}>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={`cursor-default gap-1 border-none text-[10px] ${SOURCE_STATUS_STYLE[s.status]}`}
            >
              {s.label}: {SOURCE_STATUS_LABEL[s.status]}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{s.note}</TooltipContent>
        </Tooltip>
      ))}
    </div>
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

function renderKpiGrid({
  summaryUnavailable,
  summary,
}: {
  summaryUnavailable: boolean
  summary: UsageSummary | null
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Kpi label="Total cost" value={kpiCost(summaryUnavailable, summary)} icon={Coins} />
      <Kpi label="Tokens (in/out)" value={kpiTokens(summaryUnavailable, summary)} icon={Cpu} />
      <Kpi label="Cache hit rate" value={kpiCacheRate(summaryUnavailable, summary)} icon={Activity} />
      <Kpi label="Sessions" value={kpiSessions(summaryUnavailable, summary)} icon={BarChart3} />
    </div>
  )
}

export default function UsageView() {
  const { identity } = useIdentity()
  const isAdmin = roleAtLeast(identity.role, 'admin')
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [byModel, setByModel] = useState<UsageBreakdown[]>([])
  const [byProject, setByProject] = useState<UsageBreakdown[]>([])
  const [byAgent, setByAgent] = useState<UsageBreakdown[]>([])
  const [tools, setTools] = useState<UsageToolStat[]>([])
  const [activity, setActivity] = useState<UsageActivityCell[]>([])
  const [sessions, setSessions] = useState<UsageSessionRow[]>([])
  const [traces, setTraces] = useState<UsageTraces | null>(null)
  const [detail, setDetail] = useState<UsageSessionDetail | null>(null)
  const [searchQ, setSearchQ] = useState('')
  const [hits, setHits] = useState<UsageSearchHit[]>([])
  const [loading, setLoading] = useState(true)
  // BUG-008 (dashboard-wide follow-on, GOC-28-W06): each of the 6 breakdown/
  // list calls below independently `.catch()`es down to its own safe empty
  // default, so a failing endpoint used to render identically to a real
  // "nothing here yet" -- on a cost/observability surface an operator
  // legitimately needs to trust. Each call now also records whether its most
  // recent fetch actually succeeded.
  const [summaryUnavailable, setSummaryUnavailable] = useState(false)
  const [byModelUnavailable, setByModelUnavailable] = useState(false)
  const [byProjectUnavailable, setByProjectUnavailable] = useState(false)
  const [byAgentUnavailable, setByAgentUnavailable] = useState(false)
  const [toolsUnavailable, setToolsUnavailable] = useState(false)
  const [activityUnavailable, setActivityUnavailable] = useState(false)
  const [sessionsUnavailable, setSessionsUnavailable] = useState(false)
  // Admin-only cross-tenant view (D-AOBS-2). The backend
  // (`agent_utilities.usage.authorization.resolve_usage_tenant`) already lets an
  // admin caller name a DIFFERENT tenant explicitly — by design there is no
  // implicit "every tenant" query, so this is a one-tenant-at-a-time selector,
  // not a merged all-tenants view. Non-admins never see this control and the
  // server independently refuses a non-admin's cross-tenant request either way.
  const [tenantInput, setTenantInput] = useState('')
  const [tenantFilter, setTenantFilter] = useState<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      // D-WUI-17's own closure claimed every one of these 8 calls got an
      // independent `.catch()`; only the last (getUsageTraces) actually did.
      // The other 7 had none, so a single hostile/failing endpoint rejected
      // the whole Promise.all, which (a) discarded every OTHER endpoint's
      // already-successful result too — not just the bad one's — and (b),
      // since refresh() is invoked as `void refresh()` with nothing downstream
      // to catch it, surfaced as an unhandled promise rejection (observed
      // live: intermittently rejecting `hostile-payload-contract-chokepoint
      // .test.tsx`, since Promise.all vs. Promise.allSettled ordering makes
      // which rejection wins a race). Each call now falls back independently
      // to the same safe default its own `useState` already declares.
      const f = tenantFilter ? { tenant_id: tenantFilter } : undefined
      const [s, m, p, a, t, act, sess, tr] = await Promise.all([
        api
          .getUsageSummary(f)
          .then((v) => ({ v, ok: true }))
          .catch(() => ({ v: null, ok: false })),
        api
          .getUsageByModel(f)
          .then((v) => ({ v, ok: true }))
          .catch(() => ({ v: [], ok: false })),
        api
          .getUsageByProject(f)
          .then((v) => ({ v, ok: true }))
          .catch(() => ({ v: [], ok: false })),
        api
          .getUsageByAgent(f)
          .then((v) => ({ v, ok: true }))
          .catch(() => ({ v: [], ok: false })),
        api
          .getUsageTools(f)
          .then((v) => ({ v, ok: true }))
          .catch(() => ({ v: [], ok: false })),
        api
          .getUsageActivity(f)
          .then((v) => ({ v, ok: true }))
          .catch(() => ({ v: [], ok: false })),
        api
          .getUsageTopSessions({ limit: 25, ...f })
          .then((v) => ({ v, ok: true }))
          .catch(() => ({ v: [], ok: false })),
        api.getUsageTraces().catch(() => null),
      ])
      setSummary(s.v)
      setSummaryUnavailable(!s.ok)
      setByModel(m.v)
      setByModelUnavailable(!m.ok)
      setByProject(p.v)
      setByProjectUnavailable(!p.ok)
      setByAgent(a.v)
      setByAgentUnavailable(!a.ok)
      setTools(t.v)
      setToolsUnavailable(!t.ok)
      setActivity(act.v)
      setActivityUnavailable(!act.ok)
      setSessions(sess.v)
      setSessionsUnavailable(!sess.ok)
      setTraces(tr)
    } finally {
      setLoading(false)
    }
  }, [tenantFilter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runSearch = useCallback(async () => {
    if (!searchQ.trim()) return
    setHits(await api.getUsageSearch(searchQ))
  }, [searchQ])

  const openDetail = useCallback(async (id: string) => {
    setDetail(await api.getUsageSessionDetail(id))
  }, [])

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Usage &amp; Cost</h1>
          <p className="text-sm text-muted-foreground">
            Token usage, cost, and metrics across every agent + our own runtime.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {renderAdminTenantBar({
            isAdmin,
            tenantPlaceholder: identity.raw?.tenant ? `tenant (default: ${identity.raw.tenant})` : 'tenant id',
            tenantInput,
            onTenantInputChange: setTenantInput,
            tenantFilter,
            onViewTenant: () => {
              setTenantFilter(tenantInput.trim() || undefined)
            },
          })}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refresh()
            }}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
      </div>

      {renderAdminTenantNotice({ isAdmin, tenantFilter, defaultTenant: identity.raw?.tenant })}

      {renderDataSourceBadges({ traces })}

      {renderKpiGrid({ summaryUnavailable, summary })}
      {summaryUnavailable && <UnavailableNotice what="The usage summary" />}

      <Tabs defaultValue="models">
        <TabsList className="h-auto flex-wrap justify-start gap-1" aria-label="Usage views">
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="tools">Tools &amp; Skills</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
          {traces?.enabled && <TabsTrigger value="traces">Traces</TabsTrigger>}
        </TabsList>

        <TabsContent value="models">
          <Card>
            <CardHeader>
              <CardTitle>Cost by model</CardTitle>
              <CardDescription>Spend and tokens per model.</CardDescription>
            </CardHeader>
            <CardContent>
              <BarRows rows={byModel} unavailable={byModelUnavailable} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="projects">
          <Card>
            <CardHeader>
              <CardTitle>Cost by project</CardTitle>
            </CardHeader>
            <CardContent>
              <BarRows rows={byProject} unavailable={byProjectUnavailable} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agents">
          <Card>
            <CardHeader>
              <CardTitle>Cost by agent</CardTitle>
              <CardDescription>Across all ingested agent tools + runtime.</CardDescription>
            </CardHeader>
            <CardContent>
              <BarRows rows={byAgent} unavailable={byAgentUnavailable} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tools">
          <Card>
            <CardHeader>
              <CardTitle>Tool, skill &amp; database calls</CardTitle>
              <CardDescription>Frequency and success rate.</CardDescription>
            </CardHeader>
            <CardContent>{renderToolsTab({ unavailable: toolsUnavailable, tools })}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Activity heatmap</CardTitle>
              <CardDescription>Sessions by day of week × hour.</CardDescription>
            </CardHeader>
            <CardContent>{renderActivityTab({ unavailable: activityUnavailable, activity })}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions">
          <Card>
            <CardHeader>
              <CardTitle>Top sessions by cost</CardTitle>
            </CardHeader>
            <CardContent>
              {renderSessionsTab({
                unavailable: sessionsUnavailable,
                sessions,
                onOpenDetail: (id) => {
                  void openDetail(id)
                },
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search">
          <Card>
            <CardHeader>
              <CardTitle>Search messages</CardTitle>
              <CardDescription>Full-text search across all sessions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {renderSearchTab({
                searchQ,
                onSearchQChange: setSearchQ,
                onRunSearch: () => {
                  void runSearch()
                },
                hits,
                onOpenDetail: (id) => {
                  void openDetail(id)
                },
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {traces?.enabled && (
          <TabsContent value="traces">
            <Card>
              <CardHeader>
                <CardTitle>Langfuse traces</CardTitle>
                <CardDescription>{traces.host}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">{renderTracesTab({ traces })}</CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {renderSessionDetailSheet({
        detail,
        onClose: () => {
          setDetail(null)
        },
      })}
    </div>
  )
}
