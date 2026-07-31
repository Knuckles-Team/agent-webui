/**
 * The browser-side MCP client for agent-webui.
 *
 * CONCEPT:AU-ECO.ui.mcp-apps-client
 *
 * This is what `McpAppFrame`'s `callTool` and its app-HTML fetch are wired to.
 * It deliberately does NOT open an MCP connection from the browser. Two hard
 * constraints make a direct browser→graph-os MCP connection impossible to do
 * safely, not merely inconvenient:
 *
 *  1. **`MCP_ALLOWED_HOSTS`.** graph-os's listener rejects any request whose
 *     `Host` authority is not in its exact allow-list (`400 host rejected`;
 *     `agent_utilities/mcp/server_factory.py` → `MCP_ALLOWED_HOSTS is
 *     required`). A browser cannot set `Host`, so the only requests that can
 *     ever be accepted are ones a server-side client makes.
 *  2. **The bearer is a service credential.** graph-os authenticates children
 *     with an OIDC client-credentials bearer minted by
 *     `agent_utilities/mcp/client_credentials.py`. Shipping that to JS would
 *     hand every page (and every MCP App iframe) a fleet-wide credential.
 *
 * So the transport here is the one every agent-utilities frontend already
 * uses: **same-origin HTTP to this app's own backend** (`geniusbot` →
 * `agent_utilities.gateway_client.GatewayClient`; `agent-terminal-ui` →
 * `AgentClient` over `{base_url}/…`; agent-webui → `lib/gateway.ts` over
 * `/api/*`). The backend holds the governed MCP delegation seam
 * (`api_extensions._call_mcp_tool` → the host-injected `call_mcp_tool`
 * helper), which is where the allow-list, actor policy, credential
 * references, and audit envelope live. Requests are authenticated by the same
 * session identity `ActorIdentityMiddleware` already enforces on every
 * `/api/*` route — no second auth path is introduced here.
 *
 * Security note for MCP Apps: an app's iframe is sandboxed WITHOUT
 * `allow-same-origin` (`McpAppFrame.MCP_APP_SANDBOX`), so the app itself can
 * never issue these requests — it has no same-origin privilege and therefore
 * no access to the session's ambient credentials. Only the host calls this
 * module, and only after `bridge.ts`'s `policy` gate has admitted the tool
 * name. That asymmetry is the whole point: the credential stays with the
 * host, and the app gets exactly the tools the host named.
 */

/** Backend route that proxies one MCP `tools/call` through the governed seam. */
export const MCP_TOOL_CALL_ROUTE = '/api/enhanced/mcp/tools/call'

/** Backend route that proxies one MCP `resources/read` for a `ui://` app. */
export const MCP_APP_RESOURCE_ROUTE = '/api/enhanced/mcp/apps/resource'

/** Default MCP server name delegated to — graph-os, the KG/fleet gateway. */
export const DEFAULT_MCP_SERVER = 'graph-os'

/** Raised when a tool call or resource read does not reach a usable result. */
export class McpClientError extends Error {
  /** HTTP status when the failure came from the backend, else `undefined`. */
  readonly status?: number

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.name = 'McpClientError'
    this.status = options.status
  }
}

export interface McpRequestOptions {
  /** MCP server to delegate to. Defaults to {@link DEFAULT_MCP_SERVER}. */
  server?: string
  signal?: AbortSignal
}

/** The `ui://` resource an MCP App renders, as returned by the backend. */
export interface McpAppResource {
  uri: string
  html: string
  mimeType: string
}

/** Unwrap the canonical `{status, result}` action-twin envelope when present. */
function unwrapEnvelope(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'result' in raw && 'status' in raw) {
    return (raw as { result: unknown }).result
  }
  return raw
}

async function postJson(route: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Same-origin only: never let this request be replayed cross-origin, and
      // never attach credentials to a cross-origin target.
      credentials: 'same-origin',
      signal,
    })
  } catch (err) {
    throw new McpClientError(`MCP request to ${route} failed`, { cause: err })
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new McpClientError(
      `MCP request to ${route} failed: HTTP ${String(res.status)}${detail ? `: ${detail}` : ''}`,
      { status: res.status },
    )
  }
  try {
    return unwrapEnvelope(await res.json())
  } catch (err) {
    throw new McpClientError(`MCP response from ${route} was not JSON`, { cause: err })
  }
}

/**
 * Call one MCP tool through the backend's governed delegation seam.
 *
 * Returns the tool's decoded result. Throws {@link McpClientError} when the
 * backend refuses the call, the delegation is not configured, or the tool
 * itself reports an error — never returns a silent `null`, so a host can show
 * the app an honest `mcpapp/tool-error`.
 */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  options: McpRequestOptions = {},
): Promise<unknown> {
  const payload = await postJson(
    MCP_TOOL_CALL_ROUTE,
    { server: options.server ?? DEFAULT_MCP_SERVER, tool: name, arguments: args },
    options.signal,
  )
  if (payload && typeof payload === 'object' && (payload as { isError?: unknown }).isError === true) {
    const text = (payload as { error?: unknown }).error
    throw new McpClientError(typeof text === 'string' ? text : `Tool "${name}" reported an error`)
  }
  return payload
}

/**
 * Read a `ui://` MCP App resource (its HTML) through the same governed seam.
 *
 * The returned HTML is UNTRUSTED tool output. It must only ever be rendered
 * through `McpAppFrame`, which sandboxes it and applies the host-resolved CSP.
 */
export async function readMcpAppResource(
  uri: string,
  options: McpRequestOptions = {},
): Promise<McpAppResource> {
  const payload = await postJson(
    MCP_APP_RESOURCE_ROUTE,
    { server: options.server ?? DEFAULT_MCP_SERVER, uri },
    options.signal,
  )
  if (!payload || typeof payload !== 'object') {
    throw new McpClientError(`MCP app resource "${uri}" returned no content`)
  }
  const html = (payload as { html?: unknown }).html
  if (typeof html !== 'string') {
    throw new McpClientError(`MCP app resource "${uri}" returned no HTML`)
  }
  const mimeType = (payload as { mimeType?: unknown }).mimeType
  return {
    uri,
    html,
    mimeType: typeof mimeType === 'string' ? mimeType : 'text/html',
  }
}

/**
 * Bind a tool caller for one MCP App instance — the value handed to
 * `McpAppFrame`'s `callTool`.
 *
 * This is only the *executor*; it applies no policy of its own. The host's
 * allow-list is `McpAppFrame`'s `allowedTools`, checked by `bridge.ts` before
 * this is ever reached (and re-checked server-side by the governed seam).
 */
export function createMcpToolCaller(
  options: McpRequestOptions = {},
): (name: string, args: Record<string, unknown>) => Promise<unknown> {
  return (name, args) => callMcpTool(name, args, options)
}
