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
import { Badge } from '@/components/ui/badge'
import { ApprovalCard } from '@/components/ApprovalCard'
import { Switch } from '@/components/ui/switch'
import { useChat, type UIMessage } from '@ai-sdk/react'
import type { UIDataTypes, UIMessagePart, UITools, ChatStatus } from 'ai'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type SyntheticEvent, type ChangeEvent } from 'react'

import { useQuery } from '@tanstack/react-query'
import { useThrottle } from '@uidotdev/usehooks'
import { nanoid } from 'nanoid'
import { useConversationIdFromUrl } from './hooks/useConversationIdFromUrl'
import { Part } from './Part'
import type { ConversationEntry } from './types'
import { getToolIcon } from '@/lib/tool-icons'
import { GraphActivity, type GraphEvent } from '@/components/ai-elements/graph-activity'

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
 * Agent interaction mode.
 *
 * - `ask`: conversational Q&A (default)
 * - `plan`: produce an execution plan without running tools
 * - `code`: build/code mode — the agent may call tools and modify files
 *
 * Persisted in localStorage under `AGENT_MODE_STORAGE_KEY` so refreshes keep
 * the user's last selection.
 */
type AgentMode = 'ask' | 'plan' | 'code'

const AGENT_MODE_STORAGE_KEY = 'agent-mode'
const AGENT_MODES: readonly AgentMode[] = ['ask', 'plan', 'code'] as const

function isAgentMode(value: unknown): value is AgentMode {
  return typeof value === 'string' && (AGENT_MODES as readonly string[]).includes(value)
}

/**
 * Rolling usage counters accumulated from AG-UI `usage` events.
 *
 * Field names mirror the AG-UI/OpenAI snake_case convention; the extractor
 * also tolerates camelCase variants (`totalTokens`, `inputTokens`, etc.) so
 * the same state works whether the backend speaks AG-UI or AI-SDK v5.
 */
interface TokenUsage {
  total_tokens: number
  prompt_tokens: number
  completion_tokens: number
}

const ZERO_USAGE: TokenUsage = { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 }

/**
 * Per-1M-token cost rate (USD). Mirrors the backend `ModelCostRate`
 * pydantic model and is sourced from `GET /api/enhanced/models` rather
 * than a hardcoded table. Zero values are legal (local / free models).
 */
interface ModelRate {
  input: number
  output: number
}

/**
 * One configured model as returned by the backend registry. Mirrors
 * `agent_utilities.models.ModelDefinition`.
 */
interface RegistryModel {
  id: string
  name: string
  provider: string
  model_id: string
  base_url?: string | null
  api_key_env?: string | null
  tier: 'light' | 'medium' | 'heavy' | 'reasoning'
  tags: string[]
  cost: ModelRate
  context_window?: number | null
  max_output_tokens?: number | null
  is_default: boolean
}

interface ModelRegistryPayload {
  models: RegistryModel[]
  default_id: string | null
}

const ZERO_RATE: ModelRate = { input: 0, output: 0 }

/**
 * Resolve the per-1M-token cost rate for `modelId` by consulting the
 * backend registry. Returns `null` when the id is unknown to the
 * registry so callers can render a `—` placeholder; returns an explicit
 * `{ input: 0, output: 0 }` for configured zero-cost / local models so
 * they display as `$0.00` rather than "unavailable".
 */
function lookupModelRate(
  modelId: string | undefined,
  registry: ModelRegistryPayload | undefined,
): ModelRate | null {
  if (!modelId || !registry) return null
  const byId = registry.models.find((m) => m.id === modelId)
  if (byId) return byId.cost ?? ZERO_RATE

  const lowered = modelId.toLowerCase()
  const byProviderModel = registry.models.find(
    (m) => `${m.provider}:${m.model_id}`.toLowerCase() === lowered,
  )
  if (byProviderModel) return byProviderModel.cost ?? ZERO_RATE

  const byModelId = registry.models.find((m) => m.model_id.toLowerCase() === lowered)
  if (byModelId) return byModelId.cost ?? ZERO_RATE

  return null
}

/**
 * Extract a token-usage record from an arbitrary object. Returns `null` if
 * the shape doesn't carry any of the recognised fields. Accepts both
 * snake_case (AG-UI / OpenAI) and camelCase (AI-SDK v5).
 */
