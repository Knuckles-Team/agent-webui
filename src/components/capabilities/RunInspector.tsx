import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, AlertCircle, Pause, Play, RefreshCw } from 'lucide-react'

import {
  fetchRunSummary,
  followRunEvents,
  isTerminalRunEvent,
  replayRunEvents,
  type CapabilityRenderer,
  type RunEventEnvelope,
  type RunSummary,
} from '../../lib/capabilities-api'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ResultRenderer } from './ResultRenderer'

interface RunInspectorProps {
  runId: string
  autoFollow?: boolean
  renderHint?: CapabilityRenderer
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'The run event surface is unavailable.'
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function ignorePromise(promise: Promise<unknown>): void {
  promise.catch(() => undefined)
}

function mergeEvents(current: RunEventEnvelope[], additions: RunEventEnvelope[]): RunEventEnvelope[] {
  const byId = new Map(current.map((event) => [event.event_id, event]))
  for (const event of additions) byId.set(event.event_id, event)
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence).slice(-1_000)
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.valueOf()) ? timestamp : date.toLocaleTimeString()
}

function terminalStatus(type: string): RunSummary['status'] | undefined {
  if (type === 'run_completed' || type === 'graph_complete') return 'completed'
  if (type === 'run_cancelled') return 'cancelled'
  if (type === 'run_failed' || type === 'error' || type === 'run_interrupted') return 'failed'
  return undefined
}

export function RunInspector({ runId, autoFollow = false, renderHint }: RunInspectorProps) {
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [events, setEvents] = useState<RunEventEnvelope[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [replayTruncated, setReplayTruncated] = useState(false)
  const [followState, setFollowState] = useState<'idle' | 'connecting' | 'live'>('idle')
  const followController = useRef<AbortController | null>(null)

  const stopFollowing = useCallback(() => {
    followController.current?.abort()
    followController.current = null
    setFollowState('idle')
  }, [])

  const followFrom = useCallback(
    (after: number) => {
      followController.current?.abort()
      const controller = new AbortController()
      followController.current = controller
      setError(null)
      setFollowState('connecting')
      ignorePromise(
        followRunEvents(runId, {
          after,
          signal: controller.signal,
          onOpen: () => {
            setFollowState('live')
          },
          onEvent: (event) => {
            setEvents((current) => mergeEvents(current, [event]))
            if (isTerminalRunEvent(event)) {
              setSummary((current) => {
                if (!current) return current
                return {
                  ...current,
                  status: terminalStatus(event.type),
                  last_sequence: event.sequence,
                  last_timestamp: event.timestamp,
                  last_event_type: event.type,
                }
              })
            }
          },
        })
          .catch((nextError: unknown) => {
            if (!isAbortError(nextError)) setError(messageFor(nextError))
          })
          .finally(() => {
            if (followController.current === controller) {
              followController.current = null
              setFollowState('idle')
            }
          }),
      )
    },
    [runId],
  )

  const replay = useCallback(
    async (signal?: AbortSignal) => {
      stopFollowing()
      setLoading(true)
      setError(null)
      try {
        const [nextSummary, replayed] = await Promise.all([
          fetchRunSummary(runId, signal),
          replayRunEvents(runId, { after: 0, pageSize: 500, maxEvents: 5_000, signal }),
        ])
        setSummary(nextSummary)
        setEvents(replayed.events)
        setReplayTruncated(Boolean(nextSummary.truncated) || replayed.client_truncated)
        const terminalAlreadySeen = replayed.events.some(isTerminalRunEvent)
        const terminalSummary = ['completed', 'failed', 'cancelled'].includes(nextSummary.status ?? '')
        if (autoFollow && !terminalAlreadySeen && !terminalSummary && !signal?.aborted) {
          followFrom(replayed.next_after)
        }
      } catch (nextError) {
        if (!isAbortError(nextError)) setError(messageFor(nextError))
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [autoFollow, followFrom, runId, stopFollowing],
  )

  useEffect(() => {
    const controller = new AbortController()
    setSummary(null)
    setEvents([])
    setReplayTruncated(false)
    ignorePromise(replay(controller.signal))
    return () => {
      controller.abort()
      followController.current?.abort()
    }
  }, [replay])

  const startFollowing = useCallback(() => {
    followFrom(events.at(-1)?.sequence ?? 0)
  }, [events, followFrom])

  const toolResultEvent = [...events]
    .reverse()
    .find((event) => event.type === 'tool_result' && 'result' in event.payload)

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label={`Run ${runId} event timeline`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <h3 className="font-semibold">Run inspector</h3>
            {followState === 'live' && <Badge className="bg-emerald-600">Live</Badge>}
            {followState === 'connecting' && <Badge variant="secondary">Connecting</Badge>}
          </div>
          <code className="mt-1 block truncate text-xs text-muted-foreground" title={runId}>
            {runId}
          </code>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => {
              ignorePromise(replay())
            }}
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} /> Replay
          </Button>
          {followState === 'idle' ? (
            <Button type="button" size="sm" onClick={startFollowing}>
              <Play /> Follow
            </Button>
          ) : (
            <Button type="button" size="sm" variant="secondary" onClick={stopFollowing}>
              <Pause /> Stop
            </Button>
          )}
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-md bg-muted/40 p-2">
            <div className="text-muted-foreground">Events</div>
            <div className="font-semibold">{summary.event_count}</div>
          </div>
          <div className="rounded-md bg-muted/40 p-2">
            <div className="text-muted-foreground">Last sequence</div>
            <div className="font-semibold">{summary.last_sequence}</div>
          </div>
          <div className="rounded-md bg-muted/40 p-2">
            <div className="text-muted-foreground">Last type</div>
            <div className="truncate font-semibold">{summary.last_event_type ?? '—'}</div>
          </div>
          <div className="rounded-md bg-muted/40 p-2">
            <div className="text-muted-foreground">Session</div>
            <div className="truncate font-semibold">{summary.session_id ?? '—'}</div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">Run events unavailable</div>
            <div className="text-xs opacity-90">{error}</div>
          </div>
        </div>
      )}

      {replayTruncated && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
          This timeline is bounded; earlier or additional events may exist in the canonical store.
        </div>
      )}

      {toolResultEvent && (
        <div className="space-y-2">
          <div className="text-sm font-semibold">Run result</div>
          <ResultRenderer value={toolResultEvent.payload.result} hint={renderHint} />
        </div>
      )}

      {loading && events.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Replaying canonical events…</div>
      ) : events.length === 0 && !error ? (
        <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          No events have been recorded for this run yet.
        </div>
      ) : (
        <ol className="max-h-96 space-y-0 overflow-auto pr-1" aria-label="Run event timeline">
          {events.map((event, index) => (
            <li key={event.event_id} className="relative flex gap-3 pb-3 last:pb-0">
              {index < events.length - 1 && <span className="absolute bottom-0 left-[7px] top-4 w-px bg-border" />}
              <span className="relative mt-1.5 size-[15px] shrink-0 rounded-full border-2 border-background bg-primary" />
              <div className="min-w-0 flex-1 rounded-lg border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs font-medium">{event.type}</span>
                  <span className="text-[11px] text-muted-foreground">
                    #{event.sequence} · {formatTime(event.timestamp)}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">{event.source}</div>
                {Object.keys(event.payload).length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Payload</summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px]">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
