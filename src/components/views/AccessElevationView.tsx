/**
 * @file AccessElevationView.tsx
 * @description Just-in-time access elevation: request, approve, revoke.
 *
 * A request grants nothing until a DIFFERENT person approves it here; the
 * window starts at approval, counts down, and ends on its own (or at once on
 * revoke). The console never offers to approve the signed-in user's own
 * request, and sends no identity at all: the platform takes both the requester
 * and the approver from the authenticated session and re-checks every rule.
 */

import { useEffect, useState, type SyntheticEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, KeyRound, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import {
  approveElevation,
  canApprove,
  canRevoke,
  formatRemaining,
  listElevations,
  MAX_SPAN_MS,
  requestElevation,
  revokeElevation,
  type Elevation,
  type ElevationAsk,
} from '@/lib/elevation'

const REFRESH_MS = 10_000
const QUERY_KEY = ['elevations'] as const
const MINUTE_MS = 60_000

function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [])
  return now
}

function RequestForm({ onSubmit, busy }: { onSubmit: (ask: ElevationAsk) => void; busy: boolean }) {
  const [graph, setGraph] = useState('')
  const [action, setAction] = useState<'read' | 'write'>('read')
  const [minutes, setMinutes] = useState(60)
  const [justification, setJustification] = useState('')
  const valid = graph.trim() !== '' && justification.trim() !== '' && minutes > 0
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    const span = Math.min(minutes * MINUTE_MS, MAX_SPAN_MS)
    onSubmit({ scopes: [{ graph: graph.trim(), action }], span_ms: span, justification: justification.trim() })
  }
  return (
    <form className="grid gap-3 md:grid-cols-4" onSubmit={submit} aria-label="Request elevation">
      <Input
        aria-label="Graph"
        placeholder="Graph name"
        value={graph}
        onChange={(e) => {
          setGraph(e.target.value)
        }}
      />
      <select
        aria-label="Access"
        className="border rounded-md px-2 text-sm bg-background"
        value={action}
        onChange={(e) => {
          setAction(e.target.value === 'write' ? 'write' : 'read')
        }}
      >
        <option value="read">Read</option>
        <option value="write">Write</option>
      </select>
      <Input
        aria-label="Minutes"
        type="number"
        min={1}
        max={MAX_SPAN_MS / MINUTE_MS}
        value={minutes}
        onChange={(e) => {
          setMinutes(Number(e.target.value))
        }}
      />
      <Button type="submit" disabled={!valid || busy}>
        <KeyRound className="h-4 w-4 mr-1" /> Request
      </Button>
      <Textarea
        className="md:col-span-4"
        aria-label="Justification"
        placeholder="Why is this access needed?"
        value={justification}
        onChange={(e) => {
          setJustification(e.target.value)
        }}
      />
    </form>
  )
}

function Countdown({ elevation, fetchedAt, now }: { elevation: Elevation; fetchedAt: number; now: number }) {
  if (elevation.status !== 'active') return null
  const left = elevation.remaining_ms - (now - fetchedAt)
  return (
    <span className="flex items-center gap-1 text-xs tabular-nums" aria-label="Time remaining">
      <Clock className="h-3 w-3" /> {formatRemaining(left)}
    </span>
  )
}

interface RowProps {
  elevation: Elevation
  fetchedAt: number
  now: number
  onApprove: (elevation: Elevation) => void
  onRevoke: (elevation: Elevation) => void
}

function ElevationRow({ elevation, fetchedAt, now, onApprove, onRevoke }: RowProps) {
  const scopes = elevation.scopes.map((scope) => `${scope.action} ${scope.graph}`).join(', ')
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border rounded-md px-3 py-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{scopes}</span>
          <Badge variant={elevation.status === 'active' ? 'default' : 'outline'}>{elevation.status}</Badge>
          {elevation.own && <Badge variant="secondary">yours</Badge>}
          <Countdown elevation={elevation} fetchedAt={fetchedAt} now={now} />
        </div>
        <span className="text-xs text-muted-foreground">
          {elevation.grantee} · {elevation.justification}
        </span>
      </div>
      <div className="flex gap-2">
        {canApprove(elevation) && (
          <Button
            size="sm"
            onClick={() => {
              onApprove(elevation)
            }}
          >
            <Check className="h-4 w-4 mr-1" /> Approve
          </Button>
        )}
        {canRevoke(elevation) && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onRevoke(elevation)
            }}
          >
            <X className="h-4 w-4 mr-1" /> Revoke
          </Button>
        )}
      </div>
    </div>
  )
}

export default function AccessElevationView() {
  const queryClient = useQueryClient()
  const now = useNow()
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => ({ fetchedAt: Date.now(), rows: await listElevations() }),
    refetchInterval: REFRESH_MS,
  })
  const act = useMutation({
    mutationFn: (run: () => Promise<Elevation>) => run(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: () => toast.error('The elevation change was refused or could not be completed.'),
  })
  const rows = query.data?.rows ?? []
  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Request access elevation
          </CardTitle>
          <CardDescription>
            Time-boxed access to one graph. Another person must approve it; it ends on its own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RequestForm
            busy={act.isPending}
            onSubmit={(ask) => {
              act.mutate(() => requestElevation(ask))
            }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Elevations</CardTitle>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Refresh"
            onClick={() => {
              void query.refetch()
            }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {query.isError && <UnavailableNotice what="Elevations" />}
          {query.isSuccess && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No elevations requested or active.</p>
          )}
          {rows.map((elevation) => (
            <ElevationRow
              key={elevation.elevation_id}
              elevation={elevation}
              fetchedAt={query.data?.fetchedAt ?? now}
              now={now}
              onApprove={(e) => {
                act.mutate(() => approveElevation(e))
              }}
              onRevoke={(e) => {
                act.mutate(() => revokeElevation(e.elevation_id))
              }}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
