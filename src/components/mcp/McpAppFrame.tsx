/**
 * Sandboxed MCP App iframe host.
 *
 * CONCEPT:AU-ECO.ui.mcp-apps-host
 *
 * Renders a `ui://` resource's HTML (already fetched by the caller via
 * `resources/read` -- this component never fetches on its own) in a
 * sandboxed iframe (`sandbox="allow-scripts"` only -- no
 * `allow-same-origin`, no `allow-popups`, no `allow-forms`; stricter than
 * `ai-elements/web-preview.tsx`'s `WEB_PREVIEW_SANDBOX`, which is for a
 * top-level content *preview*, not an untrusted app given a live tool-call
 * channel) and wires the postMessage bridge (`lib/mcp-apps/bridge.ts`) so
 * the app can request tool calls -- which the host, never the app,
 * authorizes and executes.
 *
 * The server's declared CSP (`meta.csp`, `McpUiMeta`) is never applied
 * directly: `resolveFramePolicy` intersects it against `allowedDomains`,
 * the host's own, independently configured ceiling. Likewise `allowedTools`
 * is the host's own tool-call allow-list, never derived from `meta`. See
 * `lib/mcp-apps/bridge.ts` and `lib/mcp-apps/policy.ts` for the "no
 * server-supplied annotation is trusted without policy verification" gate
 * this component enforces on both axes (network access, tool access).
 */

import { useEffect, useRef, useState } from 'react'
import { attachMcpAppBridge } from '@/lib/mcp-apps/bridge'
import { buildFrameSrcDoc, resolveFramePolicy } from '@/lib/mcp-apps/policy'
import type { McpAppToolCaller, McpAppToolPolicy, McpUiMeta } from '@/lib/mcp-apps/types'

/** The minimum sandbox an untrusted app with a live tool-call channel gets:
 * scripts only. No same-origin (so the app can never read the parent
 * document/cookies/storage even if it tried), no popups, no forms
 * navigation, no top-level navigation. */
export const MCP_APP_SANDBOX = 'allow-scripts'

export interface McpAppFrameProps {
  /** The tool result's declared `_meta.ui` (untrusted -- see module docstring). */
  meta: McpUiMeta
  /** The raw HTML fetched for `meta.resourceUri`. */
  html: string
  /** Initial props handed to the app once it signals ready. */
  initProps?: Record<string, unknown>
  /** The host's actual tool-call allow-list for this app instance. */
  allowedTools: McpAppToolPolicy
  /** The host's ceiling for what CSP domains it will EVER grant an app,
   * regardless of what `meta.csp` declares. */
  allowedDomains?: string[]
  callTool: McpAppToolCaller
  onRefused?: (reason: string) => void
  title?: string
  className?: string
}

export function McpAppFrame({
  meta,
  html,
  initProps = {},
  allowedTools,
  allowedDomains = [],
  callTool,
  onRefused,
  title = 'MCP App',
  className,
}: McpAppFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [attached, setAttached] = useState(false)

  useEffect(() => {
    const frameWindow = iframeRef.current?.contentWindow
    if (!frameWindow) return
    const detach = attachMcpAppBridge({
      frameWindow,
      initProps,
      policy: allowedTools,
      callTool,
      onRefused,
    })
    setAttached(true)
    return () => {
      detach()
      setAttached(false)
    }
    // `initProps` is intentionally read once at attach time -- an app can't
    // be handed changed initial props after it has already booted.
  }, [allowedTools, callTool, onRefused])

  const policy = resolveFramePolicy(meta, allowedDomains)
  const srcDoc = buildFrameSrcDoc(html, policy)

  return (
    <iframe
      ref={iframeRef}
      title={title}
      className={className}
      sandbox={MCP_APP_SANDBOX}
      srcDoc={srcDoc}
      referrerPolicy="no-referrer"
      data-mcp-app-attached={attached}
    />
  )
}
