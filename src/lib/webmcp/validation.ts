/** Strict runtime validation at the browser-agent boundary. */
import { z } from 'zod'
import type { WebMcpExecutionOptions } from './types'

/** Chrome's current security guidance recommends no more than 1.5K characters. */
export const WEBMCP_OUTPUT_CHARACTER_BUDGET = 1_500

function throwIfCancelled(options: WebMcpExecutionOptions): void {
  if (options.signal.aborted) throw new Error('WebMCP tool execution was cancelled')
}

export function parseBoundedWebMcpOutput<Output>(schema: z.ZodType<Output>, rawOutput: unknown): Output {
  const output = schema.parse(rawOutput)
  const serialized = JSON.stringify(output)
  if (serialized.length > WEBMCP_OUTPUT_CHARACTER_BUDGET) {
    throw new Error('WebMCP tool output exceeded the public character budget')
  }
  return output
}

/**
 * The current draft describes an object input, while early implementations
 * have delivered the same JSON as a string. Normalize that one compatibility
 * difference before Zod validation; malformed strings remain strings and are
 * rejected by the declared object schema.
 */
export function parseWebMcpInput<Input>(schema: z.ZodType<Input>, rawInput: unknown): Input {
  if (typeof rawInput !== 'string') return schema.parse(rawInput)

  try {
    return schema.parse(JSON.parse(rawInput) as unknown)
  } catch (error) {
    // Preserve the schema's useful Zod error for malformed JSON as well as for
    // a valid JSON value of the wrong shape. Never coerce arbitrary text.
    if (error instanceof z.ZodError) throw error
    return schema.parse(rawInput)
  }
}

/** Validate both sides of a tool call; the browser receives only the parsed output. */
export function createValidatedExecutor<Input, Output>(
  inputSchema: z.ZodType<Input>,
  outputSchema: z.ZodType<Output>,
  execute: (input: Input, options: WebMcpExecutionOptions) => Output | PromiseLike<Output>,
): (rawInput: unknown, options: WebMcpExecutionOptions) => Promise<Output> {
  return async (rawInput, options) => {
    throwIfCancelled(options)
    const input = parseWebMcpInput(inputSchema, rawInput)
    const output = await execute(input, options)
    throwIfCancelled(options)
    return parseBoundedWebMcpOutput(outputSchema, output)
  }
}
