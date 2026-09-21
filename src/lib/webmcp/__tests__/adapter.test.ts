import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { createUnavailableWebMcpRegistration, detectWebMcpAdapter, registerWebMcpTools } from '../adapter'
import { createValidatedExecutor, WEBMCP_OUTPUT_CHARACTER_BUDGET } from '../validation'
import type { WebMcpAdapter, WebMcpToolDefinition } from '../types'

function executionOptions(): { signal: AbortSignal } {
  return { signal: new AbortController().signal }
}

describe('experimental WebMCP adapter', () => {
  it('is a no-op when document.modelContext is absent', () => {
    expect(detectWebMcpAdapter({} as Document)).toBeNull()
  })

  it('passes the registration signal and aborts it during cleanup', async () => {
    const registerTool = vi.fn((signal: AbortSignal) => {
      void signal
      return Promise.resolve()
    })
    const adapter: WebMcpAdapter = {
      version: 'document-model-context-2026-08-26',
      registerTool: (tool, signal) => {
        void tool
        void registerTool(signal)
        return Promise.resolve()
      },
    }
    const tool: WebMcpToolDefinition = {
      name: 'agent-webui.test',
      description: 'test',
      inputSchema: { type: 'object' },
      execute: async () => ({ ok: true }),
    }

    const registration = registerWebMcpTools(adapter, [tool])
    expect(registerTool).toHaveBeenCalledOnce()
    const signal = registerTool.mock.calls[0]?.[0]
    if (!signal) throw new Error('registration signal was not captured')
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)

    registration()
    expect(signal.aborted).toBe(true)
    await Promise.resolve()
    expect(registration.getSnapshot().activeToolNames).toEqual([])
    expect(registration.getSnapshot().statusByTool['agent-webui.test']).toBe('aborted')
  })

  it('acknowledges only settled registrations and keeps pending tools unavailable', async () => {
    let acknowledge: (() => void) | undefined
    const adapter: WebMcpAdapter = {
      version: 'document-model-context-2026-08-26',
      registerTool: async () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve
        }),
    }
    const tool: WebMcpToolDefinition = {
      name: 'agent-webui.pending',
      description: 'pending',
      inputSchema: { type: 'object' },
      execute: async () => ({ ok: true }),
    }

    const registration = registerWebMcpTools(adapter, [tool])
    expect(registration.getSnapshot()).toMatchObject({
      activeToolNames: [],
      unavailableToolNames: ['agent-webui.pending'],
      statusByTool: { 'agent-webui.pending': 'pending' },
    })

    acknowledge?.()
    await expect(registration.acknowledged).resolves.toMatchObject({
      generation: registration.generation,
      activeToolNames: ['agent-webui.pending'],
      unavailableToolNames: [],
      statusByTool: { 'agent-webui.pending': 'active' },
    })
  })

  it('reports failed registrations and never promotes them to active', async () => {
    const adapter: WebMcpAdapter = {
      version: 'document-model-context-2026-08-26',
      registerTool: async () => {
        throw new Error('permission denied')
      },
    }
    const tool: WebMcpToolDefinition = {
      name: 'agent-webui.failed',
      description: 'failed',
      inputSchema: { type: 'object' },
      execute: async () => ({ ok: true }),
    }

    const registration = registerWebMcpTools(adapter, [tool])
    const snapshot = await registration.acknowledged
    expect(snapshot.activeToolNames).toEqual([])
    expect(snapshot.unavailableToolNames).toEqual(['agent-webui.failed'])
    expect(snapshot.statusByTool['agent-webui.failed']).toBe('failed')
    expect(snapshot.errorByTool['agent-webui.failed']).toBe('permission denied')
  })

  it('makes unsupported registration explicit instead of fabricating active evidence', async () => {
    const tool: WebMcpToolDefinition = {
      name: 'agent-webui.unsupported',
      description: 'unsupported',
      inputSchema: { type: 'object' },
      execute: async () => ({ ok: true }),
    }
    const registration = createUnavailableWebMcpRegistration([tool])
    await expect(registration.acknowledged).resolves.toMatchObject({
      activeToolNames: [],
      unavailableToolNames: ['agent-webui.unsupported'],
      statusByTool: { 'agent-webui.unsupported': 'unavailable' },
    })
  })
})

