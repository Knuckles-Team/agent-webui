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

export type ReadinessFailureKind = 'denied' | 'unavailable' | 'invalid' | 'transport'
const failureMessages: Record<ReadinessFailureKind, string> = {
  denied: 'Readiness access was denied. Use an allowed identity before retrying.',
  unavailable: 'Readiness route is not activated on this backend. Retry after it becomes available.',
  invalid: 'Readiness response could not be validated. No readiness state is inferred.',
  transport: 'Readiness evidence could not be retrieved. Retry the probe.',
}
export class ReadinessFailure extends Error {
  readonly kind: ReadinessFailureKind
  constructor(kind: ReadinessFailureKind) {
    super(failureMessages[kind])
    this.kind = kind
  }
}
export function readinessFailureMessage(error: unknown): string {
  return error instanceof ReadinessFailure ? error.message : failureMessages.transport
}
function isReadinessAbort(error: unknown): boolean {
  return (error instanceof Error || error instanceof DOMException) && error.name === 'AbortError'
}
async function requestReadiness(signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch('/api/dashboard/readiness', { signal, credentials: 'same-origin', cache: 'no-store' })
  } catch (error) {
    if (isReadinessAbort(error)) throw error
    throw new ReadinessFailure('transport')
  }
}
function requireDiagnosticResponse(status: number): void {
  if ([200, 503].includes(status)) return
  if ([401, 403].includes(status)) throw new ReadinessFailure('denied')
  if ([404, 501].includes(status)) throw new ReadinessFailure('unavailable')
  throw new ReadinessFailure('transport')
}
async function readReadinessBody(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch (error) {
    if (isReadinessAbort(error)) throw error
    throw new ReadinessFailure('transport')
  }
}
async function decodeReadiness(response: Response): Promise<OperateReadiness> {
  const body = await readReadinessBody(response)
  try {
    if (new TextEncoder().encode(body).byteLength > 262144) throw new ReadinessFailure('invalid')
    const snapshot = OperateReadinessSchema.parse(JSON.parse(body))
    if ((response.status === 200) !== (snapshot.overall === 'ready')) throw new ReadinessFailure('invalid')
    return snapshot
  } catch {
    throw new ReadinessFailure('invalid')
  }
}
export async function readOperateReadiness(signal?: AbortSignal): Promise<OperateReadiness> {
  const response = await requestReadiness(signal)
  requireDiagnosticResponse(response.status)
  return decodeReadiness(response)
}
