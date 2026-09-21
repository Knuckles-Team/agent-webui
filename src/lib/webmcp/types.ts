/**
 * Version-isolated types for the experimental WebMCP imperative API.
 *
 * WebMCP is not part of TypeScript's DOM library yet. Keep the draft browser
 * surface behind these deliberately small structural types instead of merging
 * an unstable `modelContext` property into the global `Document` interface.
 * That makes an unsupported browser a normal, typed no-op and keeps future
 * draft changes local to `document-model-context.ts`.
 */

export type WebMcpJsonSchema = Readonly<Record<string, unknown>>

export interface WebMcpToolAnnotations {
  readonly readOnlyHint?: boolean
  readonly untrustedContentHint?: boolean
}

export type WebMcpMutationClass = 'read' | 'local-ui-mutation'
export type WebMcpConfirmationPolicy = 'none' | 'exact-request'

/**
 * Stable metadata used to project the same local tool into the governed
 * capability catalog. It does not add another execution callback: the
 * definition's validated `execute` function remains the only implementation.
 */
export interface WebMcpCapabilityMetadata {
  readonly version: string
  readonly outputSchema: WebMcpJsonSchema
  readonly mutationClass: WebMcpMutationClass
  readonly confirmationPolicy: WebMcpConfirmationPolicy
  readonly source: string
}

export interface WebMcpExecutionOptions {
  readonly signal: AbortSignal
}

export interface WebMcpToolDefinition {
  readonly name: string
  readonly title?: string
  readonly description: string
  readonly inputSchema: WebMcpJsonSchema
  readonly annotations?: WebMcpToolAnnotations
  readonly capability?: WebMcpCapabilityMetadata
  readonly execute: (input: unknown, options: WebMcpExecutionOptions) => Promise<unknown>
}

export interface WebMcpRegisterToolOptions {
  readonly signal?: AbortSignal
  readonly exposedTo?: readonly string[]
}

/** Structural boundary for the current `document.modelContext` draft. */
export interface WebMcpModelContextLike {
  registerTool: (tool: WebMcpToolDefinition, options?: WebMcpRegisterToolOptions) => void | PromiseLike<void>
}

export interface WebMcpAdapter {
  /** Explicitly identifies the draft adapter so it cannot be confused with a future API. */
  readonly version: 'document-model-context-2026-08-26'
  registerTool(tool: WebMcpToolDefinition, signal: AbortSignal): Promise<void>
}
