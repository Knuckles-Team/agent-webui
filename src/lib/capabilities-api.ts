/** Typed client for the canonical frontend capability and run-event contracts. */

export type CapabilityAvailabilityStatus = 'available' | 'degraded' | 'unavailable'
export type CapabilityRenderer = 'timeseries' | 'trace' | 'map' | 'code' | 'evidence' | 'graph' | 'table' | 'json'

export interface JsonSchema {
  $ref?: string
  $defs?: Record<string, JsonSchema>
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  type?: string | string[]
  title?: string
  description?: string
  format?: string
  default?: unknown
  const?: unknown
  enum?: unknown[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  additionalProperties?: boolean | JsonSchema
  writeOnly?: boolean
  'x-sensitive'?: boolean
}

export interface CapabilitySideEffects {
  mutates: boolean | null
  durability?: string | null
  idempotent?: boolean | null
  audited?: boolean | null
  emits_cdc?: boolean | null
  transaction_participation?: string | null
}

export interface CapabilityAction {
  id: string
  input_schema: JsonSchema
  schema_quality?: string
  output_schema?: JsonSchema
  typed_io: {
    legacy_rest_route?: string
    legacy_request_encoding?: string
    frontend_executable?: boolean
    legacy_direct_response_schema?: JsonSchema
    params_field?: string
    /** Compatibility with catalog schema versions predating governed invoke. */
    rest_route?: string
    request_encoding?: string
  }
  side_effects: CapabilitySideEffects
  policy: {
    approval_class?: string | null
    authz_action?: string | null
    target_input?: string | null
    authoritative_at_execution: boolean
  }
}

export interface CapabilityDescriptor {
  id: string
  title: string
  one_line: string
  intent_verbs?: string[]
  actions: CapabilityAction[]
  typed_io: {
    legacy_rest_route?: string
    rest_route?: string
    tags: string[]
    input_schema?: JsonSchema
    rest_output_schema?: JsonSchema
    mcp_output_schema?: JsonSchema
  }
  availability: {
    status: CapabilityAvailabilityStatus
    readiness?: 'warm' | 'cold' | 'degraded' | 'blocked'
    reasons: string[]
    missing_preconditions: string[]
  }
  execution: {
    transports: string[]
    response_mode: string
    streaming: boolean | string
    governed_invoke_route?: string
    normative_frontend_contract?: string
    invocation_ack_schema?: JsonSchema
    eventual_result_event?: string
  }
  render: {
    renderer: CapabilityRenderer
    source?: string
  }
}

export interface CapabilityCatalog {
  schema_version: string
  catalog_version: string
  generated_at: string
  runtime: {
    engine_active: boolean
    backend_ready: boolean
    status: string
    reason?: string | null
  }
  count: number
  action_count: number
  capabilities: CapabilityDescriptor[]
  filtered_count?: number
}

export interface CapabilityPreflightRequest {
  action?: string
  inputs: Record<string, unknown>
  target?: string
}

export interface CapabilityInvokeRequest extends CapabilityPreflightRequest {
  approval_id?: string
  run_id?: string
  session_id?: string
}

export interface CapabilityInvocationResult {
  status: string
  run_id?: string
  session_id?: string
  approval_id?: string
  result?: unknown
  message?: string
  validation_issues?: ValidationIssue[]
  availability?: CapabilityDescriptor['availability']
  policy?: Record<string, unknown>
}

export interface ValidationIssue {
  field: string
  message: string
}

export interface CapabilityPreflight {
  capability_id: string
  action: string
  valid: boolean
  validation_issues: ValidationIssue[]
  availability: CapabilityDescriptor['availability']
  policy: {
    decision: string
    tier: string
    reason: string
    approval_required: boolean
    source: string
    authoritative: false
    identity_evaluated: false
    must_recheck_at_execution: true
  }
  eligible: boolean
  executable_now: boolean
  side_effects: CapabilitySideEffects
}

export interface RunSummary {
  run_id: string
  session_id?: string | null
  trace_id?: string | null
  status?: 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_for_input'
  first_sequence: number
  last_sequence: number
  event_count: number
  truncated?: boolean
  first_timestamp?: string | null
  last_timestamp?: string | null
  last_event_type?: string | null
}

export interface RunList {
  schema_version: string
  count: number
  runs: RunSummary[]
}

export interface RunEventEnvelope {
  schema_version: string
  event_id: string
  sequence: number
  timestamp: string
  type: string
  run_id: string
  session_id?: string | null
  trace_id?: string | null
  correlation_id?: string | null
  parent_event_id?: string | null
  source: string
  payload: Record<string, unknown>
}

export interface RunEventReplay {
  schema_version: string
  run_id: string
  after: number
  events: RunEventEnvelope[]
  next_after: number
  has_more?: boolean
  retained_from?: number | null
}

export class CapabilityApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(message: string, status: number, detail?: unknown) {
    super(message)
    this.name = 'CapabilityApiError'
    this.status = status
    this.detail = detail
  }
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return response.json()
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body
  if (body && typeof body === 'object') {
    const object = body as Record<string, unknown>
    for (const key of ['detail', 'message']) {
      if (typeof object[key] === 'string' && object[key]) return object[key]
    }
    if (object.policy && typeof object.policy === 'object') {
      const reason = (object.policy as Record<string, unknown>).reason
      if (typeof reason === 'string' && reason) return reason
    }
    if (Array.isArray(object.validation_issues) && object.validation_issues.length > 0) {
      const first = (object.validation_issues as unknown[])[0]
      if (first && typeof first === 'object') {
        const issue = first as Record<string, unknown>
        if (typeof issue.message === 'string') return issue.message
      }
    }
  }
  return fallback
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init })
  const body = await responseBody(response)
  if (!response.ok) {
    throw new CapabilityApiError(errorMessage(body, `Request failed (${response.status})`), response.status, body)
  }
  return body as T
}

