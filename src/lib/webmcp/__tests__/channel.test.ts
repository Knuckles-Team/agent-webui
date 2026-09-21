import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEBMCP_CONTROL_PROTOCOL, type WebMcpCatalogBinding } from '../catalog'
import { WebMcpControlChannel, type WebMcpSocketFactory } from '../channel'
import { ActiveWebMcpRegistry } from '../registry'
import type { WebMcpToolDefinition } from '../types'
import { createValidatedExecutor } from '../validation'
import type { AttendedArmClient, AttendedArmScope, AttendedArmStatus } from '../attended-arm'

const BINDING: WebMcpCatalogBinding = {
  documentId: 'document-1',
  routeId: 'graph',
  route: '/graph',
  identityClaim: 'operator-1',
  role: 'operator',
}

function readTool(id = 'agent-webui.read'): WebMcpToolDefinition {
  return {
    name: id,
    title: 'Read page',
    description: 'Read bounded page state',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    capability: {
      version: '1.0.0',
      outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, additionalProperties: false },
      mutationClass: 'read',
      confirmationPolicy: 'none',
      source: 'agent-webui:test',
    },
    execute: createValidatedExecutor(z.record(z.string(), z.unknown()), z.unknown(), async () => ({ ok: true })),
  }
}

class FakeSocket {
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  readonly sent: string[] = []
  readonly close = vi.fn((code?: number, reason?: string) => {
    void code
    void reason
    this.readyState = 3
  })

  send(data: string): void {
    this.sent.push(data)
  }

  open(): void {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  receiveRaw(data: string): void {
    this.onmessage?.({ data })
  }

  ready(): void {
    const opened = JSON.parse(this.sent[0] ?? '{}') as {
      registration_generation?: number
      route_id?: string
    }
    const catalog = JSON.parse(this.sent[1] ?? '{}') as {
      catalog_digest?: string
      tool_scope_digest?: string
    }
    this.receive({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'channel.ready',
      authority: 'graph-os',
      route_id: opened.route_id,
      registration_generation: opened.registration_generation,
      catalog_digest: catalog.catalog_digest,
      tool_scope_digest: catalog.tool_scope_digest,
    })
  }

  disconnect(): void {
    this.readyState = 3
    this.onclose?.(new CloseEvent('close'))
  }
}

function registryWithTool(): ActiveWebMcpRegistry {
  const registry = new ActiveWebMcpRegistry(BINDING)
  registry.replaceToolSet('page', [readTool()])
  return registry
}

function readyArmClient(registry: ActiveWebMcpRegistry): AttendedArmClient {
  return {
    readiness: vi.fn(async () => {
      const snapshot = await registry.snapshot()
      return {
        status: 'armed' as const,
        expires_at: Date.now() / 1_000 + 300,
        route_id: snapshot.catalog.routeId,
        registration_generation: snapshot.generation,
        catalog_digest: snapshot.catalog.catalogDigest,
        tool_scope_digest: snapshot.catalog.toolScopeDigest,
      }
    }),
    initiate: vi.fn(async () => ({ authorization_url: 'https://identity.example/authorize', expires_at: 1 })),
    finalize: vi.fn(async () => {
      throw new Error('Recent authentication was not expected')
    }),
    revoke: vi.fn(async () => undefined),
  }
}

function recentAuthClient(
  finalize: AttendedArmClient['finalize'],
  revoke: AttendedArmClient['revoke'] = vi.fn(async () => undefined),
): AttendedArmClient {
  return {
    readiness: vi.fn(async () => ({
      status: 'recent-auth' as const,
      expires_at: Date.now() / 1_000 + 300,
      route_id: 'graph',
    })),
    initiate: vi.fn(async () => {
      throw new Error('Step-up already completed')
    }),
    finalize,
    revoke,
  }
}

function channelWithSocket(registry = registryWithTool()): {
  channel: WebMcpControlChannel
  socket: FakeSocket
  armClient: AttendedArmClient
} {
  const socket = new FakeSocket()
  const armClient = readyArmClient(registry)
  const channel = new WebMcpControlChannel({
    registry,
    armClient,
    socketFactory: (() => socket) as unknown as WebMcpSocketFactory,
  })
  return { channel, socket, armClient }
}

async function openChannel(registry = registryWithTool()): Promise<{
  channel: WebMcpControlChannel
  socket: FakeSocket
  armClient: AttendedArmClient
}> {
  const fixture = channelWithSocket(registry)
  await fixture.channel.arm()
  fixture.socket.open()
  fixture.socket.ready()
  await Promise.resolve()
  return fixture
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  Object.defineProperty(document, 'permissionsPolicy', {
    configurable: true,
    value: { allowsFeature: vi.fn(() => true) },
  })
})

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

