/** Public entry points for the optional, draft-isolated WebMCP integration. */
export { createUnavailableWebMcpRegistration, detectWebMcpAdapter, registerWebMcpTools } from './adapter'
export type { WebMcpRegistrationHandle, WebMcpRegistrationSnapshot, WebMcpRegistrationStatus } from './adapter'
export { DocumentModelContextAdapter, DOCUMENT_MODEL_CONTEXT_VERSION } from './document-model-context'
export { WebMcpAtlasRegistrar } from './atlas'
export { navigateWithinWebUi } from './navigation'
export { createAtlasTools, createPageTools } from './tools'
export { createValidatedExecutor, parseWebMcpInput } from './validation'
export { WebMcpProvider, useWebMcpToolSet } from './provider'
export type {
  WebMcpAdapter,
  WebMcpJsonSchema,
  WebMcpModelContextLike,
  WebMcpToolAnnotations,
  WebMcpToolDefinition,
} from './types'
