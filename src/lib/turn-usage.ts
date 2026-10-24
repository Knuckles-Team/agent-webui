/** Arbora's A2A turn receipt is display data, never browser-owned accounting. */
import { z } from 'zod'
import type { UIMessage } from 'ai'
import { readRunIdentity, type RunIdentity } from '@/lib/run-identity'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const turnUsageSchema = z
  .object({
    runId: z.string().min(1).max(128),
    taskId: z.string().min(1).max(80),
    contextId: z.string().min(1).max(1024),
    scope: z.literal('turn'),
    counts: z
      .object({
        requests: count.optional(),
        tool_calls: count.optional(),
        input_tokens: count.optional(),
        output_tokens: count.optional(),
        total_tokens: count.optional(),
      })
      .strict(),
  })
  .strict()

export type TurnUsageReceipt = z.infer<typeof turnUsageSchema>

/** The namespace also marks a canonical turn whose receipt is unavailable. */
export function isArboraMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  return 'arbora' in metadata || 'arbora_run' in metadata
}

export function readTurnUsage(metadata: unknown, identity: RunIdentity): TurnUsageReceipt | null {
  const parsed = z.object({ arbora: z.object({ usage: turnUsageSchema }) }).safeParse(metadata)
  if (!parsed.success) return null
  const usage = parsed.data.arbora.usage
  if (usage.runId !== identity.run_id || usage.taskId !== identity.task_id || usage.contextId !== identity.context_id)
    return null
  return usage
}

/** Latest presentation wins, even if it invalidates an earlier valid receipt. */
export function turnUsageByMessage(
  messages: readonly UIMessage[],
  conversationId: string,
): Map<string, TurnUsageReceipt | null> {
  const latest = new Map<string, { messageId: string; runId: string | undefined; usage: TurnUsageReceipt | null }>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const identity = readRunIdentity(message.metadata, conversationId)
    if (!identity) continue
    const key = JSON.stringify([identity.context_id, identity.task_id])
    // An admitted task retains its first known run binding. A malformed replay
    // may clear that task's counts, but cannot leave its previous values visible.
    const runId = latest.get(key)?.runId ?? identity.run_id
    const usage = identity.run_id === runId ? readTurnUsage(message.metadata, identity) : null
    latest.set(key, { messageId: message.id, runId, usage })
  }
  return new Map([...latest.values()].map(({ messageId, usage }) => [messageId, usage]))
}

/** Presentation correlation for the active conversation, not run authority. */
export class TurnRunBindings {
  private readonly runs = new Map<string, string>()

  private readonly conversationId: string

  constructor(conversationId: string) {
    this.conversationId = conversationId
  }

  private key(identity: RunIdentity): string {
    return JSON.stringify([identity.context_id, identity.task_id])
  }

  retain(messages: readonly UIMessage[]): void {
    const active = new Set<string>()
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      const identity = readRunIdentity(message.metadata, this.conversationId)
      if (!identity) continue
      active.add(this.key(identity))
      this.conflicts(message.metadata)
    }
    for (const key of this.runs.keys()) {
      if (!active.has(key)) this.runs.delete(key)
    }
  }

  conflicts(metadata: unknown): boolean {
    const identity = readRunIdentity(metadata, this.conversationId)
    if (!identity?.run_id) return false
    const key = this.key(identity)
    const bound = this.runs.get(key)
    if (bound === undefined) this.runs.set(key, identity.run_id)
    return bound !== undefined && bound !== identity.run_id
  }
}
