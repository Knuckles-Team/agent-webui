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

import { cn } from '@/lib/utils'
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
import { XIcon, Settings2Icon, PaperclipIcon, DownloadIcon, Wrench, Square, GitBranch } from 'lucide-react'
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { ApprovalCard } from '@/components/ApprovalCard'
import { Switch } from '@/components/ui/switch'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport, type UIDataTypes, type UIMessagePart, type UITools } from 'ai'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'

import { useQuery } from '@tanstack/react-query'
import { useThrottle } from '@uidotdev/usehooks'
import { nanoid } from 'nanoid'
import { useConversationIdFromUrl } from './hooks/useConversationIdFromUrl'
import { Part } from './Part'
import { getToolIcon } from '@/lib/tool-icons'
import { GraphActivity, type GraphEvent } from '@/components/ai-elements/graph-activity'
import VoiceDictationButton from '@/components/VoiceDictationButton'
import { pageContextSystemPrompt, type PageContextEnvelope } from '@/lib/page-context'
import { useIdentity } from '@/lib/auth'
import {
  readConversationMessages,
  removeConversationMessages,
  saveConversationEntry,
  writeConversationMessages,
} from '@/lib/chat-store'
import { api, type SweMutatedEdge, type SweProvenanceAction } from '@/lib/api'
import { z } from 'zod'
import { fetchValidated, looseArray } from '@/lib/api-validation'

/**
 * Interface for specialized message parts (sources, images, etc.)
 */
interface MessagePart {
  type: string
  url?: string
  [key: string]: unknown
}

/**
 * One checkpoint of the core orchestrator's progress stream
 * (`agent_utilities.orchestration.agent_runner.ProgressEvent`, CONCEPT:AU-ORCH.execution.
 * messaging-orchestration-transparency), as adapted onto the wire by
 * `agent/agent_webui/orchestrator_model.py::_progress_event_payload`.
 *
 * `_reply_stream` cannot emit a distinct SSE frame type for this (pydantic-ai's
 * `FunctionModel.stream_function` only supports text/tool/thinking deltas), so each event
 * arrives as its own `reasoning` message part whose `text` is this JSON, verbatim from the
 * core. Rendering that JSON is the ONLY thing this file does with it -- no
 * routing/stage/status decision lives here (Universal capability: the core decided, this
 * entrypoint only adapts+renders).
 */
export interface ProgressEventPayload {
  stage: string
  status: string
  detail?: string
  evidence?: Record<string, unknown>
}

/**
 * Parse one `reasoning` part's text as a core `ProgressEventPayload`.
 *
 * Returns `null` for anything that isn't shaped like one (an ordinary JSON parse failure,
 * or genuine free-text "thinking" content from a reasoning-capable model) so a progress
 * event and a real thinking block are never confused with each other.
 */
export function parseProgressEventPayload(text: string): ProgressEventPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    typeof (parsed as Record<string, unknown>).stage === 'string' &&
    typeof (parsed as Record<string, unknown>).status === 'string'
  ) {
    return parsed as ProgressEventPayload
  }
  return null
}

/** True for a `reasoning` part whose text is a progress-event payload (not free-text thinking). */
export function isProgressEventPart(part: MessagePart): boolean {
  return part.type === 'reasoning' && typeof part.text === 'string' && parseProgressEventPayload(part.text) !== null
}

/** Extract, in order, every progress-event payload carried by a message's `reasoning` parts. */
export function extractProgressEvents(parts: MessagePart[] | undefined): ProgressEventPayload[] {
  if (!Array.isArray(parts)) return []
  const events: ProgressEventPayload[] = []
  for (const part of parts) {
    if (!isProgressEventPart(part)) continue
    const payload = parseProgressEventPayload(part.text as string)
    if (payload) events.push(payload)
  }
  return events
}

const PROGRESS_STAGE_LABEL: Record<string, string> = {
  start: 'Starting',
  route: 'Routing',
  tool_call: 'Calling tool',
  tool_result: 'Tool result',
  evidence_gate: 'Evidence gate',
  synthesis: 'Composing answer',
  checkpoint: 'Checkpoint',
  done: 'Done',
  failure: 'Failed',
}

/**
 * Compact, ordered timeline of a run's `ProgressEvent`s -- what makes the "the chat spins
 * for minutes then answers" fix visible: the FIRST badge appears the instant routing
 * starts (clearing `status === 'submitted'`'s spinner, see the Loader below), well before
 * the final answer streams.
 */
