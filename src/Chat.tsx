/**
 * @file Chat.tsx
 * @description Main Chat interface for the Agent Web Quickstart.
 *
 * Implements a high-fidelity conversational UI using @ai-sdk/react, featuring:
 * - Real-time streaming with sideband graph activity visualization.
 * - Multi-modal support (image attachments).
 * - Human-in-the-loop tool approval workflows.
 * - Dynamic model and tool configuration.
 * - Local storage persistence and URL-based conversation routing.
 */

import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { Loader } from '@/components/ai-elements/loader'
import {
  PromptInput,
  PromptInputButton,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input'
import { XIcon, Settings2Icon, PaperclipIcon } from 'lucide-react'
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ApprovalCard } from '@/components/ApprovalCard'
import { Switch } from '@/components/ui/switch'
import { useChat, type UIMessage } from '@ai-sdk/react'
import type { ChatStatus, UIDataTypes, UIMessagePart, UITools } from 'ai'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type SyntheticEvent, type ChangeEvent } from 'react'
import { useMCP } from './lib/mcp-context'

import { useQuery } from '@tanstack/react-query'
import { useThrottle } from '@uidotdev/usehooks'
import { nanoid } from 'nanoid'
import { useConversationIdFromUrl } from './hooks/useConversationIdFromUrl'
import { Part } from './Part'
import type { ConversationEntry } from './types'
import { getToolIcon } from '@/lib/tool-icons'
import { GraphActivity, type GraphEvent } from '@/components/ai-elements/graph-activity'
import { acpClient } from './lib/acp-client'

/**
 * Interface for specialized message parts (sources, images, etc.)
 */
interface MessagePart {
  type: string
  url?: string
  [key: string]: unknown
}

/**
 * Configuration for an available LLM model
 */
interface ModelConfig {
  id: string
  name: string
  builtinTools: string[]
}

/**
 * Built-in tool metadata
 */
interface BuiltinTool {
  name: string
  id: string
}

/**
 * Remote configuration data structure returned by the backend
 */
interface RemoteConfig {
  models: ModelConfig[]
  builtinTools: BuiltinTool[]
}

/**
 * Basic chat response structure for loading history
 */
interface ChatResponse {
  messages: UIMessage[]
}

/**
 * Fetches the available models and tools from the server configuration endpoint
 */
async function getModels() {
  const res = await fetch('/api/configure')
  return (await res.json()) as RemoteConfig
}

/**
 * Metadata for approval events and sideband graph interactions
 */
interface AppAnnotation {
  event?: string
  data?: {
    event?: string
    type?: string
    tool_calls?: {
      tool_name?: string
      tool_call_id?: string
      args?: Record<string, unknown>
    }[]
    tool_name?: string
    tool_call_id?: string
    args?: Record<string, unknown>
  }
}

/**
 * Primary Chat Component
 *
 * Orchestrates the chat lifecycle including message history management,
 * streaming response handling, and tool interaction flows.
 */
