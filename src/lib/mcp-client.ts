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

/** Browser-side request budget. The BFF enforces the same ceiling server-side. */
export const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 10_000
export const MAX_MCP_REQUEST_TIMEOUT_MS = 30_000
const MIN_MCP_REQUEST_TIMEOUT_MS = 100
const MAX_USER_ERROR_CHARS = 256

/** Backend route that lists one server's governed, policy-filtered tool catalog.
 *
 * The backend paginates this route (`?offset=&limit=`, alphabetical by tool
 * name, stable across pages) and answers with an envelope carrying the TRUE
 * `total`. Omitting the params asks for the first page at the backend's own
 * default. */
export function mcpServerToolsRoute(server: string, offset?: number, limit?: number): string {
  const base = `/api/enhanced/mcp/servers/${encodeURIComponent(server)}/tools`
  const params = new URLSearchParams()
  if (typeof offset === 'number') params.set('offset', String(offset))
  if (typeof limit === 'number') params.set('limit', String(limit))
  const query = params.toString()
  return query ? `${base}?${query}` : base
}

/** Read the `{tools, total, offset, limit, has_more}` page envelope, tolerating a bare array (the pre-pagination shape
 * this route used to answer with) so a stale/cached backend still renders. */
function parseToolTotal(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value >= 0 ? value : null
}

function parseToolEnvelope(payload: Record<string, unknown>): { entries: unknown[]; total: number | null } | null {
  if (!Array.isArray(payload.tools)) return null
  return { entries: payload.tools, total: parseToolTotal(payload.total) }
}

function parseToolPayload(payload: unknown): { entries: unknown[]; total: number | null } {
  if (Array.isArray(payload)) return { entries: payload, total: payload.length }
  if (!payload || typeof payload !== 'object') return { entries: [], total: null }
  return parseToolEnvelope(payload as Record<string, unknown>) ?? { entries: [], total: null }
}

/** Default MCP server name delegated to — graph-os, the KG/fleet gateway. */
export const DEFAULT_MCP_SERVER = 'graph-os'

/** Governed catalog is bounded at 200 tools per server (algorithmic budget: T <= 200). */
export const MAX_CATALOG_TOOLS = 200

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
  /** Optional per-request deadline, bounded to the BFF's supported ceiling. */
  timeoutMs?: number
}

/** The `ui://` resource an MCP App renders, as returned by the backend. */
export interface McpAppResource {
  uri: string
  html: string
  mimeType: string
}

/**
 * One tool descriptor from the governed catalog
 * (`GET /api/enhanced/mcp/servers/{server}/tools`, `list_mcp_server_tools` in
 * `agent_webui.api_extensions`). `enabled` reflects this deployment's own
 * toggle state, not caller authorization — a disabled tool is still listed so
 * an operator can see and re-enable it, but `MCPProvider` treats it exactly
 * like any other entry (no policy is inferred client-side; the server
 * revalidates every `tools/call`).
 */
export interface McpToolDescriptor {
  name: string
  description: string
  input_schema: Record<string, unknown>
  enabled: boolean
  /** The BFF could not safely retain the declared schema; calls fail closed. */
  schema_omitted?: boolean
  /**
   * The tool's declared MCP Apps UI binding (untrusted server metadata; the
   * backend forwards it as-is when present, omits it otherwise -- BUG-071).
   * Validate with {@link import('./mcp-apps/types').parseMcpUiMeta} before
   * treating a tool as a launchable app; never assume this shape at face
   * value.
   */
  meta?: unknown
}

/** One bounded page from the governed MCP catalog, including the backend's
 * true server total. `tools.length` is only the number of usable descriptors
 * in this page; it must never be presented as the complete catalog size. */
export interface McpToolCatalog {
  tools: McpToolDescriptor[]
  total: number
}

function isValidToolDescriptor(value: unknown): value is McpToolDescriptor {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.description === 'string' &&
    typeof candidate.enabled === 'boolean' &&
    typeof candidate.input_schema === 'object' &&
    candidate.input_schema !== null
  )
}

function boundedTimeoutMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MCP_REQUEST_TIMEOUT_MS
  return Math.max(MIN_MCP_REQUEST_TIMEOUT_MS, Math.min(MAX_MCP_REQUEST_TIMEOUT_MS, Math.trunc(value)))
}

/**
 * Keep backend text out of the user-facing error channel unless it is a short,
 * deliberately safe detail. The BFF already emits generic errors for backend
 * failures, but this boundary also protects callers from a proxy, gateway, or
 * stale deployment returning HTML, traces, or credential-shaped data.
 */
