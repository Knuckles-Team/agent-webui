import { z } from 'zod'
import { WEBMCP_CONTROL_PROTOCOL, toCatalogRegisterMessage } from './catalog'
import { RemoteWebMcpDispatcher, type WebMcpPendingConfirmation } from './bridge'
import { ActiveWebMcpRegistry, type WebMcpRegistrySnapshot } from './registry'
import { utf8ByteLength } from './canonical'
import { parseStrictJson } from './strict-json'
import {
  SameOriginAttendedArmClient,
  type AttendedArmClient,
  type AttendedArmRouteScope,
  type AttendedArmScope,
  type AttendedArmStatus,
} from './attended-arm'

const MAX_CHANNEL_MESSAGE_BYTES = 65_536

export type WebMcpChannelStatus = 'idle' | 'connecting' | 'connected' | 'armed' | 'unavailable' | 'error'

const ChannelReadySchema = z
  .object({
    protocol: z.literal(WEBMCP_CONTROL_PROTOCOL),
    type: z.literal('channel.ready'),
    authority: z.literal('graph-os'),
    route_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    registration_generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    catalog_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    tool_scope_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict()

export interface WebMcpChannelView {
  readonly status: WebMcpChannelStatus
  readonly toolIds: readonly string[]
  readonly pendingConfirmation: WebMcpPendingConfirmation | null
  readonly message: string | null
  readonly expiresAt: number | null
}

interface WebSocketLike {
  readonly readyState: number
  onopen: ((event: Event) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type WebMcpSocketFactory = (url: string) => WebSocketLike

interface PermissionsPolicyLike {
  allowsFeature(feature: string): boolean
}

function permitsTools(documentLike: Document): boolean {
  const policy = (documentLike as Document & { permissionsPolicy?: PermissionsPolicyLike }).permissionsPolicy
  try {
    return policy?.allowsFeature('tools') === true
  } catch {
    return false
  }
}

function controlSocketUrl(locationLike: Location): string {
  const url = new URL('/ws/browser-control', locationLike.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function defaultSocketFactory(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike
}

function serializeMessage(message: unknown): string {
  const serialized = JSON.stringify(message)
  if (utf8ByteLength(serialized) > MAX_CHANNEL_MESSAGE_BYTES) {
    throw new Error('WebMCP channel message exceeded its bound')
  }
  return serialized
}

function parseMessage(data: unknown): unknown {
  if (typeof data !== 'string' || utf8ByteLength(data) > MAX_CHANNEL_MESSAGE_BYTES) {
    throw new Error('WebMCP channel received an invalid message')
  }
  return parseStrictJson(data)
}

function trustPrerequisites(windowLike: Window, documentLike: Document): boolean {
  return windowLike.isSecureContext && documentLike.visibilityState === 'visible' && permitsTools(documentLike)
}

function attendedRouteScope(snapshot: WebMcpRegistrySnapshot, locationLike: Location): AttendedArmRouteScope {
  return {
    route_id: snapshot.catalog.routeId,
    next: new URL(locationLike.href).pathname,
  }
}

function attendedScope(snapshot: WebMcpRegistrySnapshot): AttendedArmScope {
  return {
    route_id: snapshot.catalog.routeId,
    registration_generation: snapshot.generation,
    catalog_digest: snapshot.catalog.catalogDigest,
    tool_scope_digest: snapshot.catalog.toolScopeDigest,
    tools: snapshot.catalog.tools.map((tool) => ({ tool_id: tool.toolId, schema_digest: tool.schemaDigest })),
  }
}

function readinessMatches(status: AttendedArmStatus, scope: AttendedArmScope): boolean {
  return (
    status.status === 'armed' &&
    status.expires_at * 1_000 > Date.now() &&
    status.route_id === scope.route_id &&
    status.registration_generation === scope.registration_generation &&
    status.catalog_digest === scope.catalog_digest &&
    status.tool_scope_digest === scope.tool_scope_digest
  )
}

function safeAuthorizationUrl(raw: string, current: Location): string {
  const url = new URL(raw)
  const isLoopback = (hostname: string) => ['localhost', '127.0.0.1', '::1'].includes(hostname)
  const secureScheme = url.protocol === 'https:'
  const localScheme = url.protocol === 'http:' && isLoopback(current.hostname) && isLoopback(url.hostname)
  if (url.username || url.password || (!secureScheme && !localScheme)) {
    throw new Error('The attended authorization URL is unsafe')
  }
  return url.toString()
}

/** Same-origin transport for one attended, exact-generation browser channel. */
export class WebMcpControlChannel {
  private readonly registry: ActiveWebMcpRegistry
  private readonly socketFactory: WebMcpSocketFactory
  private readonly armClient: AttendedArmClient
  private readonly navigateToAuthorization: (url: string) => void
  private readonly windowLike: Window
  private readonly documentLike: Document
  private readonly listeners = new Set<() => void>()
  private socket: WebSocketLike | null = null
  private dispatcher: RemoteWebMcpDispatcher | null = null
  private view: WebMcpChannelView = {
    status: 'idle',
    toolIds: [],
    pendingConfirmation: null,
    message: null,
    expiresAt: null,
  }
  private unsubscribeRegistry: (() => void) | null = null
  private armedGeneration: number | null = null
  private armedCatalogDigest: string | null = null
  private armedToolScopeDigest: string | null = null
  private expiryTimer: number | null = null
  private operationEpoch = 0
  private authorizationTail: Promise<void> = Promise.resolve()
  private pendingRevocation: Promise<boolean> | null = null
  private authorityCleanupFailed = false
  private readonly visibilityListener = () => {
    if (this.documentLike.visibilityState !== 'visible') this.revoke('document-hidden')
  }
  private readonly pageHideListener = () => {
    this.revoke('document-unload')
  }

  constructor(options: {
    registry: ActiveWebMcpRegistry
    socketFactory?: WebMcpSocketFactory
    armClient?: AttendedArmClient
    navigateToAuthorization?: (url: string) => void
    windowLike?: Window
    documentLike?: Document
  }) {
    this.registry = options.registry
    this.socketFactory = options.socketFactory ?? defaultSocketFactory
    this.armClient = options.armClient ?? new SameOriginAttendedArmClient()
    this.navigateToAuthorization =
      options.navigateToAuthorization ??
      ((url) => {
        this.windowLike.location.assign(url)
      })
    this.windowLike = options.windowLike ?? window
    this.documentLike = options.documentLike ?? document
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getView(): WebMcpChannelView {
    return this.view
  }

  async arm(): Promise<void> {
    await this.serializeAuthorization(async () => {
      if (!(await this.ensureAuthorityCleanup())) return
      if (this.view.status === 'connecting' || this.view.status === 'connected' || this.view.status === 'armed') return
      await this.armCurrentSnapshot(true, true)
    })
  }

  async resumeAttendedArm(): Promise<void> {
    await this.serializeAuthorization(async () => {
      if (!(await this.ensureAuthorityCleanup())) return
      if (this.view.status !== 'idle') return
      await this.armCurrentSnapshot(false, false)
    })
  }

  private async serializeAuthorization(operation: () => Promise<void>): Promise<void> {
    let release: (() => void) | undefined
    const slot = new Promise<void>((resolve) => {
      release = resolve
    })
    const previous = this.authorizationTail
    this.authorizationTail = previous.then(() => slot)
    await previous
    try {
      await operation()
    } finally {
      release?.()
    }
  }

  private async armCurrentSnapshot(reportUnavailable: boolean, initiateWhenAbsent: boolean): Promise<void> {
    const operation = this.beginOperation()
    const snapshot = await this.armSnapshot(reportUnavailable, operation)
    if (!snapshot) return
    this.setView({ status: 'connecting', toolIds: snapshot.toolIds, message: 'Checking attended authorization.' })
    try {
      await this.authorizeOrInitiate(snapshot, operation, initiateWhenAbsent)
    } catch {
      if (this.operationIsCurrent(operation)) {
        this.setView({
          status: reportUnavailable ? 'unavailable' : 'idle',
          toolIds: [],
          message: reportUnavailable ? 'Attended browser authorization is unavailable.' : null,
        })
      }
    }
  }

  private async ensureAuthorityCleanup(): Promise<boolean> {
    const pendingSucceeded = (await this.pendingRevocation) ?? true
    if (!pendingSucceeded || this.authorityCleanupFailed) return this.scheduleRevocation()
    return true
  }

  private scheduleRevocation(): Promise<boolean> {
    const previous = this.pendingRevocation ?? Promise.resolve(true)
    const revocation = previous
      .then(() => this.armClient.revoke())
      .then(
        () => {
          this.authorityCleanupFailed = false
          return true
        },
        () => {
          this.authorityCleanupFailed = true
          this.setView({ status: 'error', toolIds: [], message: 'Browser control authority could not be revoked.' })
          return false
        },
      )
    this.pendingRevocation = revocation
    void revocation.then(() => {
      if (this.pendingRevocation === revocation) this.pendingRevocation = null
    })
    return revocation
  }

  private beginOperation(): number {
    this.operationEpoch += 1
    return this.operationEpoch
  }

  private operationIsCurrent(operation: number, snapshot?: WebMcpRegistrySnapshot): boolean {
    return (
      operation === this.operationEpoch &&
      trustPrerequisites(this.windowLike, this.documentLike) &&
      (snapshot === undefined || this.registry.currentGeneration() === snapshot.generation)
    )
  }

  private async armSnapshot(reportUnavailable: boolean, operation: number): Promise<WebMcpRegistrySnapshot | null> {
    if (!trustPrerequisites(this.windowLike, this.documentLike)) {
      if (reportUnavailable) {
        this.setView({ status: 'unavailable', message: 'Secure visible browser control is unavailable.' })
      }
      return null
    }
    try {
      const snapshot = await this.registry.snapshot()
      if (this.operationIsCurrent(operation, snapshot) && snapshot.toolIds.length > 0) return snapshot
    } catch {
      // The current document has no fully acknowledged capability generation.
    }
    if (reportUnavailable && this.operationIsCurrent(operation)) {
      this.setView({ status: 'unavailable', message: 'No active browser tools are available.' })
    }
    return null
  }

  private async authorizeOrInitiate(
    snapshot: WebMcpRegistrySnapshot,
    operation: number,
    initiateWhenAbsent: boolean,
  ): Promise<void> {
    const scope = attendedScope(snapshot)
    const readiness = await this.armClient.readiness()
    if (!this.operationIsCurrent(operation, snapshot)) return
    if (readiness.status === 'armed') {
      if (readinessMatches(readiness, scope)) this.openSocket(snapshot, readiness.expires_at, operation)
      else await this.rejectMismatchedAuthority(snapshot, operation)
      return
    }
    if (readiness.status === 'recent-auth') {
      await this.finalizeRecentAuthority(snapshot, scope, operation, readiness)
      return
    }
    await this.initiateAuthority(snapshot, operation, initiateWhenAbsent)
  }

  private async rejectMismatchedAuthority(snapshot: WebMcpRegistrySnapshot, operation: number): Promise<void> {
    if (!(await this.scheduleRevocation())) return
    if (this.operationIsCurrent(operation, snapshot)) this.reportScopeChange()
  }

  private async finalizeRecentAuthority(
    snapshot: WebMcpRegistrySnapshot,
    scope: AttendedArmScope,
    operation: number,
    readiness: Extract<AttendedArmStatus, { status: 'recent-auth' }>,
  ): Promise<void> {
    if (readiness.route_id !== scope.route_id || readiness.expires_at * 1_000 <= Date.now()) {
      await this.rejectMismatchedAuthority(snapshot, operation)
      return
    }
    const armed = await this.armClient.finalize(scope)
    if (!this.operationIsCurrent(operation, snapshot)) {
      await this.scheduleRevocation()
      return
    }
    if (!readinessMatches(armed, scope)) {
      await this.rejectMismatchedAuthority(snapshot, operation)
      return
    }
    this.openSocket(snapshot, armed.expires_at, operation)
  }

  private async initiateAuthority(
    snapshot: WebMcpRegistrySnapshot,
    operation: number,
    initiateWhenAbsent: boolean,
  ): Promise<void> {
    if (!initiateWhenAbsent) {
      this.setView({ status: 'idle', toolIds: [], message: null })
      return
    }
    const initiation = await this.armClient.initiate(attendedRouteScope(snapshot, this.windowLike.location))
    if (!this.operationIsCurrent(operation, snapshot)) {
      await this.scheduleRevocation()
      return
    }
    if (initiation.expires_at * 1_000 <= Date.now()) throw new Error('Attended authorization already expired')
    const authorizationUrl = safeAuthorizationUrl(initiation.authorization_url, this.windowLike.location)
    this.setView({ message: 'Continuing to attended sign-in.' })
    this.navigateToAuthorization(authorizationUrl)
  }

  private reportScopeChange(): void {
    this.setView({ status: 'unavailable', toolIds: [], message: 'The browser tool scope changed during arming.' })
  }

  private openSocket(snapshot: WebMcpRegistrySnapshot, expiresAt: number, operation: number): void {
    if (!this.operationIsCurrent(operation, snapshot)) return
    if (this.socket !== null) {
      void this.scheduleRevocation()
      this.fail('The previous browser control channel was still active.')
      return
    }
    let frames: string[]
    try {
      frames = [
        serializeMessage({
          protocol: WEBMCP_CONTROL_PROTOCOL,
          type: 'channel.open',
          route_id: snapshot.catalog.routeId,
          registration_generation: snapshot.generation,
          attended: true,
          secure_context: this.windowLike.isSecureContext,
          permissions_policy: permitsTools(this.documentLike),
          document_visible: this.documentLike.visibilityState === 'visible',
        }),
        serializeMessage(toCatalogRegisterMessage(snapshot.catalog)),
      ]
    } catch {
      void this.scheduleRevocation()
      this.setView({ status: 'unavailable', message: 'The browser tool catalog exceeded its channel bound.' })
      return
    }
    this.setView({ status: 'connecting', toolIds: snapshot.toolIds, message: null, expiresAt })
    let socket: WebSocketLike
    try {
      socket = this.socketFactory(controlSocketUrl(this.windowLike.location))
    } catch {
      void this.scheduleRevocation()
      this.setView({ status: 'error', message: 'The browser control channel could not open.' })
      return
    }
    this.socket = socket
    this.armedGeneration = snapshot.generation
    this.armedCatalogDigest = snapshot.catalog.catalogDigest
    this.armedToolScopeDigest = snapshot.catalog.toolScopeDigest
    const dispatcher = new RemoteWebMcpDispatcher({
      registry: this.registry,
      registrationGeneration: snapshot.generation,
      send: (message) => {
        if (this.socket === socket && this.dispatcher === dispatcher) this.sendControlMessage(message)
      },
      onConfirmationChange: (pendingConfirmation) => {
        if (this.socket === socket && this.dispatcher === dispatcher) this.setView({ pendingConfirmation })
      },
    })
    this.dispatcher = dispatcher
    this.unsubscribeRegistry = this.registry.subscribe(() => {
      if (this.registry.currentGeneration() !== this.armedGeneration) this.revoke('generation-change')
    })
    if (this.registry.currentGeneration() !== this.armedGeneration) {
      this.revoke('generation-change')
      return
    }
    this.documentLike.addEventListener('visibilitychange', this.visibilityListener)
    this.windowLike.addEventListener('pagehide', this.pageHideListener)
    const delay = Math.max(0, Math.min(2_147_483_647, expiresAt * 1_000 - Date.now()))
    this.expiryTimer = this.windowLike.setTimeout(() => {
      this.revoke('attended-arm-expired')
    }, delay)
    socket.onopen = () => {
      if (this.socket !== socket) return
      if (!this.operationIsCurrent(operation, snapshot)) {
        this.revoke('arming-context-change')
        return
      }
      frames.forEach((frame) => {
        socket.send(frame)
      })
      this.setView({ status: 'connected', toolIds: snapshot.toolIds, message: null })
    }
    socket.onmessage = (event) => {
      if (this.socket === socket && this.dispatcher === dispatcher) void this.receive(socket, dispatcher, event.data)
    }
    socket.onerror = () => {
      if (this.socket === socket && this.dispatcher === dispatcher) this.fail('The browser control channel failed.')
    }
    socket.onclose = () => {
      if (this.socket === socket) this.retireWithAuthorityCleanup('Browser control was disconnected.', 'idle', false)
    }
  }

  confirm(callId: string): void {
    this.dispatcher?.confirm(callId)
  }

  deny(callId: string): void {
    this.dispatcher?.deny(callId)
  }

  revoke(reason = 'operator-revoked'): void {
    this.operationEpoch += 1
    const socket = this.socket
    const shouldRevokeAuthority = socket !== null || this.view.expiresAt !== null || this.view.status === 'connecting'
    this.retire(
      shouldRevokeAuthority ? 'Revoking browser control authority.' : null,
      shouldRevokeAuthority ? 'connecting' : 'idle',
    )
    socket?.close(1000, reason.slice(0, 64))
    if (shouldRevokeAuthority) {
      void this.scheduleRevocation().then((succeeded) => {
        if (succeeded && this.socket === null && this.view.status === 'connecting') {
          this.setView({ status: 'idle', message: null })
        }
      })
    }
  }

  private async receive(socket: WebSocketLike, dispatcher: RemoteWebMcpDispatcher, data: unknown): Promise<void> {
    try {
      if (!this.isActiveTransport(socket, dispatcher)) return
      const message = parseMessage(data)
      if (typeof message === 'object' && message !== null && Reflect.get(message, 'type') === 'channel.ready') {
        this.acceptReady(message)
        return
      }
      if (this.view.status !== 'armed') throw new Error('WebMCP control arrived before readiness acknowledgement')
      await dispatcher.accept(message)
    } catch {
      if (this.isActiveTransport(socket, dispatcher)) this.fail('The browser control request was refused.')
    }
  }

  private isActiveTransport(socket: WebSocketLike, dispatcher: RemoteWebMcpDispatcher): boolean {
    return this.socket === socket && this.dispatcher === dispatcher
  }

  private acceptReady(message: object): void {
    if (this.view.status !== 'connected') throw new Error('WebMCP ready acknowledgement was out of order')
    const ready = ChannelReadySchema.parse(message)
    const matchingRoute = ready.route_id === this.registry.binding.routeId
    const matchingGeneration = ready.registration_generation === this.armedGeneration
    if (!matchingRoute || !matchingGeneration) {
      throw new Error('WebMCP ready acknowledgement does not match the active binding')
    }
    if (ready.catalog_digest !== this.armedCatalogDigest || ready.tool_scope_digest !== this.armedToolScopeDigest) {
      throw new Error('WebMCP catalog acknowledgement does not match the active binding')
    }
    this.setView({ status: 'armed', message: null })
  }

  private sendControlMessage(message: unknown): void {
    const socket = this.socket
    if (socket?.readyState !== 1) return
    socket.send(serializeMessage(message))
  }

  private fail(message: string): void {
    const socket = this.socket
    this.retireWithAuthorityCleanup(message, 'error')
    socket?.close(1008, 'protocol-error')
  }

  private retireWithAuthorityCleanup(
    message: string,
    completedStatus: WebMcpChannelStatus,
    reportCancellation = true,
  ): void {
    this.retire('Revoking browser control authority.', 'connecting', reportCancellation)
    const cleanupOperation = this.operationEpoch
    void this.scheduleRevocation().then((succeeded) => {
      if (succeeded && this.operationEpoch === cleanupOperation && this.socket === null) {
        this.setView({ status: completedStatus, message })
      }
    })
  }

  private retire(message: string | null, status: WebMcpChannelStatus = 'idle', reportCancellation = true): void {
    this.operationEpoch += 1
    this.dispatcher?.close(reportCancellation)
    this.dispatcher = null
    this.unsubscribeRegistry?.()
    this.unsubscribeRegistry = null
    this.documentLike.removeEventListener('visibilitychange', this.visibilityListener)
    this.windowLike.removeEventListener('pagehide', this.pageHideListener)
    if (this.expiryTimer !== null) this.windowLike.clearTimeout(this.expiryTimer)
    this.expiryTimer = null
    this.socket = null
    this.armedGeneration = null
    this.armedCatalogDigest = null
    this.armedToolScopeDigest = null
    this.setView({ status, toolIds: [], pendingConfirmation: null, message, expiresAt: null })
  }

  private setView(patch: Partial<WebMcpChannelView>): void {
    this.view = { ...this.view, ...patch }
    this.listeners.forEach((listener) => {
      listener()
    })
  }
}
