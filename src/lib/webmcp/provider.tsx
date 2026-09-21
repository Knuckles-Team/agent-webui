/**
 * React lifecycle seam for the optional WebMCP enhancement.
 *
 * The provider owns the browser adapter and the page-level tools. Child seams
 * (currently Atlas) can register a short-lived tool set through
 * `useWebMcpToolSet`; the same provider lifecycle then cancels every set on
 * unmount, identity changes, or page-context changes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { WebMcpControl } from '@/components/webmcp/WebMcpControl'
import type { Identity } from '@/lib/auth'
import { usePageContextEnvelope } from '@/lib/page-context'
import {
  createUnavailableWebMcpRegistration,
  detectWebMcpAdapter,
  registerWebMcpTools,
  type WebMcpRegistrationHandle,
} from './adapter'
import { toPublicPageContext, type PublicPageContext } from './contracts'
import { WebMcpControlChannel } from './channel'
import { ActiveWebMcpRegistry } from './registry'
import { createPageTools } from './tools'
import type { WebMcpAdapter, WebMcpToolDefinition } from './types'
import type { AttendedArmClient } from './attended-arm'

export interface WebMcpProviderProps {
  identity: Identity
  /** Pass the app's auth-loading flag to avoid exposing unresolved identity state. */
  identityLoading?: boolean
  children: ReactNode
  /** Injectable only for deterministic browser testing; production requires Event.isTrusted. */
  isAttendedGesture?: ComponentProps<typeof WebMcpControl>['isAttendedGesture']
  /** Test seam for the server-owned attended authorization flow. */
  attendedArmClient?: AttendedArmClient
}

