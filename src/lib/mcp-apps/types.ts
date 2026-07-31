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
