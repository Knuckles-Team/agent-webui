/** Explicit admitted references are display metadata, never caller authority. */
import { z } from 'zod'

export const runIdentitySchema = z
  .object({
    conversation_context: z.string().min(1).max(2048),
    task_id: z.string().min(1).max(80),
    context_id: z.string().min(1).max(1024),
    run_id: z.string().min(1).max(128).optional(),
    run_trace_ref: z.string().min(1).max(2048).optional(),
  })
  .strict()

export type RunIdentity = z.infer<typeof runIdentitySchema>

/** A reference is not a graph trace ID and must not be decoded by naming convention. */
export function readRunIdentity(metadata: unknown, conversationId: string): RunIdentity | null {
  const parsed = z.object({ arbora_run: runIdentitySchema }).safeParse(metadata)
  if (!parsed.success || parsed.data.arbora_run.conversation_context !== `webui:${conversationId}`) return null
  return parsed.data.arbora_run
}
