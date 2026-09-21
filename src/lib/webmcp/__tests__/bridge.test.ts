import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { WEBMCP_CONTROL_PROTOCOL, type WebMcpCatalogBinding } from '../catalog'
import { RemoteWebMcpDispatcher, type WebMcpBrowserMessage, type WebMcpPendingConfirmation } from '../bridge'
import { ActiveWebMcpRegistry } from '../registry'
import type { WebMcpToolDefinition } from '../types'
import { createValidatedExecutor } from '../validation'

const BINDING: WebMcpCatalogBinding = {
  documentId: 'document-1',
  routeId: 'atlas',
  route: '/atlas',
  identityClaim: 'operator-1',
  role: 'operator',
}

function tool(options: {
  id: string
  mutating?: boolean
  execute?: WebMcpToolDefinition['execute']
}): WebMcpToolDefinition {
  const mutating = options.mutating ?? false
  return {
    name: options.id,
    title: `Title ${options.id}`,
    description: 'Synthetic local browser tool',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } }, additionalProperties: false },
    annotations: { readOnlyHint: !mutating },
    capability: {
      version: '1.0.0',
      outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, additionalProperties: false },
      mutationClass: mutating ? 'local-ui-mutation' : 'read',
      confirmationPolicy: mutating ? 'exact-request' : 'none',
      source: 'agent-webui:test',
    },
    execute: createValidatedExecutor(
      z.record(z.string(), z.unknown()),
      z.unknown(),
      options.execute ?? vi.fn(async () => ({ ok: true })),
    ),
  }
}

async function dispatcherFor(definitions: readonly WebMcpToolDefinition[]): Promise<{
  dispatcher: RemoteWebMcpDispatcher
  generation: number
  registry: ActiveWebMcpRegistry
  sent: WebMcpBrowserMessage[]
  confirmations: (WebMcpPendingConfirmation | null)[]
}> {
  const registry = new ActiveWebMcpRegistry(BINDING)
  registry.replaceToolSet('test', definitions)
  const { generation } = await registry.snapshot()
  const sent: WebMcpBrowserMessage[] = []
  const confirmations: (WebMcpPendingConfirmation | null)[] = []
  return {
    registry,
    generation,
    sent,
    confirmations,
    dispatcher: new RemoteWebMcpDispatcher({
      registry,
      registrationGeneration: generation,
      send: (message) => sent.push(message),
      onConfirmationChange: (confirmation) => confirmations.push(confirmation),
    }),
  }
}

