/**
 * The wired MCP Apps host: fetches a `ui://` app's HTML and renders it in
 * `McpAppFrame` with a live tool-call channel.
 *
 * CONCEPT:AU-ECO.ui.mcp-apps-client
 *
 * `McpAppFrame` is deliberately pure — it never fetches, and it never decides
 * what an app may call. This component supplies both of those from the real
 * MCP client (`lib/mcp-client.ts`): the `resources/read` for `meta.resourceUri`
 * and the `tools/call` executor. The host's allow-list (`allowedTools`) is a
 * required prop with no default, so an app can never be mounted with an
 * implicit "anything goes" policy — a caller must name the tools it is willing
 * to let that app invoke.
 */

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { McpAppFrame } from './McpAppFrame'
import {
  createMcpToolCaller,
  DEFAULT_MCP_REQUEST_TIMEOUT_MS,
  McpClientError,
  readMcpAppResource,
  sanitizeMcpErrorDetail,
} from '@/lib/mcp-client'
import { validateMcpAppArguments } from '@/lib/mcp-apps/policy'
import type { McpUiMeta } from '@/lib/mcp-apps/types'

export interface McpAppHostProps {
  /** The tool result's declared `_meta.ui` (untrusted server metadata). */
  meta: McpUiMeta
  /** Initial props handed to the app once it signals ready. */
  initProps?: Record<string, unknown>
  /**
   * The exact tool names this app instance may call. Required — there is no
   * default, so no app is ever mounted with an unbounded policy.
   */
  allowedTools: string[]
  /** Catalog input schemas for the explicitly allowed tools. A missing schema
   * fails closed before an iframe request reaches the BFF. */
  allowedToolSchemas?: ReadonlyMap<string, Record<string, unknown>>
  /** The host's ceiling for CSP domains, regardless of what `meta.csp` asks. */
  allowedDomains?: string[]
  /** MCP server to delegate to; defaults to arbora. */
  server?: string
  title?: string
  className?: string
}

interface RefusalRef {
  current: string[]
}

function createRefusalHandler(
  refusalsRef: RefusalRef,
  setRefusals: Dispatch<SetStateAction<string[]>>,
): (reason: string) => void {
  return (reason: string) => {
    const next = [...refusalsRef.current, reason]
    refusalsRef.current = next
    setRefusals(next)
  }
}

function createValidatedToolCaller(
  allowedToolSchemas: ReadonlyMap<string, Record<string, unknown>> | undefined,
  server: string | undefined,
) {
  const delegate = createMcpToolCaller({ server, timeoutMs: DEFAULT_MCP_REQUEST_TIMEOUT_MS })
  return (name: string, args: Record<string, unknown>) => {
    const validation = validateMcpAppArguments(allowedToolSchemas?.get(name), args)
    if (!validation.ok) return Promise.reject(new McpClientError(validation.error))
    return delegate(name, validation.value)
  }
}

function handleResourceLoadError(
  error: unknown,
  cancelled: boolean,
  setError: Dispatch<SetStateAction<string | null>>,
): void {
  if (cancelled) return
  const detail = sanitizeMcpErrorDetail(error instanceof Error ? error.message : String(error))
  setError(detail || 'MCP app resource request failed')
}

export function McpAppHost({
  meta,
  initProps = {},
  allowedTools,
  allowedToolSchemas,
  allowedDomains = [],
  server,
  title = 'MCP App',
  className,
}: McpAppHostProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refusals, setRefusals] = useState<string[]>([])

  const callTool = useMemo(() => {
    return createValidatedToolCaller(allowedToolSchemas, server)
  }, [allowedToolSchemas, server])
  // A stable identity for the allow-list so the bridge is not torn down and
  // re-attached on every render (the frame's effect depends on it).
  // Serialize the value rather than using a raw control-character delimiter:
  // tool names are untrusted catalog data and may contain any non-empty
  // string. This also keeps the policy identity stable when a caller creates
  // an equivalent array during an unrelated render.
  const allowedKey = JSON.stringify(allowedTools)
  const policy = useMemo(() => {
    const permitted = new Set(JSON.parse(allowedKey) as string[])
    return (name: string) => permitted.has(name)
    // `allowedKey` is the value identity of `allowedTools`.
  }, [allowedKey])

  const refusalsRef = useRef<string[]>([])
  const onRefused = useMemo(() => createRefusalHandler(refusalsRef, setRefusals), [])

  const resourceUri = meta.resourceUri
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setHtml(null)
    setError(null)
    readMcpAppResource(resourceUri, {
      server,
      signal: controller.signal,
      timeoutMs: DEFAULT_MCP_REQUEST_TIMEOUT_MS,
    })
      .then((resource) => {
        if (!cancelled) setHtml(resource.html)
      })
      .catch((err: unknown) => {
        handleResourceLoadError(err, cancelled, setError)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [resourceUri, server])

  if (error !== null) {
    return (
      <div className={className} data-mcp-app-state="error" role="alert" aria-live="assertive">
        {`Could not load MCP app ${resourceUri}: ${error}`}
      </div>
    )
  }

  if (html === null) {
    return (
      <div className={className} data-mcp-app-state="loading" role="status" aria-live="polite" aria-busy="true">
        {`Loading ${title}…`}
      </div>
    )
  }

  return (
    <div className={className} data-mcp-app-state="ready">
      <McpAppFrame
        meta={meta}
        html={html}
        initProps={initProps}
        allowedTools={policy}
        allowedDomains={allowedDomains}
        callTool={callTool}
        onRefused={onRefused}
        title={title}
      />
      {refusals.length > 0 && (
        <ul data-mcp-app-refusals="" aria-label="Refused app requests" role="status" aria-live="polite">
          {refusals.map((reason, index) => (
            <li key={`${reason}-${String(index)}`}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