const UNSAFE_MCP_ERROR_DETAIL =
  /<\/?(?:html|body|pre)\b|traceback|stack trace|authorization|bearer\s|api[_ -]?key|password|secret|token\b|(?:^|[\s/])(?:home|root|var)/i

function decodeMcpErrorDetail(raw: unknown): string {
  const candidate = typeof raw === 'string' ? raw.trim() : ''
  if (!candidate) return ''
  try {
    const parsed: unknown = JSON.parse(candidate)
    if (!parsed || typeof parsed !== 'object') return candidate
    const body = parsed as Record<string, unknown>
    const detail = body.detail ?? body.error ?? body.message
    return typeof detail === 'string' ? detail.trim() : candidate
  } catch {
    // Plain text error bodies are handled below.
    return candidate
  }
}

export function sanitizeMcpErrorDetail(raw: unknown): string {
  const candidate = decodeMcpErrorDetail(raw)
  if (!candidate || UNSAFE_MCP_ERROR_DETAIL.test(candidate)) return ''
  return candidate.replace(/\s+/g, ' ').slice(0, MAX_USER_ERROR_CHARS)
}

function requestFailureMessage(route: string, error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `MCP request to ${route} timed out`
  }
  return `MCP request to ${route} failed`
}

/** Fetch with both caller cancellation and a bounded local deadline. */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number | undefined,
): Promise<Response> {
  const controller = new AbortController()
  const callerSignal = init.signal
  const abortFromCaller = () => {
    controller.abort()
  }
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort()
    else callerSignal.addEventListener('abort', abortFromCaller, { once: true })
  }
  const timeoutReason = new DOMException('MCP request timed out', 'TimeoutError')
  const timer = setTimeout(() => {
    controller.abort(timeoutReason)
  }, boundedTimeoutMs(timeoutMs))
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.reason === timeoutReason) throw timeoutReason
    throw error
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}

/** Issue the tool-catalog GET and validate the HTTP-level response, wrapping both failure modes. */
async function fetchToolCatalogResponse(
  server: string,
  options: { signal?: AbortSignal; offset?: number; limit?: number; timeoutMs?: number },
): Promise<Response> {
  try {
    // Ask for this module's whole documented budget in ONE page. Without an
    // explicit limit the backend answers with its own smaller default, which
    // would silently narrow MCP Apps discovery to the alphabetically-first
    // page of a large server's catalog.
    const res = await fetchWithTimeout(
      mcpServerToolsRoute(server, options.offset, options.limit ?? MAX_CATALOG_TOOLS),
      {
        method: 'GET',
        credentials: 'same-origin',
        signal: options.signal,
      },
      options.timeoutMs,
    )
    if (!res.ok) throw await toolCatalogHttpError(server, res)
    return res
  } catch (err) {
    if (err instanceof McpClientError) throw err
    throw toolCatalogTransportError(server, err)
  }
}

function toolCatalogTransportError(server: string, error: unknown): McpClientError {
  const suffix = error instanceof DOMException && error.name === 'TimeoutError' ? 'timed out' : 'failed'
  return new McpClientError(`MCP tool catalog request for "${server}" ${suffix}`, { cause: error })
}

async function toolCatalogHttpError(server: string, response: Response): Promise<McpClientError> {
  const detail = sanitizeMcpErrorDetail(await response.text().catch(() => ''))
  const suffix = detail ? `: ${detail}` : ''
  return new McpClientError(
    `MCP tool catalog request for "${server}" failed: HTTP ${String(response.status)}${suffix}`,
    { status: response.status },
  )
}

/** Parse the tool-catalog response body into raw (unvalidated) tool entries. */
async function parseToolCatalogPayload(server: string, res: Response): Promise<{ entries: unknown[]; total: number }> {
  const payload = await parseToolCatalogJson(server, res)
  const { entries, total } = parseToolPayload(payload)
  if (total === null && !Array.isArray(payload)) {
    throw new McpClientError(`MCP tool catalog response for "${server}" was not a tool page`)
  }
  return { entries, total: total ?? entries.length }
}

async function parseToolCatalogJson(server: string, response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new McpClientError(`MCP tool catalog response for "${server}" was not JSON`, { cause: error })
  }
}

