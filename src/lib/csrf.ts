/**
 * @file csrf.ts
 * @description The one CSRF chokepoint for cookie-authenticated requests.
 *
 * The Graph OS identity broker refuses every state-changing request that a
 * browser session authenticates unless it carries the session's CSRF token
 * (`X-CSRF-Token`, a one-way digest of the session id the server hands out on
 * `/auth/session`) and a same-origin `Origin`. Browsers add the `Origin`;
 * this module adds the token — once, at the `fetch` chokepoint, so no view
 * can forget it. Only same-origin, non-safe requests carry it: the token is
 * never sent to another origin.
 */

export const CSRF_HEADER = 'X-CSRF-Token'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

let currentToken: string | null = null
/** Marks the wrapper, so installing twice never wraps twice (and a `fetch`
 *  replaced after installation is wrapped again on the next install). */
const WRAPPED = Symbol.for('agent-webui.csrf-fetch')

type MarkedFetch = typeof fetch & { [WRAPPED]?: true }

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, window.location.origin)
  if (input instanceof URL) return input
  return new URL(input.url, window.location.origin)
}

/** Whether a request should carry the session's CSRF token. */
export function needsCsrfToken(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (SAFE_METHODS.has(requestMethod(input, init))) return false
  return requestUrl(input).origin === window.location.origin
}

/** `init` with the CSRF header added (never overriding an explicit one).
 *  A `Request` input's own headers are kept when `init` names none. */
export function withCsrfToken(input: RequestInfo | URL, init: RequestInit | undefined, token: string): RequestInit {
  const own = typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined
  const headers = new Headers(init?.headers ?? own)
  if (!headers.has(CSRF_HEADER)) headers.set(CSRF_HEADER, token)
  return { ...init, headers }
}

/** The token currently attached (for tests and diagnostics). */
export function currentCsrfToken(): string | null {
  return currentToken
}

/**
 * Remember the session's CSRF token and wrap `window.fetch` once so every
 * same-origin state-changing request carries it. `null` (no session) stops
 * attaching a token without unwrapping.
 */
export function installCsrfToken(token: string | null): void {
  currentToken = token
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return
  if ((window.fetch as MarkedFetch)[WRAPPED]) return
  const original = window.fetch.bind(window)
  const wrapped: MarkedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const token = currentToken
    if (token && needsCsrfToken(input, init)) return original(input, withCsrfToken(input, init, token))
    return original(input, init)
  }
  wrapped[WRAPPED] = true
  window.fetch = wrapped
}