describe('remote WebMCP exact-generation dispatcher', () => {
  it('routes a read through the retained validated definition', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const { dispatcher, sent } = await dispatcherFor([tool({ id: 'agent-webui.read', execute })])

    await dispatcher.accept({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.call',
      call_id: 'call-1',
      lease_id: 'lease-1',
      tool_id: 'agent-webui.read',
      arguments: { value: 'safe' },
      authorization: 'read',
    })

    expect(execute).toHaveBeenCalledOnce()
    expect(sent).toEqual([
      {
        protocol: WEBMCP_CONTROL_PROTOCOL,
        type: 'control.result',
        call_id: 'call-1',
        status: 'succeeded',
        result: { ok: true },
      },
    ])
  })

  it('enforces UTF-8 argument and result bounds at the remote dispatcher', async () => {
    const oversizedResult = vi.fn(async () => ({ value: '🙂'.repeat(700) }))
    const resultFixture = await dispatcherFor([tool({ id: 'agent-webui.read', execute: oversizedResult })])
    await resultFixture.dispatcher.accept({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.call',
      call_id: 'call-result-bound',
      lease_id: 'lease-result-bound',
      tool_id: 'agent-webui.read',
      arguments: { value: 'safe' },
      authorization: 'read',
    })
    expect(resultFixture.sent).toContainEqual({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.result',
      call_id: 'call-result-bound',
      status: 'failed',
      error_code: 'browser_execution_failed',
    })

    const execute = vi.fn(async () => ({ ok: true }))
    const argumentFixture = await dispatcherFor([tool({ id: 'agent-webui.read', execute })])
    await expect(
      argumentFixture.dispatcher.accept({
        protocol: WEBMCP_CONTROL_PROTOCOL,
        type: 'control.call',
        call_id: 'call-argument-bound',
        lease_id: 'lease-argument-bound',
        tool_id: 'agent-webui.read',
        arguments: { value: '🙂'.repeat(2_100) },
        authorization: 'read',
      }),
    ).rejects.toThrow('arguments exceeded')
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([1.5, 9_007_199_254_740_992, '\uD800'])('rejects non-canonical call arguments %s', async (value) => {
    const execute = vi.fn(async () => ({ ok: true }))
    const { dispatcher } = await dispatcherFor([tool({ id: 'agent-webui.read', execute })])

    await expect(
      dispatcher.accept({
        protocol: WEBMCP_CONTROL_PROTOCOL,
        type: 'control.call',
        call_id: 'call-invalid-argument',
        lease_id: 'lease-invalid-argument',
        tool_id: 'agent-webui.read',
        arguments: { value },
        authorization: 'read',
      }),
    ).rejects.toThrow()
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([1.5, 9_007_199_254_740_992, '\uD800'])(
    'reports non-canonical execution results %s as failed',
    async (value) => {
      const execute = vi.fn(async () => ({ value }))
      const fixture = await dispatcherFor([tool({ id: 'agent-webui.read', execute })])

      await fixture.dispatcher.accept({
        protocol: WEBMCP_CONTROL_PROTOCOL,
        type: 'control.call',
        call_id: 'call-invalid-result',
        lease_id: 'lease-invalid-result',
        tool_id: 'agent-webui.read',
        arguments: { value: 'safe' },
        authorization: 'read',
      })

      expect(fixture.sent).toEqual([
        {
          protocol: WEBMCP_CONTROL_PROTOCOL,
          type: 'control.result',
          call_id: 'call-invalid-result',
          status: 'failed',
          error_code: 'browser_execution_failed',
        },
      ])
    },
  )

  it('uses a two-phase exact-request confirmation before a mutation', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const { dispatcher, sent, confirmations } = await dispatcherFor([
      tool({ id: 'agent-webui.mutate', mutating: true, execute }),
    ])
    const request = {
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.confirmation_request' as const,
      call_id: 'call-2',
      lease_id: 'lease-2',
      tool_id: 'agent-webui.mutate',
      arguments: { value: 'bounded' },
      confirmation_digest: `sha256:${'a'.repeat(64)}`,
    }

    await dispatcher.accept(request)
    expect(execute).not.toHaveBeenCalled()
    expect(confirmations.at(-1)).toMatchObject({
      callId: 'call-2',
      leaseId: 'lease-2',
      toolId: 'agent-webui.mutate',
      toolVersion: '1.0.0',
      argumentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      schemaDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    })

    dispatcher.confirm('call-2')
    expect(sent[0]).toEqual({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.confirm',
      call_id: 'call-2',
      confirmation_digest: request.confirmation_digest,
    })
    expect(execute).not.toHaveBeenCalled()

    await dispatcher.accept({
      ...request,
      type: 'control.call',
      authorization: 'confirmed_mutation',
    })
    expect(execute).toHaveBeenCalledOnce()
    expect(sent[1]).toMatchObject({ type: 'control.result', call_id: 'call-2', status: 'succeeded' })
  })

  it('refuses a mutation when arguments change after confirmation', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const { dispatcher } = await dispatcherFor([tool({ id: 'agent-webui.mutate', mutating: true, execute })])
    const digest = `sha256:${'b'.repeat(64)}`
    await dispatcher.accept({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.confirmation_request',
      call_id: 'call-3',
      lease_id: 'lease-3',
      tool_id: 'agent-webui.mutate',
      arguments: { value: 'before' },
      confirmation_digest: digest,
    })
    dispatcher.confirm('call-3')

    await expect(
      dispatcher.accept({
        protocol: WEBMCP_CONTROL_PROTOCOL,
        type: 'control.call',
        call_id: 'call-3',
        lease_id: 'lease-3',
        tool_id: 'agent-webui.mutate',
        arguments: { value: 'after' },
        confirmation_digest: digest,
        authorization: 'confirmed_mutation',
      }),
    ).rejects.toThrow('exact-request')
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not recreate a confirmation after the operator denied that call ID', async () => {
    const fixture = await dispatcherFor([tool({ id: 'agent-webui.mutate', mutating: true })])
    const request = {
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.confirmation_request' as const,
      call_id: 'call-denied-terminally',
      lease_id: 'lease-denied-terminally',
      tool_id: 'agent-webui.mutate',
      arguments: { value: 'safe' },
      confirmation_digest: `sha256:${'9'.repeat(64)}`,
    }
    await fixture.dispatcher.accept(request)
    fixture.dispatcher.deny(request.call_id)

    await expect(fixture.dispatcher.accept(request)).rejects.toThrow('is terminal')
    expect(fixture.confirmations.filter((confirmation) => confirmation !== null)).toHaveLength(1)
    expect(fixture.sent).toEqual([
      {
        protocol: WEBMCP_CONTROL_PROTOCOL,
        type: 'control.cancelled',
        call_id: request.call_id,
        effect: 'none',
      },
    ])
  })

  it('refuses a call after the active generation changes', async () => {
    const first = tool({ id: 'agent-webui.first' })
    const { dispatcher, registry } = await dispatcherFor([first])
    registry.replaceToolSet('test', [tool({ id: 'agent-webui.second' })])

    await expect(
      dispatcher.accept({
        protocol: WEBMCP_CONTROL_PROTOCOL,
        type: 'control.call',
        call_id: 'call-4',
        lease_id: 'lease-4',
        tool_id: first.name,
        arguments: { value: 'safe' },
        authorization: 'read',
      }),
    ).rejects.toThrow('Stale')
  })

  it('reports an honest unknown effect when cancellation races a mutation', async () => {
    const execute = vi.fn(
      (_input: unknown, { signal }: { signal: AbortSignal }) =>
        new Promise<unknown>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('cancelled', 'AbortError'))
          })
        }),
    )
    const { dispatcher, sent } = await dispatcherFor([tool({ id: 'agent-webui.mutate', mutating: true, execute })])
    const confirmationDigest = `sha256:${'c'.repeat(64)}`
    await dispatcher.accept({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.confirmation_request',
      call_id: 'call-5',
      lease_id: 'lease-5',
      tool_id: 'agent-webui.mutate',
      arguments: { value: 'safe' },
      confirmation_digest: confirmationDigest,
    })
    dispatcher.confirm('call-5')
    const running = dispatcher.accept({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.call',
      call_id: 'call-5',
      lease_id: 'lease-5',
      tool_id: 'agent-webui.mutate',
      arguments: { value: 'safe' },
      confirmation_digest: confirmationDigest,
      authorization: 'confirmed_mutation',
    })
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledOnce()
    })
    await dispatcher.accept({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.cancel',
      call_id: 'call-5',
      reason: 'operator_cancelled',
    })
    await running

    expect(sent.at(-1)).toEqual({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.cancelled',
      call_id: 'call-5',
      effect: 'unknown',
    })
    expect(sent.filter((message) => message.type === 'control.cancelled')).toHaveLength(1)
  })

  it('honors cancellation while a call is still authorizing', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const { dispatcher, sent } = await dispatcherFor([tool({ id: 'agent-webui.read', execute })])
    const call = {
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.call' as const,
      call_id: 'call-reserved',
      lease_id: 'lease-reserved',
      tool_id: 'agent-webui.read',
      arguments: { value: 'safe' },
      authorization: 'read' as const,
    }

    const dispatching = dispatcher.accept(call)
    await dispatcher.accept({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.cancel',
      call_id: call.call_id,
      reason: 'operator_cancelled',
    })
    await dispatching

    expect(execute).not.toHaveBeenCalled()
    expect(sent).toContainEqual({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.cancelled',
      call_id: call.call_id,
      effect: 'none',
    })
  })

  it('does not publish confirmation UI when cancellation arrives while its binding is prepared', async () => {
    const fixture = await dispatcherFor([tool({ id: 'agent-webui.mutate', mutating: true })])
    const originalSnapshot = fixture.registry.snapshot.bind(fixture.registry)
    let releaseSnapshot: (() => void) | undefined
    let reportSnapshotStarted: (() => void) | undefined
    const snapshotStarted = new Promise<void>((resolve) => {
      reportSnapshotStarted = resolve
    })
    vi.spyOn(fixture.registry, 'snapshot').mockImplementationOnce(async (expectedGeneration) => {
      reportSnapshotStarted?.()
      await new Promise<void>((resolve) => {
        releaseSnapshot = resolve
      })
      return originalSnapshot(expectedGeneration)
    })
    const callId = 'call-cancelled-while-preparing'
    const preparing = fixture.dispatcher.accept({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.confirmation_request',
      call_id: callId,
      lease_id: 'lease-cancelled-while-preparing',
      tool_id: 'agent-webui.mutate',
      arguments: { value: 'safe' },
      confirmation_digest: `sha256:${'8'.repeat(64)}`,
    })
    await snapshotStarted

    await fixture.dispatcher.accept({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.cancel',
      call_id: callId,
      reason: 'lease_revoked',
    })
    releaseSnapshot?.()
    await preparing

    expect(fixture.confirmations.filter((confirmation) => confirmation !== null)).toEqual([])
    expect(fixture.sent).toEqual([
      {
        protocol: WEBMCP_CONTROL_PROTOCOL,
        type: 'control.cancelled',
        call_id: callId,
        effect: 'none',
      },
    ])
  })

  it('reserves a call ID before async authorization to prevent concurrent dispatch', async () => {
    let finish: (() => void) | undefined
    const execute = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          finish = () => {
            resolve({ ok: true })
          }
        }),
    )
    const { dispatcher } = await dispatcherFor([tool({ id: 'agent-webui.read', execute })])
    const call = {
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.call' as const,
      call_id: 'call-duplicate',
      lease_id: 'lease-duplicate',
      tool_id: 'agent-webui.read',
      arguments: { value: 'safe' },
      authorization: 'read' as const,
    }

    const first = dispatcher.accept(call)
    await expect(dispatcher.accept(call)).rejects.toThrow('already running')
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledOnce()
    })
    finish?.()
    await first
  })

  it('retires an approved mutation when cancellation arrives before dispatch', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const { dispatcher, sent } = await dispatcherFor([tool({ id: 'agent-webui.mutate', mutating: true, execute })])
    const confirmationDigest = `sha256:${'d'.repeat(64)}`
    const request = {
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.confirmation_request' as const,
      call_id: 'call-approved',
      lease_id: 'lease-approved',
      tool_id: 'agent-webui.mutate',
      arguments: { value: 'safe' },
      confirmation_digest: confirmationDigest,
    }
    await dispatcher.accept(request)
    dispatcher.confirm(request.call_id)
    await dispatcher.accept({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.cancel',
      call_id: request.call_id,
      reason: 'lease_revoked',
    })

    await expect(
      dispatcher.accept({ ...request, type: 'control.call', authorization: 'confirmed_mutation' }),
    ).rejects.toThrow('exact-request')
    expect(execute).not.toHaveBeenCalled()
    expect(sent.at(-1)).toMatchObject({ type: 'control.cancelled', call_id: request.call_id, effect: 'none' })
  })

  it('rejects unrecognized or over-specified protocol messages', async () => {
    const { dispatcher } = await dispatcherFor([tool({ id: 'agent-webui.read' })])
    await expect(dispatcher.accept({ protocol: WEBMCP_CONTROL_PROTOCOL, type: 'control.raw' })).rejects.toThrow(
      'Unsupported',
    )
    await expect(
      dispatcher.accept({
        protocol: WEBMCP_CONTROL_PROTOCOL,
        type: 'control.cancel',
        call_id: 'call-6',
        reason: 'cancelled',
        unexpected_field: 'must-not-be-accepted',
      }),
    ).rejects.toThrow()
    await expect(
      dispatcher.accept({
        protocol: WEBMCP_CONTROL_PROTOCOL,
        type: 'control.confirmation_request',
        call_id: 'call-7',
        lease_id: 'lease-7',
        tool_id: 'agent-webui.read',
        arguments: {},
        confirmation_digest: 'a'.repeat(64),
      }),
    ).rejects.toThrow()
  })
})