export function ProgressTimeline({ events, isStreaming }: { events: ProgressEventPayload[]; isStreaming: boolean }) {
  if (events.length === 0) return null
  return (
    <div className="my-1.5 flex flex-wrap items-center gap-1.5">
      {events.map((ev, i) => (
        <Badge
          key={i}
          variant={ev.status === 'failed' ? 'destructive' : 'outline'}
          className="font-normal text-[10px]"
        >
          {PROGRESS_STAGE_LABEL[ev.stage] ?? ev.stage}
          {ev.detail ? `: ${ev.detail}` : ''}
        </Badge>
      ))}
      {isStreaming && <Loader size={12} />}
    </div>
  )
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
 * SWE mode (relocated from the former dedicated `/swe` page, OS-5.34): when on, a
 * sent message drives the developer-workspace runtime (a sandboxed session, OS-5.33)
 * instead of the normal agent reply. Persisted in localStorage like `mode` above so
 * refreshes/navigation keep the user's last selection, independent of `mode` because
 * it toggles an entirely different send path rather than a request body parameter.
 */
const SWE_MODE_STORAGE_KEY = 'swe-mode'

/** One action+observation frame from the runtime session's SSE event stream. */
interface SweStreamEvent {
  // Optional, not required: `parsed` below is a raw `JSON.parse(...) as
  // SweStreamEvent` type assertion over an SSE frame, so nothing actually
  // guarantees either key is present at runtime -- the type previously
  // claimed otherwise while formatSweEvent()'s own `ev.action ?? {}` /
  // `ev.observation ?? {}` guards (correctly) defended against exactly that.
  // Declaring them required made those guards look dead to
  // `@typescript-eslint/no-unnecessary-condition` (flagged as errors), which
  // was backwards: the guards were right and the type was the lie.
  action?: Record<string, unknown>
  observation?: Record<string, unknown>
}

/** Coerce an unknown event field to a display string (events are typed Record<string, unknown>). */
function sweAsText(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

/** Render one SWE action/observation SSE frame as a Markdown chat message body. */
function formatSweEvent(ev: SweStreamEvent): string {
  const action = ev.action ?? {}
  const observation = ev.observation ?? {}
  const kind = sweAsText(action.kind) || 'action'
  const detail = sweAsText(action.command) || sweAsText(action.path)
  const header = `**[${kind}]** ${detail}`.trim()
  const output = (
    sweAsText(observation.stdout) ||
    sweAsText(observation.report) ||
    sweAsText(observation.diff) ||
    sweAsText(observation.message) ||
    sweAsText(observation.kind)
  ).slice(0, 4000)
  return output ? `${header}\n\n\`\`\`\n${output}\n\`\`\`` : header
}

/** Render a SWE provenance snapshot (actions + KG-mutated symbols) as a Markdown block. */
function formatSweProvenance(actions: SweProvenanceAction[], mutated: SweMutatedEdge[]): string {
  if (actions.length === 0) return '### KG provenance\n\nNo actions recorded yet.'
  const lines = actions.map((a) => {
    const symbols = mutated.filter((m) => m.action_id === a.id).map((m) => m.symbol_id)
    const symbolLine = symbols.length > 0 ? `\n  symbols: ${symbols.map((s) => `\`${s}\``).join(', ')}` : ''
    return `- **[${a.kind}]** step ${a.step}: ${a.summary}${symbolLine}`
  })
  return `### KG provenance\n\n${lines.join('\n')}`
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

/**
 * Resolve the per-1M-token cost rate for `modelId` by consulting the
 * backend registry. Returns `null` when the id is unknown to the
 * registry so callers can render a `—` placeholder; returns an explicit
 * `{ input: 0, output: 0 }` for configured zero-cost / local models so
 * they display as `$0.00` rather than "unavailable".
 */
function lookupModelRate(modelId: string | undefined, registry: ModelRegistryPayload | undefined): ModelRate | null {
  if (!modelId || !registry) return null
  const byId = registry.models.find((m) => m.id === modelId)
  if (byId) return byId.cost

  const lowered = modelId.toLowerCase()
  const byProviderModel = registry.models.find((m) => `${m.provider}:${m.model_id}`.toLowerCase() === lowered)
  if (byProviderModel) return byProviderModel.cost

  const byModelId = registry.models.find((m) => m.model_id.toLowerCase() === lowered)
  if (byModelId) return byModelId.cost

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
  const completion = toNumber(rec.completion_tokens) ?? toNumber(rec.outputTokens) ?? toNumber(rec.completionTokens)
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
        const candidate = parseUsage(ann.data) ?? parseUsage(ann.usage) ?? (isUsageEvent ? parseUsage(ann) : null)
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
 * Concatenate the human-readable text of a message's parts. Non-text parts
 * (tool calls, sources, files, reasoning) are summarised as bracketed tags so
 * the export stays faithful without dumping raw payloads.
 */
function extractMessageText(message: UIMessage): string {
  const parts = message.parts as unknown as MessagePart[] | undefined
  if (!parts || parts.length === 0) return ''
  const chunks: string[] = []
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      chunks.push(part.text)
    } else if (part.type === 'reasoning' && typeof part.text === 'string') {
      const progress = parseProgressEventPayload(part.text)
      chunks.push(
        progress
          ? `[progress: ${progress.stage} ${progress.status}${progress.detail ? ` — ${progress.detail}` : ''}]`
          : part.text,
      )
    } else if (part.type === 'source-url' && typeof part.url === 'string') {
      chunks.push(`[source: ${part.url}]`)
    } else if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
      const name = (part.type === 'dynamic-tool' ? part.toolName : part.type) as string
      chunks.push(`[tool: ${name}]`)
    }
  }
  return chunks.join('\n').trim()
}

/**
 * Render the conversation as a Markdown transcript.
 */
function conversationToMarkdown(messages: readonly UIMessage[], conversationId?: string): string {
  const header = ['# Conversation export']
  if (conversationId && conversationId !== '/') header.push(`\n_Conversation: ${conversationId}_`)
  header.push(`\n_Exported: ${new Date().toISOString()}_`)
  const body = messages.map((m) => {
    const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role
    const text = extractMessageText(m) || '_(no text content)_'
    return `## ${role}\n\n${text}`
  })
  return [...header, '', ...body, ''].join('\n')
}

/**
 * Render the conversation as a structured JSON document.
 */
function conversationToJson(messages: readonly UIMessage[], conversationId?: string): string {
  return JSON.stringify(
    {
      conversationId: conversationId && conversationId !== '/' ? conversationId : null,
      exportedAt: new Date().toISOString(),
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: extractMessageText(m),
        parts: m.parts,
      })),
    },
    null,
    2,
  )
}

