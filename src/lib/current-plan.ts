/** SDK CurrentPlanRead through the canonical Arbora browser transport. */
import { z } from 'zod'
import { invoke } from '@/lib/arbora-api/invoke'

const runIdSchema = z
  .string()
  .min(1)
  .refine((value) => Array.from(value).length <= 512 && value.trim().length > 0)
const utcStamp = z.iso.datetime({ offset: true }).refine((value) => /(?:Z|\+00:00)$/.test(value))
const snapshotSchema = z
  .object({
    run_id: runIdSchema,
    revision: z.number().int().nonnegative(),
    observed_at: utcStamp,
    expires_at: utcStamp,
    items: z.array(z.object({ text: z.string().min(1), status: z.enum(['pending', 'in_progress', 'done']) }).strict()),
  })
  .strict()
  .refine((value) => Date.parse(value.expires_at) > Date.parse(value.observed_at))
const currentPlanSchema = z.discriminatedUnion('availability', [
  z.object({ availability: z.literal('available'), snapshot: snapshotSchema }).strict(),
  z.object({ availability: z.literal('unavailable'), snapshot: z.null() }).strict(),
])
export type CurrentPlanRead = z.infer<typeof currentPlanSchema>

/** No display placeholders or trace identifiers may become a run selector. */
export function currentPlanRunId(task: unknown): string | null {
  const parsed = z.object({ metadata: z.object({ arbora: z.object({ runId: runIdSchema }) }) }).safeParse(task)
  return parsed.success ? parsed.data.metadata.arbora.runId : null
}

export async function readCurrentPlan(runId: string, signal: AbortSignal): Promise<CurrentPlanRead> {
  runIdSchema.parse(runId)
  const result = await invoke(
    'runs.current_plan',
    { run_id: runId },
    z.object({ value: currentPlanSchema }).strict(),
    { signal },
  )
  const value = result.value
  if (value.availability === 'available') {
    const snapshot = value.snapshot
    const now = Date.now()
    if (snapshot.run_id !== runId || Date.parse(snapshot.observed_at) > now || Date.parse(snapshot.expires_at) <= now)
      throw new Error('Current plan identity or validity interval does not match this read')
  }
  return value
}