function parseUsage(source: unknown): TokenUsage | null {
  if (!source || typeof source !== 'object') return null
  const rec = source as Record<string, unknown>
  const total = toNumber(rec.total_tokens) ?? toNumber(rec.totalTokens)
  const prompt = toNumber(rec.prompt_tokens) ?? toNumber(rec.inputTokens) ?? toNumber(rec.promptTokens)
  const completion =
    toNumber(rec.completion_tokens) ?? toNumber(rec.outputTokens) ?? toNumber(rec.completionTokens)
  if (total === null && prompt === null && completion === null) return null
  const resolvedPrompt = prompt ?? 0
  const resolvedCompletion = completion ?? 0
  return {
    prompt_tokens: resolvedPrompt,
    completion_tokens: resolvedCompletion,
    total_tokens: total ?? resolvedPrompt + resolvedCompletion,
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

/**
 * Walk every assistant message and aggregate usage from:
 *   1. `message.metadata.usage` (AI SDK v5 happy-path)
 *   2. Any sideband part with `type === 'data-usage'` or similar
 *   3. Any annotation with a `usage` field or `TokenUsageUpdate` event
 *
 * Returns the summed `TokenUsage` across the whole conversation. Pure (no
 * hooks, no side effects) so `useMemo` can memoize on `throttledMessages`.
 */
function sumSessionUsage(messages: readonly UIMessage[]): TokenUsage {
  const totals: TokenUsage = { ...ZERO_USAGE }

  for (const rawMessage of messages) {
    const message = rawMessage as unknown as Record<string, unknown>

    // 1. Message-level metadata (AI SDK v5 `messageMetadata` pipeline).
    const metadata = message.metadata
    if (metadata && typeof metadata === 'object') {
      const metaRec = metadata as Record<string, unknown>
      const direct = parseUsage(metaRec.usage) ?? parseUsage(metaRec)
      if (direct) addUsage(totals, direct)
    }

    // 2. Direct `usage` on the message (some backends attach it here).
    const topLevel = parseUsage(message.usage)
    if (topLevel) addUsage(totals, topLevel)

    // 3. Sideband data parts (`data-usage`, `data-token-usage`, …).
    const parts = Array.isArray(message.parts) ? (message.parts as unknown[]) : []
    for (const rawPart of parts) {
      if (!rawPart || typeof rawPart !== 'object') continue
      const part = rawPart as Record<string, unknown>
      const type = typeof part.type === 'string' ? part.type : ''
      if (!type.startsWith('data-')) continue
      if (!type.includes('usage') && !type.includes('token')) continue
      const fromData = parseUsage(part.data) ?? parseUsage(part)
      if (fromData) addUsage(totals, fromData)
    }

    // 4. Annotations list (`TokenUsageUpdate`, `usage`, …).
    const annotations = message.annotations
    if (Array.isArray(annotations)) {
      for (const rawAnn of annotations as unknown[]) {
        if (!rawAnn || typeof rawAnn !== 'object') continue
        const ann = rawAnn as Record<string, unknown>
        const event = typeof ann.event === 'string' ? ann.event : ''
        const type = typeof ann.type === 'string' ? ann.type : ''
        const isUsageEvent =
          event === 'usage' || event === 'TokenUsageUpdate' || type === 'usage' || type === 'TokenUsageUpdate'
        const candidate =
          parseUsage(ann.data) ?? parseUsage(ann.usage) ?? (isUsageEvent ? parseUsage(ann) : null)
        if (candidate) addUsage(totals, candidate)
      }
    }
  }

  return totals
}

function addUsage(target: TokenUsage, addend: TokenUsage): void {
  target.total_tokens += addend.total_tokens
  target.prompt_tokens += addend.prompt_tokens
  target.completion_tokens += addend.completion_tokens
}

/**
 * Compute an approximate USD cost given a usage record, a model id, and
 * the registry payload. Returns `null` only when the model is unknown to
 * the registry; configured zero-cost models return `0` so the UI can
 * render `$0.00` instead of an unavailable placeholder.
 */
function estimateCost(
  usage: TokenUsage,
  modelId: string | undefined,
  registry: ModelRegistryPayload | undefined,
): number | null {
  const rate = lookupModelRate(modelId, registry)
  if (!rate) return null
  const inputCost = (usage.prompt_tokens / 1_000_000) * rate.input
  const outputCost = (usage.completion_tokens / 1_000_000) * rate.output
  return inputCost + outputCost
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

const TOKEN_FORMATTER = new Intl.NumberFormat('en-US')

/**
 * Fetches the available models and tools from the server configuration endpoint
 */
async function getModels() {
  const res = await fetch('/api/configure')
  return (await res.json()) as RemoteConfig
}

/**
 * Fetches the backend-configured model registry. Used to populate the
 * model picker and to compute per-turn cost. See `GET /api/enhanced/models`.
 */
async function getModelRegistry(): Promise<ModelRegistryPayload> {
  const res = await fetch('/api/enhanced/models')
  if (!res.ok) {
    return { models: [], default_id: null }
  }
  const data = (await res.json()) as Partial<ModelRegistryPayload>
  return {
    models: Array.isArray(data.models) ? data.models : [],
    default_id: data.default_id ?? null,
  }
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
 * Locally defined interfaces to satisfy strict typing requirements
 * while working around complex generic constraints in the AI SDK.
 */
interface LocalUseChatOptions {
  api: string
}

interface LocalUseChatHelpers {
  messages: UIMessage[]
  append: (
    message: { role: 'user' | 'assistant'; content: string },
    options?: { body?: Record<string, unknown> },
  ) => Promise<string | undefined>
  status: ChatStatus
  setMessages: (messages: UIMessage[]) => void
  reload: () => Promise<string | undefined>
  addToolOutput: (output: { tool: string; toolCallId: string; output: unknown }) => Promise<void>
  error: Error | undefined
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
  const [mode, setMode] = useState<AgentMode>(() => {
    // Hydrate from localStorage on mount; tolerate SSR and quota errors.
    if (typeof window === 'undefined') return 'ask'
    try {
      const stored = window.localStorage.getItem(AGENT_MODE_STORAGE_KEY)
      return isAgentMode(stored) ? stored : 'ask'
    } catch {
      return 'ask'
    }
  })
  const [enabledTools, setEnabledTools] = useState<string[]>([])
  const [attachments, setAttachments] = useState<{ url: string; base64: string; type: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { messages, append, status, setMessages, reload, addToolOutput, error } = (
    useChat as unknown as (options: LocalUseChatOptions) => LocalUseChatHelpers
  )({
    api: '/acp',
  })
  const throttledMessages = useThrottle<UIMessage[]>(messages, 500)
  const [conversationId, setConversationId] = useConversationIdFromUrl()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Persist mode selection so navigation/reload preserves the user's choice.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(AGENT_MODE_STORAGE_KEY, mode)
    } catch {
      // Storage may be disabled (private mode, quota); non-fatal.
    }
  }, [mode])

  const configQuery = useQuery({
    queryFn: getModels,
    queryKey: ['models'],
  })

  // Multi-model registry from the backend (`/api/enhanced/models`).
  // Cached and shared with cost estimation so the UI does not carry a
  // hardcoded model cost table.
  const modelRegistryQuery = useQuery({
    queryFn: getModelRegistry,
    queryKey: ['model-registry'],
    staleTime: 60_000,
  })

  const modelRegistry = modelRegistryQuery.data

  // Running token totals for the whole session. Recomputed from throttled
  // messages to avoid thrashing during a streaming response.
  const sessionUsage = useMemo(() => sumSessionUsage(throttledMessages), [throttledMessages])
  const estimatedCost = useMemo(
    () => estimateCost(sessionUsage, model, modelRegistry),
    [sessionUsage, model, modelRegistry],
  )
  const hasUsage = sessionUsage.total_tokens > 0

  // Set default model once configuration is loaded. Prefer the registry's
  // default_id so the picker opens on the same model that the backend is
  // actually wired to.
  useEffect(() => {
    if (model) return
    if (modelRegistry && modelRegistry.models.length > 0) {
      const regDefault = modelRegistry.default_id
      setModel(regDefault ?? modelRegistry.models[0].id)
      return
    }
    if (configQuery.data && configQuery.data.models.length > 0) {
      setModel(configQuery.data.models[0].id)
    }
  }, [configQuery.data, modelRegistry, model])

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

      const parts = attachments.map((a) => ({
        image: a.base64,
        media_type: a.type,
      }))

      void append(
        {
          role: 'user',
          content: input,
        },
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

      setInput('')
      setAttachments([])
    }
  }

  /**
   * Specialized submission flow for Agent Client Protocol (ACP) interactions.
   * Manages low-level RPC streaming and tool-call mapping.
   */

  // Persist messages to local storage whenever they are updated
  useEffect(() => {
    if (conversationId && throttledMessages.length > 0) {
      window.localStorage.setItem(conversationId, JSON.stringify(throttledMessages))
    }
  }, [throttledMessages, conversationId])

  /**
   * Triggers a message regeneration for the specified ID
   */
  function regen(_messageId: string) {
    void reload().catch((error: unknown) => {
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
    void addToolOutput({
      tool: 'agent_tool',
      toolCallId,
      output: { approved: true },
    })
  }

  /**
   * UI Callback for human-in-the-loop tool rejection
   */
  const handleRejectToolCall = (toolCallId: string) => {
    void addToolOutput({
      tool: 'agent_tool',
      toolCallId,
      output: { approved: false },
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.map((message: UIMessage) => (
            <div key={message.id}>
              {message.role === 'assistant' &&
                (message.parts as unknown as MessagePart[]).filter((part) => part.type === 'source-url').length >
                  0 && (
                  <Sources>
                    <SourcesTrigger
                      count={
                        (message.parts as unknown as MessagePart[]).filter((part) => part.type === 'source-url').length
                      }
                    />
                    {(message.parts as unknown as MessagePart[])
                      .filter((part) => part.type === 'source-url')
                      .map((part, i: number) => (
                        <SourcesContent key={`${message.id}-${i}`}>
                          <Source key={`${message.id}-${i}`} href={part.url ?? ''} title={part.url ?? ''} />
                        </SourcesContent>
                      ))}
                  </Sources>
                )}
              {(message.parts as unknown as MessagePart[]).map((part, i: number) => (
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
              {hasUsage && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {TOKEN_FORMATTER.format(sessionUsage.total_tokens)} tokens
                      {' \u00b7 '}
                      {estimatedCost !== null ? formatCost(estimatedCost) : '\u2014'}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs space-y-0.5">
                      <div>
                        <strong>Prompt:</strong> {TOKEN_FORMATTER.format(sessionUsage.prompt_tokens)} tokens
                      </div>
                      <div>
                        <strong>Completion:</strong>{' '}
                        {TOKEN_FORMATTER.format(sessionUsage.completion_tokens)} tokens
                      </div>
                      <div>
                        <strong>Total:</strong> {TOKEN_FORMATTER.format(sessionUsage.total_tokens)} tokens
                      </div>
                      <div className="pt-1 border-t">
                        {estimatedCost !== null
                          ? `Estimated cost: ${formatCost(estimatedCost)}`
                          : 'Cost rate not configured for this model'}
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
              {/* Prefer the backend-configured model registry; fall back
                to the legacy `/api/configure` list when no registry is
                populated (e.g. single-model / dev mode). */}
              {(modelRegistry?.models.length ?? 0) > 0 && model && (
                <PromptInputModelSelect
                  onValueChange={(value) => {
                    setModel(value)
                  }}
                  value={model}
                >
                  <PromptInputModelSelectTrigger className="w-[160px]">
                    <PromptInputModelSelectValue />
                  </PromptInputModelSelectTrigger>
                  <PromptInputModelSelectContent>
                    {modelRegistry!.models.map((m) => (
                      <PromptInputModelSelectItem key={m.id} value={m.id}>
                        {m.name}
                      </PromptInputModelSelectItem>
                    ))}
                  </PromptInputModelSelectContent>
                </PromptInputModelSelect>
              )}
              {(modelRegistry?.models.length ?? 0) === 0 && configQuery.data && model && (
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

              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground hidden sm:inline" aria-hidden>
                  Mode:
                </span>
                <PromptInputModelSelect
                  onValueChange={(value) => {
                    if (isAgentMode(value)) setMode(value)
                  }}
                  value={mode}
                >
                  <PromptInputModelSelectTrigger className="w-[90px]" aria-label="Agent mode">
                    <PromptInputModelSelectValue />
                  </PromptInputModelSelectTrigger>
                  <PromptInputModelSelectContent>
                    <PromptInputModelSelectItem value="ask">Ask</PromptInputModelSelectItem>
                    <PromptInputModelSelectItem value="plan">Plan</PromptInputModelSelectItem>
                    <PromptInputModelSelectItem value="code">Code</PromptInputModelSelectItem>
                  </PromptInputModelSelectContent>
                </PromptInputModelSelect>
              </div>
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