/**
 * Trigger a client-side file download of `content` under `filename`.
 */
function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/**
 * Export the current conversation as Markdown or JSON, downloading the file.
 */
function exportConversation(
  format: 'markdown' | 'json',
  messages: readonly UIMessage[],
  conversationId?: string,
): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  if (format === 'json') {
    downloadTextFile(conversationToJson(messages, conversationId), `conversation-${stamp}.json`, 'application/json')
  } else {
    downloadTextFile(conversationToMarkdown(messages, conversationId), `conversation-${stamp}.md`, 'text/markdown')
  }
}

// D-WUI-22: /api/configure can answer an empty-object (or otherwise
// hostile) body. The old raw cast accepted it as `RemoteConfig` verbatim, so
// `configQuery.data?.models.find(...)` -- guarded only on `data` itself, not
// on `data.models` -- crashed with "Cannot read properties of undefined
// (reading 'find')" once `models` silently resolved to `undefined`.
const remoteConfigSchema: z.ZodType<RemoteConfig> = z.object({
  models: looseArray(
    z.object({
      id: z.string(),
      name: z.string(),
      builtinTools: looseArray(z.string()),
    }),
  ),
  builtinTools: looseArray(
    z.object({
      name: z.string(),
      id: z.string(),
    }),
  ),
})

/**
 * Fetches the available models and tools from the server configuration endpoint
 */
