/**
 * Feature detection and lifecycle helpers for the experimental WebMCP API.
 *
 * The app intentionally detects only `document.modelContext`, the current
 * draft's secure-context surface. There is no navigator/polyfill fallback:
 * exposing an older or third-party API under the current contract could make
 * tool names, lifecycle guarantees, and input semantics disagree silently.
 */
import { DocumentModelContextAdapter } from './document-model-context'
import type { WebMcpAdapter, WebMcpModelContextLike, WebMcpToolDefinition } from './types'

export type WebMcpRegistrationStatus = 'pending' | 'active' | 'failed' | 'aborted' | 'unavailable'

export interface WebMcpRegistrationSnapshot {
  readonly generation: number
  /** Only acknowledged registrations appear here. */
  readonly activeToolNames: readonly string[]
  /** Pending, failed, aborted, or unsupported registrations are unavailable. */
  readonly unavailableToolNames: readonly string[]
  readonly statusByTool: Readonly<Record<string, WebMcpRegistrationStatus>>
  /** Bounded diagnostic text for failed registrations; never raw exceptions. */
  readonly errorByTool: Readonly<Record<string, string>>
}

/**
 * A callable cleanup handle that also exposes registration evidence. The
 * browser API returns no queryable registry, so a definition is not considered
 * active until its registration promise has acknowledged successfully.
 */
export interface WebMcpRegistrationHandle {
  (): void
  readonly generation: number
  readonly acknowledged: Promise<WebMcpRegistrationSnapshot>
  getSnapshot(): WebMcpRegistrationSnapshot
}

let nextRegistrationGeneration = 0

function uniqueNames(names: readonly string[]): string[] {
  return [...new Set(names)]
}

function registrationError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : ''
  if (!message || /authorization|bearer\s|api[_ -]?key|password|secret|token\b|traceback|stack trace/i.test(message)) {
    return 'WebMCP registration failed'
  }
  return message.replace(/\s+/g, ' ').slice(0, 256)
}

interface RegistrationRecord {
  name: string
  status: WebMcpRegistrationStatus
  error?: string
}

interface RegistrationState {
  cleaned: boolean
}

function settleRegistrationSuccess(record: RegistrationRecord, state: RegistrationState, signal: AbortSignal): void {
  record.status = state.cleaned || signal.aborted ? 'aborted' : 'active'
}

function settleRegistrationFailure(
  record: RegistrationRecord,
  state: RegistrationState,
  signal: AbortSignal,
  error: unknown,
): void {
  const status = state.cleaned || signal.aborted ? 'aborted' : 'failed'
  record.status = status
  if (status === 'failed') record.error = registrationError(error)
}

function registerOneWebMcpTool(
  adapter: WebMcpAdapter,
  tool: WebMcpToolDefinition,
  record: RegistrationRecord,
  controller: AbortController,
  state: RegistrationState,
): Promise<void> {
  try {
    return Promise.resolve(adapter.registerTool(tool, controller.signal)).then(
      () => {
        settleRegistrationSuccess(record, state, controller.signal)
      },
      (error: unknown) => {
        settleRegistrationFailure(record, state, controller.signal, error)
      },
    )
  } catch (error) {
    settleRegistrationFailure(record, state, controller.signal, error)
    return Promise.resolve()
  }
}

function abortPendingOrActive(record: RegistrationRecord): void {
  if (record.status === 'pending' || record.status === 'active') record.status = 'aborted'
}

function abortRegistration(controller: AbortController): void {
  if (!controller.signal.aborted) controller.abort()
}

/** Create an explicit unavailable handle for unsupported/disabled runtimes. */
export function createUnavailableWebMcpRegistration(
  tools: readonly WebMcpToolDefinition[] = [],
): WebMcpRegistrationHandle {
  const generation = ++nextRegistrationGeneration
  const names = uniqueNames(tools.map((tool) => tool.name))
  const snapshot: WebMcpRegistrationSnapshot = {
    generation,
    activeToolNames: [],
    unavailableToolNames: names,
    statusByTool: Object.fromEntries(names.map((name) => [name, 'unavailable' as const])),
    errorByTool: {},
  }
  const handle = (() => undefined) as WebMcpRegistrationHandle
  Object.defineProperties(handle, {
    generation: { value: generation, enumerable: true },
    acknowledged: { value: Promise.resolve(snapshot), enumerable: true },
    getSnapshot: { value: () => snapshot, enumerable: true },
  })
  return handle
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function modelContextFrom(documentLike: Document | undefined): WebMcpModelContextLike | null {
  if (!documentLike) return null
  try {
    const candidate = (documentLike as Document & { modelContext?: unknown }).modelContext
    if (!isRecord(candidate) || typeof candidate.registerTool !== 'function') return null
    return candidate as unknown as WebMcpModelContextLike
  } catch {
    // A browser may expose a guarded getter that throws when its permission is
    // disabled. Treat that exactly like an unsupported browser.
    return null
  }
}

/** Return the current draft adapter, or null when the browser does not support it. */
export function detectWebMcpAdapter(documentLike?: Document): WebMcpAdapter | null {
  if (typeof AbortController === 'undefined') return null
  const target = documentLike ?? (typeof document === 'undefined' ? undefined : document)
  const modelContext = modelContextFrom(target)
  return modelContext ? new DocumentModelContextAdapter(modelContext) : null
}

/**
 * Register a set of tools and return a callable handle with idempotent cleanup
 * plus acknowledged active-registration evidence.
 *
 * Cleanup aborts every registration using the current draft's authoritative
 * retirement mechanism. This covers unmount, identity changes, and page-
 * context changes, including a registration promise that is still pending
 * when React runs the effect cleanup.
 */
export function registerWebMcpTools(
  adapter: WebMcpAdapter,
  tools: readonly WebMcpToolDefinition[],
): WebMcpRegistrationHandle {
  const generation = ++nextRegistrationGeneration
  const state: RegistrationState = { cleaned: false }
  const records: RegistrationRecord[] = tools.map((tool) => ({
    name: tool.name,
    status: 'pending',
  }))
  const controllers = tools.map(() => new AbortController())
  const registrations = tools.map((tool, index) => {
    const controller = controllers[index]
    const record = records[index]
    return registerOneWebMcpTool(adapter, tool, record, controller, state)
  })

  const getSnapshot = (): WebMcpRegistrationSnapshot => {
    const activeToolNames = uniqueNames(
      records.filter((record) => record.status === 'active').map((record) => record.name),
    )
    const unavailableToolNames = uniqueNames(
      records.filter((record) => record.status !== 'active').map((record) => record.name),
    )
    const statusByTool: Record<string, WebMcpRegistrationStatus> = {}
    const errorByTool: Record<string, string> = {}
    records.forEach((record) => {
      statusByTool[record.name] = record.status
      if (record.error) errorByTool[record.name] = record.error
    })
    return { generation, activeToolNames, unavailableToolNames, statusByTool, errorByTool }
  }

  const acknowledged = Promise.all(registrations).then(() => getSnapshot())
  const handle = (() => {
    if (state.cleaned) return
    state.cleaned = true
    records.forEach(abortPendingOrActive)
    controllers.forEach(abortRegistration)
  }) as WebMcpRegistrationHandle
  Object.defineProperties(handle, {
    generation: { value: generation, enumerable: true },
    acknowledged: { value: acknowledged, enumerable: true },
    getSnapshot: { value: getSnapshot, enumerable: true },
  })
  return handle
}
