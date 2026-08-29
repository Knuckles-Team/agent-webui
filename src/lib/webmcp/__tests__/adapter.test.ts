import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { detectWebMcpAdapter, registerWebMcpTools } from '../adapter'
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

    const cleanup = registerWebMcpTools(adapter, [tool])
    expect(registerTool).toHaveBeenCalledOnce()
    const signal = registerTool.mock.calls[0]?.[0]
    if (!signal) throw new Error('registration signal was not captured')
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)

    cleanup()
    expect(signal.aborted).toBe(true)
    await Promise.resolve()
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

  it('rejects output above the browser-agent character budget', async () => {
    const execute = createValidatedExecutor(z.object({}).strict(), z.object({ value: z.string() }).strict(), () => ({
      value: 'x'.repeat(WEBMCP_OUTPUT_CHARACTER_BUDGET),
    }))

    await expect(execute({}, executionOptions())).rejects.toThrow('output exceeded')
  })
})
