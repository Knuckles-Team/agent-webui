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
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import { toast } from 'sonner'
import { api, type FleetHealth, type FleetTopology } from '@/lib/api'

const REFRESH_MS = 5000

// BUG-008 (dashboard-wide follow-on, GOC-28-W06): a failed `getFleetHealth`/
// `getFleetTopology`/`getFleetApprovals` call used to be swallowed by
// `.catch(() => null)` / `.catch(() => ({ pending: [] }))`, so an operator
// whose fleet-supervisor fetch was actually failing (network error, 5xx,
// auth expiry) saw the exact same "No active sessions." / "No pending
// approvals." text as a genuinely healthy, empty fleet -- a false
// reassurance on the surface that gates emergency pause/kill and the
// mutation/risk approval queue. Each section now tracks its own fetch
// outcome so "confirmed empty" and "couldn't be confirmed" never render
// identically. Mirrors `EcosystemView.tsx`'s `EcoStatus`/`ServiceNotice`.
type FleetSectionStatus = 'loading' | 'ready' | 'unavailable'

function renderDomainRow({
  domain,
  d,
  onContain,
}: {
  domain: string
  d: FleetHealth['domains'][string]
  onContain: (domain: string, action: 'pause' | 'kill') => void
}) {
  return (
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onContain(domain, 'pause')
          }}
        >
          <PauseCircle className="h-4 w-4 mr-1" /> Pause
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => {
            onContain(domain, 'kill')
          }}
        >
          <Ban className="h-4 w-4 mr-1" /> Kill
        </Button>
      </div>
    </div>
  )
}

function renderHealthTab({
  healthStatus,
  domains,
  onContain,
}: {
  healthStatus: FleetSectionStatus
  domains: [string, FleetHealth['domains'][string]][]
  onContain: (domain: string, action: 'pause' | 'kill') => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Per-domain error rates & containment</CardTitle>
        <CardDescription>
          Pause halts goal loops; Kill cancels every session in the domain (blast-radius stop).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {healthStatus === 'unavailable' && <UnavailableNotice what="Domain health" />}
        {healthStatus === 'ready' && domains.length === 0 && (
          <p className="text-sm text-muted-foreground">No active sessions.</p>
        )}
        {domains.map(([domain, d]) => renderDomainRow({ domain, d, onContain }))}
      </CardContent>
    </Card>
  )
}

function sessionBadgeVariant(s: { status: string; needs_input: boolean }): 'destructive' | 'secondary' | 'outline' {
  if (s.status === 'cancelled' || s.status === 'failed') return 'destructive'
  if (s.needs_input) return 'secondary'
  return 'outline'
}

function renderTopologyDomain(dom: FleetTopology['domains'][number]) {
  return (
    <div key={dom.domain}>
      <div className="font-medium mb-1">{dom.domain}</div>
      <div className="flex flex-wrap gap-2">
        {dom.sessions.map((s) => (
          <Badge key={s.id} variant={sessionBadgeVariant(s)} title={`${s.id} · ${s.status}`}>
            {s.id.slice(0, 8)} · {s.status}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function renderTopologyTab({
  topologyStatus,
  topology,
}: {
  topologyStatus: FleetSectionStatus
  topology: FleetTopology | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Live agent topology</CardTitle>
        <CardDescription>Durable sessions grouped by enterprise domain.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {topologyStatus === 'unavailable' && <UnavailableNotice what="Topology" />}
        {topologyStatus === 'ready' && (topology?.domains.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">No active sessions.</p>
        )}
        {(topology?.domains ?? []).map(renderTopologyDomain)}
      </CardContent>
    </Card>
  )
}

function renderApprovalRow({
  raw,
  index,
  onGrant,
}: {
  raw: unknown
  index: number
  onGrant: (jobId: string, decision: 'approved' | 'denied') => void
}) {
  const item = raw as Record<string, unknown>
  const idVal = item.id ?? item.job_id
  const jobId = typeof idVal === 'string' ? idVal : `job-${index}`
  return (
    <div key={jobId} className="flex items-center justify-between border rounded-md px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <span className="font-mono text-xs truncate">{jobId}</span>
        <span className="text-sm text-muted-foreground truncate">
          {typeof item.description === 'string' ? item.description : ''}
        </span>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onGrant(jobId, 'approved')
          }}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onGrant(jobId, 'denied')
          }}
        >
          Deny
        </Button>
      </div>
    </div>
  )
}

function renderApprovalsTab({
  approvalsStatus,
  approvals,
  onGrant,
}: {
  approvalsStatus: FleetSectionStatus
  approvals: unknown[]
  onGrant: (jobId: string, decision: 'approved' | 'denied') => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" /> Mutation / risk approval queue
        </CardTitle>
        <CardDescription>Pending high-risk actions awaiting human sign-off.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {approvalsStatus === 'unavailable' && <UnavailableNotice what="The mutation/risk approval queue" />}
        {approvalsStatus === 'ready' && approvals.length === 0 && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> No pending approvals.
          </p>
        )}
        {approvals.map((raw, i) => renderApprovalRow({ raw, index: i, onGrant }))}
      </CardContent>
    </Card>
  )
}