interface WebMcpRuntime {
  readonly registrationKey: string
  register(ownerId: string, tools: readonly WebMcpToolDefinition[]): WebMcpRegistrationHandle
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

function identityFingerprint(identity: Identity): string {
  return JSON.stringify(identity)
}

function providerEnabled(options: {
  adapter: WebMcpAdapter | null
  identity: Identity
  identityLoading: boolean
  publicContext: PublicPageContext | null
}): boolean {
  return (
    Boolean(options.adapter) &&
    !options.identityLoading &&
    !options.identity.needsSignIn &&
    Boolean(options.publicContext)
  )
}

function remoteControlEligible(enabled: boolean, identity: Identity): boolean {
  return enabled && identity.ssoConfigured && identity.raw?.authenticated === true
}

function createRegistry(
  documentId: string,
  identityKey: string,
  identity: Identity,
  publicContext: PublicPageContext | null,
): ActiveWebMcpRegistry {
  return new ActiveWebMcpRegistry({
    documentId,
    routeId: publicContext?.view ?? 'unavailable',
    route: publicContext?.route ?? 'unavailable',
    identityClaim: identityKey,
    role: identity.role,
  })
}

function nativeRegistration(
  adapter: WebMcpAdapter | null,
  enabled: boolean,
  tools: readonly WebMcpToolDefinition[],
): WebMcpRegistrationHandle {
  if (!adapter || !enabled || tools.length === 0) return createUnavailableWebMcpRegistration(tools)
  return registerWebMcpTools(adapter, tools)
}

function createTrackedRegistration(options: {
  adapter: WebMcpAdapter | null
  enabled: boolean
  ownerId: string
  registry: ActiveWebMcpRegistry
  tools: readonly WebMcpToolDefinition[]
}): WebMcpRegistrationHandle {
  const handle = nativeRegistration(options.adapter, options.enabled, options.tools)
  let live = true
  void handle.acknowledged.then((snapshot) => {
    if (!live || options.registry.isRetired()) return
    const activeNames = new Set(snapshot.activeToolNames)
    options.registry.replaceToolSet(
      options.ownerId,
      options.tools.filter((tool) => activeNames.has(tool.name)),
    )
  })
  const tracked = (() => {
    if (!live) return
    live = false
    handle()
    options.registry.removeToolSet(options.ownerId)
  }) as WebMcpRegistrationHandle
  Object.defineProperties(tracked, {
    generation: { value: handle.generation, enumerable: true },
    acknowledged: { value: handle.acknowledged, enumerable: true },
    getSnapshot: { value: handle.getSnapshot.bind(handle), enumerable: true },
  })
  return tracked
}

function createRootTools(
  enabled: boolean,
  pageContext: ReturnType<typeof usePageContextEnvelope>,
  identity: Identity,
): readonly WebMcpToolDefinition[] {
  if (!enabled) return []
  try {
    return createPageTools({ context: pageContext, role: identity.role })
  } catch {
    return []
  }
}

/** Mount once inside `PageContextProvider` to expose only local UI tools. */
export function WebMcpProvider({
  identity,
  identityLoading = false,
  children,
  isAttendedGesture,
  attendedArmClient,
}: WebMcpProviderProps) {
  const documentId = useId()
  const pageContext = usePageContextEnvelope()
  const adapter = useMemo(() => detectWebMcpAdapter(), [])
  const publicContext = useMemo(() => publicContextOrNull(pageContext), [pageContext])
  const identityKey = identityFingerprint(identity)
  const contextKey = contextFingerprint(pageContext)
  const enabled = providerEnabled({ adapter, identity, identityLoading, publicContext })
  const registrationKey = `${enabled ? 'enabled' : 'disabled'}:${identityKey}:${contextKey}`
  const registry = useMemo(
    () => createRegistry(documentId, identityKey, identity, publicContext),
    [documentId, identity.role, identityKey, publicContext?.route, publicContext?.view],
  )
  const controlChannel = useMemo(
    () => new WebMcpControlChannel({ registry, armClient: attendedArmClient }),
    [attendedArmClient, registry],
  )
  const remoteEligible = remoteControlEligible(enabled, identity)
  const lifecycleMarkers = useRef(new WeakMap<ActiveWebMcpRegistry, object>())

  const register = useCallback(
    (ownerId: string, tools: readonly WebMcpToolDefinition[]): WebMcpRegistrationHandle => {
      return createTrackedRegistration({ adapter, enabled, ownerId, registry, tools })
    },
    [adapter, enabled, registry],
  )

  const runtime = useMemo<WebMcpRuntime>(() => ({ registrationKey, register }), [registrationKey, register])
  const rootTools = useMemo(() => createRootTools(enabled, pageContext, identity), [enabled, identity, pageContext])

  useEffect(() => {
    if (!enabled || rootTools.length === 0) return undefined
    return register('page', rootTools)
  }, [enabled, register, registrationKey, rootTools])

  useEffect(() => {
    const marker = {}
    lifecycleMarkers.current.set(registry, marker)
    return () => {
      controlChannel.revoke('provider-lifecycle-change')
      queueMicrotask(() => {
        if (lifecycleMarkers.current.get(registry) === marker) registry.retire('provider-unmount')
      })
    }
  }, [controlChannel, registry])

  useEffect(() => {
    if (!remoteEligible) return undefined
    let resumeTimer: number | null = null
    const scheduleResume = () => {
      if (resumeTimer !== null) window.clearTimeout(resumeTimer)
      resumeTimer = window.setTimeout(() => {
        resumeTimer = null
        void controlChannel.resumeAttendedArm()
      }, 0)
    }
    const unsubscribe = registry.subscribe(scheduleResume)
    scheduleResume()
    return () => {
      if (resumeTimer !== null) window.clearTimeout(resumeTimer)
      unsubscribe()
    }
  }, [controlChannel, registry, remoteEligible])

  return (
    <WebMcpRuntimeContext.Provider value={runtime}>
      {children}
      <WebMcpControl channel={controlChannel} visible={remoteEligible} isAttendedGesture={isAttendedGesture} />
    </WebMcpRuntimeContext.Provider>
  )
}

/**
 * Register a child-owned tool set. Missing provider support is deliberately a
 * no-op so isolated view tests and unsupported browsers need no special setup.
 */
export function useWebMcpToolSet(tools: readonly WebMcpToolDefinition[]): void {
  const context = useContext(WebMcpRuntimeContext)
  const ownerId = useId()

  useEffect(() => {
    if (!context || tools.length === 0) return undefined
    return context.register(ownerId, tools)
  }, [context, ownerId, tools])
}