describe('WebMCP input/output validation', () => {
  const inputSchema = z.object({ path: z.string().min(1) }).strict()
  const outputSchema = z.object({ accepted: z.literal(true) }).strict()

  it('accepts object and JSON-string input forms', async () => {
    const signals: AbortSignal[] = []
    const execute = createValidatedExecutor(inputSchema, outputSchema, ({ path }, { signal }) => {
      expect(path).toBe('/graph')
      signals.push(signal)
      return { accepted: true }
    })

    await expect(execute({ path: '/graph' }, executionOptions())).resolves.toEqual({ accepted: true })
    await expect(execute('{"path":"/graph"}', executionOptions())).resolves.toEqual({ accepted: true })
    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true)
  })

  it('rejects duplicate-key compatibility JSON before schema validation', async () => {
    const execute = createValidatedExecutor(inputSchema, outputSchema, () => ({ accepted: true as const }))

    await expect(execute('{"path":"/graph","p\\u0061th":"/other"}', executionOptions())).rejects.toThrow(
      'duplicate keys',
    )
  })

  it.each([1.5, 9_007_199_254_740_992, '\uD800'])('rejects non-canonical local input and output %s', async (value) => {
    const permissiveInput = z.object({ value: z.unknown() }).strict()
    const permissiveOutput = z.object({ value: z.unknown() }).strict()
    const execute = createValidatedExecutor(permissiveInput, permissiveOutput, ({ value: result }) => ({
      value: result,
    }))

    await expect(execute({ value }, executionOptions())).rejects.toThrow()
    await expect(execute({ value: 'safe' }, executionOptions())).resolves.toEqual({ value: 'safe' })

    const invalidOutput = createValidatedExecutor(z.object({}).strict(), permissiveOutput, () => ({ value }))
    await expect(invalidOutput({}, executionOptions())).rejects.toThrow()
  })

  it('rejects extra input fields and invalid output', async () => {
    const execute = createValidatedExecutor(inputSchema, outputSchema, () => ({ accepted: false }))
    await expect(execute({ path: '/graph', extra: true }, executionOptions())).rejects.toThrow()
    await expect(execute({ path: '/graph' }, executionOptions())).rejects.toThrow()
  })

  it('propagates execution cancellation and rejects work after abort', async () => {
    const controller = new AbortController()
    const handler = vi.fn(() => ({ accepted: true as const }))
    const execute = createValidatedExecutor(inputSchema, outputSchema, handler)
    controller.abort()

    await expect(execute({ path: '/graph' }, { signal: controller.signal })).rejects.toThrow('execution was cancelled')
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not claim a completed local dispatch was rolled back by a later abort', async () => {
    const controller = new AbortController()
    const execute = createValidatedExecutor(inputSchema, outputSchema, () => {
      controller.abort()
      return { accepted: true as const }
    })

    await expect(execute({ path: '/graph' }, { signal: controller.signal })).resolves.toEqual({ accepted: true })
  })

  it('rejects output above the browser-agent character budget', async () => {
    const execute = createValidatedExecutor(z.object({}).strict(), z.object({ value: z.string() }).strict(), () => ({
      value: 'x'.repeat(WEBMCP_OUTPUT_CHARACTER_BUDGET),
    }))

    await expect(execute({}, executionOptions())).rejects.toThrow('output exceeded')
  })

  it('measures the output boundary as UTF-8 bytes', async () => {
    const execute = createValidatedExecutor(z.object({}).strict(), z.object({ value: z.string() }).strict(), () => ({
      value: '🙂'.repeat(700),
    }))

    await expect(execute({}, executionOptions())).rejects.toThrow('byte budget')
  })
})
