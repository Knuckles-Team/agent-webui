import { workspaceButtonClass } from '@/components/ui/button'
import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArboraApiError } from '@/lib/arbora-api/invoke'
import { executionGraphLayers, readExecutionGraph, type ExecutionGraphSnapshot } from '@/lib/execution-graph'

interface Props {
  runId: string | null
  taskId: string
  generation: string
}
const button = `${workspaceButtonClass} my-2`
const statuses = {
  unobserved: 'Unobserved',
  running: 'Observed running',
  completed: 'Observed completed',
  failed: 'Observed failed',
  cancelled: 'Observed cancelled',
  blocked: 'Observed blocked',
}

export function WorkExecutionGraph(props: Props) {
  return (
    <section aria-label="Execution dependency graph" className="mt-3 min-w-0 rounded border bg-card/70 p-3">
      <h4 className="font-medium">Execution dependencies</h4>
      <p className="text-sm text-muted-foreground">
        Read-only declared plan steps for this task’s Arbora run, not child agents or trace spans.
      </p>
      {props.runId === null ? (
        <p>Execution graph is unavailable: this task is missing an authoritative run binding.</p>
      ) : (
        <GraphRead
          key={JSON.stringify([props.generation, props.taskId, props.runId])}
          {...props}
          runId={props.runId}
        />
      )}
    </section>
  )
}

function GraphRead({ runId, taskId, generation }: Props & { runId: string }) {
  const [attempt, setAttempt] = useState(0)
  const query = useQuery({
    queryKey: ['execution-graph', generation, taskId, runId, attempt],
    queryFn: ({ signal }) => readExecutionGraph(runId, taskId, signal),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  return (
    <>
      <button
        className={button}
        onClick={() => {
          setAttempt((value) => value + 1)
        }}
      >
        Refresh execution graph
      </button>
      {query.isPending || query.isFetching ? (
        <p role="status">Loading execution graph…</p>
      ) : query.isError ? (
        <p role="alert">{graphError(query.error)}</p>
      ) : query.data.availability === 'available' ? (
        <GraphSnapshot key={attempt} snapshot={query.data.snapshot} />
      ) : (
        <p role="status">Execution graph is unavailable for this run.</p>
      )}
    </>
  )
}

function graphError(error: unknown) {
  if (error instanceof ArboraApiError && [401, 403].includes(error.status)) return 'Execution graph access was denied.'
  if (error instanceof ArboraApiError && [404, 501, 503].includes(error.status))
    return 'Execution graph is unavailable on this backend.'
  return 'Execution graph could not be loaded or validated. Refresh to retry.'
}

function GraphSnapshot({ snapshot }: { snapshot: ExecutionGraphSnapshot }) {
  const nodes = new Map(snapshot.nodes.map((node) => [node.key, node]))
  return (
    <div className="min-w-0 space-y-2">
      <p className="text-sm">Complete declared topology · Incomplete lifecycle evidence</p>
      <p className="text-xs">
        Covered event cursor: {snapshot.covered_after}.{' '}
        {snapshot.has_more
          ? 'More evidence is available beyond this snapshot.'
          : 'No more evidence in this observed prefix; this is not proof of completed execution.'}
      </p>
      <p className="text-sm text-muted-foreground">
        Unobserved means no lifecycle evidence in this snapshot, not queued or completed.
      </p>
      <DependencyDiagram snapshot={snapshot} />
      <h5 className="font-medium">Step details and dependencies</h5>
      <p className="text-xs">
        Arrows point from predecessor to dependent. Expand a step for the equivalent dependency list and observed
        evidence.
      </p>
      <ul aria-label="Execution step dependency list" className="space-y-2">
        {snapshot.nodes.map((node) => (
          <li key={node.key} className="min-w-0 rounded border bg-background/60">
            <details>
              <summary className="min-h-11 cursor-pointer break-all rounded p-2 text-sm focus-visible:outline-2 focus-visible:outline-ring">
                <span>{node.task_id}</span> · <span>{statuses[node.status]}</span>
              </summary>
              <dl className="grid min-w-0 gap-1 px-3 pb-3 text-sm">
                <dt className="font-medium">Predecessors</dt>
                <dd className="break-all">
                  {snapshot.edges
                    .filter((edge) => edge.target === node.key)
                    .map((edge) => nodes.get(edge.source)!.task_id)
                    .join(', ') || 'None declared'}
                </dd>
                <dt className="font-medium">Dependents</dt>
                <dd className="break-all">
                  {snapshot.edges
                    .filter((edge) => edge.source === node.key)
                    .map((edge) => nodes.get(edge.target)!.task_id)
                    .join(', ') || 'None declared'}
                </dd>
                <dt className="font-medium">Observed evidence</dt>
                <dd className="break-all">
                  {node.evidence
                    ? `Event ${node.evidence.event_id} · Sequence ${node.evidence.sequence}`
                    : 'Not observed in the covered prefix'}
                </dd>
                <dt className="font-medium">Producer node key</dt>
                <dd className="break-all">{node.key}</dd>
              </dl>
            </details>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        Child hierarchy, transcripts, child messaging and continuation are unavailable. Inspecting these steps does not
        change the chat target.
      </p>
    </div>
  )
}

/** Display coordinates use only the validated, producer-declared dependencies. */
function DependencyDiagram({ snapshot }: { snapshot: ExecutionGraphSnapshot }) {
  const markerId = useId()
  const layers = executionGraphLayers(snapshot)
  const width = Math.max(360, ...layers.map((layer) => layer.length * 180))
  const height = layers.length * 96 + 16
  const positions = new Map(
    layers.flatMap((layer, row) =>
      layer.map(
        (key, column) =>
          [
            key,
            {
              x: ((column + 0.5) * width) / layer.length,
              y: row * 96 + 16,
            },
          ] as const,
      ),
    ),
  )
  return (
    <div
      role="region"
      aria-label="Scrollable dependency diagram; equivalent step details below"
      tabIndex={0}
      className="work-execution-diagram max-h-80 max-w-full overflow-auto rounded border bg-background/60 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <svg aria-hidden="true" width={width} height={height} className="block text-primary">
        <defs>
          <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
          </marker>
        </defs>
        {snapshot.edges.map((edge) => {
          const source = positions.get(edge.source)!
          const target = positions.get(edge.target)!
          return (
            <path
              key={JSON.stringify([edge.source, edge.target])}
              d={`M${source.x},${source.y + 56} L${target.x},${target.y - 4}`}
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              markerEnd={`url(#${markerId})`}
            />
          )
        })}
        {snapshot.nodes.map((node) => {
          const position = positions.get(node.key)!
          return (
            <g key={node.key} transform={`translate(${position.x - 80},${position.y})`}>
              <title>
                {node.task_id}: {statuses[node.status]}
              </title>
              <rect width="160" height="56" rx="10" fill="var(--card)" stroke="currentColor" />
              <text x="80" y="23" textAnchor="middle" fill="var(--foreground)" fontSize="12">
                {Array.from(node.task_id).slice(0, 18).join('')}
                {Array.from(node.task_id).length > 18 ? '…' : ''}
              </text>
              <text x="80" y="42" textAnchor="middle" fill="var(--muted-foreground)" fontSize="11">
                {statuses[node.status]}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
