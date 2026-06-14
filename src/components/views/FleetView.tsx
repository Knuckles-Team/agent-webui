/**
 * @file FleetView.tsx
 * @description Swarm supervisory dashboard — the single pane of glass over the
 * running agent fleet (CONCEPT:OS-5.10).
 *
 * Surfaces the gateway's native /api/fleet/* endpoints: per-domain swarm health
 * and error rates, live session topology, one-click emergency containment
 * (pause / kill a whole domain), and the mutation/risk approval queue. No
 * separate supervisor service — these are native gateway endpoints.
 */

import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, Ban, PauseCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { api, type FleetHealth, type FleetTopology } from '@/lib/api'

const REFRESH_MS = 5000

export default function FleetView() {
  const [health, setHealth] = useState<FleetHealth | null>(null)
  const [topology, setTopology] = useState<FleetTopology | null>(null)
  const [approvals, setApprovals] = useState<unknown[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [h, t, a] = await Promise.all([
        api.getFleetHealth().catch(() => null),
        api.getFleetTopology().catch(() => null),
        api.getFleetApprovals().catch(() => ({ pending: [] })),
      ])
      if (h) setHealth(h)
      if (t) setTopology(t)
      setApprovals((a as { pending: unknown[] })?.pending ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  const containDomain = async (domain: string, action: 'pause' | 'kill') => {
    try {
      const fn = action === 'pause' ? api.pauseFleet : api.killFleet
      const res = await fn({ domain })
      toast.success(`${action === 'pause' ? 'Paused' : 'Killed'} ${res.count} session(s) in "${domain}"`)
      refresh()
    } catch (e) {
      toast.error(`Failed to ${action} domain: ${String(e)}`)
    }
  }

  const grant = async (jobId: string, decision: 'approved' | 'denied') => {
    try {
      await api.grantFleetApproval(jobId, decision)
      toast.success(`Approval ${decision}`)
      refresh()
    } catch (e) {
      toast.error(`Failed to ${decision}: ${String(e)}`)
    }
  }

  const domains = health ? Object.entries(health.domains) : []

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="h-6 w-6" /> Fleet Supervisor
          </h2>
          <p className="text-sm text-muted-foreground">
            Live swarm health, topology, and emergency containment across the enterprise.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Sessions" value={health?.sessions.total ?? '—'} />
        <SummaryCard label="Active goal loops" value={health?.goals.active ?? '—'} />
        <SummaryCard label="Domains" value={topology?.totals.domains ?? '—'} />
        <SummaryCard
          label="Failed / cancelled"
          value={health ? Object.values(health.domains).reduce((n, d) => n + d.errored, 0) : '—'}
        />
      </div>

      <Tabs defaultValue="health">
        <TabsList>
          <TabsTrigger value="health">Domain Health</TabsTrigger>
          <TabsTrigger value="topology">Topology</TabsTrigger>
          <TabsTrigger value="approvals">Approvals{approvals.length ? ` (${approvals.length})` : ''}</TabsTrigger>
        </TabsList>

        {/* Per-domain health + containment */}
        <TabsContent value="health">
          <Card>
            <CardHeader>
              <CardTitle>Per-domain error rates & containment</CardTitle>
              <CardDescription>
                Pause halts goal loops; Kill cancels every session in the domain (blast-radius stop).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {domains.length === 0 && <p className="text-sm text-muted-foreground">No active sessions.</p>}
              {domains.map(([domain, d]) => (
                <div key={domain} className="flex items-center justify-between border rounded-md px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{domain}</span>
                    <Badge variant="secondary">{d.active} active</Badge>
                    <Badge variant={d.error_rate > 0.2 ? 'destructive' : 'outline'}>
                      {(d.error_rate * 100).toFixed(0)}% errors
                    </Badge>
                    <span className="text-xs text-muted-foreground">{d.total} total</span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => containDomain(domain, 'pause')}>
                      <PauseCircle className="h-4 w-4 mr-1" /> Pause
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => containDomain(domain, 'kill')}>
                      <Ban className="h-4 w-4 mr-1" /> Kill
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Topology */}
        <TabsContent value="topology">
          <Card>
            <CardHeader>
              <CardTitle>Live agent topology</CardTitle>
              <CardDescription>Durable sessions grouped by enterprise domain.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(topology?.domains ?? []).map((dom) => (
                <div key={dom.domain}>
                  <div className="font-medium mb-1">{dom.domain}</div>
                  <div className="flex flex-wrap gap-2">
                    {dom.sessions.map((s) => (
                      <Badge
                        key={s.id}
                        variant={
                          s.status === 'cancelled' || s.status === 'failed'
                            ? 'destructive'
                            : s.needs_input
                              ? 'secondary'
                              : 'outline'
                        }
                        title={`${s.id} · ${s.status}`}
                      >
                        {s.id?.slice(0, 8)} · {s.status}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Approval queue */}
        <TabsContent value="approvals">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" /> Mutation / risk approval queue
              </CardTitle>
              <CardDescription>Pending high-risk actions awaiting human sign-off.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {approvals.length === 0 && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> No pending approvals.
                </p>
              )}
              {approvals.map((raw, i) => {
                const item = raw as Record<string, unknown>
                const jobId = String(item.id ?? item.job_id ?? `job-${i}`)
                return (
                  <div key={jobId} className="flex items-center justify-between border rounded-md px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="font-mono text-xs truncate">{jobId}</span>
                      <span className="text-sm text-muted-foreground truncate">{String(item.description ?? '')}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => grant(jobId, 'approved')}>
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => grant(jobId, 'denied')}>
                        Deny
                      </Button>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}
