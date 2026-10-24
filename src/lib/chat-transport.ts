import { DefaultChatTransport, type UIMessage, type UIMessageChunk } from 'ai'
import { isArboraMetadata, TurnRunBindings } from '@/lib/turn-usage'

/** Preserve canonical metadata snapshots across the SDK's recursive merge.
 *
 * Reset the canonical receipt and identity together before forwarding the
 * valid metadata unchanged. Conflicting run bindings lose usage. Generic
 * provider metadata keeps SDK semantics.
 * This seam is shared by normal responses and reconnect/replay streams.
 */
export class ReceiptChatTransport extends DefaultChatTransport<UIMessage> {
  private readonly bindings: TurnRunBindings
  private readonly getMessages: () => readonly UIMessage[]

  constructor(
    options: ConstructorParameters<typeof DefaultChatTransport<UIMessage>>[0],
    conversationId: string,
    getMessages: () => readonly UIMessage[] = () => [],
  ) {
    super(options)
    this.getMessages = getMessages
    this.bindings = new TurnRunBindings(conversationId)
  }

  protected override processResponseStream(stream: ReadableStream<Uint8Array>): ReadableStream<UIMessageChunk> {
    const bindings = this.bindings
    bindings.retain(this.getMessages())
    return super.processResponseStream(stream).pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform(chunk, controller) {
          if ('messageMetadata' in chunk && isArboraMetadata(chunk.messageMetadata)) {
            const messageMetadata = bindings.conflicts(chunk.messageMetadata)
              ? { ...(chunk.messageMetadata as Record<string, unknown>), arbora: { usage: null } }
              : chunk.messageMetadata
            const reset = { arbora: null, arbora_run: null }
            if (chunk.type === 'start') {
              // Initialize the message ID before publishing any metadata update.
              controller.enqueue({ ...chunk, messageMetadata: reset })
              controller.enqueue({ type: 'message-metadata', messageMetadata })
              return
            }
            controller.enqueue({ type: 'message-metadata', messageMetadata: reset })
            controller.enqueue({ ...chunk, messageMetadata })
            return
          }
          controller.enqueue(chunk)
        },
      }),
    )
  }
}
