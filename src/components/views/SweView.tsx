/**
 * @file SweView.tsx
 * @description KG-grounded SWE agent view (OS-5.34).
 *
 * Drives the developer-workspace runtime (OS-5.33) from the browser: create a
 * session, send shell/file actions, and watch the live action/observation event
 * stream over SSE (/api/runtime/sessions/{id}/events). The differentiator over a
 * flat log is the Provenance panel, which renders the KG symbol graph the agent
 * reasoned over — the WorkspaceAction nodes and the Code symbols each edit
 * mutated (KG-2.64), fetched from /api/runtime/sessions/{id}/provenance.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { GitBranch, Loader2, Play, Send, Square, Workflow } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { api, type SweMutatedEdge, type SweProvenanceAction } from '@/lib/api'

interface StreamEvent {
  action: Record<string, unknown>
  observation: Record<string, unknown>
}

/** Coerce an unknown event field to a display string (events are typed Record<string, unknown>). */
const asText = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

const SweView = () => {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [backend, setBackend] = useState('')
  const [busy, setBusy] = useState(false)
  const [command, setCommand] = useState('')
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [provActions, setProvActions] = useState<SweProvenanceAction[]>([])
  const [mutated, setMutated] = useState<SweMutatedEdge[]>([])
  const sourceRef = useRef<EventSource | null>(null)

  const closeStream = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
  }, [])

  useEffect(
    () => () => {
      closeStream()
    },
    [closeStream],
  )

  const startSession = async () => {
    setBusy(true)
    try {
      // local backend keeps the demo zero-infra; flip prefer_docker for isolation
      const res = await api.createSweSession({ prefer_docker: false })
      setSessionId(res.session_id)
      setBackend(res.backend)
      setEvents([])
      const es = new EventSource(api.sweEventsUrl(res.session_id))
      es.onmessage = (e) => {
        try {
          setEvents((prev) => [...prev, JSON.parse(e.data as string) as StreamEvent])
        } catch {
          /* ignore malformed frames */
        }
      }
      sourceRef.current = es
    } catch (err) {
      toast.error(`Failed to start session: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const stopSession = async () => {
    if (!sessionId) return
    closeStream()
    try {
      await api.stopSweSession(sessionId)
    } catch {
      /* best-effort teardown */
    }
    setSessionId(null)
    setBackend('')
    setProvActions([])
    setMutated([])
  }

  const sendCommand = async () => {
    if (!sessionId || !command.trim()) return
    setBusy(true)
    try {
      await api.sweAct(sessionId, { kind: 'cmd_run', command })
      setCommand('')
    } catch (err) {
      toast.error(`Action failed: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const loadProvenance = async () => {
    if (!sessionId) return
    try {
      const p = await api.sweProvenance(sessionId)
      setProvActions(p.actions)
      setMutated(p.mutated)
    } catch (err) {
      toast.error(`Provenance failed: ${String(err)}`)
    }
  }

  const symbolsFor = (actionId: string) => mutated.filter((m) => m.action_id === actionId).map((m) => m.symbol_id)

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="h-5 w-5" /> KG-Grounded SWE Agent
          </CardTitle>
          <CardDescription>
            Drive the developer-workspace runtime and watch the action/observation stream with KG provenance grounded
            to the code symbols each edit touched.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {sessionId ? (
            <>
              <Badge variant="secondary">session {sessionId}</Badge>
              <Badge>{backend}</Badge>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  void stopSession()
                }}
              >
                <Square className="mr-1 h-4 w-4" /> Stop
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void loadProvenance()
                }}
              >
                <GitBranch className="mr-1 h-4 w-4" /> Load provenance
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                void startSession()
              }}
              disabled={busy}
            >
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
              Start session
            </Button>
          )}
        </CardContent>
      </Card>

      {sessionId && (
        <div className="flex items-center gap-2">
          <Input
            value={command}
            onChange={(e) => {
              setCommand(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendCommand()
            }}
            placeholder="shell command, e.g. git clone … && pytest -q"
          />
          <Button
            size="sm"
            onClick={() => {
              void sendCommand()
            }}
            disabled={busy || !command.trim()}
          >
            <Send className="mr-1 h-4 w-4" /> Run
          </Button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 flex min-h-0 flex-col">
          <CardHeader>
            <CardTitle className="text-base">Action / Observation stream</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1">
            <ScrollArea className="h-[420px] pr-2">
              {events.length === 0 && <p className="text-muted-foreground text-sm">No events yet.</p>}
              {events.map((ev, i) => (
                <div key={i} className="mb-2 rounded-md border p-2 text-sm">
                  <div className="font-mono text-xs">
                    <Badge variant="outline" className="mr-1">
                      {asText(ev.action.kind) || 'action'}
                    </Badge>
                    {asText(ev.action.command) || asText(ev.action.path)}
                  </div>
                  <pre className="text-muted-foreground mt-1 whitespace-pre-wrap break-all text-xs">
                    {(
                      asText(ev.observation.stdout) ||
                      asText(ev.observation.report) ||
                      asText(ev.observation.diff) ||
                      asText(ev.observation.message) ||
                      asText(ev.observation.kind)
                    ).slice(0, 800)}
                  </pre>
                </div>
              ))}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col">
          <CardHeader>
            <CardTitle className="text-base">KG provenance</CardTitle>
            <CardDescription>Symbols the agent reasoned over / mutated.</CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1">
            <ScrollArea className="h-[420px] pr-2">
              {provActions.length === 0 && (
                <p className="text-muted-foreground text-sm">Load provenance to see the symbol graph.</p>
              )}
              {provActions.map((a) => (
                <div key={a.id} className="mb-2 rounded-md border p-2 text-sm">
                  <div className="flex items-center gap-1">
                    <Badge variant="outline">{a.kind}</Badge>
                    <span className="text-muted-foreground text-xs">step {a.step}</span>
                  </div>
                  <div className="mt-1 text-xs">{a.summary}</div>
                  {symbolsFor(a.id).map((s) => (
                    <Badge key={s} variant="secondary" className="mr-1 mt-1 font-mono text-xs">
                      {s}
                    </Badge>
                  ))}
                </div>
              ))}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default SweView
