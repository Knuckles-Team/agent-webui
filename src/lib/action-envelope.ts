/**
 * @file action-envelope.ts
 * @description The GraphOS/AU REST action-twin envelope, read in one place.
 *
 * A twin answers `{status: 'success', result}` with HTTP 200. Since EH-386 a
 * tool's typed failed `OperationResult` is answered as `{status: 'failed',
 * result: {status: 'failed', operation_id, error: {code, message}}}` with the
 * error code's HTTP status (400/403/500/503). It used to be answered as HTTP 200
 * `success`, which rendered an engine `ACCESS_DENIED` write as a success. Every
 * HTTP helper (`gateway.ts`, `atlas/transport.ts`, `mcp-client.ts`) reads the
 * envelope through here, so they agree on what a failure means.
 */

/** Unwrap the canonical `{status, result}` action-twin envelope when present. */
export function unwrapEnvelope(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'result' in raw && 'status' in raw) {
    return (raw as { result: unknown }).result
  }
  return raw
}

/** Public error codes that mean "a required service is down", not "you did it wrong". */
const UNAVAILABLE_CODES = new Set(['dependency_unavailable', 'engine_degraded'])

export interface EnvelopeFailure {
  /** The capability's backing service is down: render as a stated absence, not an error. */
  unavailable: boolean
  /** `HTTP <status>: <code>: <message>`. The `HTTP <status>` prefix is kept for status checks. */
  error: string
}

function typedError(body: unknown): { code: string; message: string } | null {
  if (!body || typeof body !== 'object') return null
  const envelope = body as Record<string, unknown>
  if (envelope.status !== 'failed') return null
  const result = envelope.result as Record<string, unknown> | null | undefined
  const error = result && typeof result === 'object' ? result.error : null
  if (!error || typeof error !== 'object') return null
  const { code, message } = error as Record<string, unknown>
  if (typeof code !== 'string') return null
  return { code, message: typeof message === 'string' ? message : code }
}

/**
 * Classify a non-2xx response body that carries a typed failed operation.
 * Returns `null` for any other body, and the caller keeps its generic handling.
 */
export function failedEnvelope(status: number, bodyText: string): EnvelopeFailure | null {
  let body: unknown
  try {
    body = JSON.parse(bodyText)
  } catch {
    return null
  }
  const failure = typedError(body)
  if (failure === null) return null
  return {
    unavailable: UNAVAILABLE_CODES.has(failure.code),
    error: `HTTP ${String(status)}: ${failure.code}: ${failure.message}`,
  }
}
