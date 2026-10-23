import { workHref, type WorkState } from '@/lib/work-workspace'
import { operateHref, type OperateState } from '@/lib/operate-workspace'
import type { WorkspaceCommand } from './WorkspaceCommands'
interface Named {
  id: string
  name?: string | null
}
function label(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim()
  if (trimmed === undefined || trimmed.length === 0) return fallback
  return trimmed
}
interface FleetItem {
  id: string
  name: string
  server?: string
}
function command(id: string, label: string, href: () => string): WorkspaceCommand[] {
  try {
    return [{ id, label, href: href() }]
  } catch {
    return []
  }
}
/** Bounded loaded destinations, never inferred associations or execution actions. */
export function loadedWorkCommands(
  state: WorkState,
  data: {
    conversations: readonly { id: string; firstMessage?: string | null }[]
    tasks: readonly { id: string }[]
    traces: readonly Named[]
    nodes: readonly Named[]
  },
): WorkspaceCommand[] {
  return [
    ...data.conversations
      .slice(0, 25)
      .flatMap((entry) =>
        command(`conversation:${entry.id}`, `Conversation: ${label(entry.firstMessage, entry.id)}`, () =>
          workHref({ ...state, conversation: entry.id }),
        ),
      ),
    ...data.tasks
      .slice(0, 25)
      .flatMap((entry) =>
        command(`task:${entry.id}`, `Task: ${entry.id}`, () => workHref({ ...state, task: entry.id })),
      ),
    ...data.traces
      .slice(0, 25)
      .flatMap((entry) =>
        command(`trace:${entry.id}`, `Trace: ${label(entry.name, entry.id)}`, () =>
          workHref({ ...state, run: entry.id, node: null }),
        ),
      ),
    ...(state.run
      ? data.nodes
          .slice(0, 25)
          .flatMap((entry) =>
            command(`node:${entry.id}`, `Trace node: ${label(entry.name, entry.id)}`, () =>
              workHref({ ...state, node: entry.id }),
            ),
          )
      : []),
  ]
}
export function loadedOperateCommands(
  state: OperateState,
  servers: readonly string[],
  items: readonly FleetItem[],
): WorkspaceCommand[] {
  const confirmed = new Set(servers)
  return [
    ...servers
      .slice(0, 50)
      .flatMap((server) =>
        command(`server:${server}`, `Fleet: ${server}`, () => operateHref({ ...state, server, item: null })),
      ),
    ...items
      .filter(
        (item): item is FleetItem & { server: string } =>
          typeof item.server === 'string' && confirmed.has(item.server),
      )
      .slice(0, 50)
      .flatMap((item) =>
        command(`capability:${item.id}`, `Capability: ${item.name} (${item.server})`, () =>
          operateHref({ ...state, server: item.server, item: item.id }),
        ),
      ),
  ]
}
