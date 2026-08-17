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
 *
 * Resource bounds (GOC-26 lane doc, "Algorithmic and resource budget"): a
 * sandboxed app is untrusted code the host chose to render, not code the
 * host wrote -- nothing here assumes it behaves. Three independent ceilings
 * apply, each refusing rather than queuing/blocking once hit, so a hostile
 * or malfunctioning app degrades to visible refusals instead of pinning the
 * bridge or the browser tab:
 *  - {@link MAX_INFLIGHT_CALLS} outstanding `tools/call` requests at once.
 *  - {@link CALL_TIMEOUT_MS} per call, after which it is reported as a
 *    timeout and its in-flight slot is freed, regardless of whether the
 *    underlying `callTool` promise ever settles.
 *  - {@link MAX_MESSAGES_PER_SECOND} inbound postMessage events in any
 *    rolling one-second window.
 */

import type { McpAppInboundMessage, McpAppOutboundMessage, McpAppToolCaller, McpAppToolPolicy } from './types'

/** Bound: the maximum number of `mcpapp/tool-call` requests this bridge will
 * have outstanding to the real MCP client at once (lane budget: <=8). A call
 * beyond the cap is refused exactly like a policy denial -- volume can never
 * substitute for an allowed tool name, and it can never exhaust the host's
 * outbound call budget on the real backend. */
export const MAX_INFLIGHT_CALLS = 8

/** Bound: a tool call not resolved within this window is reported to the
 * app as a timeout and its in-flight slot is freed (lane budget: 30 s). This
 * is a HOST-side ceiling on top of whatever deadline the real MCP client or
 * backend already enforces -- it exists so a stalled `callTool` promise can
 * never pin an in-flight slot (and therefore, once enough stall, the whole
 * bridge) forever. */
export const CALL_TIMEOUT_MS = 30_000

/** Bound: the maximum number of postMessage events from the bridged frame
 * processed in any rolling one-second window (lane budget: <=100/s). Beyond
 * it, a `mcpapp/tool-call` gets a typed refusal (so the app is never left
 * waiting on a response that will never come) and any other message type is
 * simply dropped, both reported via `onRefused`. */
export const MAX_MESSAGES_PER_SECOND = 100

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

  // In-flight `tools/call` ids currently awaiting a real result -- bounded by
  // MAX_INFLIGHT_CALLS. A call's own timer is stored so it can be cleared
  // once the real result/error lands first (whichever settles first wins;
  // the loser is a no-op, never a double post).
  const inFlight = new Map<string, ReturnType<typeof setTimeout>>()

  // Rolling one-second window of accepted message timestamps, for
  // MAX_MESSAGES_PER_SECOND. Pruned on every check -- bounded by the same
  // cap, so this never grows past it.
  let recentMessageTimes: number[] = []

  const withinRateLimit = (): boolean => {
    const now = Date.now()
    recentMessageTimes = recentMessageTimes.filter((t) => now - t < 1000)
    if (recentMessageTimes.length >= MAX_MESSAGES_PER_SECOND) return false
    recentMessageTimes.push(now)
    return true
  }

  const settleCall = (id: string, message: McpAppInboundMessage): void => {
    const timer = inFlight.get(id)
    if (timer === undefined) return // already settled (e.g. timed out first)
    clearTimeout(timer)
    inFlight.delete(id)
    post(message)
  }

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== frameWindow) return

    if (!withinRateLimit()) {
      const message = parseOutboundMessage(event.data)
      if (message?.type === 'mcpapp/tool-call') {
        post({
          type: 'mcpapp/tool-error',
          id: message.id,
          error: { message: 'This app is sending requests too quickly and was throttled.' },
        })
      }
      onRefused?.('rate limited: too many messages per second')
      return
    }

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
    if (inFlight.size >= MAX_INFLIGHT_CALLS) {
      post({
        type: 'mcpapp/tool-error',
        id: message.id,
        error: { message: `Too many tool calls in flight (max ${String(MAX_INFLIGHT_CALLS)}); try again shortly.` },
      })
      onRefused?.(`too many in-flight calls: ${message.name}`)
      return
    }

    const { id, name, arguments: args } = message
    const timer = setTimeout(() => {
      settleCall(id, {
        type: 'mcpapp/tool-error',
        id,
        error: { message: `Tool "${name}" timed out after ${String(CALL_TIMEOUT_MS)}ms.` },
      })
    }, CALL_TIMEOUT_MS)
    inFlight.set(id, timer)

    callTool(name, args)
      .then((result) => {
        settleCall(id, { type: 'mcpapp/tool-result', id, result })
      })
      .catch((error: unknown) => {
        settleCall(id, {
          type: 'mcpapp/tool-error',
          id,
          error: { message: error instanceof Error ? error.message : String(error) },
        })
      })
  }

  window.addEventListener('message', handleMessage)
  return () => {
    for (const timer of inFlight.values()) clearTimeout(timer)
    inFlight.clear()
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
