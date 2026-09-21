/** Public entry points for the optional, draft-isolated WebMCP integration. */
export { createUnavailableWebMcpRegistration, detectWebMcpAdapter, registerWebMcpTools } from './adapter'
export type { WebMcpRegistrationHandle, WebMcpRegistrationSnapshot, WebMcpRegistrationStatus } from './adapter'
export { DocumentModelContextAdapter, DOCUMENT_MODEL_CONTEXT_VERSION } from './document-model-context'
export { WebMcpAtlasRegistrar } from './atlas'
export { navigateWithinWebUi } from './navigation'
export { createAtlasTools, createPageTools } from './tools'
export { createValidatedExecutor, isValidatedWebMcpExecutor, parseWebMcpInput } from './validation'
export { WebMcpProvider, useWebMcpToolSet } from './provider'
export { ActiveWebMcpRegistry } from './registry'
export { RemoteWebMcpDispatcher } from './bridge'
export { WebMcpControlChannel } from './channel'
export { SameOriginAttendedArmClient } from './attended-arm'
export type { AttendedArmClient, AttendedArmRouteScope, AttendedArmScope, AttendedArmStatus } from './attended-arm'
export {
  WEBMCP_CAPABILITY_CATALOG_VERSION,
  WEBMCP_CONTROL_PROTOCOL,
  buildWebMcpCapabilityCatalog,
  toCatalogRegisterMessage,
} from './catalog'
export type {
  WebMcpCapabilityCatalog,
  WebMcpCapabilityDescriptor,
  WebMcpCatalogBinding,
  WebMcpCatalogRegisterMessage,
} from './catalog'
export type { WebMcpBrowserMessage, WebMcpPendingConfirmation, WebMcpServerMessage } from './bridge'
export type { WebMcpChannelStatus, WebMcpChannelView, WebMcpSocketFactory } from './channel'
export type {
  WebMcpAdapter,
  WebMcpCapabilityMetadata,
  WebMcpConfirmationPolicy,
  WebMcpJsonSchema,
  WebMcpModelContextLike,
  WebMcpToolAnnotations,
  WebMcpToolDefinition,
  WebMcpMutationClass,
} from './types'
