import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { RemoteWebMcpDispatcher, type WebMcpBrowserMessage } from '../bridge'
import { WEBMCP_CONTROL_PROTOCOL } from '../catalog'
import type { WebMcpPendingProposal } from '../proposal'
import { ActiveWebMcpRegistry } from '../registry'
import { createValidatedExecutor } from '../validation'

async function fixture() {
  const execute = vi.fn(async () => ({ ok: true }))
  const registry = new ActiveWebMcpRegistry({
    documentId: 'doc',
    routeId: 'atlas',
    route: '/atlas',
    identityClaim: 'owner',
    role: 'operator',
  })
  registry.replaceToolSet('navigation', [
    {
      name: 'navigate',
      title: 'Navigate',
      description: 'Synthetic navigation',
      inputSchema: {
        type: 'object',
        properties: { target: { type: 'string' } },
        required: ['target'],
        additionalProperties: false,
      },
      capability: {
        version: '1.0.0',
        outputSchema: { type: 'object' },
        mutationClass: 'local-ui-mutation',
        confirmationPolicy: 'exact-request',
        source: 'agent-webui:test',
      },
      execute: createValidatedExecutor(
        z.object({ target: z.string() }).strict(),
        z.object({ ok: z.boolean() }),
        execute,
      ),
    },
  ])
  const snapshot = await registry.snapshot()
  const sent: WebMcpBrowserMessage[] = []
  const changes: (WebMcpPendingProposal | null)[] = []
  const dispatcher = new RemoteWebMcpDispatcher({
    registry,
    registrationGeneration: snapshot.generation,
    send: (message) => sent.push(message),
    onProposalChange: (proposal) => changes.push(proposal),
  })
  const request = {
    protocol: WEBMCP_CONTROL_PROTOCOL,
    type: 'control.proposal_request',
    proposal_id: 'proposal-1',
    proposal_digest: `sha256:${'a'.repeat(64)}`,
    registration_generation: snapshot.generation,
    tool_id: 'navigate',
    schema_digest: snapshot.catalog.tools[0]!.schemaDigest,
    arguments: { target: '/atlas?tip=branch-2' },
    requester_agent: 'web-agent',
    requester_run_ref: 'run-1',
    expires_at: Math.floor(Date.now() / 1_000) + 30,
  }
  return { registry, dispatcher, request, execute, sent, changes }
}

afterEach(() => vi.useRealTimers())

