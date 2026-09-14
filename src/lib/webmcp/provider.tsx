/**
 * React lifecycle seam for the optional WebMCP enhancement.
 *
 * The provider owns the browser adapter and the page-level tools. Child seams
 * (currently Atlas) can register a short-lived tool set through
 * `useWebMcpToolSet`; the same provider lifecycle then cancels every set on
 * unmount, identity changes, or page-context changes.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import type { Identity } from '@/lib/auth'
import { usePageContextEnvelope } from '@/lib/page-context'
import {
  createUnavailableWebMcpRegistration,
  detectWebMcpAdapter,
  registerWebMcpTools,
  type WebMcpRegistrationHandle,
} from './adapter'
import { toPublicPageContext, type PublicPageContext } from './contracts'
import { createPageTools } from './tools'
import type { WebMcpToolDefinition } from './types'

export interface WebMcpProviderProps {
  identity: Identity
  /** Pass the app's auth-loading flag to avoid exposing unresolved identity state. */
  identityLoading?: boolean
  children: ReactNode
}

interface WebMcpRuntime {
  readonly registrationKey: string
  register(tools: readonly WebMcpToolDefinition[]): WebMcpRegistrationHandle
}

const WebMcpRuntimeContext = createContext<WebMcpRuntime | null>(null)

function publicContextOrNull(envelope: ReturnType<typeof usePageContextEnvelope>): PublicPageContext | null {
  try {
    return toPublicPageContext(envelope)
  } catch {
    // A malformed route/filter envelope must not turn an optional browser
    // feature into an application render failure.
    return null
  }
}

function contextFingerprint(envelope: ReturnType<typeof usePageContextEnvelope>): string {
  try {
    return JSON.stringify(envelope)
  } catch {
    return 'invalid-page-context'
  }
}

/** Mount once inside `PageContextProvider` to expose only local UI tools. */
export function WebMcpProvider({ identity, identityLoading = false, children }: WebMcpProviderProps) {
  const pageContext = usePageContextEnvelope()
  const adapter = useMemo(() => detectWebMcpAdapter(), [])
  const publicContext = useMemo(() => publicContextOrNull(pageContext), [pageContext])
  const identityKey = [identity.userKey, identity.role, identity.ssoConfigured, identity.needsSignIn].join('|')
  const contextKey = contextFingerprint(pageContext)
  const enabled = adapter !== null && !identityLoading && !identity.needsSignIn && publicContext !== null
  const registrationKey = `${enabled ? 'enabled' : 'disabled'}:${identityKey}:${contextKey}`

  const register = useCallback(
    (tools: readonly WebMcpToolDefinition[]): WebMcpRegistrationHandle => {
      if (!adapter || !enabled || tools.length === 0) return createUnavailableWebMcpRegistration(tools)
      return registerWebMcpTools(adapter, tools)
    },
    [adapter, enabled],
  )

  const runtime = useMemo<WebMcpRuntime>(() => ({ registrationKey, register }), [registrationKey, register])
  const rootTools = useMemo<readonly WebMcpToolDefinition[]>(() => {
    if (!enabled) return []
    try {
      return createPageTools({ context: pageContext, role: identity.role })
    } catch {
      // The adapter remains optional even if a future page-context field is
      // outside this draft's bounded public contract.
      return []
    }
  }, [enabled, identity.role, pageContext])

  useEffect(() => {
    if (!enabled || rootTools.length === 0) return undefined
    return register(rootTools)
  }, [enabled, register, registrationKey, rootTools])

  return <WebMcpRuntimeContext.Provider value={runtime}>{children}</WebMcpRuntimeContext.Provider>
}

/**
 * Register a child-owned tool set. Missing provider support is deliberately a
 * no-op so isolated view tests and unsupported browsers need no special setup.
 */
export function useWebMcpToolSet(tools: readonly WebMcpToolDefinition[]): void {
  const context = useContext(WebMcpRuntimeContext)

  useEffect(() => {
    if (!context || tools.length === 0) return undefined
    return context.register(tools)
  }, [context, tools])
}