function totalErrored(health: FleetHealth | null): number | '—' {
  if (!health) return '—'
  return Object.values(health.domains).reduce((n, d) => n + d.errored, 0)
}

function renderFleetSummaryCards({
  health,
  topology,
}: {
  health: FleetHealth | null
  topology: FleetTopology | null
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <SummaryCard label="Sessions" value={health?.sessions.total ?? '—'} />
      <SummaryCard label="Active goal loops" value={health?.goals.active ?? '—'} />
      <SummaryCard label="Domains" value={topology?.totals.domains ?? '—'} />
      <SummaryCard label="Failed / cancelled" value={totalErrored(health)} />
    </div>
  )
}

export default function FleetView() {
  const [health, setHealth] = useState<FleetHealth | null>(null)
  const [healthStatus, setHealthStatus] = useState<FleetSectionStatus>('loading')
  const [topology, setTopology] = useState<FleetTopology | null>(null)
  const [topologyStatus, setTopologyStatus] = useState<FleetSectionStatus>('loading')
  const [approvals, setApprovals] = useState<unknown[]>([])
  const [approvalsStatus, setApprovalsStatus] = useState<FleetSectionStatus>('loading')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [h, t, a] = await Promise.all([
        api
          .getFleetHealth()
          .then((v) => ({ ok: true as const, v }))
          .catch(() => ({ ok: false as const, v: null })),
        api
          .getFleetTopology()
          .then((v) => ({ ok: true as const, v }))
          .catch(() => ({ ok: false as const, v: null })),
        api
          .getFleetApprovals()
          .then((v) => ({ ok: true as const, v }))
          .catch(() => ({ ok: false as const, v: null })),
      ])
      if (h.ok) {
        setHealth(h.v)
        setHealthStatus('ready')
      } else {
        setHealthStatus('unavailable')
      }
      if (t.ok) {
        setTopology(t.v)
        setTopologyStatus('ready')
      } else {
        setTopologyStatus('unavailable')
      }
      if (a.ok) {
        setApprovals(a.v.pending)
        setApprovalsStatus('ready')
      } else {
        setApprovalsStatus('unavailable')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => {
      void refresh()
    }, REFRESH_MS)
    return () => {
      clearInterval(id)
    }
  }, [refresh])

  const containDomain = async (domain: string, action: 'pause' | 'kill') => {
    try {
      const fn = action === 'pause' ? api.pauseFleet : api.killFleet
      const res = await fn({ domain })
      toast.success(`${action === 'pause' ? 'Paused' : 'Killed'} ${res.count} session(s) in "${domain}"`)
      void refresh()
    } catch (e) {
      toast.error(`Failed to ${action} domain: ${String(e)}`)
    }
  }

  const grant = async (jobId: string, decision: 'approved' | 'denied') => {
    try {
      await api.grantFleetApproval(jobId, decision)
      toast.success(`Approval ${decision}`)
      void refresh()
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void refresh()
          }}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {/* Summary cards */}
      {renderFleetSummaryCards({ health, topology })}

      <Tabs defaultValue="health">
        <TabsList>
          <TabsTrigger value="health">Domain Health</TabsTrigger>
          <TabsTrigger value="topology">Topology</TabsTrigger>
          <TabsTrigger value="approvals">Approvals{approvals.length ? ` (${approvals.length})` : ''}</TabsTrigger>
        </TabsList>

        {/* Per-domain health + containment */}
        <TabsContent value="health">
          {renderHealthTab({
            healthStatus,
            domains,
            onContain: (domain, action) => {
              void containDomain(domain, action)
            },
          })}
        </TabsContent>

        {/* Topology */}
        <TabsContent value="topology">{renderTopologyTab({ topologyStatus, topology })}</TabsContent>

        {/* Approval queue */}
        <TabsContent value="approvals">
          {renderApprovalsTab({
            approvalsStatus,
            approvals,
            onGrant: (jobId, decision) => {
              void grant(jobId, decision)
            },
          })}
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
