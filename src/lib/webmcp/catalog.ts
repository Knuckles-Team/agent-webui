import { canonicalJson, digestJson, utf8ByteLength } from './canonical'
import type { WebMcpToolDefinition } from './types'
import { isValidatedWebMcpExecutor } from './validation'

export const WEBMCP_CONTROL_PROTOCOL = 'webmcp.control.v1'
export const WEBMCP_CAPABILITY_CATALOG_VERSION = '1.0.0'
export const WEBMCP_CATALOG_TOOL_LIMIT = 64
export const WEBMCP_SCHEMA_BYTE_BUDGET = 16_384

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const VERSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

function isSafeSourceReference(source: string): boolean {
  return (
    source.length > 0 &&
    source.length <= 256 &&
    Array.from(source).every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
  )
}

export type WebMcpCatalogMutationClass = 'read' | 'local-ui-mutation'
export type WebMcpCatalogConfirmation = 'none' | 'exact-request'

export interface WebMcpCapabilityDescriptor {
  readonly toolId: string
  readonly title: string
  readonly version: string
  readonly schemaDigest: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly outputSchema: Readonly<Record<string, unknown>>
  readonly inputSchemaDigest: string
  readonly outputSchemaDigest: string
  readonly requiredRoles: readonly string[]
  readonly routeId: string
  readonly mutationClass: WebMcpCatalogMutationClass
  readonly confirmation: WebMcpCatalogConfirmation
  readonly authority: 'browser-local'
  readonly source: string
}

export interface WebMcpCapabilityCatalog {
  readonly protocol: typeof WEBMCP_CONTROL_PROTOCOL
  readonly version: typeof WEBMCP_CAPABILITY_CATALOG_VERSION
  readonly authority: 'browser-local'
  readonly documentId: string
  readonly routeId: string
  readonly route: string
  readonly identityClaim: string
  readonly registrationGeneration: number
  readonly tools: readonly WebMcpCapabilityDescriptor[]
  readonly catalogDigest: string
  readonly toolScopeDigest: string
}

export interface WebMcpCatalogBinding {
  readonly documentId: string
  readonly routeId: string
  readonly route: string
  readonly identityClaim: string
  readonly role: string
}

async function describeTool(
  tool: WebMcpToolDefinition,
  binding: WebMcpCatalogBinding,
): Promise<WebMcpCapabilityDescriptor> {
  const metadata = tool.capability
  if (!metadata) throw new Error(`WebMCP tool ${tool.name} has no capability metadata`)
  if (!isValidatedWebMcpExecutor(tool.execute)) {
    throw new Error(`WebMCP tool ${tool.name} does not use the validated executor`)
  }
  if (!OPAQUE_ID.test(tool.name)) throw new Error(`WebMCP tool ${tool.name} has an invalid protocol ID`)
  if (!VERSION_ID.test(metadata.version)) throw new Error(`WebMCP tool ${tool.name} has an invalid version`)
  if (!isSafeSourceReference(metadata.source)) {
    throw new Error(`WebMCP tool ${tool.name} has an invalid source reference`)
  }
  if (
    utf8ByteLength(canonicalJson(tool.inputSchema)) > WEBMCP_SCHEMA_BYTE_BUDGET ||
    utf8ByteLength(canonicalJson(metadata.outputSchema)) > WEBMCP_SCHEMA_BYTE_BUDGET
  ) {
    throw new Error(`WebMCP tool ${tool.name} exceeded the schema byte budget`)
  }
  const [inputSchemaDigest, outputSchemaDigest, schemaDigest] = await Promise.all([
    digestJson(tool.inputSchema),
    digestJson(metadata.outputSchema),
    digestJson({ input_schema: tool.inputSchema, output_schema: metadata.outputSchema }),
  ])
  return {
    toolId: tool.name,
    title: tool.title ?? tool.name,
    version: metadata.version,
    schemaDigest,
    inputSchema: tool.inputSchema,
    outputSchema: metadata.outputSchema,
    inputSchemaDigest,
    outputSchemaDigest,
    requiredRoles: [binding.role],
    routeId: binding.routeId,
    mutationClass: metadata.mutationClass,
    confirmation: metadata.confirmationPolicy,
    authority: 'browser-local',
    source: metadata.source,
  }
}

