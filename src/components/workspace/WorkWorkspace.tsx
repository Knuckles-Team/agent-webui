import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/lib/api-validation'
import { useIdentity } from '@/lib/auth'
import { conversationOwnerKey, useConversations } from '@/lib/chat-store'
import { useConversationIdFromUrl } from '@/hooks/useConversationIdFromUrl'
import { roleAtLeast } from '@/lib/nav-registry'
import { useWorkspaceLocation } from '@/lib/workspace-navigation'
import { usePageContextPublisher } from '@/lib/page-context'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { makeTool } from '@/lib/webmcp/tools'
import { z } from 'zod'
import {
  navigateWork,
  parseWorkState,
  workApi,
  retryWorkTaskRead,
  workHref,
  WorkStateSchema,
  type WorkState,
  type WorkRunDetail,
} from '@/lib/work-workspace'
import { useWorkspaceCommands } from './WorkspaceCommands'
import { WorkTaskControls } from './WorkTaskControls'
import { WorkConversationControls } from './WorkConversationControls'
import { WorkTaskInspector } from './WorkTaskInspector'
import { createTaskCancellation } from './task-cancellation'
import { useWorkspaceAdmission } from './useWorkspaceAdmission'
import { loadedWorkCommands } from './loaded-workspace-commands'
const button = 'min-h-11 rounded border px-3 py-2 text-sm'
const EMPTY: WorkState = { conversation: null, task: null, run: null, node: null }
function destination(location: string) {
  try {
    return { state: parseWorkState(location), error: null }
  } catch {
    return { state: EMPTY, error: 'This Work destination is invalid. Return to Work to continue.' }
  }
}
export default function WorkWorkspace() {
  const { identity, loading } = useIdentity()
  const generation = useWorkspaceAdmission(identity)
  if (loading) return <p role="status">Checking Work access…</p>
  if (identity.needsSignIn || !roleAtLeast(identity.role, 'user'))
    return <p role="alert">Work is not available for this identity.</p>
  return <AuthorizedWork key={generation} identity={identity} generation={generation} />
}
function AuthorizedWork({
  identity,
  generation,
}: {
  identity: ReturnType<typeof useIdentity>['identity']
  generation: string
}) {
  const [cancellation] = useState(createTaskCancellation)
  useLayoutEffect(() => {
    cancellation.activate()
    return () => {
      cancellation.retire()
    }
  }, [cancellation])
  const location = useWorkspaceLocation()
  const { state, error } = destination(location)
  const conversations = useConversations(conversationOwnerKey(identity))
  const [activeConversation, setActiveConversation] = useConversationIdFromUrl()
  const heading = useRef<HTMLHeadingElement>(null)
  const previous = useRef(location)
  const tasks = useQuery({
    queryKey: ['work-tasks', generation],
    queryFn: ({ signal }) => workApi.listTasks(signal),
    retry: retryWorkTaskRead,
    enabled: !error,
  })
  const task = useQuery({
    queryKey: ['work-task', generation, state.task],
    queryFn: ({ signal }) => workApi.getTask(state.task!, signal),
    retry: retryWorkTaskRead,
    enabled: !error && Boolean(state.task),
  })
  const runs = useQuery({
    queryKey: ['work-runs', generation],
    queryFn: workApi.listRuns,
    enabled: !error,
  })
  const detail = useQuery({
    queryKey: ['work-run', generation, state.run],
    queryFn: () => workApi.getRun(state.run!),
    enabled: !error && Boolean(state.run),
  })
  const rows = useMemo(
    function availableRunRows() {
      if (runs.isError || !runs.data?.ok) return []
      return runs.data.data?.result ?? []
    },
    [runs.data, runs.isError],
  )
  const candidateRun = !detail.isError && detail.data?.ok ? detail.data.data?.result : undefined
  const run = candidateRun?.trace.id === state.run ? candidateRun : undefined
  const taskData = !task.isError && task.data?.id === state.task ? task.data : undefined
  const taskMismatch = Boolean(task.data && !taskData)
  const runMismatch = Boolean(candidateRun && !run)
  const selectedNode = run?.nodes.find((node) => node.id === state.node)
  const commands = useMemo(
    function buildWorkCommands() {
      return error
        ? []
        : loadedWorkCommands(parseWorkState(location), {
            conversations,
            tasks: tasks.isError ? [] : (tasks.data ?? []),
            traces: runs.isError ? [] : rows,
            nodes: detail.isError ? [] : (run?.nodes ?? []),
          })
    },
    [error, location, conversations, tasks.isError, tasks.data, runs.isError, rows, detail.isError, run],
  )
  useWorkspaceCommands(commands, conversationOwnerKey(identity))

  const context = useMemo(
    () => ({
      // Publish the selected tip, not duplicate all ancestors or echo unbounded labels.
      selection: selectedNode
        ? [{ kind: 'trace-node', id: selectedNode.id }]
        : run
          ? [{ kind: 'trace', id: run.trace.id }]
          : taskData
            ? [{ kind: 'agent-task', id: taskData.id }]
            : [],
      filters: { conversation: Array.from(activeConversation).slice(0, 48).join(''), association: 'unavailable' },
    }),
    [run, selectedNode, activeConversation, taskData],
  )
  usePageContextPublisher(context)
  useEffect(() => {
    if (previous.current !== location) {
      heading.current?.focus({ preventScroll: true })
      previous.current = location
    }
  }, [location])
  const availableTasks = useMemo(() => (tasks.isError ? [] : (tasks.data ?? [])), [tasks.isError, tasks.data])
  const tools = useMemo(() => {
    const allowedConversations = new Set(conversations.map((entry) => entry.id))
    const allowedTasks = new Set([null, state.task, ...availableTasks.map((entry) => entry.id)])
    const allowedRuns = new Set([null, state.run, ...rows.map((entry) => entry.id)])
    const allowedNodes = new Set(run?.nodes.map((node) => node.id) ?? [])
    return [
      makeTool({
        name: 'agent-webui.work.select',
        title: 'Select Work context',
        description:
          'Select a known conversation or independent execution trace and its node. Does not execute a run or imply conversation ownership.',
        inputSchema: WorkStateSchema,
        outputSchema: z.object({ selected: z.literal(true) }).strict(),
        jsonSchema: z.toJSONSchema(WorkStateSchema),
        readOnly: false,
        source: 'agent-webui:src/components/workspace/WorkWorkspace.tsx',
        execute: (next) => {
          if (
            next.conversation !== null &&
            next.conversation !== state.conversation &&
            !allowedConversations.has(next.conversation)
          )
            throw new Error('Conversation is outside the loaded context')
          if (!allowedTasks.has(next.task)) throw new Error('Task is outside the loaded context')
          if (!allowedRuns.has(next.run)) throw new Error('Run is outside the loaded context')
          if (next.node && (next.run !== state.run || !allowedNodes.has(next.node)))
            throw new Error('Node is outside the selected run')
          navigateWork(next, identity.role)
          return { selected: true as const }
        },
      }),
    ]
  }, [conversations, rows, run, availableTasks, state.conversation, state.task, state.run, identity.role])
  useWebMcpToolSet(error ? [] : tools)
  return (
    <section aria-label="Work workspace" className="workspace-surface flex min-w-0 flex-col gap-3">
      <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold">
        Work
      </h1>
      {error && <p role="alert">{error}</p>}
      <section aria-label="Conversation selection" className="rounded border p-3">
        <h2 className="font-medium">Conversation</h2>
        <p className="text-sm text-muted-foreground">
          The same assistant stays mounted while you inspect execution evidence.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          Available conversation
          <select
            className="min-h-11 min-w-0 rounded border bg-background px-2"
            value={state.conversation ?? ''}
            onChange={(event) => {
              navigateWork({ ...state, conversation: event.target.value || null }, identity.role)
            }}
          >
            <option value="">Keep current conversation</option>
            {state.conversation && !conversations.some((entry) => entry.id === state.conversation) && (
              <option value={state.conversation}>Linked conversation</option>
            )}
            {conversations.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.firstMessage?.trim() ? entry.firstMessage : entry.id}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 break-all text-xs">
          Active: {activeConversation === '/' ? 'New conversation' : activeConversation}
        </p>
        <WorkConversationControls
          enabled={!error}
          owner={conversationOwnerKey(identity)}
          conversation={activeConversation}
          onNew={() => {
            setActiveConversation('/')
          }}
        />
      </section>
      <div className="workspace-panels workspace-panels-balanced">
        <section aria-label="Agent tasks" className="rounded border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Agent tasks</h2>
            <button
              className={button}
              onClick={() => {
                void tasks.refetch()
              }}
            >
              Refresh tasks
            </button>
          </div>
          <p className="my-2 text-sm">
            Caller-visible tasks from Arbora. Conversation ownership and trace linkage are not supplied.
          </p>
          {tasks.isFetching && <p role="status">Loading tasks…</p>}
          {tasks.isError && (
            <p role="alert">
              {tasks.error instanceof ApiError && [404, 501].includes(tasks.error.status)
                ? 'Task inspection is unavailable on this backend.'
                : 'Task listing failed. Refresh to retry.'}
            </p>
          )}
          {tasks.data?.length === 0 && <p>No tasks were returned.</p>}
          <ul>
            {!tasks.isError &&
              tasks.data?.map((entry) => (
                <li key={entry.id}>
                  <a
                    href={workHref({ ...state, task: entry.id })}
                    className={`${button} my-1 inline-flex max-w-full flex-wrap break-all`}
                    aria-current={state.task === entry.id ? 'true' : undefined}
                    onClick={(event) => {
                      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
                      event.preventDefault()
                      navigateWork({ ...state, task: entry.id }, identity.role)
                    }}
                  >
                    {entry.id}
                    {entry.status?.state && ` · ${entry.status.state}`}
                  </a>
                </li>
              ))}
          </ul>
          {state.task && (
            <div className="mt-2 border-t pt-2">
              <button className={button} onClick={() => navigateWork({ ...state, task: null }, identity.role)}>
                All tasks
              </button>
              {task.isFetching && <p role="status">Loading task…</p>}
              {(task.isError || taskMismatch) && (
                <p role="alert">
                  Task detail could not be loaded.{' '}
                  <button
                    className={button}
                    onClick={() => {
                      void task.refetch()
                    }}
                  >
                    Retry task
                  </button>
                </p>
              )}
              {taskData && !task.isError && (
                <>
                  <h3 className="break-all font-medium">Task {taskData.id}</h3>
                  <p>Status: {taskData.status?.state ?? 'Not reported'}</p>
                  <WorkTaskControls
                    taskId={taskData.id}
                    taskState={taskData.status?.state}
                    context={location}
                    refreshing={task.isFetching}
                    cancellation={cancellation}
                    onRefresh={() => {
                      void task.refetch()
                      void tasks.refetch()
                    }}
                  />
                  <WorkTaskInspector task={taskData} />
                  <p className="text-sm">
                    Child-agent execution and relationships to listed traces are not supplied by this task contract.
                  </p>
                </>
              )}
            </div>
          )}
        </section>
        <section aria-label="Execution inspection" className="min-w-0 rounded border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Available execution traces</h2>
            <button
              className={button}
              onClick={() => {
                void runs.refetch()
              }}
              disabled={runs.isFetching}
            >
              Refresh traces
            </button>
          </div>
          <p className="my-2 text-sm text-muted-foreground">
            Conversation-to-run association is unavailable. These are independent caller-visible traces, not runs
            attributed to the selected conversation.
          </p>
          {runs.isFetching && <p role="status">Loading traces…</p>}
          {runs.data?.unavailable && <p role="status">Trace inspection is not activated on this backend.</p>}
          {(runs.isError || (runs.data && !runs.data.ok && !runs.data.unavailable)) && (
            <p role="alert">Trace listing failed. Refresh to retry.</p>
          )}
          {runs.data?.ok && rows.length === 0 && <p>No execution traces were returned.</p>}
          <ul className="space-y-1">
            {rows.map((row) => (
              <li key={row.id}>
                <a
                  className={`${button} inline-flex max-w-full flex-wrap gap-2`}
                  href={workHref({ ...state, run: row.id, node: null })}
                  aria-current={state.run === row.id ? 'true' : undefined}
                  onClick={(event) => {
                    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
                    event.preventDefault()
                    navigateWork({ ...state, run: row.id, node: null }, identity.role)
                  }}
                >
                  <span className="break-all">{row.name ?? row.id}</span>
                  {row.status && <span>{row.status}</span>}
                </a>
              </li>
            ))}
          </ul>
          {state.run && (
            <div className="mt-3 border-t pt-3">
              <button
                className={button}
                onClick={() => navigateWork({ ...state, run: null, node: null }, identity.role)}
              >
                All traces
              </button>
              <button
                className={button}
                disabled={detail.isFetching}
                onClick={() => {
                  void detail.refetch()
                }}
              >
                Refresh selected trace
              </button>
              {detail.isFetching && <p role="status">Loading selected trace…</p>}
              {detail.data?.unavailable && <p role="status">Trace detail is unavailable on this backend.</p>}
              {(detail.isError || runMismatch || (detail.data && !detail.data.ok && !detail.data.unavailable)) && (
                <p role="alert">
                  Selected trace could not be loaded.{' '}
                  <button
                    className={button}
                    onClick={() => {
                      void detail.refetch()
                    }}
                  >
                    Retry detail
                  </button>
                </p>
              )}
              {run && (
                <>
                  <h3 className="mt-2 break-all font-medium">{run.trace.name ?? run.trace.id}</h3>
                  <p className="text-sm">Recorded spans and generations. A span is not proof of a subagent.</p>
                  <ul>
                    {run.nodes.map((node) => (
                      <li key={node.id}>
                        <button
                          className={`${button} mt-1 max-w-full break-all text-left`}
                          aria-pressed={state.node === node.id}
                          onClick={() => navigateWork({ ...state, node: node.id }, identity.role)}
                        >
                          {node.name ?? node.id} {node.kind && `· ${node.kind}`}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {state.node && !selectedNode && <p role="alert">This node is not present in the selected trace.</p>}
                  <TraceNodeInspector state={state} run={run} role={identity.role} />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Run cancellation, live subagent execution and linked output evidence require upstream contracts and
                    are not available in this slice.
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  )
}

function TraceNodeInspector({
  state,
  run,
  role,
}: {
  state: WorkState
  run: WorkRunDetail
  role: ReturnType<typeof useIdentity>['identity']['role']
}) {
  const node = run.nodes.find((entry) => entry.id === state.node)
  const parentNode = node?.parentId ? run.nodes.find((entry) => entry.id === node.parentId) : undefined
  return (
    <>
      {state.node && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={button} onClick={() => navigateWork({ ...state, node: null }, role)}>
            Back to trace
          </button>
          {parentNode && (
            <button className={button} onClick={() => navigateWork({ ...state, node: parentNode.id }, role)}>
              Inspect recorded parent
            </button>
          )}
        </div>
      )}
      {node && (
        <dl className="mt-3 grid gap-1 text-sm">
          <dt>Node</dt>
          <dd className="break-all">{node.id}</dd>
          <dt>Recorded parent</dt>
          <dd className="break-all">{node.parentId ?? 'No parent recorded'}</dd>
          <dt>Latency</dt>
          <dd>{node.latencyMs === undefined ? 'Not reported' : `${node.latencyMs} ms`}</dd>
          {node.model && (
            <>
              <dt>Model</dt>
              <dd>{node.model}</dd>
            </>
          )}
          {node.error && (
            <>
              <dt>Recorded error</dt>
              <dd className="break-words">{node.error}</dd>
            </>
          )}
        </dl>
      )}
    </>
  )
}
