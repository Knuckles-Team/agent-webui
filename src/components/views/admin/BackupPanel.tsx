/**
 * @file BackupPanel.tsx
 * @description Backup / point-in-time-restore for the Admin console.
 *
 * WIRING (honest): online backup + PITR is CONCEPT:EG-090 — a `Method::Backup`
 * engine op that streams a per-shard MVCC snapshot, reachable today only over
 * the epistemic_graph UDS client, not over a browser-facing REST route. This
 * panel PROBES `POST /api/graph/configure` action=backup_status and, when it
 * resolves `unavailable` (the common case today), renders a clearly-labeled
 * read-only placeholder with DISABLED trigger controls — it never invents backup
 * records or a fake PITR window. If/when the REST twin lands, the same probe
 * renders live status and the trigger control activates with no further wiring.
 */

import { useEffect, useState } from 'react'
import { Archive, Clock, DatabaseBackup, Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { fetchBackupStatus, triggerBackup, type BackupStatus } from '@/lib/admin-api'

function fmtBytes(n: number | undefined): string {
  if (n === undefined) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v.toFixed(1)} ${units[u]}`
}

export default function BackupPanel() {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [loading, setLoading] = useState(false)
  const [triggering, setTriggering] = useState(false)

  const refresh = async () => {
    setLoading(true)
    const r = await fetchBackupStatus()
    setUnavailable(!r.ok)
    setStatus(r.ok ? r.data : null)
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const onTrigger = async () => {
    setTriggering(true)
    await triggerBackup()
    await refresh()
    setTriggering(false)
  }

  const backups = status?.backups ?? []
  const wired = !unavailable

  return (
    <div className="space-y-6" data-testid="admin-backup-panel">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <DatabaseBackup className="size-5" />
            Backup &amp; PITR
          </h2>
          <p className="text-muted-foreground text-sm">Online backups and point-in-time restore (CONCEPT:EG-090).</p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button
            size="sm"
            onClick={() => {
              void onTrigger()
            }}
            disabled={!wired || triggering}
            title={wired ? 'Trigger an online backup' : 'Backup REST twin not wired yet'}
          >
            {triggering ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
            <span className="ml-2">Trigger backup</span>
          </Button>
        </div>
      </div>

      {loading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : !wired ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Badge variant="outline">read-only · not wired</Badge>
              Backup/PITR not exposed over REST yet
            </CardTitle>
            <CardDescription>
              Online backup / restore (EG-090) is reachable today only over the epistemic-graph UDS client (a
              <code> Method::Backup</code> op streaming a per-shard MVCC snapshot). This panel will list snapshots,
              show the PITR window, and enable the trigger control as soon as the REST twin is wired; until then it is
              read-only by design and shows no fabricated backups.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">The engine backup model:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Online per-shard MVCC snapshot streamed verbatim (no write-stall).</li>
              <li>Point-in-time restore to a chosen LSN / timestamp within the retained window.</li>
            </ul>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Snapshots</p>
                <p className="text-2xl font-bold">{backups.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Last backup</p>
                <p className="text-lg font-semibold">{status?.last_backup_at ?? '-'}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Clock className="size-3.5" />
                  PITR window
                </p>
                <p className="text-xs font-mono">
                  {status?.pitr_window?.earliest ?? '-'} → {status?.pitr_window?.latest ?? '-'}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Snapshots</CardTitle>
              <CardDescription>Retained backups available for point-in-time restore.</CardDescription>
            </CardHeader>
            <CardContent>
              {backups.length === 0 ? (
                <p className="text-muted-foreground text-sm">No snapshots yet.</p>
              ) : (
                <div className="space-y-2">
                  {backups.map((b) => (
                    <div key={b.id} className="flex items-center justify-between rounded border p-2 text-sm">
                      <div className="flex flex-col min-w-0">
                        <span className="font-mono truncate">{b.id}</span>
                        <span className="text-xs text-muted-foreground">
                          {b.created_at ?? '-'} {b.shard ? `· ${b.shard}` : ''} {b.lsn ? `· LSN ${b.lsn}` : ''}
                        </span>
                      </div>
                      <Badge variant="secondary">{fmtBytes(b.size_bytes)}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
