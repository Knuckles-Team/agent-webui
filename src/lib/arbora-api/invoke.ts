import { invalidateIdentity } from '@/lib/identity-events'
/** One browser transport for Arbora operations. Authority stays at Arbora. */
import { z } from 'zod'
import { validateShape } from '@/lib/api-validation'

const metaSchema = z.object({ registry_digest: z.string().min(1), api_version: z.string().min(1) }).loose()
const errorSchema = z
  .object({
    code: z.string().min(1),
    source: z.enum(['arbora', 'engine', 'fleet']),
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .loose()
const envelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.unknown(), meta: metaSchema }),
  z.object({ ok: z.literal(false), error: errorSchema, meta: metaSchema }),
])

export class ArboraApiError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  readonly details: Record<string, unknown>

  constructor(code: string, status: number, retryable: boolean, details: Record<string, unknown>) {
    super(`Arbora operation refused: ${code}`)
    this.name = 'ArboraApiError'
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

function validatedSessionToken(body: unknown): string {
  if (!sessionSchema.safeParse(body).success) invalidateIdentity()
  return validateShape(sessionSchema, body, '/auth/session').csrf_token
}

async function csrfToken(signal?: AbortSignal): Promise<string> {
  const response = await fetch('/auth/session', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    invalidateIdentity()
    throw new Error('Arbora browser session is unavailable')
  }
  const body: unknown = await response.json()
  return validatedSessionToken(body)
}

/** Validate both the shared envelope and the operation result before rendering. */
export async function invoke<T>(
  opId: string,
  params: Record<string, unknown>,
  resultSchema: z.ZodType<T>,
  options: InvokeOptions = {},
): Promise<T> {
  if (!OP_ID.test(opId)) throw new Error('Invalid Arbora operation id')
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  headers['X-Request-ID'] = crypto.randomUUID()
  headers['X-CSRF-Token'] = await csrfToken(options.signal)
  if (options.planRef) headers['Arbora-Plan-Ref'] = options.planRef
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
    // Older servers may not mount the registry route. Preserve that absence
    // without treating a malformed successful response as unavailable.
    if ([404, 501, 503].includes(response.status))
      throw new ArboraApiError('HTTP_UNAVAILABLE', response.status, response.status === 503, {})
    throw error
  }
  if (!envelope.ok) {
    throw new ArboraApiError(
      envelope.error.code,
      response.status,
      envelope.error.retryable,
      envelope.error.details ?? {},
    )
  }
  if (!response.ok) throw new Error('Arbora returned a successful envelope with an unsuccessful status')
  return validateShape(resultSchema, envelope.result, endpoint)
}
