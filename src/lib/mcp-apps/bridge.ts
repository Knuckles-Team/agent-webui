/**
 * Host-mediated postMessage JSON-RPC-ish bridge for MCP Apps
 * (`io.modelcontextprotocol/ui`).
 *
 * CONCEPT:AU-ECO.ui.mcp-apps-host
 *
 * An MCP App's HTML runs inside a sandboxed iframe with NO direct MCP
 * connection of its own (see `McpAppFrame.tsx`: `sandbox="allow-scripts"`,
 * no `allow-same-origin`). The only way it can ever call a tool is by
 * `postMessage`-ing this bridge a `mcpapp/tool-call` request; the bridge is
 * the host, and the host decides, every time, whether that call is allowed
 * -- via `policy`, a caller-supplied allow-list check -- and only then
 * actually executes it, via `callTool`, the real MCP client call.
 *
 * This is the enforcement point for "no server-supplied annotation is
 * trusted without policy verification": an app's own declared
 * `visibility`/`csp`/`permissions` (`types.ts`'s `McpUiMeta`) is metadata
 * the SERVER asserted about itself. Nothing here ever reads `McpUiMeta` to
 * decide what to allow -- `policy` is the host's own, independently
 * configured allow-list, supplied by the caller (e.g. exactly the tools the
 * model was already permitted to call in this session; never derived from
 * the app's own declared visibility).
 *
 * A sandboxed iframe without `allow-same-origin` always reports
 * `event.origin === "null"`, so an origin check is not a meaningful trust
 * boundary here -- `event.source` (exact window identity) is what this
 * module checks instead.
 */

import type { McpAppInboundMessage, McpAppOutboundMessage, McpAppToolCaller, McpAppToolPolicy } from './types'

export interface McpAppBridgeOptions {
  /** The sandboxed iframe's `contentWindow`. Messages are only ever
   * accepted from this exact window identity. */
  frameWindow: Window
  /** Initial props sent to the app once it signals `mcpapp/ready`. */
  initProps: Record<string, unknown>
  /** The host's own tool-call allow-list for this app instance. */
  policy: McpAppToolPolicy
  /** The real MCP tool-call executor. */
  callTool: McpAppToolCaller
  /** Called when a message is refused (denied by policy, malformed, or from
   * an unrecognized source) -- for host-side logging/UI surfacing. */
  onRefused?: (reason: string) => void
}

/** Attach the bridge to `window`; call the returned function to detach it. */
export function attachMcpAppBridge(options: McpAppBridgeOptions): () => void {
  const { frameWindow, initProps, policy, callTool, onRefused } = options

  const post = (message: McpAppInboundMessage): void => {
    frameWindow.postMessage(message, '*')
  }

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== frameWindow) return
    const message = parseOutboundMessage(event.data)
    if (!message) {
      onRefused?.('malformed message')
      return
    }
    if (message.type === 'mcpapp/ready') {
      post({ type: 'mcpapp/init', props: initProps })
      return
    }
    if (!policy(message.name)) {
      post({
        type: 'mcpapp/tool-error',
        id: message.id,
        error: { message: `Tool "${message.name}" is not permitted for this app.` },
      })
      onRefused?.(`denied by policy: ${message.name}`)
      return
    }
    callTool(message.name, message.arguments)
      .then((result) => {
        post({ type: 'mcpapp/tool-result', id: message.id, result })
      })
      .catch((error: unknown) => {
        post({
          type: 'mcpapp/tool-error',
          id: message.id,
          error: { message: error instanceof Error ? error.message : String(error) },
        })
      })
  }

  window.addEventListener('message', handleMessage)
  return () => {
    window.removeEventListener('message', handleMessage)
  }
}

function parseOutboundMessage(data: unknown): McpAppOutboundMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  if (type === 'mcpapp/ready') {
    return { type: 'mcpapp/ready' }
  }
  if (type === 'mcpapp/tool-call') {
    const id = (data as { id?: unknown }).id
    const name = (data as { name?: unknown }).name
    const args = (data as { arguments?: unknown }).arguments
    if (typeof id !== 'string' || typeof name !== 'string' || typeof args !== 'object' || args === null) {
      return null
    }
    return { type: 'mcpapp/tool-call', id, name, arguments: args as Record<string, unknown> }
  }
  return null
}