async function getModels() {
  return fetchValidated('/api/configure', remoteConfigSchema)
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
interface ChatProps {
  pageContext: PageContextEnvelope
}

/**
 * Primary Chat Component
 *
 * Orchestrates the chat lifecycle including message history management,
 * streaming response handling, and tool interaction flows.
 */
const Chat = ({ pageContext }: ChatProps) => {
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number>(0)

  useEffect(() => {
    if (input.startsWith('/')) {
      const controller = new AbortController()
      fetch(`/api/enhanced/commands/autocomplete?query=${encodeURIComponent(input)}`, {
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : { suggestions: [] }))
        .then((data: { suggestions?: string[] }) => {
          if (Array.isArray(data.suggestions)) {
            setSuggestions(data.suggestions)
            setActiveSuggestionIndex(0)
          } else {
            setSuggestions([])
          }
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name !== 'AbortError') {
            console.error('Error fetching autocomplete:', err)
          }
        })
      return () => {
        controller.abort()
      }
    } else {
      setSuggestions([])
    }
  }, [input])
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

  const [sweMode, setSweMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(SWE_MODE_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [sweSessionId, setSweSessionId] = useState<string | null>(null)
  const [sweBackend, setSweBackend] = useState('')
  const [sweBusy, setSweBusy] = useState(false)
  const sweEventSourceRef = useRef<EventSource | null>(null)

  const pageContextRef = useRef(pageContext)
  pageContextRef.current = pageContext
  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: '/api/chats/messages',
        prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => {
          const context = pageContextRef.current
          const contextMessage: UIMessage = {
            id: 'agent-webui-page-context',
            role: 'system',
            parts: [{ type: 'text', text: pageContextSystemPrompt(context) }],
          }
          return {
            body: {
              ...body,
              id,
              trigger,
              messages: [contextMessage, ...messages],
              ...(messageId ? { messageId } : {}),
              pageContext: context,
            },
          }
        },
      }),
    [],
  )
  const { messages, sendMessage, status, setMessages, regenerate, addToolOutput, error } = useChat({ transport })
  const throttledMessages = useThrottle<UIMessage[]>(messages, 500)
  const [conversationId, setConversationId] = useConversationIdFromUrl()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { identity } = useIdentity()
  const userKey = identity.userKey

  // Persist mode selection so navigation/reload preserves the user's choice.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(AGENT_MODE_STORAGE_KEY, mode)
    } catch {
      // Storage may be disabled (private mode, quota); non-fatal.
    }
  }, [mode])

  // Persist SWE mode selection the same way `mode` is persisted.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(SWE_MODE_STORAGE_KEY, String(sweMode))
    } catch {
      // Storage may be disabled (private mode, quota); non-fatal.
    }
  }, [sweMode])

  // Tear down any live SSE connection to the runtime session on unmount.
  useEffect(
    () => () => {
      sweEventSourceRef.current?.close()
    },
    [],
  )

  /** Best-effort teardown of the active SWE runtime session (OS-5.33), used by both
   * the explicit "Stop session" control and turning SWE mode off. */
  const stopSweSession = async () => {
    sweEventSourceRef.current?.close()
    sweEventSourceRef.current = null
    const sid = sweSessionId
    setSweSessionId(null)
    setSweBackend('')
    if (sid) {
      try {
        await api.stopSweSession(sid)
      } catch {
        /* best-effort teardown */
      }
    }
  }

  const handleToggleSweMode = () => {
    setSweMode((prev) => {
      const next = !prev
      if (!next) void stopSweSession()
      return next
    })
  }

  /**
   * Sends a chat message as a SWE runtime action instead of a normal agent turn:
   * lazily creates a developer-workspace session (OS-5.33), attaches the live
   * action/observation SSE stream into the transcript, and runs the message as a
   * `cmd_run` action — the same mechanism `SweView` used to drive directly.
   */
  const sendSweMessage = async (text: string) => {
    const userMsg: UIMessage = {
      id: nanoid(),
      role: 'user',
      parts: [{ type: 'text', text }],
    }
    setMessages((prev) => [...prev, userMsg])

    setSweBusy(true)
    try {
      let sid = sweSessionId
      if (!sid) {
        const res = await api.createSweSession({ prefer_docker: false })
        sid = res.session_id
        setSweSessionId(sid)
        setSweBackend(res.backend)

        const es = new EventSource(api.sweEventsUrl(sid))
        es.onmessage = (evt) => {
          try {
            const parsed = JSON.parse(evt.data as string) as SweStreamEvent
            const assistantMsg: UIMessage = {
              id: nanoid(),
              role: 'assistant',
              parts: [{ type: 'text', text: formatSweEvent(parsed) }],
            }
            setMessages((prev) => [...prev, assistantMsg])
          } catch {
            /* ignore malformed SSE frames */
          }
        }
        sweEventSourceRef.current = es
      }

      await api.sweAct(sid, { kind: 'cmd_run', command: text })
    } catch (err) {
      const errorMsg: UIMessage = {
        id: nanoid(),
        role: 'assistant',
        parts: [{ type: 'text', text: `❌ SWE action failed: ${err instanceof Error ? err.message : String(err)}` }],
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setSweBusy(false)
    }
  }

  /** Fetch KG provenance (actions + mutated symbols) for the active session and
   * render it as a compact Markdown block appended to the transcript — the chat-path
   * equivalent of `SweView`'s dedicated provenance panel. */
  const loadSweProvenance = async () => {
    if (!sweSessionId) return
    try {
      const p = await api.sweProvenance(sweSessionId)
      const provenanceMsg: UIMessage = {
        id: nanoid(),
        role: 'assistant',
        parts: [{ type: 'text', text: formatSweProvenance(p.actions, p.mutated) }],
      }
      setMessages((prev) => [...prev, provenanceMsg])
    } catch (err) {
      const errorMsg: UIMessage = {
        id: nanoid(),
        role: 'assistant',
        parts: [
          { type: 'text', text: `❌ Failed to load provenance: ${err instanceof Error ? err.message : String(err)}` },
        ],
      }
      setMessages((prev) => [...prev, errorMsg])
    }
  }

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
    let cancelled = false
    if (conversationId === '/') {
      setMessages([])
    } else {
      const storedMessages = readConversationMessages(userKey, conversationId)
      if (storedMessages) {
        setMessages(storedMessages as typeof messages)
      } else {
        const fetchMessages = async () => {
          try {
            const res = await fetch(`/api/chats${conversationId}`)
            if (!res.ok) return
            const data = (await res.json()) as ChatResponse
            if (cancelled) return
            // BUG-259: starting a NEW conversation sets `conversationId` and
            // calls `sendMessage(...)` in the same `handleSubmit` -- both of
            // which change on this exact dependency and race this fetch. A
            // brand-new conversation has no server history yet, so this
            // resolves with `{messages: []}` -- unconditionally applying it
            // used to CLOBBER the message `sendMessage` had already
            // optimistically added, dropping `messages` back to `[]` and
            // triggering the "no messages yet" guard below, which renders
            // nothing at all -- the reported permanently blank chat window.
            // Only apply the fetched history if nothing has populated
            // `messages` in the meantime (functional update avoids a stale
            // read of the `messages` closure).
            setMessages((current) => (current.length > 0 ? current : data.messages))
          } catch (err) {
            console.error('Failed to fetch messages for conversation', err)
          }
        }
        void fetchMessages()
      }
    }
    textareaRef.current?.focus()
    return () => {
      cancelled = true
    }
  }, [conversationId, userKey])

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

  /** Body of the `/help` slash command. */
  const slashHelp = (): string => `### 💻 Agent WebUI Slash Commands

Available commands:
- **\`/help\`**: Show this help summary.
- **\`/clear\`** or **\`/reset\`**: Wipe all messages in this conversation.
- **\`/new [model]\`**: Archive the current conversation and start a new one. Optionally specify a model ID (e.g. \`/new\`, \`/new gpt-4o\`).
- **\`/tools\`**: List all tools configured for the current agent/model.
- **\`/model [model_id]\`**: View active model or switch to a new model (e.g. \`/model\`, \`/model gemini-2.5-pro\`).
- **\`/mode [ask|plan|code]\`**: View or change the agent interaction mode (e.g. \`/mode\`, \`/mode code\`).
- **\`/system\`**: Retrieve the active agent's system prompt.
- **\`/prompt [name]\`**: View or list system prompt profiles (e.g. \`/prompt\`, \`/prompt mobile_programmer\`).
- **\`/skills\`**: List loaded custom skills centrally.
- **\`/graph stats|nodes|search|impact\`**: Access knowledge graph and run blast radius / impact analysis.
- **\`/kb list|search|ingest\`**: Manage and query connected knowledge bases.
- **\`/sdd specs|constitution|sync\`**: Manage spec-driven development rules and sync workspace.
- **\`/cron calendar|logs\`**: View scheduled background tasks and logs.
- **\`/resources list|spawn\`**: List and spawn subagents and tasks.`

  /** Body of the `/clear` and `/reset` slash commands. Handles its own message replacement. */
  const slashClear = (): void => {
    setMessages([])
    if (conversationId && conversationId !== '/') {
      removeConversationMessages(userKey, conversationId)
    }
    setInput('')
  }

  /** Body of the `/new` slash command. Handles its own message replacement. */
  const slashNew = (arg: string): void => {
    const newConversationId = `/${nanoid()}`
    let modelMsg = ''
    if (arg) {
      const list = modelRegistry?.models ?? configQuery.data?.models ?? []
      const matched = list.find(
        (m) => m.id.toLowerCase().includes(arg.toLowerCase()) || m.name.toLowerCase().includes(arg.toLowerCase()),
      )
      if (matched) {
        setModel(matched.id)
        modelMsg = ` with model **${matched.name}** (\`${matched.id}\`)`
      } else {
        modelMsg = ` (model \`${arg}\` not found, keeping active model)`
      }
    }

    saveConversationEntry(userKey, newConversationId, arg ? `New chat (${arg})` : 'New Chat')
    setConversationId(newConversationId)

    const welcomeMsg: UIMessage = {
      id: nanoid(),
      role: 'assistant',
      parts: [{ type: 'text', text: `🔄 Started a fresh conversation${modelMsg}. How can I assist you today?` }],
    }
    setMessages([welcomeMsg])
    setInput('')
  }

  /** Body of the `/tools` slash command. */
  const slashTools = (): string => {
    const toolList = availableTools.map((t) => `- **${t.name}** (\`${t.id}\`)`).join('\n')
    return `### 🛠️ Available Tools for \`${model}\`\n\n${toolList || 'No tools configured.'}`
  }

  /** Body of the `/model` slash command with no argument: reports the active model. */
  const slashModelStatus = (): string => {
    const currentModelName = modelRegistry?.models.find((m) => m.id === model)?.name ?? model
    const modelsList =
      (modelRegistry?.models ?? configQuery.data?.models ?? []).map((m) => `- \`${m.id}\` (${m.name})`).join('\n') ||
      ''
    return `**Active Model:** \`${currentModelName}\` (\`${model}\`)\n\n**Available Models:**\n${modelsList}`
  }

  /** Body of the `/model <arg>` slash command: switches the active model. */
  const slashModelSwitch = (arg: string): string => {
    const list = modelRegistry?.models ?? configQuery.data?.models ?? []
    const matched = list.find(
      (m) => m.id.toLowerCase().includes(arg.toLowerCase()) || m.name.toLowerCase().includes(arg.toLowerCase()),
    )
    if (matched) {
      setModel(matched.id)
      return `🔄 Active model switched to **${matched.name}** (\`${matched.id}\`).`
    }
    return (
      `❌ Model \`${arg}\` not found. Available models:\n` + list.map((m) => `- \`${m.id}\` (${m.name})`).join('\n')
    )
  }

  /** Body of the `/model` slash command. */
  const slashModel = (arg: string): string => (arg ? slashModelSwitch(arg) : slashModelStatus())

  /** Body of the `/mode` slash command. */
  const slashMode = (arg: string): string => {
    if (!arg) {
      return `Active agent interaction mode: **${mode}** (options: \`ask\`, \`plan\`, \`code\`).`
    }
    const normalized = arg.toLowerCase()
    if (normalized === 'ask' || normalized === 'plan' || normalized === 'code') {
      setMode(normalized)
      return `🔄 Interaction mode switched to **${normalized}**.`
    }
    return `❌ Invalid mode \`${arg}\`. Valid options are: \`ask\`, \`plan\`, \`code\`.`
  }

  /** Body of the `/system` slash command. */
  const slashSystem = async (): Promise<string> => {
    try {
      const res = await fetch('/api/enhanced/system')
      if (res.ok) {
        const data = (await res.json()) as { system_prompt?: string }
        return `### 🤖 Active Agent System Prompt\n\n\`\`\`markdown\n${
          data.system_prompt ?? 'No system prompt found.'
        }\n\`\`\``
      }
      return `❌ Failed to fetch active system prompt from agent server.`
    } catch (e) {
      return `❌ Error retrieving system prompt: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  /** Body of the `/prompt` slash command with no argument: lists prompt profiles. */
  const slashPromptList = async (): Promise<string> => {
    try {
      const res = await fetch('/api/enhanced/prompts')
      if (res.ok) {
        const list = (await res.json()) as { name: string; title: string }[]
        const items = list.map((p) => `- \`${p.name}\`: **${p.title}**`).join('\n')
        return `### 📝 Registered Prompt Profiles\n\n${
          items || 'No prompt profiles found.'
        }\n\n*Use \`/prompt [name]\` to view a specific profile.*`
      }
      return `❌ Failed to load prompts list.`
    } catch (e) {
      return `❌ Error loading prompts: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  /** Body of the `/prompt <arg>` slash command: fetches one prompt profile. */
  const slashPromptShow = async (arg: string): Promise<string> => {
    try {
      const res = await fetch(`/api/enhanced/prompts/${arg}`)
      if (res.ok) {
        const data = (await res.json()) as { title?: string; goal?: string; core_directive?: string }
        return (
          `### 📝 Prompt Profile: **${data.title ?? arg}** (\`${arg}.json\`)\n\n` +
          `**Goal:** ${data.goal ?? 'No goal specified.'}\n\n` +
          `#### Core Directive:\n\`\`\`markdown\n${data.core_directive ?? 'No directive.'}\n\`\`\``
        )
      }
      return `❌ Prompt profile \`${arg}\` not found.`
    } catch (e) {
      return `❌ Error loading prompt: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  /** Body of the `/prompt` slash command. */
  const slashPrompt = (arg: string): Promise<string> => (arg ? slashPromptShow(arg) : slashPromptList())

  /** Applies one client action returned by the gateway's slash-command executor. */
  const applySlashClientAction = (act: { action?: string; value?: string }): void => {
    if (act.action === 'clear_chat') {
      setMessages([])
      if (conversationId && conversationId !== '/') {
        window.localStorage.removeItem(conversationId)
      }
      setInput('')
    } else if (act.action === 'set_model' && act.value) {
      setModel(act.value)
    }
  }

  /** Body of the default (server-executed) slash command branch. */
  const slashExecuteOnGateway = async (command: string, trimmed: string): Promise<string> => {
    try {
      const res = await fetch('/api/enhanced/commands/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: trimmed }),
      })
      if (!res.ok) {
        return `❌ Failed to execute slash command \`${command}\` on the gateway server.`
      }
      const data = (await res.json()) as {
        response_markdown?: string
        client_actions?: { action?: string; value?: string }[]
      }
      for (const act of data.client_actions ?? []) {
        applySlashClientAction(act)
      }
      return data.response_markdown ?? ''
    } catch (e) {
      return `❌ Error executing slash command: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  /** Dispatches a parsed slash command to its handler. */
  const dispatchSlashCommand = async (command: string, arg: string, trimmed: string): Promise<string> => {
    switch (command) {
      case '/help':
        return slashHelp()
      case '/tools':
        return slashTools()
      case '/model':
        return slashModel(arg)
      case '/mode':
        return slashMode(arg)
      case '/system':
        return await slashSystem()
      case '/prompt':
        return await slashPrompt(arg)
      default:
        return await slashExecuteOnGateway(command, trimmed)
    }
  }

  /**
   * Processes a client-side slash command and appends the result to the chat.
   */
  const handleSlashCommand = async (rawInput: string) => {
    const trimmed = rawInput.trim()
    if (!trimmed.startsWith('/')) return false

    const parts = trimmed.split(/\s+/)
    const command = parts[0].toLowerCase()
    const arg = parts.slice(1).join(' ').trim()

    // Add user message to display
    const userMsg: UIMessage = {
      id: nanoid(),
      role: 'user',
      parts: [{ type: 'text', text: trimmed }],
    }

    if (command === '/clear' || command === '/reset') {
      slashClear()
      return true
    }
    if (command === '/new') {
      slashNew(arg)
      return true
    }

    const assistantReply = await dispatchSlashCommand(command, arg, trimmed)

    const replyMsg: UIMessage = {
      id: nanoid(),
      role: 'assistant',
      parts: [{ type: 'text', text: assistantReply }],
    }

    setMessages([...messages, userMsg, replyMsg])
    setInput('')
    return true
  }

  const handleInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveSuggestionIndex((prev) => (prev + 1) % suggestions.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveSuggestionIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        setInput(suggestions[activeSuggestionIndex])
        setSuggestions([])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setSuggestions([])
      }
    } else {
      if (e.key === 'Enter') {
        if (e.nativeEvent.isComposing || e.shiftKey) {
          return
        }
        e.preventDefault()
        const form = e.currentTarget.form
        if (form) {
          form.requestSubmit()
        }
      }
    }
  }

  /**
   * Submits the user prompt, handling conversation initialization and optional ACP/Multi-modal routing.
   */
  const handleSubmit = (e: SyntheticEvent) => {
    e.preventDefault()
    if (input.trim()) {
      if (input.trim().startsWith('/')) {
        void handleSlashCommand(input.trim())
        return
      }

      if (conversationId === '/') {
        const newConversationId = `/${nanoid()}`
        setConversationId(newConversationId)

        saveConversationEntry(userKey, newConversationId, input)
      }

      if (sweMode) {
        void sendSweMessage(input)
        setInput('')
        setAttachments([])
        return
      }

      const message: UIMessage = {
        id: nanoid(),
        role: 'user',
        parts: [
          { type: 'text', text: input },
          ...attachments.map((attachment) => ({
            type: 'file' as const,
            mediaType: attachment.type,
            url: attachment.base64,
          })),
        ],
      }

      void sendMessage(message, {
        body: {
          model,
          builtinTools: enabledTools,
          mode,
        },
      }).catch((error: unknown) => {
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
      writeConversationMessages(userKey, conversationId, throttledMessages)
    }
  }, [throttledMessages, conversationId])

  /**
   * Triggers a message regeneration for the specified ID
   */
  function regen(_messageId: string) {
    void regenerate({ messageId: _messageId }).catch((error: unknown) => {
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
              {message.role === 'assistant' && (
                <ProgressTimeline
                  events={extractProgressEvents(message.parts as unknown as MessagePart[])}
                  isStreaming={
                    status === 'streaming' && throttledMessages.indexOf(message) === throttledMessages.length - 1
                  }
                />
              )}
              {(message.parts as unknown as MessagePart[])
                // Progress-event reasoning parts stream through ProgressTimeline above
                // instead -- excluded here so they don't ALSO render as raw-JSON generic
                // "Thinking" bubbles via <Part>'s default reasoning handling.
                .filter((part) => !isProgressEventPart(part))
                .map((part, i: number) => (
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

      <div className="sticky bottom-0 p-3 relative">
        {suggestions.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-2 max-h-60 overflow-y-auto rounded-lg border border-border bg-background/95 backdrop-blur-md shadow-lg z-50 divide-y divide-border">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                type="button"
                className={cn(
                  'w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-colors',
                  index === activeSuggestionIndex
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
                onClick={() => {
                  setInput(suggestion)
                  setSuggestions([])
                  textareaRef.current?.focus()
                }}
              >
                <span>{suggestion}</span>
                {index === activeSuggestionIndex && (
                  <span className="text-xs text-muted-foreground bg-background border rounded px-1.5 py-0.5">
                    Tab or Enter
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea
            ref={textareaRef}
            onChange={(e) => {
              setInput(e.target.value)
            }}
            onKeyDown={handleInputKeyDown}
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
              <VoiceDictationButton
                onTranscript={(text) => {
                  if (!text) return
                  setInput((prev) => (prev ? `${prev} ${text}` : text))
                  textareaRef.current?.focus()
                }}
              />
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <PromptInputButton
                    variant={sweMode ? 'default' : 'outline'}
                    aria-pressed={sweMode}
                    aria-label="Toggle SWE mode"
                    onClick={handleToggleSweMode}
                  >
                    <Wrench className="size-4" />
                  </PromptInputButton>
                </TooltipTrigger>
                <TooltipContent>
                  {sweMode
                    ? 'SWE mode is on — messages run as commands in a live developer workspace'
                    : 'Enable SWE mode: drive a developer-workspace runtime from chat'}
                </TooltipContent>
              </Tooltip>
              {sweMode && sweSessionId && (
                <>
                  <Badge variant="secondary" className="font-mono text-xs">
                    swe:{sweBackend || sweSessionId}
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PromptInputButton
                        variant="outline"
                        aria-label="Load KG provenance"
                        onClick={() => {
                          void loadSweProvenance()
                        }}
                      >
                        <GitBranch className="size-4" />
                      </PromptInputButton>
                    </TooltipTrigger>
                    <TooltipContent>Load KG provenance (symbols this session mutated)</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PromptInputButton
                        variant="outline"
                        aria-label="Stop SWE session"
                        onClick={() => {
                          void stopSweSession()
                        }}
                      >
                        <Square className="size-4" />
                      </PromptInputButton>
                    </TooltipTrigger>
                    <TooltipContent>Stop SWE session</TooltipContent>
                  </Tooltip>
                </>
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
                        <strong>Completion:</strong> {TOKEN_FORMATTER.format(sessionUsage.completion_tokens)} tokens
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
              {messages.length > 0 && (
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <PromptInputButton variant="outline" aria-label="Export conversation">
                          <DownloadIcon className="size-4" />
                        </PromptInputButton>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Export conversation</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() => {
                        exportConversation('markdown', messages, conversationId)
                      }}
                    >
                      Export as Markdown
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        exportConversation('json', messages, conversationId)
                      }}
                    >
                      Export as JSON
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
            <PromptInputSubmit disabled={!input || (sweMode && sweBusy)} status={status} />
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </div>
  )
}

export default Chat
