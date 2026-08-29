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
 * Register a set of tools and return an idempotent cleanup function.
 *
 * Cleanup aborts every registration using the current draft's authoritative
 * retirement mechanism. This covers unmount, identity changes, and page-
 * context changes, including a registration promise that is still pending
 * when React runs the effect cleanup.
 */
export function registerWebMcpTools(adapter: WebMcpAdapter, tools: readonly WebMcpToolDefinition[]): () => void {
  let cleaned = false
  const registrations = tools.map((tool) => {
    const controller = new AbortController()
    try {
      void adapter.registerTool(tool, controller.signal).catch(() => undefined)
    } catch {
      // Permission policy and browser-draft failures are intentionally a no-op.
    }

    return () => {
      if (controller.signal.aborted) return
      controller.abort()
    }
  })

  return () => {
    if (cleaned) return
    cleaned = true
    registrations.forEach((cleanup) => {
      cleanup()
    })
  }
}
