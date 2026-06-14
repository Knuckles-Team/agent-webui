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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, BarChart3, Coins, Cpu, RefreshCw, Search, Wrench } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
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

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const fmtUsd = (n: number) => `$${(n ?? 0).toFixed(2)}`
const fmtNum = (n: number) => ((n ?? 0) >= 1000 ? `${((n ?? 0) / 1000).toFixed(1)}k` : String(n ?? 0))

function Kpi({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Coins }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

/** Horizontal bar rows for a breakdown (cost-weighted). */
function BarRows({ rows }: { rows: UsageBreakdown[] }) {
  const max = Math.max(1, ...rows.map((r) => r.cost_usd))
  if (!rows.length) return <Empty>No data yet.</Empty>
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3 text-sm">
          <div className="w-40 shrink-0 truncate font-mono text-xs" title={r.key}>
            {r.key}
          </div>
          <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
            <div className="h-full bg-primary" style={{ width: `${(r.cost_usd / max) * 100}%` }} />
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
      <div className="inline-grid" style={{ gridTemplateColumns: `auto repeat(24, 1fr)` }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="px-1 text-center text-[9px] text-muted-foreground">
            {h % 6 === 0 ? h : ''}
          </div>
        ))}
        {DAYS.map((d, di) => (
          <>
            <div key={`l${di}`} className="pr-2 text-right text-[10px] text-muted-foreground">
              {d}
            </div>
            {Array.from({ length: 24 }, (_, h) => {
              const c = grid.get(`${di}-${h}`)
              const intensity = c ? 0.15 + (c.sessions / max) * 0.85 : 0
              return (
                <div
                  key={`${di}-${h}`}
                  className="m-[1px] aspect-square rounded-[2px]"
                  style={{
                    backgroundColor: c
                      ? `color-mix(in srgb, var(--primary) ${intensity * 100}%, transparent)`
                      : 'var(--muted)',
                  }}
                  title={c ? `${d} ${h}:00 — ${c.sessions} sessions, ${fmtUsd(c.cost_usd)}` : `${d} ${h}:00`}
                />
              )
            })}
          </>
        ))}
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{children}</div>
}

export default function UsageView() {
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

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [s, m, p, a, t, act, sess, tr] = await Promise.all([
        api.getUsageSummary(),
        api.getUsageByModel(),
        api.getUsageByProject(),
        api.getUsageByAgent(),
        api.getUsageTools(),
        api.getUsageActivity(),
        api.getUsageTopSessions({ limit: 25 }),
        api.getUsageTraces().catch(() => null),
      ])
      setSummary(s)
      setByModel(m)
      setByProject(p)
      setByAgent(a)
      setTools(t)
      setActivity(act)
      setSessions(sess)
      setTraces(tr)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const runSearch = useCallback(async () => {
    if (!searchQ.trim()) return
    setHits(await api.getUsageSearch(searchQ))
  }, [searchQ])

  const openDetail = useCallback(async (id: string) => {
    setDetail(await api.getUsageSessionDetail(id))
  }, [])

  const totals = summary?.totals

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Usage &amp; Cost</h1>
          <p className="text-sm text-muted-foreground">
            Token usage, cost, and metrics across every agent + our own runtime.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total cost" value={fmtUsd(totals?.cost_usd ?? 0)} icon={Coins} />
        <Kpi
          label="Tokens (in/out)"
          value={`${fmtNum(totals?.input_tokens ?? 0)} / ${fmtNum(totals?.output_tokens ?? 0)}`}
          icon={Cpu}
        />
        <Kpi label="Cache hit rate" value={`${Math.round((summary?.cache_hit_rate ?? 0) * 100)}%`} icon={Activity} />
        <Kpi label="Sessions" value={fmtNum(summary?.session_count ?? 0)} icon={BarChart3} />
      </div>

      <Tabs defaultValue="models">
        <TabsList>
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
              <BarRows rows={byModel} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="projects">
          <Card>
            <CardHeader>
              <CardTitle>Cost by project</CardTitle>
            </CardHeader>
            <CardContent>
              <BarRows rows={byProject} />
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
              <BarRows rows={byAgent} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tools">
          <Card>
            <CardHeader>
              <CardTitle>Tool, skill &amp; database calls</CardTitle>
              <CardDescription>Frequency and success rate.</CardDescription>
            </CardHeader>
            <CardContent>
              {tools.length === 0 ? (
                <Empty>No tool calls recorded yet.</Empty>
              ) : (
                <div className="space-y-1">
                  {tools.map((t) => (
                    <div key={`${t.name}-${t.category}`} className="flex items-center gap-3 text-sm">
                      <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="w-44 shrink-0 truncate font-mono text-xs">{t.name}</span>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {t.category}
                      </Badge>
                      <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${Math.min(100, (t.calls / Math.max(1, tools[0].calls)) * 100)}%` }}
                        />
                      </div>
                      <span className="w-12 text-right tabular-nums">{t.calls}</span>
                      <Badge
                        variant={
                          t.success_rate >= 0.9 ? 'default' : t.success_rate >= 0.5 ? 'secondary' : 'destructive'
                        }
                        className="w-14 shrink-0 justify-center text-[10px]"
                      >
                        {Math.round(t.success_rate * 100)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Activity heatmap</CardTitle>
              <CardDescription>Sessions by day of week × hour.</CardDescription>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? <Empty>No activity yet.</Empty> : <Heatmap cells={activity} />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions">
          <Card>
            <CardHeader>
              <CardTitle>Top sessions by cost</CardTitle>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <Empty>No sessions yet.</Empty>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="pb-2">Project</th>
                      <th className="pb-2">Agent</th>
                      <th className="pb-2 text-right">Msgs</th>
                      <th className="pb-2 text-right">Cost</th>
                      <th className="pb-2 text-center">Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr
                        key={s.id}
                        className="cursor-pointer border-t hover:bg-muted/50"
                        onClick={() => openDetail(s.id)}
                      >
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
              <div className="flex gap-2">
                <Input
                  placeholder="Search…"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                />
                <Button onClick={runSearch}>
                  <Search className="mr-2 h-4 w-4" />
                  Search
                </Button>
              </div>
              {hits.map((h, i) => (
                <div
                  key={`${h.session_id}-${h.ordinal}-${i}`}
                  className="cursor-pointer rounded border p-2 text-sm hover:bg-muted/50"
                  onClick={() => openDetail(h.session_id)}
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">
                      {h.agent}
                    </Badge>
                    <span>{h.project}</span>
                    <span>·</span>
                    <span>{h.role}</span>
                  </div>
                  <div className="mt-1">{h.snippet}</div>
                </div>
              ))}
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
              <CardContent className="space-y-1">
                {traces.traces.map((t) => (
                  <a
                    key={t.session_id}
                    href={t.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded border p-2 text-sm hover:bg-muted/50"
                  >
                    <span className="font-mono text-xs">{t.session_id}</span>
                    <span className="ml-2 text-muted-foreground">{t.project}</span>
                  </a>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
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
                      {m.has_tool_use && <Wrench className="h-3 w-3" />}
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
                          {tc.skill_name || tc.tool_name} ({tc.category})
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
    </div>
  )
}
