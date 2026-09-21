import { z } from 'zod'
import { parseStrictJson } from './strict-json'

const MAX_AUTHORITY_RESPONSE_BYTES = 4_096

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const opaqueId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const generation = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const expiry = z.number().positive()

const NoneResponseSchema = z.object({ status: z.literal('none') }).strict()
const RecentAuthResponseSchema = z
  .object({
    status: z.literal('recent-auth'),
    expires_at: expiry,
    route_id: opaqueId,
  })
  .strict()
const ArmedResponseSchema = z
  .object({
    status: z.literal('armed'),
    expires_at: expiry,
    route_id: opaqueId,
    registration_generation: generation,
    catalog_digest: digest,
    tool_scope_digest: digest,
  })
  .strict()

const AttendedArmStatusSchema = z.discriminatedUnion('status', [
  NoneResponseSchema,
  RecentAuthResponseSchema,
  ArmedResponseSchema,
])
const AttendedArmInitiationSchema = z
  .object({
    authorization_url: z.url().max(2_048),
    expires_at: expiry,
  })
  .strict()

export interface AttendedArmRouteScope {
  readonly route_id: string
  readonly next?: string
}

export interface AttendedArmScope {
  readonly route_id: string
  readonly registration_generation: number
  readonly catalog_digest: string
  readonly tool_scope_digest: string
  readonly tools: readonly {
    readonly tool_id: string
    readonly schema_digest: string
  }[]
}

export type AttendedArmStatus = z.infer<typeof AttendedArmStatusSchema>

export interface AttendedArmClient {
  readiness(): Promise<AttendedArmStatus>
  initiate(scope: AttendedArmRouteScope): Promise<{ authorization_url: string; expires_at: number }>
  finalize(scope: AttendedArmScope): Promise<Extract<AttendedArmStatus, { status: 'armed' }>>
  revoke(): Promise<void>
}

function unavailable(): never {
  throw new Error('Attended browser control is unavailable')
}

async function boundedJson(response: Response, abort: () => void): Promise<unknown> {
  const declaredSize = Number(response.headers.get('Content-Length'))
  if (!response.ok || (Number.isFinite(declaredSize) && declaredSize > MAX_AUTHORITY_RESPONSE_BYTES)) {
    abort()
    unavailable()
  }
  const reader = response.body?.getReader()
  if (!reader) unavailable()
  const bytes = new Uint8Array(MAX_AUTHORITY_RESPONSE_BYTES)
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (length + value.byteLength > MAX_AUTHORITY_RESPONSE_BYTES) {
      abort()
      await reader.cancel().catch(() => undefined)
      unavailable()
    }
    bytes.set(value, length)
    length += value.byteLength
  }
  return parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)))
}

async function sameOriginJson(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
  const controller = new AbortController()
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers:
      body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: controller.signal,
  })
  return boundedJson(response, () => {
    controller.abort()
  })
}

/** Same-origin client; recent-auth and arm receipt material remain HttpOnly and server-owned. */
export class SameOriginAttendedArmClient implements AttendedArmClient {
  async readiness(): Promise<AttendedArmStatus> {
    return AttendedArmStatusSchema.parse(await sameOriginJson('/api/browser-control/attended-arm', 'GET'))
  }

  async initiate(scope: AttendedArmRouteScope): Promise<{ authorization_url: string; expires_at: number }> {
    const response = await sameOriginJson('/api/browser-control/attended-arm', 'POST', scope)
    return AttendedArmInitiationSchema.parse(response)
  }

  async finalize(scope: AttendedArmScope): Promise<Extract<AttendedArmStatus, { status: 'armed' }>> {
    const response = await sameOriginJson('/api/browser-control/attended-arm/finalize', 'POST', {
      route_id: scope.route_id,
      registration_generation: scope.registration_generation,
      catalog_digest: scope.catalog_digest,
      tools: scope.tools,
    })
    return ArmedResponseSchema.parse(response)
  }

  async revoke(): Promise<void> {
    const response = await fetch('/api/browser-control/attended-arm', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error('Attended browser control could not be revoked')
  }
}
