import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArboraApiError } from '@/lib/arbora-api/invoke'
import { readCurrentPlan } from '@/lib/current-plan'

interface Props {
  runId: string | null
  taskId: string
  generation: string
}
const labels = { pending: 'Pending', in_progress: 'In progress', done: 'Done' }

export function CurrentPlanPanel(props: Props) {
  return (
    <section aria-label="Current plan" className="mt-3 rounded border p-3">
      <h4 className="font-medium">Current plan</h4>
      <p className="text-sm text-muted-foreground">
        Read-only snapshot for the selected task’s Arbora run. Independent trace selection does not select this plan.
      </p>
      {props.runId === null ? (
        <p>Current plan is not available: this task has no valid run reference.</p>
      ) : (
        <PlanRead key={JSON.stringify([props.generation, props.taskId, props.runId])} {...props} runId={props.runId} />
      )}
    </section>
  )
}

function PlanRead({ runId, taskId, generation }: Props & { runId: string }) {
  const [attempt, setAttempt] = useState(0)
  const query = useQuery({
    queryKey: ['current-plan', generation, taskId, runId, attempt],
    queryFn: ({ signal }) => readCurrentPlan(runId, signal),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const snapshot = query.data?.availability === 'available' ? query.data.snapshot : null
  const [expired, setExpired] = useState<typeof snapshot>(null)
  useEffect(() => {
    if (!snapshot) return
    const expiresAt = Date.parse(snapshot.expires_at)
    let timer: ReturnType<typeof setTimeout>
    function checkExpiry() {
      const remaining = expiresAt - Date.now()
      if (remaining <= 0) setExpired(snapshot)
      else timer = setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647))
    }
    checkExpiry()
    return () => {
      clearTimeout(timer)
    }
  }, [snapshot])
  const isExpired = snapshot !== null && (snapshot === expired || Date.parse(snapshot.expires_at) <= Date.now())
  const error = query.error
  return (
    <>
      <button
        className="my-2 min-h-11 rounded border px-3 py-2 text-sm"
        onClick={() => {
          setAttempt((value) => value + 1)
        }}
      >
        Refresh current plan
      </button>
      {query.isPending || query.isFetching ? (
        <p role="status">Loading current plan…</p>
      ) : query.isError ? (
        <p role="alert">
          {error instanceof ArboraApiError && [401, 403].includes(error.status)
            ? 'Current plan access was denied.'
            : error instanceof ArboraApiError && [404, 501, 503].includes(error.status)
              ? 'Current plan is not available on this backend.'
              : 'Current plan could not be loaded or validated. Refresh to retry.'}
        </p>
      ) : isExpired ? (
        <p role="status">Current plan expired. Refresh to read it again.</p>
      ) : snapshot ? (
        <>
          <p className="text-xs">
            Revision {snapshot.revision} · Observed {snapshot.observed_at}
          </p>
          {snapshot.items.length === 0 ? (
            <p>The current plan has no items.</p>
          ) : (
            <ol className="list-decimal space-y-1 pl-6">
              {snapshot.items.map((item, index) => (
                <li key={index} className="break-words whitespace-pre-wrap">
                  <span>{item.text}</span>{' '}
                  <span className="text-sm text-muted-foreground">({labels[item.status]})</span>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <p>Current plan is not available for this run.</p>
      )}
    </>
  )
}
