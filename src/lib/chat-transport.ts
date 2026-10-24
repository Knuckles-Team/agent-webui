import { DefaultChatTransport, type UIMessage, type UIMessageChunk } from 'ai'
import { isArboraMetadata } from '@/lib/turn-usage'

/** Preserve canonical metadata snapshots across the SDK's recursive merge.
 *
 * Reset the canonical receipt and identity together before forwarding the
 * original metadata unchanged. Generic provider metadata keeps SDK semantics.
 * This seam is shared by normal responses and reconnect/replay streams.
 */
export class ReceiptChatTransport extends DefaultChatTransport<UIMessage> {
  protected override processResponseStream(stream: ReadableStream<Uint8Array>): ReadableStream<UIMessageChunk> {
    return super.processResponseStream(stream).pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform(chunk, controller) {
          if ('messageMetadata' in chunk && isArboraMetadata(chunk.messageMetadata)) {
            const reset = { arbora: null, arbora_run: null }
            if (chunk.type === 'start') {
              // Initialize the message ID before publishing any metadata update.
              controller.enqueue({ ...chunk, messageMetadata: reset })
              controller.enqueue({ type: 'message-metadata', messageMetadata: chunk.messageMetadata })
              return
            }
            controller.enqueue({ type: 'message-metadata', messageMetadata: reset })
          }
          controller.enqueue(chunk)
        },
      }),
    )
  }
}
