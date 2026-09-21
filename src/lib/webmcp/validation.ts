/** Strict runtime validation at the browser-agent boundary. */
import { z } from 'zod'
import type { WebMcpExecutionOptions } from './types'
import { canonicalJson, utf8ByteLength } from './canonical'
import { parseStrictJson } from './strict-json'

const validatedExecutors = new WeakSet<(...args: never[]) => unknown>()

/** The local draft and Graph OS channel both cap serialized results at 1.5 KiB. */
export const WEBMCP_OUTPUT_BYTE_BUDGET = 1_500
export const WEBMCP_OUTPUT_CHARACTER_BUDGET = WEBMCP_OUTPUT_BYTE_BUDGET

function throwIfCancelled(options: WebMcpExecutionOptions): void {
  if (options.signal.aborted) throw new Error('WebMCP tool execution was cancelled')
}

export function parseBoundedWebMcpOutput<Output>(schema: z.ZodType<Output>, rawOutput: unknown): Output {
  const output = schema.parse(rawOutput)
  const serialized = canonicalJson(output)
  if (utf8ByteLength(serialized) > WEBMCP_OUTPUT_BYTE_BUDGET) {
    throw new Error('WebMCP tool output exceeded the public byte budget')
  }
  return output
}

/**
 * The current draft describes an object input, while early implementations
 * have delivered the same JSON as a string. Normalize that one compatibility
 * difference before Zod validation. The shared canonical JSON subset keeps
 * local draft execution and remote governed execution semantically identical.
 */
export function parseWebMcpInput<Input>(schema: z.ZodType<Input>, rawInput: unknown): Input {
  const candidate = typeof rawInput === 'string' ? parseStrictJson(rawInput) : rawInput
  const input = schema.parse(candidate)
  canonicalJson(input)
  return input
}

/** Validate both sides of a tool call; the browser receives only the parsed output. */
export function createValidatedExecutor<Input, Output>(
  inputSchema: z.ZodType<Input>,
  outputSchema: z.ZodType<Output>,
  execute: (input: Input, options: WebMcpExecutionOptions) => Output | PromiseLike<Output>,
): (rawInput: unknown, options: WebMcpExecutionOptions) => Promise<Output> {
  const validated = async (rawInput: unknown, options: WebMcpExecutionOptions): Promise<Output> => {
    throwIfCancelled(options)
    const input = parseWebMcpInput(inputSchema, rawInput)
    // Once the callback has returned, its local action may already have been
    // dispatched (navigation, reducer update, or another browser side effect).
    // Do not report a post-dispatch abort as if it rolled that action back.
    // Cooperative async callbacks must observe `options.signal` themselves
    // before returning an outcome.
    const output = await execute(input, options)
    return parseBoundedWebMcpOutput(outputSchema, output)
  }
  validatedExecutors.add(validated)
  return validated
}

/** Runtime invariant for definitions eligible for the governed remote catalog. */
export function isValidatedWebMcpExecutor(execute: (...args: never[]) => unknown): boolean {
  return validatedExecutors.has(execute)
}
