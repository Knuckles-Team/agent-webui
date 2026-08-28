/**
 * @file Part.tsx
 * @description Renders individual message parts (text, reasoning, tools) in the chat feed.
 *
 * Implements granular rendering logic for:
 * - Text messages with Markdown sub-rendering and action buttons.
 * - Thinking/Reasoning blocks with streaming support and expand/collapse triggers.
 * - Multi-stage tool execution (calls, approvals, outputs).
 * - Sideband data events (intercepted for consolidated rendering).
 */

import { Message, MessageContent } from '@/components/ai-elements/message'
import { Actions, Action } from '@/components/ai-elements/actions'
import { Response } from '@/components/ai-elements/response'
import { CopyIcon, RefreshCcwIcon } from 'lucide-react'
import type { UIDataTypes, UIMessagePart, UITools, UIMessage } from 'ai'
import type { ReactNode } from 'react'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Tool, ToolHeader, ToolInput, ToolOutput, ToolContent } from '@/components/ai-elements/tool'
import { CodeBlock } from '@/components/ai-elements/code-block'

/**
 * Props for the Part component
 */
interface PartProps {
  /** The specific AI SDK message part to render */
  part: UIMessagePart<UIDataTypes, UITools>
  /** The parent message object current part belongs to */
  message: UIMessage
  /** Current chat status ('streaming', 'ready', etc.) */
  status: string
  /** Callback to trigger a message regeneration */
  regen: (id: string) => void
  /** Index of the part within the message */
  index: number
  /** Whether this is the last message in the list */
  lastMessage: boolean
  /** Optional callback for approving tool calls */
  onApprove?: (toolCallId: string) => void
  /** Optional callback for rejecting tool calls */
  onReject?: (toolCallId: string) => void
}

/**
 * Metadata structure for sideband graph events
 */
interface GraphEventData {
  event?: string
  tool_name?: string
  tool_call_id?: string
  args?: Record<string, unknown>
  tool_calls?: {
    tool_name?: string
    tool_call_id?: string
    args?: Record<string, unknown>
  }[]
}

/**
 * internal mapping for custom non-standard part types
 */
interface CustomPart {
  type: string
  text?: string
  events?: GraphEventData[]
  event_data?: GraphEventData[]
  data?: GraphEventData[] | GraphEventData
  event?: string
}

/**
 * Helper to copy text to clipboard using the modern Clipboard API
 */
function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch((error: unknown) => {
    console.error('Error copying text:', error)
  })
}

/** 1. Text Parts (Standard Conversation) */
function renderTextPart(
  part: UIMessagePart<UIDataTypes, UITools>,
  message: UIMessage,
  index: number,
  regen: (id: string) => void,
): ReactNode {
  const textPart = part as unknown as { text: string }
  const textStr = textPart.text
  const isCron = textStr.startsWith('[CRON]')
  const displayText = isCron ? textStr.replace('[CRON]', '').trim() : textStr

  return (
    <div className="py-2">
      <Message from={message.role} isCron={isCron}>
        <MessageContent>
          <Response>{displayText}</Response>
        </MessageContent>
      </Message>
      {message.role === 'assistant' && index === message.parts.length - 1 && (
        <Actions className="mt-1">
          <Action
            onClick={() => {
              regen(message.id)
            }}
            label="Retry"
          >
            <RefreshCcwIcon className="size-3" />
          </Action>
          <Action
            onClick={() => {
              copyToClipboard(textStr)
            }}
            label="Copy"
          >
            <CopyIcon className="size-3" />
          </Action>
        </Actions>
      )}
    </div>
  )
}

/** 2. Reasoning/Thought Parts (Deep Thinking) */
function renderReasoningPart(
  part: UIMessagePart<UIDataTypes, UITools>,
  message: UIMessage,
  status: string,
  index: number,
  lastMessage: boolean,
): ReactNode {
  const reasoningPart = part as unknown as { text: string }
  const reasoningText = reasoningPart.text
  if (!reasoningText && status !== 'streaming') return null
  return (
    <div className="py-2">
      <Message from={message.role}>
        <MessageContent>
          <Reasoning
            className="w-full mb-0"
            isStreaming={status === 'streaming' && index === message.parts.length - 1 && lastMessage}
          >
            <ReasoningTrigger />
            <ReasoningContent>{reasoningText}</ReasoningContent>
          </Reasoning>
        </MessageContent>
      </Message>
    </div>
  )
}

/** 4. Standard AI SDK Tools (Call/Input/Output). Returns `null` when `part` doesn't
 * actually carry a `toolCallId`, or is the `dynamic-tool` part the dispatcher already
 * handles separately — callers only reach this once both are already true, so this is
 * a defensive no-op in practice, not a new code path. The explicit `dynamic-tool`
 * exclusion (not just the caller's dispatch order) is what lets TS narrow `part.type`
 * to `` `tool-${string}` `` for `ToolHeader` below. */
function renderToolCallPart(part: UIMessagePart<UIDataTypes, UITools>): ReactNode {
  if (!('toolCallId' in part) || part.type === 'dynamic-tool') return null
  return (
    <div className="py-2">
      <Tool>
        <ToolHeader type={part.type} state={part.state} />
        <ToolContent>
          <ToolInput input={part.input} />
          {(part.state === 'output-available' || part.state === 'output-error') && (
            <ToolOutput
              errorText={part.errorText}
              output={<CodeBlock code={JSON.stringify(part.output, null, 2)} language="json" />}
            />
          )}
        </ToolContent>
      </Tool>
    </div>
  )
}

/**
 * Message Part Component
 *
 * Determines and renders the appropriate UI component based on the part's 'type'
 * (text, tool-call, reasoning, thought, data-graph-event).
 */
export function Part(props: PartProps) {
  const { part, message, status, regen, index, lastMessage } = props

  /**
   * Dispatches rendering logic based on part type
   */
  const renderPartContent = (): ReactNode => {
    // 1. Text Parts (Standard Conversation)
    if (part.type === 'text') return renderTextPart(part, message, index, regen)

    // 2. Reasoning/Thought Parts (Deep Thinking)
    if (part.type === 'reasoning' || (part as unknown as { type: string }).type === 'thought') {
      return renderReasoningPart(part, message, status, index, lastMessage)
    }

    // 3. Dynamic Tool Placeholders
    if (part.type === 'dynamic-tool') {
      return <div className="py-2 opacity-50 text-[10px]">Dynamic Tool: {JSON.stringify(part)}</div>
    }

    // 4. Standard AI SDK Tools (Call/Input/Output)
    if ('toolCallId' in part) return renderToolCallPart(part)

    // 5. Sideband Graph Activity (Handled by Chat.tsx root)
    if ((part as unknown as CustomPart).type === 'data-graph-event') {
      // Intentionally bypassed; Chat.tsx handles this for consolidated rendering
      return null
    }

    return null
  }

  return <>{renderPartContent()}</>
}