describe('attended agent proposals', () => {
  it.each([true, false])(
    'returns human decision %s exactly once without executing or confirming a mutation',
    async (accepted) => {
      const { dispatcher, request, execute, sent, changes } = await fixture()
      await dispatcher.accept(request)
      expect(changes.at(-1)).toMatchObject({
        toolId: 'navigate',
        requesterAgent: 'web-agent',
        requesterRunRef: 'run-1',
        argumentsJson: JSON.stringify(request.arguments),
      })
      expect(sent).toEqual([])
      dispatcher.respondProposal(request.proposal_id, accepted)
      expect(sent).toEqual([
        {
          protocol: WEBMCP_CONTROL_PROTOCOL,
          type: 'control.proposal_response',
          proposal_id: request.proposal_id,
          proposal_digest: request.proposal_digest,
          accepted,
        },
      ])
      expect(changes.at(-1)).toBeNull()
      expect(() => {
        dispatcher.respondProposal(request.proposal_id, accepted)
      }).toThrow()
      await expect(dispatcher.accept(request)).rejects.toThrow('terminal')
      await expect(
        dispatcher.accept({
          protocol: WEBMCP_CONTROL_PROTOCOL,
          type: 'control.call',
          call_id: 'call-1',
          lease_id: 'lease-1',
          tool_id: 'navigate',
          arguments: request.arguments,
          authorization: 'confirmed_mutation',
          confirmation_digest: request.proposal_digest,
        }),
      ).rejects.toThrow('exact-request confirmation')
      expect(execute).not.toHaveBeenCalled()
      dispatcher.close()
    },
  )

  it('still executes only after a separate exact mutation confirmation and later control.call', async () => {
    const { dispatcher, request, execute } = await fixture()
    await dispatcher.accept(request)
    dispatcher.respondProposal(request.proposal_id, true)
    const call = {
      protocol: WEBMCP_CONTROL_PROTOCOL,
      call_id: 'call-1',
      lease_id: 'lease-1',
      tool_id: request.tool_id,
      arguments: request.arguments,
      confirmation_digest: `sha256:${'b'.repeat(64)}`,
    }
    await dispatcher.accept({ ...call, type: 'control.confirmation_request' })
    expect(execute).not.toHaveBeenCalled()
    dispatcher.confirm('call-1')
    expect(execute).not.toHaveBeenCalled()
    await dispatcher.accept({ ...call, type: 'control.call', authorization: 'confirmed_mutation' })
    expect(execute).toHaveBeenCalledOnce()
    dispatcher.close()
  })

  it.each(['expiry', 'withdrawal', 'retirement', 'close'])('drops pending attention on %s', async (reason) => {
    const { dispatcher, registry, request, changes, sent, execute } = await fixture()
    vi.useFakeTimers()
    await dispatcher.accept(request)
    if (reason === 'expiry') vi.advanceTimersByTime(31_000)
    if (reason === 'withdrawal')
      await dispatcher.accept({
        protocol: WEBMCP_CONTROL_PROTOCOL,
        type: 'control.proposal_withdrawn',
        proposal_id: request.proposal_id,
        reason: 'run_cancelled',
      })
    if (reason === 'retirement') registry.retire('provider-unmount')
    if (reason === 'close') dispatcher.close()
    expect(changes.at(-1)).toBeNull()
    expect(() => {
      dispatcher.respondProposal(request.proposal_id, true)
    }).toThrow()
    expect(sent).toEqual([])
    expect(execute).not.toHaveBeenCalled()
    dispatcher.close()
  })

  it.each(['generation', 'schema', 'arguments', 'expired', 'duplicate'])(
    'rejects invalid %s before presenting or executing',
    async (invalid) => {
      const { dispatcher, request, changes, execute } = await fixture()
      const altered = { ...request }
      if (invalid === 'generation') altered.registration_generation++
      if (invalid === 'schema') altered.schema_digest = `sha256:${'f'.repeat(64)}`
      if (invalid === 'arguments') Object.assign(altered, { arguments: { target: 3 } })
      if (invalid === 'expired') altered.expires_at = Date.now() / 1_000 - 1
      if (invalid === 'duplicate') {
        await dispatcher.accept(request)
        dispatcher.respondProposal(request.proposal_id, false)
        changes.length = 0
      }
      await expect(dispatcher.accept(altered)).rejects.toThrow()
      expect(changes).toEqual([])
      expect(execute).not.toHaveBeenCalled()
      dispatcher.close()
    },
  )

  it('does not resurrect a proposal whose withdrawal arrived before preparation', async () => {
    const { dispatcher, request, changes, execute } = await fixture()
    await dispatcher.accept({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.proposal_withdrawn',
      proposal_id: request.proposal_id,
      reason: 'run_cancelled',
    })
    await expect(dispatcher.accept(request)).rejects.toThrow('terminal')
    expect(changes).toEqual([])
    expect(execute).not.toHaveBeenCalled()
    dispatcher.close()
  })

  it('withdraws a proposal while catalog validation is in flight', async () => {
    const { dispatcher, registry, request, changes } = await fixture()
    const original = registry.snapshot.bind(registry)
    let release!: () => void
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(registry, 'snapshot').mockImplementation(async (generation) => {
      await paused
      return original(generation)
    })
    const accepting = dispatcher.accept(request)
    await dispatcher.accept({
      protocol: WEBMCP_CONTROL_PROTOCOL,
      type: 'control.proposal_withdrawn',
      proposal_id: request.proposal_id,
      reason: 'run_cancelled',
    })
    release()
    await accepting
    expect(changes).toEqual([])
    expect(() => {
      dispatcher.respondProposal(request.proposal_id, true)
    }).toThrow()
    dispatcher.close()
  })
})