export function fetchCapabilityCatalog(signal?: AbortSignal): Promise<CapabilityCatalog> {
  return requestJson<CapabilityCatalog>('/api/capabilities?include_actions=true', {
    headers: { Accept: 'application/json' },
    signal,
  })
}

export function fetchCapabilityDetail(capabilityId: string, signal?: AbortSignal): Promise<CapabilityDescriptor> {
  return requestJson<CapabilityDescriptor>(`/api/capabilities/${encodeURIComponent(capabilityId)}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
}

export function preflightCapability(
  capabilityId: string,
  proposal: CapabilityPreflightRequest,
  signal?: AbortSignal,
): Promise<CapabilityPreflight> {
  return requestJson<CapabilityPreflight>(`/api/capabilities/${encodeURIComponent(capabilityId)}/preflight`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(proposal),
    signal,
  })
}

export function invokeCapability(
  capabilityId: string,
  proposal: CapabilityInvokeRequest,
  signal?: AbortSignal,
): Promise<CapabilityInvocationResult> {
  return requestJson<CapabilityInvocationResult>(`/api/capabilities/${encodeURIComponent(capabilityId)}/invoke`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(proposal),
    signal,
  })
}

export function fetchRunSummary(runId: string, signal?: AbortSignal): Promise<RunSummary> {
  return requestJson<RunSummary>(`/api/runs/${encodeURIComponent(runId)}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
}

export function fetchRuns(
  options: { sessionId?: string; status?: RunSummary['status']; limit?: number; signal?: AbortSignal } = {},
): Promise<RunList> {
  const params = new URLSearchParams({ limit: String(options.limit ?? 50) })
  if (options.sessionId) params.set('session_id', options.sessionId)
  if (options.status) params.set('status', options.status)
  return requestJson<RunList>(`/api/runs?${params}`, {
    headers: { Accept: 'application/json' },
    signal: options.signal,
  })
}

export function fetchRunEvents(
  runId: string,
  options: { after?: number; limit?: number; signal?: AbortSignal } = {},
): Promise<RunEventReplay> {
  const params = new URLSearchParams({
    after: String(options.after ?? 0),
    limit: String(options.limit ?? 1_000),
  })
  return requestJson<RunEventReplay>(`/api/runs/${encodeURIComponent(runId)}/events?${params}`, {
    headers: { Accept: 'application/json' },
    signal: options.signal,
  })
}

export interface PaginatedRunReplay extends RunEventReplay {
  client_truncated: boolean
}

/** Replay successive cursor pages while keeping a bounded browser timeline. */
export async function replayRunEvents(
  runId: string,
  options: { after?: number; pageSize?: number; maxEvents?: number; signal?: AbortSignal } = {},
): Promise<PaginatedRunReplay> {
  const after = options.after ?? 0
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 500, 1_000))
  const maxEvents = Math.max(1, options.maxEvents ?? 5_000)
  const events: RunEventEnvelope[] = []
  let cursor = after
  let schemaVersion = '1.0'
  let retainedFrom: number | null | undefined
  let hasMore: boolean | undefined
  let serverTruncated = false

  while (events.length < maxEvents) {
    const limit = Math.min(pageSize, maxEvents - events.length)
    const page = await fetchRunEvents(runId, { after: cursor, limit, signal: options.signal })
    schemaVersion = page.schema_version
    retainedFrom = page.retained_from ?? retainedFrom
    hasMore = page.has_more
    if (typeof page.retained_from === 'number' && after < page.retained_from - 1) serverTruncated = true
    events.push(...page.events)
    if (page.events.length === 0 || page.next_after <= cursor || page.has_more === false) {
      cursor = Math.max(cursor, page.next_after)
      break
    }
    cursor = page.next_after
  }

  return {
    schema_version: schemaVersion,
    run_id: runId,
    after,
    events,
    next_after: cursor,
    has_more: hasMore,
    retained_from: retainedFrom,
    client_truncated: serverTruncated || (events.length >= maxEvents && hasMore !== false),
  }
}

