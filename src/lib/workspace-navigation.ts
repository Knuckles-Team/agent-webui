/** Shared same-origin navigation for the workspace and WebMCP. No new router. */
import { useLayoutEffect, useSyncExternalStore } from 'react'
import { matchRoute, roleAtLeast, ROUTE_REGISTRY, type Role } from '@/lib/nav-registry'

export interface WebUiNavigationResult {
  navigated: true
  path: string
  routeId: string
  view: string
}

function currentWindow(windowLike?: Window): Window | null {
  if (windowLike) return windowLike
  return typeof window === 'undefined' ? null : window
}

function resolveNavigationTarget(path: string, targetWindow: Window): URL {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('WebMCP navigation requires an application-relative path')
  }

  let target: URL
  try {
    target = new URL(path, targetWindow.location.origin)
  } catch {
    throw new Error('WebMCP navigation requires a valid in-app path')
  }
  if (target.origin !== targetWindow.location.origin || !target.pathname.startsWith('/')) {
    throw new Error('WebMCP navigation is restricted to this application origin')
  }
  // Navigation tools do not need arbitrary route state. Reject it instead of
  // persisting a credential/PII-bearing query or fragment in browser history
  // and then echoing it to the invoking agent.
  if (target.search || target.hash) {
    throw new Error('WebMCP navigation does not accept query strings or fragments')
  }
  return target
}

function resolveAuthorizedRoute(pathname: string, role: Role): NonNullable<ReturnType<typeof matchRoute>> {
  let matched: ReturnType<typeof matchRoute>
  try {
    matched = matchRoute(pathname)
  } catch {
    throw new Error('WebMCP navigation path is not a registered route')
  }
  if (!matched) throw new Error('WebMCP navigation path is not a registered route')
  if (!roleAtLeast(role, matched.route.minRole)) {
    throw new Error('WebMCP navigation is not permitted for the current role')
  }
  return matched
}

/** Resolve only registry-declared compatibility entries. Preserve browser query and fragment context.
 * Source admission is checked first, so an admin alias cannot lower its role via Work.
 * Target entries cannot redirect again: no loops or parallel navigation authority.
 */
export function resolveWorkspaceRedirect(path: string, role: Role): string | null {
  const url = new URL(path, 'https://workspace.invalid')
  const source = matchRoute(url.pathname)?.route
  if (!source?.redirects || !roleAtLeast(role, source.minRole)) return null
  for (const destination of source.redirects) {
    const target = ROUTE_REGISTRY.find((route) => route.id === destination.routeId)
    if (!target || target.redirects || !roleAtLeast(role, target.minRole)) continue
    url.pathname = target.path
    for (const [key, value] of new URLSearchParams(destination.search)) {
      // A conflicting value must remain invalid, not silently select a different lens.
      if (url.searchParams.get(key) !== value) url.searchParams.append(key, value)
    }
    return `${url.pathname}${url.search}${url.hash}`
  }
  return null
}

/** Canonicalize the current entry only after identity admission, without adding a Back stop. */
export function useWorkspaceEntry(role: Role, admitted: boolean): void {
  const location = useWorkspaceLocation()
  useLayoutEffect(() => {
    if (!admitted) return
    // Fragments remain browser context, not semantic workspace command state.
    const target = resolveWorkspaceRedirect(`${location}${window.location.hash}`, role)
    if (!target) return
    window.history.replaceState(window.history.state, '', target)
    window.dispatchEvent(new Event('history-state-changed'))
  }, [location, role, admitted])
}

/** Validate a path against the declarative route registry and the signed-in role. */
export function navigateWorkspace(path: string, role: Role, windowLike?: Window): WebUiNavigationResult {
  const targetWindow = currentWindow(windowLike)
  if (!targetWindow) throw new Error('WebMCP navigation is unavailable outside a browser window')
  const target = resolveNavigationTarget(path, targetWindow)
  resolveAuthorizedRoute(target.pathname, role)
  const normalizedPath = resolveWorkspaceRedirect(target.pathname, role) ?? target.pathname
  const matched = resolveAuthorizedRoute(new URL(normalizedPath, targetWindow.location.origin).pathname, role)
  targetWindow.history.pushState({}, '', normalizedPath)
  targetWindow.dispatchEvent(new Event('history-state-changed'))
  return {
    navigated: true,
    path: normalizedPath,
    routeId: matched.route.id,
    // Route ids are the stable public view identifier here. The richer page
    // context tool remains the source for the legacy view id when needed.
    view: matched.route.id,
  }
}

/** Subscribe to the same URL events used by existing sidebar and conversation links. */
function subscribe(listener: () => void): () => void {
  window.addEventListener('history-state-changed', listener)
  window.addEventListener('popstate', listener)
  return () => {
    window.removeEventListener('history-state-changed', listener)
    window.removeEventListener('popstate', listener)
  }
}

function locationSnapshot(): string {
  return `${window.location.pathname}${window.location.search}`
}

export function useWorkspaceLocation(): string {
  return useSyncExternalStore(subscribe, locationSnapshot, () => '/')
}

/** Route parameters are selected entity references, never invented child records. */
export function describeWorkspaceDestination(path: string) {
  const pathname = new URL(path, 'https://workspace.invalid').pathname
  const match = matchRoute(pathname)
  if (!match) return null
  return {
    routeId: match.route.id,
    section: match.route.section,
    label: match.route.label,
    path: pathname,
    parameters: match.params,
  }
}
