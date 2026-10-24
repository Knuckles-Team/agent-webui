import { z } from 'zod'

const reference = z.string().min(1).max(2048)
const referencesSchema = z.object({
  contextId: reference.nullish(),
  metadata: z
    .object({
      arbora: z.object({ runId: reference.nullish(), runTraceRef: reference.nullish() }).nullish(),
    })
    .nullish(),
})
const artifactSchema = z.object({
  artifactId: z.string().min(1).max(512),
  name: z.string().max(256).nullish(),
  parts: z
    .array(z.object({ kind: z.literal('text'), text: z.string().min(1).max(65536) }))
    .min(1)
    .max(32),
})
const artifactsSchema = z
  .array(artifactSchema)
  .max(32)
  .refine((artifacts) => new Set(artifacts.map((artifact) => artifact.artifactId)).size === artifacts.length)
  .refine(
    (artifacts) =>
      artifacts.reduce(
        (sum, artifact) => sum + artifact.parts.reduce((size, part) => size + part.text.length, 0),
        0,
      ) <= 262144,
  )
const replySchema = z.object({
  status: z.literal('unavailable'),
  reason: z.enum(['payload_too_large', 'payload_serialization_failed', 'reply_too_large']),
})
const outputEnvelope = z.object({
  artifacts: z.unknown().optional(),
  metadata: z.object({ arbora: z.object({ reply: z.unknown().optional() }).nullish() }).nullish(),
})
const unsupported = 'Task output is unavailable: unsupported format or display limit.'
const refusalLabels = {
  payload_too_large: 'The producer could not retain the reply because its payload was too large.',
  payload_serialization_failed: 'The producer could not serialize the reply for retention.',
  reply_too_large: 'The producer reports that the reply exceeds its output limit.',
}
export function taskReferences(task: unknown) {
  const parsed = referencesSchema.safeParse(task)
  if (!parsed.success) return null
  return {
    context: parsed.data.contextId ?? 'Not supplied',
    run: parsed.data.metadata?.arbora?.runId ?? 'Not supplied',
    trace: parsed.data.metadata?.arbora?.runTraceRef ?? 'Not supplied',
  }
}
export function taskOutput(task: unknown) {
  const envelope = outputEnvelope.safeParse(task)
  if (!envelope.success) return { artifacts: [], message: unsupported }
  const refusal = envelope.data.metadata?.arbora?.reply
  if (refusal != null) {
    const reply = replySchema.safeParse(refusal)
    return { artifacts: [], message: reply.success ? refusalLabels[reply.data.reason] : unsupported }
  }
  if (envelope.data.artifacts == null) return { artifacts: [], message: 'Task output is not supplied.' }
  const parsed = artifactsSchema.safeParse(envelope.data.artifacts)
  if (!parsed.success) return { artifacts: [], message: unsupported }
  return { artifacts: parsed.data, message: parsed.data.length ? null : 'No output artifacts were returned.' }
}
