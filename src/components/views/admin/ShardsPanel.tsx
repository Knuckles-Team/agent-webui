/**
 * @file ShardsPanel.tsx
 * @description Shard topology + per-shard health for the Admin console.
 *
 * FULLY WIRED to real engine APIs:
 *   - `GET /api/dashboard/daemon/shards` → `shard_topology_status()` (OS-5.28):
 *     the configured `GRAPH_SERVICE_ENDPOINTS` topology (single vs sharded /
 *     K-way writer layout), a transport-level reachability probe per shard, and
 *     each shard's circuit-breaker state.
 *   - `GET /api/dashboard/daemon/status` → the consolidated KG daemon status.
 */

import { useEffect, useState } from 'react'
import { CheckCircle2, Layers, Loader2, RefreshCw, Server, XCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import { fetchDaemonStatus, fetchShardTopology, type DaemonStatus, type ShardTopology } from '@/lib/admin-api'

function breakerVariant(state: string | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!state) return 'outline'
  const s = state.toLowerCase()
  if (s === 'closed') return 'default'
  if (s === 'open') return 'destructive'
  return 'secondary'
}

export default function ShardsPanel() {
  const [topology, setTopology] = useState<ShardTopology | null>(null)
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  // BUG-008 (dashboard-wide follow-on, GOC-28-W06): `unavailable` is only
  // ever true for an HTTP 404/501 (the route genuinely not activated yet) --
  // a real error (network failure, 5xx) left `topology` at `null` with NO
  // distinguishing state, so "No shard endpoints reported." rendered
  // identically for that error and for a genuine zero-shard topology.
  // `topologyError` closes that gap.
  const [topologyError, setTopologyError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    const [top, dae] = await Promise.all([fetchShardTopology(), fetchDaemonStatus()])
    setUnavailable(top.unavailable)
    setTopologyError(!top.ok && !top.unavailable ? (top.error ?? 'The shard topology request failed.') : null)
    setTopology(top.ok ? top.data : null)
    setDaemon(dae.ok ? dae.data : null)
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const endpoints = topology?.endpoints ?? []
  const reachable = endpoints.filter((e) => e.reachable).length

  return (
    <div className="space-y-6" data-testid="admin-shards-panel">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Layers className="size-5" />
            Shard Topology
            {topology && (
              <Badge variant="secondary" className="uppercase">
                {topology.mode}
              </Badge>
            )}
          </h2>
          <p className="text-muted-foreground text-sm">
            K-way writer layout, per-shard reachability and circuit-breaker state.
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
          <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {unavailable ? (
        <p className="text-muted-foreground text-sm">
          The <code>/api/dashboard/daemon/shards</code> route is not activated on this backend yet.
        </p>
      ) : topologyError ? (
        <UnavailableNotice what={`Shard topology (${topologyError})`} />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Mode</p>
                <p className="text-2xl font-bold capitalize">{topology?.mode ?? '-'}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Shards</p>
                <p className="text-2xl font-bold">{endpoints.length || '-'}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Reachable</p>
                <p className="text-2xl font-bold">
                  {endpoints.length ? `${String(reachable)}/${String(endpoints.length)}` : '-'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Default graph</p>
                <p className="text-lg font-semibold font-mono truncate">{topology?.default_graph ?? '-'}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Shards</CardTitle>
              <CardDescription>Each configured engine endpoint and its live health.</CardDescription>
            </CardHeader>
            <CardContent>
              {endpoints.length === 0 ? (
                <p className="text-muted-foreground text-sm">No shard endpoints reported.</p>
              ) : (
                <div className="space-y-2">
                  {endpoints.map((ep, idx) => (
                    <div key={ep.endpoint} className="flex items-center justify-between rounded border p-3 text-sm">
                      <div className="flex items-center gap-3 min-w-0">
                        <Server className="size-4 shrink-0 text-muted-foreground" />
                        <div className="flex flex-col min-w-0">
                          <span className="font-mono truncate">{ep.endpoint}</span>
                          <span className="text-xs text-muted-foreground">
                            writer #{idx} {ep.local ? '· local' : '· remote'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {ep.local && <Badge variant="outline">local</Badge>}
                        {ep.breaker && (
                          <Badge variant={breakerVariant(ep.breaker)} className="font-mono text-xs">
                            {ep.breaker}
                          </Badge>
                        )}
                        {ep.reachable ? (
                          <Badge variant="default" className="gap-1">
                            <CheckCircle2 className="size-3" />
                            up
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1">
                            <XCircle className="size-3" />
                            down
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daemon</CardTitle>
              <CardDescription>The consolidated KG background daemon that hosts the local shard.</CardDescription>
            </CardHeader>
            <CardContent>
              {daemon ? (
                <div className="flex flex-wrap gap-2 text-sm">
                  {daemon.role !== undefined && (
                    <Badge variant="secondary" className="gap-1">
                      role: {daemon.role}
                    </Badge>
                  )}
                  <Badge variant={daemon.running ? 'default' : 'outline'} className="gap-1">
                    {daemon.running ? <Loader2 className="size-3 animate-spin" /> : <XCircle className="size-3" />}
                    {daemon.running ? 'running' : 'stopped'}
                  </Badge>
                  {daemon.queue_depth !== undefined && (
                    <Badge variant="secondary">queue: {String(daemon.queue_depth)}</Badge>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">Daemon status unavailable.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