function uniqueTools(tools: readonly WebMcpToolDefinition[]): readonly WebMcpToolDefinition[] {
  const byId = new Map<string, WebMcpToolDefinition>()
  for (const tool of tools) {
    if (byId.has(tool.name)) throw new Error(`Duplicate WebMCP tool ID: ${tool.name}`)
    byId.set(tool.name, tool)
  }
  return [...byId.values()].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}

export async function buildWebMcpCapabilityCatalog(options: {
  binding: WebMcpCatalogBinding
  registrationGeneration: number
  tools: readonly WebMcpToolDefinition[]
}): Promise<WebMcpCapabilityCatalog> {
  if (!OPAQUE_ID.test(options.binding.routeId)) throw new Error('WebMCP catalog has an invalid route ID')
  if (!VERSION_ID.test(options.binding.role)) throw new Error('WebMCP catalog has an invalid required role')
  if (!Number.isSafeInteger(options.registrationGeneration) || options.registrationGeneration < 1) {
    throw new Error('WebMCP catalog has an invalid registration generation')
  }
  const unique = uniqueTools(options.tools)
  if (unique.length > WEBMCP_CATALOG_TOOL_LIMIT) throw new Error('WebMCP capability catalog has too many tools')
  const tools = await Promise.all(unique.map((tool) => describeTool(tool, options.binding)))
  const body = {
    protocol: WEBMCP_CONTROL_PROTOCOL as typeof WEBMCP_CONTROL_PROTOCOL,
    version: WEBMCP_CAPABILITY_CATALOG_VERSION as typeof WEBMCP_CAPABILITY_CATALOG_VERSION,
    authority: 'browser-local' as const,
    documentId: options.binding.documentId,
    routeId: options.binding.routeId,
    route: options.binding.route,
    identityClaim: options.binding.identityClaim,
    registrationGeneration: options.registrationGeneration,
    tools,
  }
  const descriptorClaims = tools.map((tool) => ({
    tool_id: tool.toolId,
    version: tool.version,
    schema_digest: tool.schemaDigest,
    mutation_class: tool.mutationClass,
    confirmation_policy: tool.confirmation,
    required_roles: tool.requiredRoles,
    source_ref: tool.source,
  }))
  const toolScope = {
    tool_ids: tools.map((tool) => tool.toolId),
    schema_digests: Object.fromEntries(tools.map((tool) => [tool.toolId, tool.schemaDigest])),
  }
  const [catalogDigest, toolScopeDigest] = await Promise.all([digestJson(descriptorClaims), digestJson(toolScope)])
  return { ...body, catalogDigest, toolScopeDigest }
}

export interface WebMcpCatalogRegisterMessage {
  readonly type: 'catalog.register'
  readonly protocol: typeof WEBMCP_CONTROL_PROTOCOL
  readonly authority: 'browser-local'
  readonly registration_generation: number
  readonly route_id: string
  readonly catalog_digest: string
  readonly tool_scope_digest: string
  readonly tools: readonly {
    readonly tool_id: string
    readonly version: string
    readonly input_schema: Readonly<Record<string, unknown>>
    readonly output_schema: Readonly<Record<string, unknown>>
    readonly schema_digest: string
    readonly mutation_class: WebMcpCatalogMutationClass
    readonly confirmation_policy: WebMcpCatalogConfirmation
    readonly required_roles: readonly string[]
    readonly source_ref: string
  }[]
}

/** Strip browser-only detail before sending the catalog over the authenticated channel. */
export function toCatalogRegisterMessage(catalog: WebMcpCapabilityCatalog): WebMcpCatalogRegisterMessage {
  return {
    type: 'catalog.register',
    protocol: WEBMCP_CONTROL_PROTOCOL,
    authority: 'browser-local',
    registration_generation: catalog.registrationGeneration,
    route_id: catalog.routeId,
    catalog_digest: catalog.catalogDigest,
    tool_scope_digest: catalog.toolScopeDigest,
    tools: catalog.tools.map((tool) => ({
      tool_id: tool.toolId,
      version: tool.version,
      input_schema: tool.inputSchema,
      output_schema: tool.outputSchema,
      schema_digest: tool.schemaDigest,
      mutation_class: tool.mutationClass,
      confirmation_policy: tool.confirmation,
      required_roles: tool.requiredRoles,
      source_ref: tool.source,
    })),
  }
}
