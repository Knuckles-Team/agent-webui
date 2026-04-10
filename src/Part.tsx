import { Message, MessageContent } from '@/components/ai-elements/message'

import { Actions, Action } from '@/components/ai-elements/actions'
import { Response } from '@/components/ai-elements/response'
import { CopyIcon, RefreshCcwIcon } from 'lucide-react'
import type { UIDataTypes, UIMessagePart, UITools, UIMessage } from 'ai'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Tool, ToolHeader, ToolInput, ToolOutput, ToolContent } from '@/components/ai-elements/tool'
import { CodeBlock } from '@/components/ai-elements/code-block'

interface PartProps {
  part: UIMessagePart<UIDataTypes, UITools>
  message: UIMessage
  status: string
  regen: (id: string) => void
  index: number
  lastMessage: boolean
  onApprove?: (toolCallId: string) => void
  onReject?: (toolCallId: string) => void
  sideband?: unknown[]
}

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

interface CustomPart {
  type: string
  text?: string
  events?: GraphEventData[]
  event_data?: GraphEventData[]
  data?: GraphEventData[] | GraphEventData
  event?: string
}

export function Part(props: PartProps) {
  const { part, message, status, regen, index, lastMessage } = props

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch((error: unknown) => {
      console.error('Error copying text:', error)
    })
  }

  // Helper to render the specific part content
  const renderPartContent = () => {
    if (part.type === 'text') {
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
                  copy(textStr)
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

    if (part.type === 'reasoning' || (part as unknown as { type: string }).type === 'thought') {
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

    if (part.type === 'dynamic-tool') {
      return <div className="py-2 opacity-50 text-[10px]">Dynamic Tool: {JSON.stringify(part)}</div>
    }

    if ('toolCallId' in part) {
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

    if (
      (part as unknown as CustomPart).type === 'graph-event' ||
      (part as unknown as CustomPart).type === 'graph_event'
    ) {
      // Handled by consolidated renderer at index 0
      return null
    }

    return null
  }

  return <>{renderPartContent()}</>
}