describe('attended WebMCP control channel', () => {
  it('refuses an empty capability generation before checking authority or opening a socket', async () => {
    const registry = new ActiveWebMcpRegistry(BINDING)
    registry.replaceToolSet('page', [])
    const socketFactory = vi.fn(() => new FakeSocket()) as unknown as WebMcpSocketFactory
    const armClient = readyArmClient(registry)
    const channel = new WebMcpControlChannel({ registry, armClient, socketFactory })

    await channel.arm()

    expect(channel.getView()).toMatchObject({ status: 'unavailable', toolIds: [] })
    expect(armClient.readiness).not.toHaveBeenCalled()
    expect(socketFactory).not.toHaveBeenCalled()
  })

  it('opens same-origin with exact-generation claims and no identity or token fields', async () => {
    const socket = new FakeSocket()
    const socketFactory = vi.fn(() => socket) as unknown as WebMcpSocketFactory
    const registry = registryWithTool()
    const channel = new WebMcpControlChannel({
      registry,
      armClient: readyArmClient(registry),
      socketFactory,
    })

    await channel.arm()
    expect(channel.getView().status).toBe('connecting')
    socket.open()
    socket.ready()
    await Promise.resolve()

    expect(socketFactory).toHaveBeenCalledWith('ws://localhost/ws/browser-control')
    const messages = socket.sent.map((message) => JSON.parse(message) as Record<string, unknown>)
    expect(messages[0]).toMatchObject({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'channel.open',
      route_id: 'graph',
      attended: true,
      secure_context: true,
      permissions_policy: true,
      document_visible: true,
    })
    expect(messages[1]).toMatchObject({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'catalog.register',
      route_id: 'graph',
      tools: [{ tool_id: 'agent-webui.read' }],
    })
    expect(socket.sent.join('')).not.toMatch(/operator-1|document-1|bearer|token/i)
    await vi.waitFor(() => {
      expect(channel.getView()).toMatchObject({ status: 'armed', toolIds: ['agent-webui.read'] })
    })
  })

  it('initiates server-owned attended step-up before opening a browser socket', async () => {
    window.history.replaceState({}, '', '/graph?access_token=must-not-leave#fragment')
    const registry = registryWithTool()
    const socketFactory = vi.fn(() => new FakeSocket()) as unknown as WebMcpSocketFactory
    const navigate = vi.fn()
    const initiate = vi.fn(async () => ({
      authorization_url: 'https://identity.example/realms/graph/protocol/openid-connect/auth',
      expires_at: Date.now() / 1_000 + 300,
    }))
    const armClient: AttendedArmClient = {
      readiness: vi.fn(async () => ({ status: 'none' as const })),
      initiate,
      finalize: vi.fn(async () => {
        throw new Error('Recent authentication was not expected')
      }),
      revoke: vi.fn(async () => undefined),
    }
    const channel = new WebMcpControlChannel({
      registry,
      armClient,
      navigateToAuthorization: navigate,
      socketFactory,
    })

    await channel.arm()

    expect(initiate).toHaveBeenCalledWith({
      route_id: 'graph',
      next: '/graph',
    })
    expect(navigate).toHaveBeenCalledWith('https://identity.example/realms/graph/protocol/openid-connect/auth')
    expect(socketFactory).not.toHaveBeenCalled()
  })

  it('finalizes a post-redirect recent-auth grant against the rebuilt exact catalog', async () => {
    const registry = registryWithTool()
    const socket = new FakeSocket()
    const finalize = vi.fn(async (scope: AttendedArmScope) => ({
      status: 'armed' as const,
      expires_at: Date.now() / 1_000 + 300,
      route_id: scope.route_id,
      registration_generation: scope.registration_generation,
      catalog_digest: scope.catalog_digest,
      tool_scope_digest: scope.tool_scope_digest,
    }))
    const channel = new WebMcpControlChannel({
      registry,
      armClient: recentAuthClient(finalize),
      socketFactory: (() => socket) as unknown as WebMcpSocketFactory,
    })

    await channel.resumeAttendedArm()

    const snapshot = await registry.snapshot()
    expect(finalize).toHaveBeenCalledWith({
      route_id: 'graph',
      registration_generation: snapshot.generation,
      catalog_digest: snapshot.catalog.catalogDigest,
      tool_scope_digest: snapshot.catalog.toolScopeDigest,
      tools: [{ tool_id: 'agent-webui.read', schema_digest: snapshot.catalog.tools[0].schemaDigest }],
    })
    socket.open()
    expect(socket.sent.map((frame) => (JSON.parse(frame) as { type: unknown }).type)).toEqual([
      'channel.open',
      'catalog.register',
    ])
  })

  it('invalidates an asynchronous arm operation when the operator revokes it', async () => {
    const registry = registryWithTool()
    let finishReadiness: ((status: { status: 'none' }) => void) | undefined
    const readiness = vi.fn(
      () =>
        new Promise<{ status: 'none' }>((resolve) => {
          finishReadiness = resolve
        }),
    )
    const initiate = vi.fn(async () => ({ authorization_url: 'https://identity.example/authorize', expires_at: 1 }))
    const revoke = vi.fn(async () => undefined)
    const socketFactory = vi.fn(() => new FakeSocket()) as unknown as WebMcpSocketFactory
    const channel = new WebMcpControlChannel({
      registry,
      armClient: {
        readiness,
        initiate,
        finalize: vi.fn(async () => {
          throw new Error('No recent authentication')
        }),
        revoke,
      },
      socketFactory,
    })

    const arming = channel.arm()
    await vi.waitFor(() => {
      expect(readiness).toHaveBeenCalledOnce()
    })
    channel.revoke()
    finishReadiness?.({ status: 'none' })
    await arming

    expect(revoke).toHaveBeenCalledOnce()
    expect(initiate).not.toHaveBeenCalled()
    expect(socketFactory).not.toHaveBeenCalled()
    expect(channel.getView().status).toBe('idle')
  })

  it('clears stale finalize authority before starting a replacement arm', async () => {
    const registry = registryWithTool()
    let finishFinalize: ((status: Extract<AttendedArmStatus, { status: 'armed' }>) => void) | undefined
    let finalizedScope: AttendedArmScope | undefined
    const finalize = vi.fn(
      (scope: AttendedArmScope) =>
        new Promise<Extract<AttendedArmStatus, { status: 'armed' }>>((resolve) => {
          finalizedScope = scope
          finishFinalize = resolve
        }),
    )
    const readiness = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'recent-auth' as const,
        expires_at: Date.now() / 1_000 + 300,
        route_id: 'graph',
      })
      .mockResolvedValueOnce({ status: 'none' as const })
    const initiate = vi.fn(async () => ({
      authorization_url: 'https://identity.example/authorize',
      expires_at: Date.now() / 1_000 + 300,
    }))
    const revoke = vi.fn(async () => undefined)
    const socketFactory = vi.fn(() => new FakeSocket()) as unknown as WebMcpSocketFactory
    const navigate = vi.fn()
    const channel = new WebMcpControlChannel({
      registry,
      armClient: { readiness, initiate, finalize, revoke },
      navigateToAuthorization: navigate,
      socketFactory,
    })

    const arming = channel.resumeAttendedArm()
    await vi.waitFor(() => {
      expect(finalize).toHaveBeenCalledOnce()
    })
    channel.revoke()
    const replacement = channel.arm()
    await Promise.resolve()
    expect(readiness).toHaveBeenCalledOnce()
    expect(initiate).not.toHaveBeenCalled()
    if (!finalizedScope) throw new Error('Synthetic finalize scope was not captured')
    finishFinalize?.({
      status: 'armed',
      expires_at: Date.now() / 1_000 + 300,
      route_id: finalizedScope.route_id,
      registration_generation: finalizedScope.registration_generation,
      catalog_digest: finalizedScope.catalog_digest,
      tool_scope_digest: finalizedScope.tool_scope_digest,
    })
    await arming
    await replacement

    expect(revoke).toHaveBeenCalledTimes(2)
    expect(readiness).toHaveBeenCalledTimes(2)
    expect(initiate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith('https://identity.example/authorize')
    expect(socketFactory).not.toHaveBeenCalled()
    expect(channel.getView().status).toBe('connecting')
  })

  it('revokes server authority when an authorized socket cannot be constructed', async () => {
    const registry = registryWithTool()
    const armClient = readyArmClient(registry)
    const channel = new WebMcpControlChannel({
      registry,
      armClient,
      socketFactory: () => {
        throw new Error('Synthetic socket failure')
      },
    })

    await channel.arm()

    expect(armClient.revoke).toHaveBeenCalledOnce()
    expect(channel.getView().status).toBe('error')
  })

  it('revokes server authority when the socket fails before readiness', async () => {
    const { channel, socket, armClient } = channelWithSocket()
    await channel.arm()

    socket.onerror?.(new Event('error'))

    expect(channel.getView()).toMatchObject({ status: 'connecting', message: 'Revoking browser control authority.' })
    await vi.waitFor(() => {
      expect(channel.getView()).toMatchObject({ status: 'error', message: 'The browser control channel failed.' })
    })
    expect(armClient.revoke).toHaveBeenCalledOnce()
    expect(socket.close).toHaveBeenCalledWith(1008, 'protocol-error')
  })

  it('revokes the channel immediately when the active generation changes', async () => {
    const registry = registryWithTool()
    const { channel, socket } = await openChannel(registry)

    registry.replaceToolSet('page', [readTool('agent-webui.changed')])

    expect(socket.close).toHaveBeenCalledWith(1000, 'generation-change')
    await vi.waitFor(() => {
      expect(channel.getView().status).toBe('idle')
    })
    expect(channel.getView().toolIds).toEqual([])
  })

  it('closes when a generation changes while the channel is being constructed', async () => {
    const registry = registryWithTool()
    const socket = new FakeSocket()
    const channel = new WebMcpControlChannel({
      registry,
      armClient: readyArmClient(registry),
      socketFactory: (() => {
        registry.replaceToolSet('page', [readTool('agent-webui.changed-during-open')])
        return socket
      }) as unknown as WebMcpSocketFactory,
    })

    await channel.arm()

    expect(socket.close).toHaveBeenCalledWith(1000, 'generation-change')
    expect(channel.getView()).toMatchObject({ status: 'idle', toolIds: [] })
    socket.open()
    expect(socket.sent).toEqual([])
  })

  it('ignores delayed events from a retired socket after a new generation is armed', async () => {
    const registry = registryWithTool()
    const firstSocket = new FakeSocket()
    const secondSocket = new FakeSocket()
    const sockets = [firstSocket, secondSocket]
    const channel = new WebMcpControlChannel({
      registry,
      armClient: readyArmClient(registry),
      socketFactory: (() => {
        const socket = sockets.shift()
        if (!socket) throw new Error('No synthetic socket remains')
        return socket
      }) as unknown as WebMcpSocketFactory,
    })
    await channel.arm()
    firstSocket.open()
    firstSocket.ready()
    await Promise.resolve()
    registry.replaceToolSet('page', [readTool('agent-webui.current')])
    await channel.arm()
    secondSocket.open()
    secondSocket.ready()
    await Promise.resolve()

    firstSocket.receive({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.call',
      call_id: 'stale-call',
      lease_id: 'stale-lease',
      tool_id: 'agent-webui.current',
      arguments: {},
      authorization: 'read',
    })
    firstSocket.onerror?.(new Event('error'))

    await Promise.resolve()
    expect(channel.getView().status).toBe('armed')
    expect(secondSocket.close).not.toHaveBeenCalled()
    expect(secondSocket.sent.map((frame) => (JSON.parse(frame) as { type: unknown }).type)).toEqual([
      'channel.open',
      'catalog.register',
    ])
  })

  it('fails closed while hidden or when the tools Permissions Policy is absent', async () => {
    const socketFactory = vi.fn(() => new FakeSocket()) as unknown as WebMcpSocketFactory
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    const hiddenRegistry = registryWithTool()
    const hidden = new WebMcpControlChannel({
      registry: hiddenRegistry,
      armClient: readyArmClient(hiddenRegistry),
      socketFactory,
    })
    await hidden.arm()
    expect(hidden.getView()).toMatchObject({ status: 'unavailable' })

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    Object.defineProperty(document, 'permissionsPolicy', { configurable: true, value: undefined })
    const unpermittedRegistry = registryWithTool()
    const unpermitted = new WebMcpControlChannel({
      registry: unpermittedRegistry,
      armClient: readyArmClient(unpermittedRegistry),
      socketFactory,
    })
    await unpermitted.arm()

    expect(unpermitted.getView()).toMatchObject({ status: 'unavailable' })
    expect(socketFactory).not.toHaveBeenCalled()
  })

  it('does not report armed or accept calls before the exact server readiness acknowledgement', async () => {
    const { channel, socket } = channelWithSocket()
    await channel.arm()
    socket.open()
    expect(channel.getView().status).toBe('connected')

    socket.receive({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.call',
      call_id: 'premature-call',
      lease_id: 'premature-lease',
      tool_id: 'agent-webui.read',
      arguments: {},
      authorization: 'read',
    })

    await vi.waitFor(() => {
      expect(channel.getView().status).toBe('error')
    })
    expect(socket.close).toHaveBeenCalledWith(1008, 'protocol-error')
  })

  it('refuses a Graph OS readiness receipt with a tampered catalog digest', async () => {
    const { channel, socket } = channelWithSocket()
    await channel.arm()
    socket.open()
    const opened = JSON.parse(socket.sent[0]) as { route_id: string; registration_generation: number }
    const catalog = JSON.parse(socket.sent[1]) as { tool_scope_digest: string }

    socket.receive({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'channel.ready',
      authority: 'graph-os',
      route_id: opened.route_id,
      registration_generation: opened.registration_generation,
      catalog_digest: `sha256:${'0'.repeat(64)}`,
      tool_scope_digest: catalog.tool_scope_digest,
    })

    await vi.waitFor(() => {
      expect(channel.getView().status).toBe('error')
    })
    expect(socket.close).toHaveBeenCalledWith(1008, 'protocol-error')
  })

  it('refuses protocol-invalid server messages and closes the channel', async () => {
    const { channel, socket } = await openChannel()

    socket.receive({ protocol: WEBMCP_CONTROL_PROTOCOL, type: 'control.raw', token: 'forbidden' })
    await vi.waitFor(() => {
      expect(channel.getView()).toMatchObject({ status: 'error', message: 'The browser control request was refused.' })
    })
    expect(socket.close).toHaveBeenCalledWith(1008, 'protocol-error')
  })

  it('rejects duplicate decoded keys before channel message validation', async () => {
    const { channel, socket } = await openChannel()

    socket.receiveRaw(
      `{"protocol":"${WEBMCP_CONTROL_PROTOCOL}","type":"control.cancel","call_id":"first","call_\\u0069d":"second","reason":"lease_revoked"}`,
    )

    await vi.waitFor(() => {
      expect(channel.getView().status).toBe('error')
    })
    expect(socket.close).toHaveBeenCalledWith(1008, 'protocol-error')
  })

  it('revokes an armed channel when the document becomes hidden', async () => {
    const { channel, socket } = await openChannel()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(socket.close).toHaveBeenCalledWith(1000, 'document-hidden')
    await vi.waitFor(() => {
      expect(channel.getView().status).toBe('idle')
    })
  })

  it('does not present failed server authority revocation as successful cleanup', async () => {
    const registry = registryWithTool()
    const socket = new FakeSocket()
    const armClient = readyArmClient(registry)
    vi.mocked(armClient.revoke).mockRejectedValueOnce(new Error('Synthetic authority failure'))
    const channel = new WebMcpControlChannel({
      registry,
      armClient,
      socketFactory: (() => socket) as unknown as WebMcpSocketFactory,
    })
    await channel.arm()
    socket.open()
    socket.ready()
    await vi.waitFor(() => {
      expect(channel.getView().status).toBe('armed')
    })

    channel.revoke()
    expect(channel.getView()).toMatchObject({ status: 'connecting', message: 'Revoking browser control authority.' })
    await vi.waitFor(() => {
      expect(channel.getView()).toMatchObject({
        status: 'error',
        message: 'Browser control authority could not be revoked.',
      })
    })
  })

  it('retires cleanly when the socket disappears before a cancellation report can be sent', async () => {
    const { channel, socket, armClient } = await openChannel()

    expect(() => {
      socket.disconnect()
    }).not.toThrow()
    expect(channel.getView()).toMatchObject({ status: 'connecting', message: 'Revoking browser control authority.' })
    await vi.waitFor(() => {
      expect(channel.getView()).toMatchObject({ status: 'idle', message: 'Browser control was disconnected.' })
    })
    expect(armClient.revoke).toHaveBeenCalledOnce()
  })
})
