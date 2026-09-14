/**
 * Host-side CSP intersection and srcDoc construction for MCP Apps.
 *
 * CONCEPT:AU-ECO.ui.mcp-apps-host
 *
 * The server's declared `_meta.ui.csp` (`McpUiMeta.csp`) is a claim the
 * server made about what domains ITS app needs -- it is never applied
 * directly. `resolveFramePolicy` intersects it against `allowedDomains`,
 * the host's own, independently configured ceiling (e.g. an operator
 * allow-list), so a tool declaring a domain the host never agreed to trust
 * gets nothing, regardless of what it asked for. This is the client-side
 * half of "no server-supplied annotation is trusted without policy
 * verification" (the other half is `bridge.ts`'s tool-call `policy`).
 */

import type { McpUiMeta } from './types'

export interface ResolvedFramePolicy {
  connectDomains: string[]
  resourceDomains: string[]
  frameDomains: string[]
}

/** Bounds for arguments arriving from an untrusted MCP App iframe. Keep these
 * aligned with the BFF's structural/serialized delegation limits. */
export const MCP_APP_ARGUMENT_MAX_BYTES = 256 * 1024
export const MCP_APP_ARGUMENT_MAX_DEPTH = 10
export const MCP_APP_ARGUMENT_MAX_NODES = 20_000

export interface McpArgumentValidationSuccess {
  ok: true
  value: Record<string, unknown>
}

export interface McpArgumentValidationFailure {
  ok: false
  error: string
}

export type McpArgumentValidationResult = McpArgumentValidationSuccess | McpArgumentValidationFailure

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

interface ArgumentValidationContext {
  rootSchema: Record<string, unknown>
  nodes: number
}

function schemaReference(
  schema: Record<string, unknown>,
  rootSchema: Record<string, unknown>,
): Record<string, unknown> | null {
  const reference = schema.$ref
  if (reference === undefined) return schema
  if (typeof reference !== 'string') return null
  const prefix = reference.startsWith('#/$defs/') ? '#/$defs/' : '#/definitions/'
  if (!reference.startsWith(prefix)) return null
  const name = reference.slice(prefix.length)
  const definitions = rootSchema[prefix === '#/$defs/' ? '$defs' : 'definitions']
  if (!isRecord(definitions) || !isRecord(definitions[name])) return null
  return definitions[name]
}

function unsupportedSchemaKeyword(schema: Record<string, unknown>): boolean {
  return ['$dynamicRef', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else'].some((keyword) => keyword in schema)
}

function schemaTypes(schema: Record<string, unknown>): string[] | null {
  if (schema.type === undefined) return null
  if (typeof schema.type === 'string') return [schema.type]
  if (Array.isArray(schema.type) && schema.type.every((item) => typeof item === 'string')) {
    return schema.type
  }
  return []
}

function valueMatchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isRecord(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    default:
      return false
  }
}

function validationNodeAllowed(depth: number, context: ArgumentValidationContext): boolean {
  if (depth > MCP_APP_ARGUMENT_MAX_DEPTH) return false
  context.nodes += 1
  return context.nodes <= MCP_APP_ARGUMENT_MAX_NODES
}

function matchesSchemaType(value: unknown, schema: Record<string, unknown>): boolean {
  const types = schemaTypes(schema)
  return types === null || (types.length > 0 && types.some((type) => valueMatchesType(value, type)))
}

function matchesSchemaLiterals(value: unknown, schema: Record<string, unknown>): boolean {
  if ('const' in schema && !jsonEqual(value, schema.const)) return false
  if (!('enum' in schema)) return true
  return Array.isArray(schema.enum) && schema.enum.some((candidate) => jsonEqual(value, candidate))
}

function validateStringConstraints(value: string, schema: Record<string, unknown>): boolean {
  if (utf8Bytes(value) > 64 * 1024) return false
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false
  // Do not execute server-supplied regular expressions in the browser. A
  // descriptor that needs pattern semantics fails closed until a bounded
  // regex validator is available.
  return schema.pattern === undefined
}

function validateNumberConstraints(value: number, schema: Record<string, unknown>): boolean {
  if (typeof schema.minimum === 'number' && value < schema.minimum) return false
  if (typeof schema.maximum === 'number' && value > schema.maximum) return false
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return false
  return !(typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum)
}

function validateScalarConstraints(value: unknown, schema: Record<string, unknown>): boolean {
  if (typeof value === 'string') return validateStringConstraints(value, schema)
  return typeof value !== 'number' || validateNumberConstraints(value, schema)
}

function validateArrayBounds(value: unknown[], schema: Record<string, unknown>): boolean {
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) return false
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return false
  return value.length <= 256
}

function validateArgumentValue(
  value: unknown,
  rawSchema: Record<string, unknown>,
  depth: number,
  context: ArgumentValidationContext,
): boolean {
  if (!validationNodeAllowed(depth, context)) return false
  const schema = schemaReference(rawSchema, context.rootSchema)
  if (!schema || unsupportedSchemaKeyword(schema)) return false
  if (!matchesSchemaType(value, schema)) return false
  if (!matchesSchemaLiterals(value, schema)) return false
  if (!validateScalarConstraints(value, schema)) return false

  if (Array.isArray(value)) return validateArrayValue(value, schema, depth, context)
  if (isRecord(value)) return validateObjectValue(value, schema, depth, context)
  return true
}

