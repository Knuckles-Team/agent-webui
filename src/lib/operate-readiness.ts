import { z } from 'zod'

const state = z.enum(['ready', 'degraded', 'unavailable', 'stale', 'not_configured'])
export const OperateReadinessSchema = z.object({
  schema_version: z.literal('arbora.readiness.v1'),
  snapshot_id: z.string().min(1),
  observed_at: z.string().min(1),
  overall: state,
  checks: z.record(z.string().min(1), z.object({ state }).loose()),
  required_failures: z.array(z.string()),
  degraded_reasons: z.array(z.string()),
})
export type OperateReadiness = z.infer<typeof OperateReadinessSchema>

export async function readOperateReadiness(signal?: AbortSignal): Promise<OperateReadiness> {
  const response = await fetch('/api/dashboard/readiness', {
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (![200, 503].includes(response.status)) throw new Error(`Readiness request refused (HTTP ${response.status}).`)
  const body = await response.text()
  if (new TextEncoder().encode(body).byteLength > 262144) throw new Error('Readiness response exceeds its bound.')
  const snapshot = OperateReadinessSchema.parse(JSON.parse(body))
  if ((response.status === 200) !== (snapshot.overall === 'ready')) throw new Error('Inconsistent readiness response.')
  return snapshot
}