const Chat = () => {
  const [input, setInput] = useState('')
  const [model, setModel] = useState<string>('')
  const [mode, setMode] = useState<'ask' | 'plan' | 'execute'>('ask')
  const [enabledTools, setEnabledTools] = useState<string[]>([])
  const [attachments, setAttachments] = useState<{ url: string; base64: string; type: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { tools: mcpTools, isLoadingTools } = useMCP()

  const { messages, sendMessage, status, setMessages, regenerate, error, addToolOutput } = useChat({
    tools: isLoadingTools ? undefined : mcpTools,
  } as unknown as Parameters<typeof useChat>[0]) as unknown as {
    messages: UIMessage[]
    sendMessage: (
      message: { text: string },
      options?: { body?: Record<string, unknown> },
    ) => Promise<string | undefined>
    status: ChatStatus
    setMessages: (messages: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])) => void
    regenerate: (options?: { messageId: string }) => Promise<string | undefined>
    error: unknown
    addToolOutput: (opts: { toolCallId: string; output: unknown; state?: string; errorText?: string }) => void
  }
  const throttledMessages = useThrottle(messages, 500)
  const [conversationId, setConversationId] = useConversationIdFromUrl()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const configQuery = useQuery({
    queryFn: getModels,
    queryKey: ['models'],
  })

  // Set default model once configuration is loaded
  useEffect(() => {
    if (configQuery.data) {
      setModel(configQuery.data.models[0].id)
    }
  }, [configQuery.data])

  // Load chat history from local storage or server on conversation ID change
  useLayoutEffect(() => {
    if (conversationId === '/') {
      setMessages([])
    } else {
      const localStorageMessages = window.localStorage.getItem(conversationId)
      if (localStorageMessages) {
        setMessages(JSON.parse(localStorageMessages) as typeof messages)
      } else {
        const fetchMessages = async () => {
          try {
            const res = await fetch(`/api/enhanced/chats${conversationId}`)
            if (res.ok) {
              const data = (await res.json()) as ChatResponse
              setMessages(data.messages)
            }
          } catch (err) {
            console.error('Failed to fetch messages for conversation', err)
          }
        }
        void fetchMessages()
      }
    }
    textareaRef.current?.focus()
  }, [conversationId])

  /**
   * Handles multi-modal image uploads, converting files to base64 for the AI SDK
   */
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue

      const reader = new FileReader()
      reader.onload = (event) => {
        const base64 = event.target?.result as string
        setAttachments((prev) => [...prev, { url: URL.createObjectURL(file), base64, type: file.type }])
      }
      reader.readAsDataURL(file)
    }
    e.target.value = '' // Clear input for next upload
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  /**
   * Submits the user prompt, handling conversation initialization and optional ACP/Multi-modal routing.
   */
  const handleSubmit = (e: SyntheticEvent) => {
    e.preventDefault()
    if (input.trim()) {
      const theCurrentUrl = new URL(window.location.toString())

      if (theCurrentUrl.pathname === '/') {
        const newConversationId = `/${nanoid()}`
        setConversationId(newConversationId)

        saveConversationEntryInLocalStorage(newConversationId, input)

        theCurrentUrl.pathname = newConversationId
        window.history.pushState({}, '', theCurrentUrl.toString())
      }

      if (import.meta.env.VITE_ENABLE_ACP === 'true') {
        void handleAcpSubmit(input)
      } else {
        const parts = attachments.map((a) => ({
          image: a.base64,
          media_type: a.type,
        }))

        void sendMessage(
          { text: input },
          {
            body: {
              model,
              builtinTools: enabledTools,
              mode,
              parts: parts.length > 0 ? [...parts, { text: input }] : [],
            },
          },
        ).catch((error: unknown) => {
          console.error('Error sending message:', error)
        })
      }
      setInput('')
      setAttachments([])
    }
  }

  /**
   * Specialized submission flow for Agent Client Protocol (ACP) interactions.
   * Manages low-level RPC streaming and tool-call mapping.
   */
  const handleAcpSubmit = async (query: string) => {
    // Manually add user message to local state
    const userMessage: UIMessage = {
      id: nanoid(),
      role: 'user',
      parts: [{ type: 'text', text: query }],
    }
    setMessages((prev: UIMessage[]) => [...prev, userMessage])

    // Create assistant message placeholder
    const assistantId = nanoid()
    const assistantMessage: UIMessage = {
      id: assistantId,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
    }
    setMessages((prev: UIMessage[]) => [...prev, assistantMessage])

    try {
      await acpClient.sendRpc('prompt', { text: query })

      for await (const event of acpClient.streamEvents()) {
        if (event.type === 'text-delta') {
          const delta = (event as unknown as { delta: string }).delta
          setMessages((prev: UIMessage[]) =>
            prev.map((m: UIMessage) =>
              m.id === assistantId
                ? {
                    ...m,
                    parts: m.parts.map((p) =>
                      (p as unknown as { type: string }).type === 'text'
                        ? ({
                            ...p,
                            text: (p as unknown as { text: string }).text + delta,
                          } as UIMessagePart<UIDataTypes, UITools>)
                        : p,
                    ),
                  }
                : m,
            ),
          )
        } else if (event.type === 'tool-call') {
          const callData = (event as unknown as { call: Record<string, unknown> }).call
          // Explicit mapping to AI SDK camelCase format
          const toolCall = {
            type: 'tool-call',
            toolCallId: (callData.tool_call_id ?? callData.id ?? nanoid()) as string,
            toolName: (callData.tool_name ?? callData.name) as string,
            args: callData.args ?? {},
          }

          setMessages((prev: UIMessage[]) =>
            prev.map((m: UIMessage) =>
              m.id === assistantId
                ? {
                    ...m,
                    parts: [...m.parts, toolCall as UIMessagePart<UIDataTypes, UITools>],
                  }
                : m,
            ),
          )
        }
      }
    } catch (err) {
      console.error('ACP Submission failed:', err)
    }
  }

  // Persist messages to local storage whenever they are updated
  useEffect(() => {
    if (conversationId && throttledMessages.length > 0) {
      window.localStorage.setItem(conversationId, JSON.stringify(throttledMessages))
    }
  }, [throttledMessages, conversationId])

  /**
   * Triggers a message regeneration for the specified ID
   */
  function regen(messageId: string) {
    void regenerate({ messageId }).catch((error: unknown) => {
      console.error('Error regenerating message:', error)
    })
  }

  // Memoize the available tools based on the currently selected model
  const availableTools = useMemo(() => {
    const enabledToolIds = configQuery.data?.models.find((entry) => entry.id === model)?.builtinTools ?? []
    return configQuery.data?.builtinTools.filter((tool) => enabledToolIds.includes(tool.id)) ?? []
  }, [configQuery.data, model])

  if (conversationId !== '/' && messages.length === 0) {
    return null
  }

  /**
   * UI Callback for human-in-the-loop tool approval
   */
  const handleApproveToolCall = (toolCallId: string) => {
    addToolOutput({
      toolCallId,
      output: { approved: true },
    })
  }

  /**
   * UI Callback for human-in-the-loop tool rejection
   */
  const handleRejectToolCall = (toolCallId: string) => {
    addToolOutput({
      toolCallId,
      output: { approved: false },
      errorText: 'Tool call rejected by user',
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.map((message: UIMessage) => (
            <div key={message.id}>
              {message.role === 'assistant' &&
                (message.parts as MessagePart[]).filter((part) => part.type === 'source-url').length > 0 && (
                  <Sources>
                    <SourcesTrigger
                      count={(message.parts as MessagePart[]).filter((part) => part.type === 'source-url').length}
                    />
                    {(message.parts as MessagePart[])
                      .filter((part) => part.type === 'source-url')
                      .map((part, i: number) => (
                        <SourcesContent key={`${message.id}-${i}`}>
                          <Source key={`${message.id}-${i}`} href={part.url ?? ''} title={part.url ?? ''} />
                        </SourcesContent>
                      ))}
                  </Sources>
                )}
              {(message.parts as MessagePart[]).map((part, i: number) => (
                <Part
                  key={`${message.id}-${i}`}
                  part={part as unknown as UIMessagePart<UIDataTypes, UITools>}
                  message={message}
                  status={status}
                  regen={regen}
                  index={i}
                  lastMessage={throttledMessages.indexOf(message) === throttledMessages.length - 1}
                  onApprove={handleApproveToolCall}
                  onReject={handleRejectToolCall}
                />
              ))}

              {(message as unknown as { annotations?: AppAnnotation[] }).annotations?.map((ann, idx: number) => {
                const isApproval =
                  ann.event === 'approval_required' ||
                  ann.data?.event === 'approval_required' ||
                  ann.data?.type === 'approval_required'

                if (!isApproval) return null

                return (
                  <div className="py-2" key={`ann-${idx}`}>
                    <ApprovalCard
                      onApprove={handleApproveToolCall}
                      onReject={handleRejectToolCall}
                      toolPart={{
                        toolName: ann.data?.tool_name ?? ann.data?.tool_calls?.[0]?.tool_name ?? 'Graph Tool',
                        toolCallId:
                          ann.data?.tool_call_id ??
                          ann.data?.tool_calls?.[0]?.tool_call_id ??
                          `${message.id}-graph-approval`,
                        input: ann.data?.args ?? ann.data?.tool_calls?.[0]?.args ?? {},
                        state: 'input-available',
                      }}
                    />
                  </div>
                )
              })}
              {((message as unknown as Record<string, unknown>).annotations as MessagePart[] | undefined)?.map(
                (annotation, i: number) => (
                  <Part
                    key={`${message.id}-ann-${i}`}
                    part={annotation as unknown as UIMessagePart<UIDataTypes, UITools>}
                    message={message}
                    status={status}
                    index={i}
                    regen={regen}
                    lastMessage={message.id === (messages as { id: string }[]).at(-1)?.id}
                  />
                ),
              )}

              {/* Message-level graph activity rendering from data-graph-event parts */}
              {message.role === 'assistant' &&
                (() => {
                  const parts = message.parts as unknown[] | undefined
                  // AI SDK v5 delivers sideband 8: events as DataUIParts in message.parts
                  // with type "data-graph-event" and the payload in .data
                  const graphEvents = (Array.isArray(parts) ? parts : [])
                    .filter((p: unknown) => {
                      if (!p || typeof p !== 'object') return false
                      const part = p as Record<string, unknown>
                      return part.type === 'data-graph-event'
                    })
                    .map((p: unknown) => {
                      const part = p as Record<string, unknown>
                      const payload = (part.data && typeof part.data === 'object' ? part.data : part) as GraphEvent
                      return payload
                    })

                  if (graphEvents.length === 0) return null

                  return (
                    <div className="py-1 px-4">
                      <GraphActivity
                        events={graphEvents}
                        isStreaming={
                          status === 'streaming' && throttledMessages.indexOf(message) === throttledMessages.length - 1
                        }
                      />
                    </div>
                  )
                })()}
            </div>
          ))}
          {status === 'submitted' && <Loader />}
          {status === 'error' && error ? (
            <div className="px-4 py-3 mx-4 my-2 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm">
              <strong>Error:</strong> {(error as { message?: string }).message ?? 'Unknown error'}
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="sticky bottom-0 p-3">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea
            ref={textareaRef}
            onChange={(e) => {
              setInput(e.target.value)
            }}
            value={input}
            autoFocus={true}
          />
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 p-2 border-t bg-muted/30">
              {attachments.map((attachment, index) => (
                <div key={index} className="relative group">
                  <img
                    src={attachment.url}
                    alt="attachment"
                    className="h-16 w-16 object-cover rounded-md border border-border bg-background shadow-sm transition-all group-hover:opacity-80"
                  />
                  <button
                    onClick={() => {
                      removeAttachment(index)
                    }}
                    className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove attachment"
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <PromptInputToolbar>
            <PromptInputTools>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                multiple
                onChange={handleFileChange}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <PromptInputButton
                    variant="outline"
                    onClick={() => {
                      fileInputRef.current?.click()
                    }}
                  >
                    <PaperclipIcon className="size-4" />
                  </PromptInputButton>
                </TooltipTrigger>
                <TooltipContent>Attach files</TooltipContent>
              </Tooltip>
              {availableTools.length > 0 && (
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <PromptInputButton variant="outline">
                          <Settings2Icon className="size-4" />
                        </PromptInputButton>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Tools</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start">
                    {availableTools.map((tool) => (
                      <div
                        key={tool.id}
                        className="flex items-center justify-between gap-3 px-2 py-1.5 cursor-pointer hover:bg-accent rounded-sm"
                        onClick={() => {
                          setEnabledTools((prev) =>
                            prev.includes(tool.id) ? prev.filter((id) => id !== tool.id) : [...prev, tool.id],
                          )
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {getToolIcon(tool.id)}
                          <span className="text-sm">{tool.name}</span>
                        </div>
                        <Switch
                          checked={enabledTools.includes(tool.id)}
                          onCheckedChange={(checked) => {
                            setEnabledTools((prev) =>
                              checked ? [...prev, tool.id] : prev.filter((id) => id !== tool.id),
                            )
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                          }}
                        />
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {configQuery.data && model && (
                <PromptInputModelSelect
                  onValueChange={(value) => {
                    setModel(value)
                  }}
                  value={model}
                >
                  <PromptInputModelSelectTrigger className="w-[120px]">
                    <PromptInputModelSelectValue />
                  </PromptInputModelSelectTrigger>
                  <PromptInputModelSelectContent>
                    {(configQuery.data as { models: { id: string; name: string }[] }).models
                      .filter((m) => m.id && m.name)
                      .map((m) => (
                        <PromptInputModelSelectItem key={m.id} value={m.id}>
                          {m.name}
                        </PromptInputModelSelectItem>
                      ))}
                  </PromptInputModelSelectContent>
                </PromptInputModelSelect>
              )}

              <PromptInputModelSelect
                onValueChange={(value) => {
                  setMode(value as 'ask' | 'plan' | 'execute')
                }}
                value={mode}
              >
                <PromptInputModelSelectTrigger className="w-[90px]">
                  <PromptInputModelSelectValue />
                </PromptInputModelSelectTrigger>
                <PromptInputModelSelectContent>
                  <PromptInputModelSelectItem value="ask">Ask</PromptInputModelSelectItem>
                  <PromptInputModelSelectItem value="plan">Plan</PromptInputModelSelectItem>
                  <PromptInputModelSelectItem value="execute">Execute</PromptInputModelSelectItem>
                </PromptInputModelSelectContent>
              </PromptInputModelSelect>
            </PromptInputTools>
            <PromptInputSubmit disabled={!input} status={status} />
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </div>
  )
}

export default Chat

/**
 * Limit for the displayed length of the first message in conversation history
 */
const MAX_FIRST_MESSAGE_LENGTH = 30

/**
 * Persists a new conversation entry to the local storage list
 */
function saveConversationEntryInLocalStorage(newConversationId: string, firstMessage: string) {
  const currentConversations = window.localStorage.getItem('conversationIds') ?? '[]'
  const conversationIds = JSON.parse(currentConversations) as ConversationEntry[]
  const trimmedFirstMessage =
    firstMessage.length > MAX_FIRST_MESSAGE_LENGTH
      ? firstMessage.slice(0, MAX_FIRST_MESSAGE_LENGTH) + '...'
      : firstMessage
  conversationIds.unshift({
    id: newConversationId,
    firstMessage: trimmedFirstMessage,
    timestamp: Date.now(),
  })
  window.localStorage.setItem('conversationIds', JSON.stringify(conversationIds))

  window.dispatchEvent(new Event('local-storage-change'))
}