function validateArrayValue(
  value: unknown[],
  schema: Record<string, unknown>,
  depth: number,
  context: ArgumentValidationContext,
): boolean {
  if (!validateArrayBounds(value, schema)) return false
  const itemSchema = schema.items
  if (itemSchema !== undefined && !isRecord(itemSchema)) return false
  const childSchema = isRecord(itemSchema) ? itemSchema : {}
  return value.every((item) => validateArgumentValue(item, childSchema, depth + 1, context))
}

function validateRequiredProperties(value: Record<string, unknown>, schema: Record<string, unknown>): boolean {
  const required = schema.required
  if (required === undefined) return true
  return (
    Array.isArray(required) &&
    required.every((item) => typeof item === 'string') &&
    required.every((key) => key in value)
  )
}

function validateObjectBounds(value: Record<string, unknown>, schema: Record<string, unknown>): boolean {
  const propertyCount = Object.keys(value).length
  if (typeof schema.minProperties === 'number' && propertyCount < schema.minProperties) return false
  if (typeof schema.maxProperties === 'number' && propertyCount > schema.maxProperties) return false
  return propertyCount <= 256
}

function validateObjectEntry(
  key: string,
  value: unknown,
  properties: Record<string, unknown> | undefined,
  additionalProperties: unknown,
  depth: number,
  context: ArgumentValidationContext,
): boolean {
  const propertySchema = properties?.[key]
  if (propertySchema !== undefined) {
    return isRecord(propertySchema) && validateArgumentValue(value, propertySchema, depth + 1, context)
  }
  if (additionalProperties === false) return false
  const childSchema = isRecord(additionalProperties) ? additionalProperties : {}
  return validateArgumentValue(value, childSchema, depth + 1, context)
}

function validateObjectValue(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  depth: number,
  context: ArgumentValidationContext,
): boolean {
  const properties = schema.properties
  if (properties !== undefined && !isRecord(properties)) return false
  if (!validateRequiredProperties(value, schema) || !validateObjectBounds(value, schema)) return false
  const additionalProperties = schema.additionalProperties
  return Object.entries(value).every(([key, item]) =>
    validateObjectEntry(
      key,
      item,
      isRecord(properties) ? properties : undefined,
      additionalProperties,
      depth,
      context,
    ),
  )
}

/** Validate iframe arguments against the catalog descriptor before delegation. */
export function validateMcpAppArguments(
  schema: Record<string, unknown> | undefined,
  argumentsValue: Record<string, unknown>,
): McpArgumentValidationResult {
  if (!schema || !isRecord(argumentsValue)) {
    return { ok: false, error: 'MCP tool arguments do not match the declared input schema.' }
  }
  try {
    const serializedSchema = JSON.stringify(schema)
    const serializedArguments = JSON.stringify(argumentsValue)
    if (
      typeof serializedSchema !== 'string' ||
      typeof serializedArguments !== 'string' ||
      utf8Bytes(serializedSchema) > MCP_APP_ARGUMENT_MAX_BYTES ||
      utf8Bytes(serializedArguments) > MCP_APP_ARGUMENT_MAX_BYTES
    ) {
      return { ok: false, error: 'MCP tool arguments exceed the safety bound.' }
    }
  } catch {
    return { ok: false, error: 'MCP tool arguments must be JSON-compatible.' }
  }
  const context: ArgumentValidationContext = { rootSchema: schema, nodes: 0 }
  return validateArgumentValue(argumentsValue, schema, 0, context)
    ? { ok: true, value: argumentsValue }
    : { ok: false, error: 'MCP tool arguments do not match the declared input schema.' }
}

/** Intersect the server-declared CSP against the host's allow-list ceiling. */
export function resolveFramePolicy(meta: McpUiMeta, allowedDomains: string[]): ResolvedFramePolicy {
  const allowed = new Set(allowedDomains)
  const intersect = (declared: string[] | undefined): string[] =>
    (declared ?? []).filter((domain) => allowed.has(domain))
  return {
    connectDomains: intersect(meta.csp?.connectDomains),
    resourceDomains: intersect(meta.csp?.resourceDomains),
    frameDomains: intersect(meta.csp?.frameDomains),
  }
}

function cspSources(domains: string[]): string {
  return domains.length > 0 ? domains.join(' ') : "'none'"
}

/**
 * Wrap the app's HTML with a `<meta http-equiv="Content-Security-Policy">`
 * reflecting the RESOLVED (host-enforced) policy, never the server's raw
 * declaration.
 *
 * `script-src`/`style-src` allow `'unsafe-inline'` unconditionally: the app
 * HTML is host-fetched content (a `resources/read`, not third-party
 * navigation), and `sandbox="allow-scripts"` with no `allow-same-origin`
 * already keeps any script here from ever reading the parent document,
 * cookies, or storage -- the CSP's job is bounding OUTBOUND network/frame
 * access, which it does via `connect-src`/`img-src`/`frame-src`.
 */
export function buildFrameSrcDoc(html: string, policy: ResolvedFramePolicy): string {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `connect-src ${cspSources(policy.connectDomains)}`,
    `img-src 'self' data: ${cspSources(policy.resourceDomains)}`,
    `frame-src ${cspSources(policy.frameDomains)}`,
  ].join('; ')
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, (match) => `${match}${metaTag}`)
  }
  return `<!DOCTYPE html><html><head>${metaTag}</head><body>${html}</body></html>`
}