/** Drop invalid/duplicate-named entries and cap the result at the catalog budget. */
function dedupeValidTools(entries: unknown[]): McpToolDescriptor[] {
  const seen = new Set<string>()
  const validated: McpToolDescriptor[] = []
  for (const entry of entries) {
    if (!isValidToolDescriptor(entry)) continue
    if (seen.has(entry.name)) continue
    seen.add(entry.name)
    validated.push(entry)
    if (validated.length >= MAX_CATALOG_TOOLS) break
  }
  return validated
}

/**
 * Fetch and bound-validate one server's governed tool catalog.
 *
 * Never throws on a malformed *entry* — an individual null/wrong-typed/
 * duplicate-named item is dropped rather than failing the whole catalog, so
 * one bad tool descriptor cannot blank the list. Throws {@link McpClientError}
 * only when the backend itself refuses the request (missing delegation,
 * policy denial, transport failure) or the top-level response is not a JSON
 * array, so a caller can distinguish "no catalog" from "empty catalog".
 * Caps the result at {@link MAX_CATALOG_TOOLS}, matching the lane's bounded
 * per-page budget — this is a page guard, not pagination.
 */
export async function fetchMcpServerTools(
  server: string,
  options: { signal?: AbortSignal; offset?: number; limit?: number; timeoutMs?: number } = {},
): Promise<McpToolDescriptor[]> {
  const catalog = await fetchMcpServerToolCatalog(server, options)
  return catalog.tools
}

/**
 * Fetch one governed catalog page while retaining the backend's true total.
 * The compatibility `fetchMcpServerTools` helper above intentionally keeps
 * its historical array return type for callers that only need descriptors;
 * shared consumers such as `MCPProvider` must use this function when they
 * render catalog counts.
 */
export async function fetchMcpServerToolCatalog(
  server: string,
  options: { signal?: AbortSignal; offset?: number; limit?: number; timeoutMs?: number } = {},
): Promise<McpToolCatalog> {
  const res = await fetchToolCatalogResponse(server, options)
  const { entries, total } = await parseToolCatalogPayload(server, res)
  return { tools: dedupeValidTools(entries), total }
}

/** Unwrap the canonical `{status, result}` action-twin envelope when present. */
function unwrapEnvelope(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'result' in raw && 'status' in raw) {
    return (raw as { result: unknown }).result
  }
  return raw
}

async function postJson(
  route: string,
  body: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<unknown> {
  let res: Response
  try {
    res = await fetchWithTimeout(
      route,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // Same-origin only: never let this request be replayed cross-origin, and
        // never attach credentials to a cross-origin target.
        credentials: 'same-origin',
        signal: options.signal,
      },
      options.timeoutMs,
    )
  } catch (err) {
    throw new McpClientError(requestFailureMessage(route, err), { cause: err })
  }
  if (!res.ok) {
    const detail = sanitizeMcpErrorDetail(await res.text().catch(() => ''))
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
  const payload = await postJson(MCP_TOOL_CALL_ROUTE, toolCallBody(name, args, options), options)
  const error = toolCallError(payload, name)
  if (error) throw error
  return payload
}

function toolCallBody(
  name: string,
  args: Record<string, unknown>,
  options: McpRequestOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    server: options.server ?? DEFAULT_MCP_SERVER,
    tool: name,
    arguments: args,
  }
  if (options.timeoutMs !== undefined) body.timeout_ms = boundedTimeoutMs(options.timeoutMs)
  return body
}

function toolCallError(payload: unknown, name: string): McpClientError | null {
  if (!payload || typeof payload !== 'object' || (payload as { isError?: unknown }).isError !== true) return null
  const text = (payload as { error?: unknown }).error
  return new McpClientError(sanitizeMcpErrorDetail(text) || `Tool "${name}" reported an error`)
}

/**
 * Read a `ui://` MCP App resource (its HTML) through the same governed seam.
 *
 * The returned HTML is UNTRUSTED tool output. It must only ever be rendered
 * through `McpAppFrame`, which sandboxes it and applies the host-resolved CSP.
 */
export async function readMcpAppResource(uri: string, options: McpRequestOptions = {}): Promise<McpAppResource> {
  const payload = await postJson(MCP_APP_RESOURCE_ROUTE, resourceReadBody(uri, options), options)
  return parseMcpAppResource(uri, payload)
}

function resourceReadBody(uri: string, options: McpRequestOptions): Record<string, unknown> {
  const body: Record<string, unknown> = { server: options.server ?? DEFAULT_MCP_SERVER, uri }
  if (options.timeoutMs !== undefined) body.timeout_ms = boundedTimeoutMs(options.timeoutMs)
  return body
}

function parseMcpAppResource(uri: string, payload: unknown): McpAppResource {
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
