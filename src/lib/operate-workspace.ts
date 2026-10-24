import { z } from 'zod'
import { canonicalJson } from '@/lib/webmcp/canonical'
import { invoke } from '@/lib/arbora-api/invoke'
import { roleAtLeast, type Role } from '@/lib/nav-registry'
function safeText(s: string) {
  if (Array.from(s).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return false
  try {
    canonicalJson(s)
    return true
  } catch {
    return false
  }
}
const text = z.string().min(1).max(256).refine(safeText)
export const OperateFleetSelectionSchema = z
  .object({
    server: text.nullable(),
    item: text.nullable(),
    q: z.string().max(128).refine(safeText),
  })
  .strict()
  .refine((s) => !s.item || Boolean(s.server), 'A capability requires a server')
export const OperateStateSchema = OperateFleetSelectionSchema.safeExtend({
  connector: text.optional(),
  definition: text.optional(),
}).refine((s) => !s.definition || Boolean(s.connector), 'A definition requires a connector')
export type OperateState = z.infer<typeof OperateStateSchema>
export const OPERATE_PATH = '/workspace/operate'
export function parseOperateState(location: string): OperateState {
  const url = new URL(location, 'https://workspace.invalid')
  if (
    url.origin !== 'https://workspace.invalid' ||
    url.pathname !== OPERATE_PATH ||
    url.hash ||
    [...url.searchParams.keys()].some((key) => !['server', 'item', 'q', 'connector', 'definition'].includes(key)) ||
    ['server', 'item', 'q', 'connector', 'definition'].some((key) => url.searchParams.getAll(key).length > 1)
  )
    throw new Error('Invalid Operate destination')
  return OperateStateSchema.parse({
    server: url.searchParams.get('server'),
    item: url.searchParams.get('item'),
    q: url.searchParams.get('q') ?? '',
    ...(url.searchParams.has('connector') ? { connector: url.searchParams.get('connector') } : {}),
    ...(url.searchParams.has('definition') ? { definition: url.searchParams.get('definition') } : {}),
  })
}
export function operateHref(state: OperateState): string {
  const parsed = OperateStateSchema.parse(state)
  const query = new URLSearchParams()
  for (const key of ['server', 'item', 'q', 'connector', 'definition'] as const)
    if (parsed[key]) query.set(key, parsed[key])
  return `${OPERATE_PATH}${query.size ? `?${query}` : ''}`
}
export function navigateOperate(state: OperateState, role: Role): void {
  if (!roleAtLeast(role, 'reader')) throw new Error('Operate is not permitted')
  const href = operateHref(state)
  if (`${window.location.pathname}${window.location.search}` !== href) {
    window.history.pushState({}, '', href)
    window.dispatchEvent(new Event('history-state-changed'))
  }
}
const count = z.number().int().nonnegative()
export const FleetStatusSchema = z.object({
  value: z.object({
    children: z.record(
      text,
      z.object({
        state: z.string().max(128),
        restart_count: count.optional(),
        mounted_tools: count.optional(),
        in_flight: count.optional(),
        queued: count.optional(),
      }),
    ),
  }),
})
export const FleetCatalogSchema = z.object({
  value: z.object({
    items: z
      .array(
        z.object({
          id: text,
          server: text.optional(),
          name: z.string().min(1).max(512),
          kind: z.string().max(128),
          description: z.string().max(8192).optional(),
        }),
      )
      .max(100),
    next_cursor: z.string().max(1024).nullable(),
  }),
})
export const operateApi = {
  status: (signal?: AbortSignal) => invoke('fleet.status', { servers: [] }, FleetStatusSchema, { signal }),
  // Unfiltered discovery avoids the selected-server live-probe path. No load/call/start operations.
  catalog: (cursor: string | null, signal?: AbortSignal) =>
    invoke('fleet.catalog.list', { browse: true, limit: 100, cursor }, FleetCatalogSchema, { signal }),
}
