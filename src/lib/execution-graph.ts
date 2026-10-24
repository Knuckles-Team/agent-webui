/** Prompt-free, flat producer projection. No trace/replay-derived orchestration. */
import { z } from 'zod'
import { invoke } from '@/lib/arbora-api/invoke'

/** Producer string limits count Unicode code points, not UTF-16 code units. */
function boundedText(maximum: number) {
  return z
    .string()
    .min(1)
    .refine((value) => Array.from(value).length <= maximum)
}
const id = boundedText(512).refine((value) => value.trim().length > 0)
const key = boundedText(16384)
const nodeIdentity = z.tuple([id, z.literal('plan_step'), id])
const sequence = z.number().int().nonnegative().max(1000)
const stepSchema = z
  .object({
    key,
    kind: z.literal('plan_step'),
    task_id: id,
    status: z.enum(['unobserved', 'running', 'completed', 'failed', 'cancelled', 'blocked']),
    evidence: z
      .object({ event_id: boundedText(1024), sequence: sequence.min(1) })
      .strict()
      .nullable(),
  })
  .strict()
const snapshotSchema = z
  .object({
    plan_digest: id,
    nodes: z.array(stepSchema).min(1).max(64),
    edges: z.array(z.object({ kind: z.literal('depends_on'), source: key, target: key }).strict()).max(2016),
    topology_completeness: z.literal('complete'),
    lifecycle_completeness: z.literal('incomplete'),
    lifecycle_reason: z.literal('observed_prefix_only'),
    covered_after: sequence,
    has_more: z.boolean(),
    can_read_transcript: z.literal(false),
    can_message_active: z.literal(false),
    can_continue_completed: z.literal(false),
    supports_spawned_children: z.literal(false),
  })
  .strict()
const binding = { schema_version: z.literal('arbora-execution-graph-v1'), run_id: id, task_id: id }
const readSchema = z.discriminatedUnion('availability', [
  z.object({ ...binding, availability: z.literal('available'), snapshot: snapshotSchema }).strict(),
  z.object({ ...binding, availability: z.literal('unavailable'), snapshot: z.null() }).strict(),
])
export type ExecutionGraphRead = z.infer<typeof readSchema>
export type ExecutionGraphSnapshot = z.infer<typeof snapshotSchema>

/** Topological depth is a display coordinate, never an execution decision. */
export function executionGraphLayers(snapshot: ExecutionGraphSnapshot): string[][] {
  const remaining = new Set(snapshot.nodes.map((node) => node.key))
  if (remaining.size !== snapshot.nodes.length) throw new Error('Duplicate execution node')
  const predecessors = new Map(snapshot.nodes.map((node) => [node.key, new Set<string>()]))
  for (const edge of snapshot.edges) {
    const dependencies = predecessors.get(edge.target)
    if (!remaining.has(edge.source) || !dependencies || dependencies.has(edge.source))
      throw new Error('Invalid execution dependency')
    dependencies.add(edge.source)
  }
  const layers: string[][] = []
  while (remaining.size) {
    const layer = [...remaining].filter((node) => ![...predecessors.get(node)!].some((dep) => remaining.has(dep)))
    if (!layer.length) throw new Error('Cyclic execution dependency')
    layers.push(layer)
    layer.forEach((node) => remaining.delete(node))
  }
  return layers
}

function validateEvidence(snapshot: ExecutionGraphSnapshot) {
  const localIds = new Set(snapshot.nodes.map((node) => node.task_id))
  if (localIds.size !== snapshot.nodes.length) throw new Error('Duplicate execution step')
  for (const node of snapshot.nodes) {
    if ((node.status === 'unobserved') !== (node.evidence === null))
      throw new Error('Execution status has inconsistent evidence')
    if (node.evidence && node.evidence.sequence > snapshot.covered_after)
      throw new Error('Execution evidence is outside the covered prefix')
  }
  executionGraphLayers(snapshot)
}

function validateNodeIdentity(snapshot: ExecutionGraphSnapshot, runId: string) {
  for (const node of snapshot.nodes) {
    // Decode the producer key, not its byte representation: Python may escape Unicode.
    const tuple = nodeIdentity.parse(JSON.parse(node.key) as unknown)
    if (tuple[0] !== runId || tuple[2] !== node.task_id)
      throw new Error('Execution node key does not match its run and step')
  }
}

function validateUniqueEvidence(snapshot: ExecutionGraphSnapshot) {
  const events = new Set<string>()
  const sequences = new Set<number>()
  for (const { evidence } of snapshot.nodes) {
    if (!evidence) continue
    if (events.has(evidence.event_id) || sequences.has(evidence.sequence))
      throw new Error('Execution steps share conflicting event evidence')
    events.add(evidence.event_id)
    sequences.add(evidence.sequence)
  }
}

export async function readExecutionGraph(
  runId: string,
  taskId: string,
  signal: AbortSignal,
): Promise<ExecutionGraphRead> {
  const result = await invoke(
    'runs.execution_graph',
    {
      schema_version: 'arbora-execution-graph-v1',
      run_id: id.parse(runId),
      task_id: id.parse(taskId),
    },
    z.object({ value: readSchema }).strict(),
    { signal },
  )
  const value = result.value
  if (value.run_id !== runId || value.task_id !== taskId)
    throw new Error('Execution graph binding does not match this read')
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 1_048_576)
    throw new Error('Execution graph exceeds display limit')
  if (value.availability === 'available') {
    validateNodeIdentity(value.snapshot, runId)
    validateUniqueEvidence(value.snapshot)
    validateEvidence(value.snapshot)
  }
  return value
}
