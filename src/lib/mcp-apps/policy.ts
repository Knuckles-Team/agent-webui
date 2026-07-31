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
