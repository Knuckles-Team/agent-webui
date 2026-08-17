/**
 * Wire types for the MCP Apps extension (`io.modelcontextprotocol/ui`) and
 * the host<->iframe postMessage bridge this package implements.
 *
 * CONCEPT:AU-ECO.ui.mcp-apps-host
 *
 * `McpUiMeta` mirrors `fastmcp.apps.config.AppConfig`'s wire shape (the
 * agent-utilities server dependency that produces it) and the message
 * shapes below mirror the small bridge protocol documented at the top of
 * `agent_utilities/mcp/tools/mcp_apps.py`'s HTML payload -- keep the two in
 * sync if either changes.
 */

/** A tool result's declared `_meta.ui` object (untrusted server metadata --
 * see `bridge.ts`'s module docstring for why nothing here is trusted at
 * face value). */
export interface McpUiMeta {
  resourceUri: string
  visibility?: ('app' | 'model')[]
  csp?: McpResourceCsp
  permissions?: McpResourcePermissions
  domain?: string
  prefersBorder?: boolean
}

export interface McpResourceCsp {
  connectDomains?: string[]
  resourceDomains?: string[]
  frameDomains?: string[]
  baseUriDomains?: string[]
}

export interface McpResourcePermissions {
  camera?: Record<string, never>
  microphone?: Record<string, never>
  geolocation?: Record<string, never>
  clipboardWrite?: Record<string, never>
}

export interface McpAppReadyMessage {
  type: 'mcpapp/ready'
}

export interface McpAppInitMessage {
  type: 'mcpapp/init'
  props: Record<string, unknown>
}

export interface McpAppToolCallMessage {
  type: 'mcpapp/tool-call'
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface McpAppToolResultMessage {
  type: 'mcpapp/tool-result'
  id: string
  result: unknown
}

export interface McpAppToolErrorMessage {
  type: 'mcpapp/tool-error'
  id: string
  error: { message: string }
}

/** Messages the iframe (the app) sends to the host. */
export type McpAppOutboundMessage = McpAppReadyMessage | McpAppToolCallMessage

/** Messages the host sends to the iframe. */
export type McpAppInboundMessage = McpAppInitMessage | McpAppToolResultMessage | McpAppToolErrorMessage

/** A host-side tool-call executor: the ONLY way an app's iframe can ever
 * reach a real MCP tool. Never resolved from anything the app declares --
 * the caller of `attachMcpAppBridge` supplies its own real MCP client call. */
export type McpAppToolCaller = (name: string, args: Record<string, unknown>) => Promise<unknown>

/** Host policy gate: decides whether a given tool name may be called for
 * this app instance. Independent of, and never derived from, any
 * server-declared annotation (`McpUiMeta.visibility` or anything else) --
 * see `bridge.ts`'s module docstring. */
export type McpAppToolPolicy = (name: string) => boolean

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((item): item is string => typeof item === 'string')
  return strings.length > 0 ? strings : undefined
}

function parseVisibility(value: unknown): ('app' | 'model')[] | undefined {
  const strings = asStringArray(value)
  if (!strings) return undefined
  const visibility = strings.filter((item): item is 'app' | 'model' => item === 'app' || item === 'model')
  return visibility.length > 0 ? visibility : undefined
}

function parseCsp(value: unknown): McpResourceCsp | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  return {
    connectDomains: asStringArray(raw.connectDomains),
    resourceDomains: asStringArray(raw.resourceDomains),
    frameDomains: asStringArray(raw.frameDomains),
    baseUriDomains: asStringArray(raw.baseUriDomains),
  }
}

function parsePermissions(value: unknown): McpResourcePermissions | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const permissions: McpResourcePermissions = {}
  for (const key of ['camera', 'microphone', 'geolocation', 'clipboardWrite'] as const) {
    if (raw[key] && typeof raw[key] === 'object') permissions[key] = {}
  }
  return permissions
}

/**
 * Validate a tool descriptor's declared `meta` (the wire shape produced by
 * `AppConfig`, `{ui: {...}}` on `Tool.meta` -- BUG-071) into a `McpUiMeta`,
 * or `undefined` when the tool carries no usable app binding.
 *
 * `resourceUri` is the ONLY required field: a tool with a missing, blank, or
 * non-string `resourceUri` is not an MCP App no matter what else `meta.ui`
 * declares -- this is what makes a tool "launchable" for an app-launcher
 * (`McpAppsView`) rather than rendered with a fabricated/empty frame. Every
 * other field is untrusted server metadata, so each is individually
 * type-checked and dropped (never defaulted to something fabricated) when
 * malformed -- a hostile or buggy server cannot smuggle extra shape through.
 */
export function parseMcpUiMeta(meta: unknown): McpUiMeta | undefined {
  if (!meta || typeof meta !== 'object') return undefined
  const ui = (meta as Record<string, unknown>).ui
  if (!ui || typeof ui !== 'object') return undefined
  const raw = ui as Record<string, unknown>
  const resourceUri = raw.resourceUri
  if (typeof resourceUri !== 'string' || resourceUri.length === 0) return undefined
  return {
    resourceUri,
    visibility: parseVisibility(raw.visibility),
    csp: parseCsp(raw.csp),
    permissions: parsePermissions(raw.permissions),
    domain: typeof raw.domain === 'string' ? raw.domain : undefined,
    prefersBorder: typeof raw.prefersBorder === 'boolean' ? raw.prefersBorder : undefined,
  }
}
