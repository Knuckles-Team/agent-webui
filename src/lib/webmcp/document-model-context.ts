/**
 * Adapter for the 26 August 2026 WebMCP community-draft shape:
 * `document.modelContext.registerTool(tool, { signal })`.
 *
 * Do not import this module to call the browser API directly. The feature
 * detector in `adapter.ts` is the only public entry point so that an API
 * revision can be added without spreading draft-specific assumptions through
 * React components.
 */
import type { WebMcpAdapter, WebMcpModelContextLike, WebMcpToolDefinition } from './types'

export const DOCUMENT_MODEL_CONTEXT_VERSION = 'document-model-context-2026-08-26' as const

export class DocumentModelContextAdapter implements WebMcpAdapter {
  readonly version = DOCUMENT_MODEL_CONTEXT_VERSION
  private readonly modelContext: WebMcpModelContextLike

  constructor(modelContext: WebMcpModelContextLike) {
    this.modelContext = modelContext
  }

  registerTool(tool: WebMcpToolDefinition, signal: AbortSignal): Promise<void> {
    // The current draft uses an AbortSignal as the lifecycle/unregistration
    // mechanism. Promise.resolve also normalizes early implementations that
    // return void despite the draft's Promise<void> contract.
    try {
      return Promise.resolve(this.modelContext.registerTool(tool, { signal })).then(() => undefined)
    } catch (error) {
      const cause = error instanceof Error ? error : new Error('Unknown WebMCP registration failure')
      return Promise.reject(cause)
    }
  }
}
