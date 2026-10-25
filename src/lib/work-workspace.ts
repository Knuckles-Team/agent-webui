import { z } from 'zod'
import { canonicalJson } from '@/lib/webmcp/canonical'
import { ApiError, fetchValidated } from '@/lib/api-validation'
import { gatewayPost } from '@/lib/gateway'
import { roleAtLeast, type Role } from '@/lib/nav-registry'

function canonicalIdentifier(value: string): boolean {
  if (Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    return false
  try {
    canonicalJson(value)
    return true
  } catch {
    return false
  }
}
const id = z.string().min(1).max(256).refine(canonicalIdentifier)
// Match the existing host's workflow identity bound without narrowing other Work references.
const workflowId = z
  .string()
  .min(1)
  .max(512)
  .refine(canonicalIdentifier)
  .refine((value) => new TextEncoder().encode(value).length <= 512)
export const WorkStateSchema = z
  .object({
    conversation: id.nullable(),
    task: id.nullable(),
    run: id.nullable(),
    node: id.nullable(),
    lens: z.enum(['investigation', 'prompts', 'workflows']).optional(),
    workflow: workflowId.nullable().optional(),
  })
  .strict()
  .refine((state) => !state.node || Boolean(state.run), 'A node requires a run')
export type WorkState = z.infer<typeof WorkStateSchema>
export const WORK_PATH = '/workspace/work'
export function parseWorkState(location: string): WorkState {
  const url = new URL(location, 'https://workspace.invalid')
  if (
    url.pathname !== WORK_PATH ||
    [...url.searchParams.keys()].some(
      (key) => !['conversation', 'task', 'run', 'node', 'lens', 'workflow'].includes(key),
    ) ||
    ['conversation', 'task', 'run', 'node', 'lens', 'workflow'].some((key) => url.searchParams.getAll(key).length > 1)
  )
    throw new Error('Invalid Work destination')
  return WorkStateSchema.parse({
    conversation: url.searchParams.get('conversation'),
    task: url.searchParams.get('task'),
    run: url.searchParams.get('run'),
    node: url.searchParams.get('node'),
    ...(url.searchParams.has('lens') ? { lens: url.searchParams.get('lens') } : {}),
    ...(url.searchParams.has('workflow') ? { workflow: url.searchParams.get('workflow') } : {}),
  })
}
/** Only the ordinary conversation landing foregrounds Chat, never an inspection/editor deep link. */
export function isWorkConversationLanding(location: string): boolean {
  try {
    const state = parseWorkState(location)
    return !state.task && !state.run && !state.node && (!state.lens || state.lens === 'investigation')
  } catch {
    return false
  }
}
export function workHref(state: WorkState): string {
  const parsed = WorkStateSchema.parse(state)
  const url = new URL(WORK_PATH, 'https://workspace.invalid')
  for (const key of ['conversation', 'task', 'run', 'node', 'lens', 'workflow'] as const)
    if (parsed[key]) url.searchParams.set(key, parsed[key])
  return `${url.pathname}${url.search}`
}
export function navigateWork(state: WorkState, role: Role): WorkState {
  if (!roleAtLeast(role, state.lens === 'prompts' || state.lens === 'workflows' ? 'admin' : 'user'))
    throw new Error('Work is not permitted for this role')
  const href = workHref(state)
  if (`${window.location.pathname}${window.location.search}` !== href) {
    window.history.pushState({}, '', href)
    window.dispatchEvent(new Event('history-state-changed'))
  }
  return state
}
const TraceRowSchema = z
  .object({ trace_id: id.optional(), id: id.optional(), name: z.string().optional(), status: z.string().optional() })
  .refine((row) => Boolean(row.trace_id ?? row.id), 'Trace has no identity')
  .transform((row) => ({ id: (row.trace_id ?? row.id)!, name: row.name, status: row.status }))
const TraceNodeSchema = z.object({
  id,
  parentId: id.nullable().optional(),
  kind: z.string().optional(),
  name: z.string().optional(),
  latencyMs: z.number().nonnegative().optional(),
  model: z.string().optional(),
  error: z.string().nullable().optional(),
})
const RunSearchSchema = z.object({ result: z.array(TraceRowSchema) })
const RunDetailSchema = z.object({
  result: z.object({
    trace: z.object({ id, name: z.string().optional(), status: z.string().optional() }),
    nodes: z.array(TraceNodeSchema),
  }),
})
export type WorkRun = z.infer<typeof TraceRowSchema>
export type WorkRunDetail = z.infer<typeof RunDetailSchema>['result']
/** Existing read-only trace surface. No invented conversation-to-run association. */
const AgentTaskSchema = z.object({ id, status: z.object({ state: z.string() }).optional() }).loose()
/** Explicit refusal is final for this read; the caller can request a new read. */
export function retryWorkTaskRead(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && [401, 403, 404, 501].includes(error.status)) return false
  return failureCount < 3
}
export const workApi = {
  listTasks: (signal?: AbortSignal) =>
    fetchValidated('/api/enhanced/sessions?limit=50', z.array(AgentTaskSchema), { signal }),
  getTask: (taskId: string, signal?: AbortSignal) =>
    fetchValidated(`/api/enhanced/sessions/${encodeURIComponent(id.parse(taskId))}`, AgentTaskSchema, { signal }),
  cancelTask: (taskId: string) =>
    fetchValidated(
      `/api/enhanced/sessions/${encodeURIComponent(id.parse(taskId))}/cancel`,
      z.object({ status: z.literal('cancelled'), task: z.unknown() }),
      { method: 'POST' },
    ),
  listRuns: () => gatewayPost('/traces', { action: 'search', query: '', limit: 50 }, RunSearchSchema),
  getRun: (traceId: string) =>
    gatewayPost('/traces', { action: 'waterfall', trace_id: id.parse(traceId) }, RunDetailSchema),
}