function parseSseData(record: string): unknown {
  const data = record
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return null
  try {
    return JSON.parse(data) as unknown
  } catch {
    return null
  }
}

/** Parse one SSE record while ignoring comments and malformed/non-event records. */
export function parseRunEventSseRecord(record: string): RunEventEnvelope | null {
  const event = parseSseData(record) as Partial<RunEventEnvelope> | null
  if (
    !event ||
    typeof event.event_id !== 'string' ||
    typeof event.sequence !== 'number' ||
    typeof event.type !== 'string' ||
    typeof event.run_id !== 'string'
  ) {
    return null
  }
  return event as RunEventEnvelope
}

export interface RunStreamReset {
  schema_version: string
  type: 'stream_reset'
  run_id: string
  requested_after: number
  first_available: number
  last_available: number
  reason: string
}

function parseRunStreamReset(record: string): RunStreamReset | null {
  const reset = parseSseData(record) as Partial<RunStreamReset> | null
  if (
    reset?.type !== 'stream_reset' ||
    typeof reset.run_id !== 'string' ||
    typeof reset.first_available !== 'number' ||
    typeof reset.last_available !== 'number'
  ) {
    return null
  }
  return reset as RunStreamReset
}

export class RunEventStreamResetError extends Error {
  readonly reset: RunStreamReset

  constructor(reset: RunStreamReset) {
    super(
      `${reset.reason || 'Run history is no longer retained'}. Replay begins at sequence ${reset.first_available}.`,
    )
    this.name = 'RunEventStreamResetError'
    this.reset = reset
  }
}

export interface FollowRunEventsOptions {
  after?: number
  signal?: AbortSignal
  onOpen?: () => void
  onEvent: (event: RunEventEnvelope) => void
}

const TERMINAL_RUN_EVENT_TYPES = new Set([
  'run_completed',
  'graph_complete',
  'run_failed',
  'error',
  'run_cancelled',
  'run_interrupted',
])

export function isTerminalRunEvent(event: Pick<RunEventEnvelope, 'type'>): boolean {
  return TERMINAL_RUN_EVENT_TYPES.has(event.type)
}

/** Follow arbitrary named SSE events without relying on EventSource's `message` event. */
export async function followRunEvents(runId: string, options: FollowRunEventsOptions): Promise<void> {
  const params = new URLSearchParams({ after: String(options.after ?? 0), follow: 'true' })
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events?${params}`, {
    credentials: 'same-origin',
    headers: { Accept: 'text/event-stream' },
    signal: options.signal,
  })
  if (!response.ok) {
    const body = await responseBody(response)
    throw new CapabilityApiError(errorMessage(body, `Follow failed (${response.status})`), response.status, body)
  }
  if (!response.body) throw new Error('Run event stream is unavailable in this browser')
  options.onOpen?.()

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamComplete = false
  while (!streamComplete) {
    const { done, value } = await reader.read()
    streamComplete = done
    if (value) buffer += decoder.decode(value, { stream: !done })
    let boundary = buffer.search(/\r?\n\r?\n/)
    let terminal = false
    let streamReset: RunStreamReset | null = null
    while (boundary >= 0) {
      const record = buffer.slice(0, boundary)
      const separator = /^\r?\n\r?\n/.exec(buffer.slice(boundary))?.[0] ?? '\n\n'
      buffer = buffer.slice(boundary + separator.length)
      streamReset = parseRunStreamReset(record)
      if (streamReset) break
      const event = parseRunEventSseRecord(record)
      if (event) {
        options.onEvent(event)
        terminal = isTerminalRunEvent(event)
      }
      if (terminal) break
      boundary = buffer.search(/\r?\n\r?\n/)
    }
    if (terminal || streamReset) {
      await reader.cancel()
      if (streamReset) throw new RunEventStreamResetError(streamReset)
      return
    }
  }
  const finalReset = parseRunStreamReset(buffer)
  if (finalReset) throw new RunEventStreamResetError(finalReset)
  const finalEvent = parseRunEventSseRecord(buffer)
  if (finalEvent) options.onEvent(finalEvent)
}

/** Find a canonical run identifier in common response envelopes. */
export function extractRunId(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 5) return null
  const object = value as Record<string, unknown>
  for (const key of ['run_id', 'runId']) {
    if (typeof object[key] === 'string' && object[key]) return object[key]
  }
  for (const key of ['result', 'data', 'run', 'metadata']) {
    const nested = extractRunId(object[key], depth + 1)
    if (nested) return nested
  }
  return null
}
