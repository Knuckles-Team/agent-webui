import { workspaceButtonClass as button, workspaceDestructiveButtonClass } from '@/components/ui/button'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { z } from 'zod'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { TaskCancellation } from './task-cancellation'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { makeTool } from '@/lib/webmcp/tools'
import { ApiError } from '@/lib/api-validation'

const cancellable = new Set(['submitted', 'working', 'input-required', 'auth-required', 'running', 'pending'])
const empty = z.object({}).strict()
const reviewResult = z.object({ reviewRequired: z.literal(true) }).strict()

/** Review changes local state. Only visible attended confirmation requests cancellation. */
interface Props {
  taskId: string
  taskState?: string
  context: string
  refreshing: boolean
  onRefresh: () => void
  cancellation: TaskCancellation
  isAttendedGesture?: (event: MouseEvent<HTMLButtonElement>) => boolean
}
export function WorkTaskControls(props: Props) {
  return <OwnedTaskControls key={JSON.stringify([props.context, props.taskId, props.taskState])} {...props} />
}
function OwnedTaskControls({
  taskId,
  taskState,
  context,
  refreshing,
  onRefresh,
  cancellation,
  isAttendedGesture = (event) => event.nativeEvent.isTrusted,
}: Props) {
  const generation = useMemo(() => ({ taskId, taskState, context }), [taskId, taskState, context])
  const live = useRef<typeof generation | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const focusTarget = useRef<HTMLElement>(null)
  interface Review {
    generation: typeof generation
    token: symbol
  }
  const currentReview = useRef<Review | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const running = useSyncExternalStore(
    cancellation.subscribe,
    () => cancellation.isPending(taskId),
    () => false,
  )
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useLayoutEffect(() => {
    live.current = generation
    return () => {
      live.current = null
    }
  }, [generation])
  const canCancel = cancellable.has(taskState ?? '')
  const requestReview = useCallback(() => {
    if (live.current !== generation) throw new Error('Task context is stale')
    if (!canCancel) throw new Error('This task state does not support cancellation')
    if (cancellation.isPending(taskId)) throw new Error('A cancellation request is already pending')
    if (currentReview.current) throw new Error('A task review is already open')
    const next = { generation, token: Symbol('task-review') }
    currentReview.current = next
    setError(null)
    setReview(next)
    return { reviewRequired: true as const }
  }, [generation, canCancel, cancellation, taskId])
  const tools = useMemo(
    () => [
      makeTool({
        name: 'agent-webui.work.cancel-task.review',
        title: 'Review cancellation of the selected task',
        description:
          'Open local review for the selected task. Never sends a cancellation request. Requires visible human confirmation.',
        inputSchema: empty,
        outputSchema: reviewResult,
        jsonSchema: z.toJSONSchema(empty),
        readOnly: false,
        source: 'agent-webui:src/components/workspace/WorkTaskControls.tsx',
        execute: requestReview,
      }),
    ],
    [requestReview],
  )
  useWebMcpToolSet(canCancel ? tools : [])
  function close() {
    if (currentReview.current !== review) return
    currentReview.current = null
    setReview(null)
  }
  function current() {
    return Boolean(
      review && currentReview.current === review && review.generation === generation && live.current === generation,
    )
  }
  async function confirm(event: MouseEvent<HTMLButtonElement>) {
    if (!isAttendedGesture(event)) {
      setError('Use the visible confirmation button with a browser interaction.')
      return
    }
    if (cancellation.isPending(taskId) || !current()) return
    close()
    setMessage(null)
    setError(null)
    try {
      const accepted = await cancellation.cancel(taskId)
      if (accepted && live.current === generation)
        setMessage(`Cancellation requested for task ${taskId}. Refresh to inspect its current state.`)
    } catch (error) {
      if (live.current === generation) setError(cancellationFailure(error))
    }
  }
  return (
    <section ref={focusTarget} tabIndex={-1} aria-label="Task lifecycle" className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={refreshing || running}
          onClick={() => {
            if (live.current !== generation) return
            close()
            onRefresh()
          }}
        >
          Refresh task
        </button>
        <button
          ref={trigger}
          type="button"
          className={button}
          disabled={!canCancel || running}
          onClick={requestReview}
        >
          Cancel task…
        </button>
      </div>
      <TaskStatus
        canCancel={canCancel}
        running={running}
        message={message}
        error={error}
        reviewing={review !== null}
      />
      <Dialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (trigger.current?.disabled) focusTarget.current?.focus({ preventScroll: true })
            else trigger.current?.focus()
          }}
        >
          <DialogTitle>Cancel selected task?</DialogTitle>
          <DialogDescription>
            This requests cancellation through Arbora. The service decides whether this task can be cancelled.
          </DialogDescription>
          <p className="break-all">Task: {review?.generation.taskId}</p>
          {error && <p role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={close}>
              Keep task running
            </button>
            <button
              type="button"
              className={workspaceDestructiveButtonClass}
              disabled={review?.generation !== generation || running}
              onClick={(event) => {
                void confirm(event)
              }}
            >
              Confirm task cancellation
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function TaskStatus({
  canCancel,
  running,
  message,
  error,
  reviewing,
}: {
  canCancel: boolean
  running: boolean
  message: string | null
  error: string | null
  reviewing: boolean
}) {
  return (
    <>
      {!canCancel && <p className="text-sm">Cancellation is unavailable for the reported task state.</p>}
      {running && <p role="status">Requesting task cancellation…</p>}
      {message && (
        <p role="status" className="break-words">
          {message}
        </p>
      )}
      {error && !reviewing && <p role="alert">{error}</p>}
    </>
  )
}

function cancellationFailure(error: unknown): string {
  if (error instanceof ApiError && [401, 403].includes(error.status))
    return 'Task cancellation was refused. Refresh to check access and task state.'
  return 'Cancellation outcome is unknown. Refresh task state before retrying.'
}
