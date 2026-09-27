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
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  readonly details: Record<string, unknown>

  constructor(code: string, status: number, retryable: boolean, details: Record<string, unknown>) {
    super(`GraphOS operation refused: ${code}`)
    this.name = 'GraphOsApiError'
    this.code = code
    this.status = status
    this.retryable = retryable
    this.details = details
  }
}

export interface InvokeOptions {
  planRef?: string
  idempotencyKey?: string
  signal?: AbortSignal
}

const OP_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/
const sessionSchema = z.object({ authenticated: z.literal(true), csrf_token: z.string().min(1) })

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
  headers['X-Request-ID'] = crypto.randomUUID()
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
  const envelope = validateShape(envelopeSchema, await response.json(), endpoint)
  if (!envelope.ok) {
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
