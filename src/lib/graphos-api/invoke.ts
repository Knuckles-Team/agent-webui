/** One browser transport for GraphOS operations. Authority stays at GraphOS. */
import { z } from 'zod'
import { validateShape } from '@/lib/api-validation'

const metaSchema = z.object({ registry_digest: z.string().min(1), api_version: z.string().min(1) }).loose()
const errorSchema = z
  .object({
    code: z.string().min(1),
    source: z.enum(['graphos', 'engine', 'fleet']),
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .loose()
const envelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.unknown(), meta: metaSchema }),
  z.object({ ok: z.literal(false), error: errorSchema, meta: metaSchema }),
])

export class GraphOsApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly details: Record<string, unknown>,
  ) {
    super(`GraphOS operation refused: ${code}`)
    this.name = 'GraphOsApiError'
  }
}

export interface InvokeOptions {
  planRef?: string
  idempotencyKey?: string
  signal?: AbortSignal
}

const OP_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/
const PLAN_REF = /^graphos_plan:[0-9a-f]{48}$/
const sessionSchema = z.object({ authenticated: z.literal(true), csrf_token: z.string().min(1) })
interface PendingConfirmation {
  planRef: string
  opId: string
  params: Record<string, unknown>
  idempotencyKey?: string
  expiresAt: number
}
let pendingConfirmation: PendingConfirmation | null = null

/** Only the initiating tab retains the replay arguments; the lease retains digests. */
export function pendingConsoleConfirmation(planRef: string): Readonly<PendingConfirmation> | null {
  const pending = pendingConfirmation
  if (pending?.planRef !== planRef) return null
  if (Date.now() >= pending.expiresAt) return null
  return pending
}

export function clearConsoleConfirmation(planRef: string): void {
  if (pendingConfirmation?.planRef === planRef) pendingConfirmation = null
}

function rememberConsoleConfirmation(
  code: string,
  details: Record<string, unknown>,
  opId: string,
  params: Record<string, unknown>,
  idempotencyKey?: string,
): void {
  const planRef = details.plan_ref
  if (code !== 'STEP_UP_REQUIRED' || typeof planRef !== 'string' || !PLAN_REF.test(planRef)) return
  if (details.console_url !== `/console/confirm/${planRef}`) return
  if (details.op !== opId) return
  pendingConfirmation = {
    planRef,
    opId,
    params: structuredClone(params),
    idempotencyKey,
    expiresAt: Date.now() + 5 * 60_000,
  }
}

async function csrfToken(signal?: AbortSignal): Promise<string> {
  const response = await fetch('/auth/session', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error('GraphOS browser session is unavailable')
  const session = validateShape(sessionSchema, await response.json(), '/auth/session')
  return session.csrf_token
}

/** Validate both the shared envelope and the operation result before rendering. */
export async function invoke<T>(
  opId: string,
  params: Record<string, unknown>,
  resultSchema: z.ZodType<T>,
  options: InvokeOptions = {},
): Promise<T> {
  if (!OP_ID.test(opId)) throw new Error('Invalid GraphOS operation id')
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  headers['X-CSRF-Token'] = await csrfToken(options.signal)
  if (options.planRef) headers['GraphOS-Plan-Ref'] = options.planRef
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
  const endpoint = `/api/v1/ops/${opId}`
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify(params),
    signal: options.signal,
  })
  let envelope: z.infer<typeof envelopeSchema>
  try {
    envelope = validateShape(envelopeSchema, await response.json(), endpoint)
  } catch (error) {
    // An older server may not mount the registry route at all. Keep that
    // distinct from a malformed successful operation response.
    if ([404, 501, 503].includes(response.status))
      throw new GraphOsApiError('HTTP_UNAVAILABLE', response.status, response.status === 503, {})
    throw error
  }
  if (!envelope.ok) {
    if (envelope.error.source === 'graphos') {
      rememberConsoleConfirmation(
        envelope.error.code,
        envelope.error.details ?? {},
        opId,
        params,
        options.idempotencyKey,
      )
    }
    throw new GraphOsApiError(
      envelope.error.code,
      response.status,
      envelope.error.retryable,
      envelope.error.details ?? {},
    )
  }
  if (!response.ok) throw new Error('GraphOS returned a successful envelope with an unsuccessful status')
  return validateShape(resultSchema, envelope.result, endpoint)
}
