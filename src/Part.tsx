import { Message, MessageContent } from '@/components/ai-elements/message'

import { Actions, Action } from '@/components/ai-elements/actions'
import { Response } from '@/components/ai-elements/response'
import { CopyIcon, RefreshCcwIcon } from 'lucide-react'
import type { UIDataTypes, UIMessagePart, UITools, UIMessage } from 'ai'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Tool, ToolHeader, ToolInput, ToolOutput, ToolContent } from '@/components/ai-elements/tool'
import { CodeBlock } from '@/components/ai-elements/code-block'
import { ApprovalCard } from '@/components/ApprovalCard'
import { GraphActivity, type GraphEvent } from '@/components/GraphActivity'

interface PartProps {
  part: UIMessagePart<UIDataTypes, UITools>
  message: UIMessage
  status: string
  regen: (id: string) => void
  index: number
  lastMessage: boolean
  onApprove?: (toolCallId: string) => void
  onReject?: (toolCallId: string) => void
}

export function Part({ part, message, status, regen, index, lastMessage, onApprove, onReject }: PartProps) {
  function copy(text: string) {
    navigator.clipboard.writeText(text).catch((error: unknown) => {
      console.error('Error copying text:', error)
    })
  }

  if (!part) return null

  if (part.type === 'text') {
    const textStr = (part as any).text ?? ''
    if (!textStr || !textStr.trim()) {
      return null
    }

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
  } else if (part.type === 'reasoning') {
    const reasoningText = (part as any).text ?? ''
    if (!reasoningText && status !== 'streaming') {
      return null
    }
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
  } else if (part.type === 'dynamic-tool') {
    return <>Dynamic Tool, TODO {JSON.stringify(part)}</>
  } else if ('toolCallId' in part) {
    if (part.state === 'input-available' && !('output' in part) && lastMessage && onApprove && onReject) {
      return <ApprovalCard toolPart={part} onApprove={onApprove} onReject={onReject} />
    }
    return (
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
    )
  } else if ((part as any)?.type === 'graph-event' || (part as any)?.type === 'graph_event') {
    const rawEvents = (part as any).events || (part as any).event_data || (part as any).data
    const events = Array.isArray(rawEvents)
      ? rawEvents
      : rawEvents
        ? [rawEvents]
        : ([(part as any).event ? part : null].filter(Boolean) as any[])

    if (events.length === 0) return null

    const approvalEvent = events.find((ev) => ev.event === 'approval_required')

    return (
      <div className="py-2">
        <Message from="assistant">
          <MessageContent>
            {approvalEvent && onApprove && onReject ? (
              <ApprovalCard
                toolPart={{
                  toolName: approvalEvent.tool_name || approvalEvent.tool_calls?.[0]?.tool_name || 'Graph Tool',
                  toolCallId: approvalEvent.tool_calls?.[0]?.tool_call_id || message.id + '-graph-approval',
                  input: approvalEvent.tool_calls?.[0]?.args || {},
                  state: 'input-available',
                }}
                onApprove={onApprove}
                onReject={onReject}
              />
            ) : (
              <GraphActivity events={events as GraphEvent[]} isStreaming={status === 'streaming' && lastMessage} />
            )}
          </MessageContent>
        </Message>
      </div>
    )
  }

  return null
}
