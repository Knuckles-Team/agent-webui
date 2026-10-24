import { describe, expect, it, vi } from 'vitest'
import { readUIMessageStream, type UIMessage } from 'ai'
import { ReceiptChatTransport } from '@/lib/chat-transport'
import { turnUsageByMessage } from '@/lib/turn-usage'

function metadata(counts: Record<string, number> = { requests: 1, input_tokens: 23 }) {
  return {
    arbora_run: { conversation_context: 'webui:chat', task_id: 'task', context_id: 'context', run_id: 'run' },
    arbora: { usage: { runId: 'run', taskId: 'task', contextId: 'context', scope: 'turn', counts } },
  }
}

async function receive(
  method: 'send' | 'reconnect',
  first: unknown,
  second: unknown,
  chunk: 'start' | 'message-metadata' | 'finish' = 'message-metadata',
) {
  const events = [
    { type: 'start', messageId: 'reply', messageMetadata: first },
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: 'Measured reply' },
    { type: 'text-end', id: 'text' },
    { type: chunk, ...(chunk === 'start' ? { messageId: 'reply' } : {}), messageMetadata: second },
    ...(chunk === 'finish' ? [] : [{ type: 'finish' }]),
  ]
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  const fetcher = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
  const transport = new ReceiptChatTransport({ api: '/api/chats/messages', fetch: fetcher })
  const stream =
    method === 'send'
      ? await transport.sendMessages({
          chatId: 'chat',
          trigger: 'submit-message',
          messageId: undefined,
          messages: [],
          abortSignal: undefined,
        })
      : await transport.reconnectToStream({ chatId: 'chat' })
  expect(transport.resumeStreamIsReplay).toBe(true)
  expect(fetcher).toHaveBeenCalledWith(
    method === 'send' ? '/api/chats/messages' : '/api/chats/messages/chat/stream',
    expect.objectContaining({ method: method === 'send' ? 'POST' : 'GET' }),
  )
  let last: UIMessage | undefined
  for await (const message of readUIMessageStream({ stream: stream!, terminateOnError: true })) {
    expect(message.id).toBe('reply')
    last = message
  }
  expect(last?.parts).toEqual([{ type: 'text', text: 'Measured reply', state: 'done' }])
  return last!
}

describe.each(['send', 'reconnect'] as const)('canonical metadata replacement on %s', (method) => {
  it.each(['start', 'message-metadata', 'finish'] as const)(
    'replaces full receipts with exact partial %s metadata',
    async (chunk) => {
      const partial = metadata({ total_tokens: 0 })
      const message = await receive(method, metadata(), partial, chunk)
      expect(message.metadata).toEqual(partial)
      expect(turnUsageByMessage([message], 'chat').get(message.id)?.counts).toEqual({ total_tokens: 0 })
    },
  )

  it.each([null, { status: 'unavailable' }, { status: 'denied' }])('clears counts on %j', async (usage) => {
    const message = await receive(method, metadata(), { ...metadata(), arbora: { usage } })
    expect(turnUsageByMessage([message], 'chat').get(message.id)).toBeNull()
    expect((message.metadata as { arbora: unknown }).arbora).toEqual({ usage })
  })

  it.each([undefined, { task_id: 'task' }, { ...metadata().arbora_run, run_id: undefined }])(
    'does not inherit missing or partial outer identity %j',
    async (identity) => {
      const message = await receive(method, metadata(), { arbora: metadata().arbora, arbora_run: identity })
      expect([...turnUsageByMessage([message], 'chat').values()].every((usage) => usage === null)).toBe(true)
      expect((message.metadata as { arbora_run?: unknown }).arbora_run).toEqual(identity ?? null)
    },
  )

  it.each(['start', 'message-metadata', 'finish'] as const)(
    'keeps generic provider %s semantics unchanged',
    async (chunk) => {
      const message = await receive(method, { usage: { inputTokens: 2 } }, { usage: { outputTokens: 3 } }, chunk)
      expect(message.metadata).toEqual({ usage: { inputTokens: 2, outputTokens: 3 } })
    },
  )
})
