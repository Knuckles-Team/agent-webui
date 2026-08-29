import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, CheckCircle, ExternalLink, Globe, Plus, RefreshCw, Search, Sparkles, Trash2, Wrench } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import { toast } from 'sonner'
import { fetchValidated } from '@/lib/api-validation'

/**
 * @file AgentLibraryView.tsx
 * @description The Agent Library: compose a local agent from a name, instructions,
 * and hand-picked (or whole-server) tools, register an external A2A agent, browse
 * what already exists, and see suggestions derived from what is actually installed
 * and ingested. Every entry here is a real `CallableResource` graph node the
 * delegation engine can run by name — this page is the missing "create" half of
 * the prompt/skills/tools views, not a separate silo.
 */

interface LibraryAgent {
  id: string
  name: string
  description: string
  kind: 'local' | 'a2a'
  mcp_server?: string | null
  model_preference?: string | null
  timestamp?: string | null
  status?: string
  runnable_bound?: boolean
  tools?: { id?: string; name?: string }[]
  endpoint?: string | null
}

interface LibraryTool {
  id: string
  name: string
  mcp_server?: string | null
  tags: string[]
}

interface Suggestion {
  mcp_server: string
  tool_count: number
  sample_tools: string[]
  reason: string
}

interface ChatModelSummary {
  id: string
  provider: string
  intelligence_level?: string
  vision?: boolean
  reasoning?: boolean
  tools_enabled?: boolean
  can_route?: boolean
  can_kg?: boolean
  context_window?: number | null
}

interface EmbeddingModelSummary {
  id: string
  provider: string
  chunk_size?: number
  context_window?: number | null
}

interface ConfigSummary {
  app_profile: string
  deployment_profile: string
  chat_models: ChatModelSummary[]
  embedding_models: EmbeddingModelSummary[]
}

type TabId = 'library' | 'compose' | 'external' | 'config'

function isTabId(value: string): value is TabId {
  return value === 'library' || value === 'compose' || value === 'external' || value === 'config'
}

interface RevisionRef {
  current: number
}

function bumpTabRevisionsIfChanged(
  nextTab: TabId,
  currentTab: TabId,
  compose: RevisionRef,
  external: RevisionRef,
): void {
  if (nextTab !== currentTab) {
    compose.current += 1
    external.current += 1
  }
}

const libraryAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  kind: z.enum(['local', 'a2a']),
  mcp_server: z.string().nullable().optional(),
  model_preference: z.string().nullable().optional(),
  timestamp: z.string().nullable().optional(),
  status: z.string().optional(),
  runnable_bound: z.boolean().optional(),
  tools: z.array(z.object({ id: z.string().optional(), name: z.string().optional() })).optional(),
  endpoint: z.string().nullable().optional(),
})

const libraryToolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mcp_server: z.string().nullable().optional(),
  tags: z.array(z.string()),
})

const suggestionSchema = z.object({
  mcp_server: z.string().min(1),
  tool_count: z.number().int().nonnegative(),
  sample_tools: z.array(z.string()),
  reason: z.string(),
})

const chatModelSummarySchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  intelligence_level: z.string().optional(),
  vision: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  tools_enabled: z.boolean().optional(),
  can_route: z.boolean().optional(),
  can_kg: z.boolean().optional(),
  context_window: z.number().int().positive().nullable().optional(),
})

const embeddingModelSummarySchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  chunk_size: z.number().int().positive().optional(),
  context_window: z.number().int().positive().nullable().optional(),
})

const configSummarySchema = z.object({
  app_profile: z.string(),
  deployment_profile: z.string(),
  chat_models: z.array(chatModelSummarySchema),
  embedding_models: z.array(embeddingModelSummarySchema),
})

interface RequestRefs {
  sequence: { current: number }
  controller: { current: AbortController | null }
}

function beginRequest(refs: RequestRefs): { id: number; controller: AbortController } {
  refs.controller.current?.abort()
  const controller = new AbortController()
  const id = refs.sequence.current + 1
  refs.sequence.current = id
  refs.controller.current = controller
  return { id, controller }
}

function isCurrentRequest(refs: RequestRefs, id: number, controller: AbortController): boolean {
  return refs.sequence.current === id && refs.controller.current === controller && !controller.signal.aborted
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function cancelRequests(refs: RequestRefs[]): void {
  for (const requestRefs of refs) {
    requestRefs.sequence.current += 1
    requestRefs.controller.current?.abort()
    requestRefs.controller.current = null
  }
}

function navigateTo(path: string): void {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new Event('history-state-changed'))
}

// Keep the client-side compose checks aligned with the endpoint's bounded agent
// name and instruction limits. The server remains authoritative; these checks
// prevent a beginner from waiting on a request that can only return a
// validation error.
const MAX_AGENT_NAME_LENGTH = 120
const MAX_AGENT_INSTRUCTIONS_LENGTH = 32_000
const MAX_EXTERNAL_AGENT_URL_BYTES = 2_048

function httpUrlError(value: string): string | null {
  const url = value.trim()
  if (!url) return 'Enter the URL of the external agent'
  if (utf8ByteLength(url) > MAX_EXTERNAL_AGENT_URL_BYTES) {
    return 'The URL must be 2,048 UTF-8 bytes or fewer'
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Use an http:// or https:// URL'
    }
  } catch {
    return 'Enter a complete http:// or https:// URL'
  }
  return null
}

interface ParsedAgentCard {
  value: unknown
  error: string | null
}

function parseAgentCard(value: string): ParsedAgentCard {
  if (!value.trim()) return { value: undefined, error: null }
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { value: undefined, error: 'Agent card JSON must be a non-empty JSON object' }
    }
    if (Object.keys(parsed).length === 0) {
      return { value: undefined, error: 'Agent card JSON must be a non-empty JSON object' }
    }
    return { value: parsed, error: null }
  } catch {
    return { value: undefined, error: 'Enter valid JSON for the agent card' }
  }
}

function externalUrlError(value: string): string | null {
  return value.trim() ? httpUrlError(value) : null
}

function describedBy(helpId: string, errorId: string, error: string | null): string {
  return error ? `${helpId} ${errorId}` : helpId
}

function renderValidationError(errorId: string, error: string | null) {
  if (!error) return null
  return (
    <p id={errorId} role="alert" className="mt-1 text-[11px] text-red-400 font-medium">
      {error}
    </p>
  )
}

function isExternalRegistrationDisabled(
  registering: boolean,
  url: string,
  urlError: string | null,
  cardError: string | null,
): boolean {
  return [registering, !url.trim(), Boolean(urlError), Boolean(cardError)].some(Boolean)
}

function suggestedAgentName(server: string): string {
  const safeServer = server.replace(/[^A-Za-z0-9_.:-]/g, '-').replace(/^[^A-Za-z0-9]+/, '')
  const suffix = '-agent'
  return `${(safeServer || 'custom').slice(0, MAX_AGENT_NAME_LENGTH - suffix.length)}${suffix}`
}

// Python's len(str) counts Unicode code points, while JavaScript's string
// length counts UTF-16 code units. Array.from gives the same character count
// as the server for names containing astral Unicode characters.
function characterLength(value: string): number {
  return Array.from(value).length
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

interface MutationSuccess {
  ok: true
}

interface MutationFailure {
  ok: false
  error: string
}

type MutationResult = MutationSuccess | MutationFailure

function ignoreJsonParseError(): null {
  return null
}

async function postJson(path: string, payload: unknown, fallbackMessage: string): Promise<MutationResult> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (res.ok) return { ok: true }
  const body = (await res.json().catch(ignoreJsonParseError)) as { detail?: string } | null
  return { ok: false, error: body?.detail ?? fallbackMessage }
}

interface ExternalRegistrationValidation {
  url: string
  agentCard: unknown
  error: string | null
}

function validateExternalRegistration(url: string, cardJson: string): ExternalRegistrationValidation {
  const trimmedUrl = url.trim()
  const urlError = trimmedUrl ? httpUrlError(url) : 'An agent URL is required'
  const parsedCard = parseAgentCard(cardJson)
  return { url: trimmedUrl, agentCard: parsedCard.value, error: urlError ?? parsedCard.error }
}

function composeValidationError(name: string, instructions: string): string | null {
  if (!name || !instructions) return 'Name and instructions are required'
  if (characterLength(name) > MAX_AGENT_NAME_LENGTH) {
    return `Agent name must be ${MAX_AGENT_NAME_LENGTH} characters or fewer`
  }
  if (utf8ByteLength(instructions) > MAX_AGENT_INSTRUCTIONS_LENGTH) {
    return `Instructions must be ${MAX_AGENT_INSTRUCTIONS_LENGTH.toLocaleString()} bytes or fewer`
  }
  return null
}

const EMPTY_CONFIG: ConfigSummary = {
  app_profile: '',
  deployment_profile: '',
  chat_models: [],
  embedding_models: [],
}

interface SuggestionsGridProps {
  loadingSuggestions: boolean
  suggestionsUnavailable: boolean
  suggestions: Suggestion[]
  onStartFromSuggestion: (s: Suggestion) => void
}

function renderSuggestionsUnavailable() {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-emerald-400" /> Suggested, from what is installed
      </h3>
      <UnavailableNotice what="Agent suggestions" />
    </div>
  )
}

function renderSuggestionCard(suggestion: Suggestion, onStartFromSuggestion: (s: Suggestion) => void) {
  return (
    <div
      key={suggestion.mcp_server}
      className="p-3.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-sm text-foreground">{suggestion.mcp_server}</span>
        <Badge variant="secondary" className="text-[10px]">
          {suggestion.tool_count} tool{suggestion.tool_count === 1 ? '' : 's'}
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">{suggestion.reason}</p>
      <Button
        size="sm"
        variant="outline"
        className="self-start h-7 text-xs"
        onClick={onStartFromSuggestion.bind(null, suggestion)}
      >
        <Plus className="size-3.5 mr-1" /> Build this agent
      </Button>
    </div>
  )
}

function renderAvailableSuggestions(suggestions: Suggestion[], onStartFromSuggestion: (s: Suggestion) => void) {
  if (suggestions.length === 0) return null
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-emerald-400" /> Suggested, from what is installed
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {suggestions.slice(0, 6).map((suggestion) => renderSuggestionCard(suggestion, onStartFromSuggestion))}
      </div>
    </div>
  )
}

function renderSuggestionsGrid({
  loadingSuggestions,
  suggestionsUnavailable,
  suggestions,
  onStartFromSuggestion,
}: SuggestionsGridProps) {
  if (loadingSuggestions) return null
  if (suggestionsUnavailable) return renderSuggestionsUnavailable()
  return renderAvailableSuggestions(suggestions, onStartFromSuggestion)
}

interface ValidatedRequestOptions<T> {
  refs: RequestRefs
  path: string
  schema: z.ZodType<T>
  fallback: T
  setData: (value: T) => void
  setLoading: (value: boolean) => void
  setUnavailable: (value: boolean) => void
  onFailure?: () => void
}

async function loadValidatedRequest<T>({
  refs,
  path,
  schema,
  fallback,
  setData,
  setLoading,
  setUnavailable,
  onFailure,
}: ValidatedRequestOptions<T>): Promise<void> {
  const request = beginRequest(refs)
  try {
    setLoading(true)
    const data = await fetchValidated(path, schema, { signal: request.controller.signal })
    if (!isCurrentRequest(refs, request.id, request.controller)) return
    setData(data)
    setUnavailable(false)
  } catch (error) {
    if (!isCurrentRequest(refs, request.id, request.controller) || isAbortError(error)) return
    setData(fallback)
    setUnavailable(true)
    onFailure?.()
  } finally {
    if (isCurrentRequest(refs, request.id, request.controller)) setLoading(false)
  }
}

function reportAgentLibraryFailure(): void {
  toast.error('Failed to connect to the Agent Library')
}

function renderAgentCard({ agent, onArchive }: { agent: LibraryAgent; onArchive: (agent: LibraryAgent) => void }) {
  return (
    <div
      key={agent.id}
      className="p-4 rounded-xl border border-border/40 bg-muted/10 backdrop-blur-sm hover:border-emerald-500/30 transition-all flex flex-col justify-between"
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            {agent.kind === 'a2a' ? (
              <Globe className="size-4 text-teal-400 shrink-0" />
            ) : (
              <Bot className="size-4 text-emerald-400 shrink-0" />
            )}
            <h4 className="font-bold text-sm text-foreground truncate">{agent.name}</h4>
          </div>
          <Badge
            variant="outline"
            className={`text-[10px] font-semibold shrink-0 ${
              agent.kind === 'a2a'
                ? 'bg-teal-500/10 border-teal-500/30 text-teal-400'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            }`}
          >
            {agent.kind === 'a2a' ? 'External · A2A' : 'Local'}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-normal line-clamp-3">
          {agent.description || 'No description.'}
        </p>
        {agent.mcp_server && (
          <div className="text-[10px] text-muted-foreground mt-2">
            <Wrench className="size-3 inline mr-1" />
            bound to <code className="font-mono">{agent.mcp_server}</code>
          </div>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-3">
        <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
          <CheckCircle className="size-3" />
          {agent.runnable_bound === false ? 'Prompt only' : 'Delegatable'}
        </div>
        <button
          type="button"
          onClick={() => {
            onArchive(agent)
          }}
          className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all"
          aria-label={`Archive ${agent.name}`}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function renderAgentGrid({
  loadingAgents,
  agentsUnavailable,
  filteredAgents,
  onArchive,
}: {
  loadingAgents: boolean
  agentsUnavailable: boolean
  filteredAgents: LibraryAgent[]
  onArchive: (agent: LibraryAgent) => void
}) {
  if (loadingAgents) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <RefreshCw className="size-8 text-emerald-500 animate-spin" />
        <span className="text-sm text-muted-foreground font-medium">Querying the graph...</span>
      </div>
    )
  }
  if (agentsUnavailable) {
    return (
      <div className="text-center py-12">
        <UnavailableNotice what="The Agent Library" className="justify-center" />
      </div>
    )
  }
  if (filteredAgents.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No agents yet. Compose one, or register an external A2A agent.
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {filteredAgents.map((agent) => renderAgentCard({ agent, onArchive }))}
    </div>
  )
}

interface LibraryTabProps {
  loadingSuggestions: boolean
  suggestionsUnavailable: boolean
  suggestions: Suggestion[]
  onStartFromSuggestion: (s: Suggestion) => void
  search: string
  onSearchChange: (v: string) => void
  onRefresh: () => void
  loadingAgents: boolean
  onNewAgent: () => void
  agentsUnavailable: boolean
  filteredAgents: LibraryAgent[]
  onArchive: (agent: LibraryAgent) => void
}

function renderLibraryTab(props: LibraryTabProps) {
  const {
    loadingSuggestions,
    suggestionsUnavailable,
    suggestions,
    onStartFromSuggestion,
    search,
    onSearchChange,
    onRefresh,
    loadingAgents,
    onNewAgent,
    agentsUnavailable,
    filteredAgents,
    onArchive,
  } = props
  return (
    <div className="space-y-6">
      {renderSuggestionsGrid({ loadingSuggestions, suggestionsUnavailable, suggestions, onStartFromSuggestion })}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            aria-label="Search agents"
            placeholder="Search your agents..."
            value={search}
            onChange={(e) => {
              onSearchChange(e.target.value)
            }}
            className="pl-9 h-9 bg-muted/20"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={onRefresh}
          disabled={loadingAgents}
          aria-label="Refresh agents"
        >
          <RefreshCw className={`size-4 ${loadingAgents ? 'animate-spin' : ''}`} />
        </Button>
        <Button size="sm" onClick={onNewAgent}>
          <Plus className="size-4 mr-1.5" /> New agent
        </Button>
      </div>

      <ScrollArea className="h-[calc(100vh-32rem)] min-h-[16rem] pr-2">
        {renderAgentGrid({ loadingAgents, agentsUnavailable, filteredAgents, onArchive })}
      </ScrollArea>
    </div>
  )
}

interface ComposeTabProps {
  composeName: string
  onComposeNameChange: (v: string) => void
  composeDescription: string
  onComposeDescriptionChange: (v: string) => void
  composeInstructions: string
  onComposeInstructionsChange: (v: string) => void
  composeServer: string
  onComposeServerChange: (v: string) => void
  serverNames: string[]
  composeModel: string
  onComposeModelChange: (v: string) => void
  chatModels: ChatModelSummary[]
  loadingTools: boolean
  toolsUnavailable: boolean
  tools: LibraryTool[]
  selectedToolIds: Set<string>
  onToggleTool: (id: string) => void
  composing: boolean
  onCompose: () => void
}

function renderComposeToolRow(tool: LibraryTool, selectedToolIds: Set<string>, onToggleTool: (id: string) => void) {
  return (
    <label
      key={tool.id}
      htmlFor={`compose-tool-${tool.id}`}
      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/20 cursor-pointer"
    >
      <Checkbox
        id={`compose-tool-${tool.id}`}
        aria-label={`Use ${tool.name}${tool.mcp_server ? ` from ${tool.mcp_server}` : ''}`}
        checked={selectedToolIds.has(tool.id)}
        onCheckedChange={onToggleTool.bind(null, tool.id)}
      />
      <span className="text-xs font-mono">{tool.name}</span>
      {tool.mcp_server && <span className="text-[10px] text-muted-foreground ml-auto">{tool.mcp_server}</span>}
    </label>
  )
}

function renderComposeToolPicker({
  loadingTools,
  toolsUnavailable,
  tools,
  selectedToolIds,
  onToggleTool,
}: Pick<ComposeTabProps, 'loadingTools' | 'toolsUnavailable' | 'tools' | 'selectedToolIds' | 'onToggleTool'>) {
  if (loadingTools) return <div className="text-xs text-muted-foreground p-2">Loading tools...</div>
  if (toolsUnavailable) {
    return (
      <div className="p-2">
        <UnavailableNotice what="The tool catalog" />
      </div>
    )
  }
  if (tools.length === 0) {
    return (
      <div className="text-xs text-muted-foreground p-2">
        No tools ingested yet for this filter — the agent can still run prompt-only.
      </div>
    )
  }
  return <>{tools.map((tool) => renderComposeToolRow(tool, selectedToolIds, onToggleTool))}</>
}

function renderComposeTab(props: ComposeTabProps) {
  const {
    composeName,
    onComposeNameChange,
    composeDescription,
    onComposeDescriptionChange,
    composeInstructions,
    onComposeInstructionsChange,
    composeServer,
    onComposeServerChange,
    serverNames,
    composeModel,
    onComposeModelChange,
    chatModels,
    composing,
    onCompose,
  } = props
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <label
          htmlFor="compose-agent-name"
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        >
          Name
        </label>
        <Input
          id="compose-agent-name"
          required
          aria-describedby="compose-agent-name-help"
          value={composeName}
          onChange={(e) => {
            onComposeNameChange(e.target.value)
          }}
          placeholder="e.g. release-notes-writer"
          className="mt-1 bg-muted/20"
        />
        <p id="compose-agent-name-help" className="mt-1 text-[11px] text-muted-foreground">
          Required. Up to 120 characters; leading and trailing whitespace is removed before saving.
        </p>
      </div>
      <div>
        <label
          htmlFor="compose-agent-description"
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        >
          Description
        </label>
        <Input
          id="compose-agent-description"
          aria-describedby="compose-agent-description-help"
          value={composeDescription}
          onChange={(e) => {
            onComposeDescriptionChange(e.target.value)
          }}
          placeholder="One line: what does this agent do for you?"
          className="mt-1 bg-muted/20"
        />
        <p id="compose-agent-description-help" className="mt-1 text-[11px] text-muted-foreground">
          Optional one-line summary so you can recognize this agent later.
        </p>
      </div>
      <div>
        <label
          htmlFor="compose-agent-instructions"
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        >
          Instructions (its system prompt)
        </label>
        <Textarea
          id="compose-agent-instructions"
          required
          maxLength={MAX_AGENT_INSTRUCTIONS_LENGTH}
          aria-describedby="compose-agent-instructions-help"
          value={composeInstructions}
          onChange={(e) => {
            onComposeInstructionsChange(e.target.value)
          }}
          placeholder="You are a specialist that..."
          className="mt-1 bg-muted/20 font-mono text-xs leading-relaxed"
          rows={8}
        />
        <p id="compose-agent-instructions-help" className="mt-1 text-[11px] text-muted-foreground">
          Required. Describe the agent&apos;s role and how it should complete work (up to 32,000 UTF-8 bytes).
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="compose-agent-server"
            className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
          >
            Bind an entire MCP server&apos;s tools (optional)
          </label>
          <select
            id="compose-agent-server"
            aria-describedby="compose-agent-server-help"
            value={composeServer}
            onChange={(e) => {
              onComposeServerChange(e.target.value)
            }}
            className="w-full h-9 mt-1 px-3 rounded-md border border-input bg-muted/20 text-xs"
          >
            <option value="">— none —</option>
            {serverNames.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <p id="compose-agent-server-help" className="mt-1 text-[11px] text-muted-foreground">
            Optional. Select a server to make all of its tools available to this agent.
          </p>
        </div>
        <div>
          <label
            htmlFor="compose-agent-model"
            className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
          >
            Preferred model (optional, advisory)
          </label>
          <select
            id="compose-agent-model"
            aria-describedby="compose-agent-model-help"
            value={composeModel}
            onChange={(e) => {
              onComposeModelChange(e.target.value)
            }}
            className="w-full h-9 mt-1 px-3 rounded-md border border-input bg-muted/20 text-xs"
          >
            <option value="">— default —</option>
            {chatModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} ({m.provider})
              </option>
            ))}
          </select>
          <p id="compose-agent-model-help" className="mt-1 text-[11px] text-muted-foreground">
            Optional hint for delegation; the default model is used when this is left unchanged.
          </p>
        </div>
      </div>

      <div>
        <h3
          id="compose-agent-tools-label"
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        >
          Or pick individual tools
        </h3>
        <p id="compose-agent-tools-help" className="mt-1 text-[11px] text-muted-foreground">
          Choose specific tools when you do not want to grant access to an entire server.
        </p>
        <div
          role="group"
          aria-labelledby="compose-agent-tools-label"
          aria-describedby="compose-agent-tools-help"
          className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border/20 bg-muted/5 p-2 space-y-1"
        >
          {renderComposeToolPicker(props)}
        </div>
      </div>

      <Button
        onClick={onCompose}
        disabled={composing || !composeName.trim() || !composeInstructions.trim()}
        className="bg-emerald-600 hover:bg-emerald-700"
      >
        {composing ? 'Saving...' : 'Save agent to the Library'}
      </Button>
    </div>
  )
}

interface ExternalTabProps {
  a2aUrl: string
  onA2aUrlChange: (v: string) => void
  a2aCardJson: string
  onA2aCardJsonChange: (v: string) => void
  registering: boolean
  onRegister: () => void
}

function renderExternalTab({
  a2aUrl,
  onA2aUrlChange,
  a2aCardJson,
  onA2aCardJsonChange,
  registering,
  onRegister,
}: ExternalTabProps) {
  const urlError = externalUrlError(a2aUrl)
  const cardError = parseAgentCard(a2aCardJson).error
  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-xs text-muted-foreground">
        Register an outside agent that speaks the A2A protocol. Give its URL and, if it doesn&apos;t publish a
        discoverable agent card, paste the card JSON yourself. The URL is used to discover the agent; it is not a
        secret.
      </p>
      <div>
        <label
          htmlFor="external-agent-url"
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        >
          Agent URL
        </label>
        <Input
          id="external-agent-url"
          type="url"
          required
          maxLength={MAX_EXTERNAL_AGENT_URL_BYTES}
          aria-describedby={describedBy('external-agent-url-help', 'external-agent-url-error', urlError)}
          aria-invalid={Boolean(urlError)}
          value={a2aUrl}
          onChange={(e) => {
            onA2aUrlChange(e.target.value)
          }}
          placeholder="https://agent.example.com"
          className="mt-1 bg-muted/20 font-mono text-xs"
        />
        <p id="external-agent-url-help" className="mt-1 text-[11px] text-muted-foreground">
          Required. Use a complete http:// or https:// URL (up to 2,048 UTF-8 bytes).
        </p>
        {renderValidationError('external-agent-url-error', urlError)}
      </div>
      <div>
        <label
          htmlFor="external-agent-card-json"
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        >
          Agent card JSON (optional — auto-fetched from the URL if left blank)
        </label>
        <Textarea
          id="external-agent-card-json"
          aria-describedby={describedBy('external-agent-card-help', 'external-agent-card-error', cardError)}
          aria-invalid={Boolean(cardError)}
          value={a2aCardJson}
          onChange={(e) => {
            onA2aCardJsonChange(e.target.value)
          }}
          placeholder='{"name": "...", "description": "...", "capabilities": []}'
          className="mt-1 bg-muted/20 font-mono text-xs"
          rows={8}
        />
        <p id="external-agent-card-help" className="mt-1 text-[11px] text-muted-foreground">
          Optional. Leave blank to let the server fetch the card. If you paste one, it must be a non-empty JSON object.
        </p>
        {renderValidationError('external-agent-card-error', cardError)}
      </div>
      <Button
        type="button"
        onClick={onRegister}
        disabled={isExternalRegistrationDisabled(registering, a2aUrl, urlError, cardError)}
        className="bg-teal-600 hover:bg-teal-700"
      >
        {registering ? 'Registering...' : 'Register external agent'}
      </Button>
    </div>
  )
}

function renderChatModelCard(m: ChatModelSummary) {
  return (
    <div key={m.id} className="p-3 rounded-lg border border-border/30 bg-muted/5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono font-bold text-xs">{m.id}</span>
        <Badge variant="outline" className="text-[9px]">
          {m.provider}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-1">
        {m.intelligence_level && (
          <Badge variant="secondary" className="text-[9px]">
            {m.intelligence_level}
          </Badge>
        )}
        {m.can_route && (
          <Badge variant="secondary" className="text-[9px]">
            router
          </Badge>
        )}
        {m.can_kg && (
          <Badge variant="secondary" className="text-[9px]">
            kg
          </Badge>
        )}
        {m.vision && (
          <Badge variant="secondary" className="text-[9px]">
            vision
          </Badge>
        )}
        {m.reasoning && (
          <Badge variant="secondary" className="text-[9px]">
            reasoning
          </Badge>
        )}
        {m.tools_enabled && (
          <Badge variant="secondary" className="text-[9px]">
            tools
          </Badge>
        )}
      </div>
      {m.context_window ? (
        <div className="text-[10px] text-muted-foreground">{m.context_window.toLocaleString()} token context</div>
      ) : null}
    </div>
  )
}

function renderChatModelsSection({
  configUnavailable,
  chatModels,
}: {
  configUnavailable: boolean
  chatModels: ChatModelSummary[]
}) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Chat models</h3>
      {configUnavailable ? null : chatModels.length === 0 ? (
        <div className="text-xs text-muted-foreground">No chat models configured.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{chatModels.map(renderChatModelCard)}</div>
      )}
    </div>
  )
}

function renderEmbeddingModelCard(m: EmbeddingModelSummary) {
  return (
    <div key={m.id} className="p-3 rounded-lg border border-border/30 bg-muted/5 space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-mono font-bold text-xs">{m.id}</span>
        <Badge variant="outline" className="text-[9px]">
          {m.provider}
        </Badge>
      </div>
      <div className="text-[10px] text-muted-foreground">
        chunk {m.chunk_size ?? '—'}
        {m.context_window ? ` · ${m.context_window.toLocaleString()} token context` : ''}
      </div>
    </div>
  )
}

function renderEmbeddingModelsSection({
  configUnavailable,
  embeddingModels,
}: {
  configUnavailable: boolean
  embeddingModels: EmbeddingModelSummary[]
}) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Embedding models</h3>
      {configUnavailable ? null : embeddingModels.length === 0 ? (
        <div className="text-xs text-muted-foreground">No embedding models configured.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{embeddingModels.map(renderEmbeddingModelCard)}</div>
      )}
    </div>
  )
}

function renderConfigTab({
  loadingConfig,
  config,
  configUnavailable,
}: {
  loadingConfig: boolean
  config: ConfigSummary
  configUnavailable: boolean
}) {
  if (loadingConfig) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center py-12 gap-3">
          <RefreshCw className="size-8 text-emerald-500 animate-spin" />
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 text-xs">
        <div className="rounded-md border border-border/30 bg-muted/10 px-3 py-2">
          <div className="text-muted-foreground">App profile</div>
          <div className="font-bold">{config.app_profile || '—'}</div>
        </div>
        <div className="rounded-md border border-border/30 bg-muted/10 px-3 py-2">
          <div className="text-muted-foreground">Deployment profile</div>
          <div className="font-bold">{config.deployment_profile || '—'}</div>
        </div>
      </div>

      {configUnavailable && <UnavailableNotice what="The model configuration summary" />}

      {renderChatModelsSection({ configUnavailable, chatModels: config.chat_models })}
      {renderEmbeddingModelsSection({ configUnavailable, embeddingModels: config.embedding_models })}
      <p className="text-[11px] text-muted-foreground">
        Read-only view of the active <code>AgentConfig</code> model registry. Secrets and provider credentials are
        never sent to the browser.
      </p>
    </div>
  )
}

export default function AgentLibraryView() {
  const [tab, setTab] = useState<TabId>('library')

  const [agents, setAgents] = useState<LibraryAgent[]>([])
  const [loadingAgents, setLoadingAgents] = useState(true)
  const [search, setSearch] = useState('')

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(true)
  const [suggestionsUnavailable, setSuggestionsUnavailable] = useState(false)

  const [tools, setTools] = useState<LibraryTool[]>([])
  const [loadingTools, setLoadingTools] = useState(false)

  const [config, setConfig] = useState<ConfigSummary>(EMPTY_CONFIG)
  const [loadingConfig, setLoadingConfig] = useState(true)

  // BUG-008 (dashboard-wide follow-on, GOC-28-W06): each fetch below used to
  // leave its list at the same empty default on a failed request as on a
  // real "nothing here yet" response, with only a transient toast (or
  // nothing at all for the best-effort tools/config calls). Each now records
  // whether its most recent fetch actually reached the backend.
  const [agentsUnavailable, setAgentsUnavailable] = useState(false)
  const [toolsUnavailable, setToolsUnavailable] = useState(false)
  const [configUnavailable, setConfigUnavailable] = useState(false)

  // Compose form state
  const [composeName, setComposeName] = useState('')
  const [composeDescription, setComposeDescription] = useState('')
  const [composeInstructions, setComposeInstructions] = useState('')
  const [composeServer, setComposeServer] = useState('')
  const [composeModel, setComposeModel] = useState('')
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set())
  const [composing, setComposing] = useState(false)

  // External agent form state
  const [a2aUrl, setA2aUrl] = useState('')
  const [a2aCardJson, setA2aCardJson] = useState('')
  const [registering, setRegistering] = useState(false)

  const agentsRequests = useRef<RequestRefs>({ sequence: { current: 0 }, controller: { current: null } })
  const suggestionsRequests = useRef<RequestRefs>({ sequence: { current: 0 }, controller: { current: null } })
  const toolsRequests = useRef<RequestRefs>({ sequence: { current: 0 }, controller: { current: null } })
  const configRequests = useRef<RequestRefs>({ sequence: { current: 0 }, controller: { current: null } })
  // Mutations do not own a selected detail document, but they do own the
  // compose/register form. A response must not clear that form after the
  // operator has edited it or moved to another section while the request was
  // in flight.
  const composeRevision = useRef(0)
  const a2aRevision = useRef(0)

  const fetchAgents = async () => {
    await loadValidatedRequest({
      refs: agentsRequests.current,
      path: '/api/enhanced/agent-library/agents',
      schema: z.array(libraryAgentSchema),
      fallback: [] as LibraryAgent[],
      setData: setAgents,
      setLoading: setLoadingAgents,
      setUnavailable: setAgentsUnavailable,
      onFailure: reportAgentLibraryFailure,
    })
  }

  const fetchSuggestions = async () => {
    await loadValidatedRequest({
      refs: suggestionsRequests.current,
      path: '/api/enhanced/agent-library/suggestions',
      schema: z.array(suggestionSchema),
      fallback: [] as Suggestion[],
      setData: setSuggestions,
      setLoading: setLoadingSuggestions,
      setUnavailable: setSuggestionsUnavailable,
    })
  }

  const fetchTools = async (server?: string) => {
    const qs = server ? `?mcp_server=${encodeURIComponent(server)}` : ''
    await loadValidatedRequest({
      refs: toolsRequests.current,
      path: `/api/enhanced/agent-library/tools${qs}`,
      schema: z.array(libraryToolSchema),
      fallback: [] as LibraryTool[],
      setData: setTools,
      setLoading: setLoadingTools,
      setUnavailable: setToolsUnavailable,
    })
  }

  const fetchConfig = async () => {
    await loadValidatedRequest({
      refs: configRequests.current,
      path: '/api/enhanced/agent-library/config-summary',
      schema: configSummarySchema,
      fallback: EMPTY_CONFIG,
      setData: setConfig,
      setLoading: setLoadingConfig,
      setUnavailable: setConfigUnavailable,
    })
  }

  useEffect(() => {
    void fetchAgents()
    void fetchSuggestions()
    void fetchTools()
    void fetchConfig()
    return cancelRequests.bind(null, [
      agentsRequests.current,
      suggestionsRequests.current,
      toolsRequests.current,
      configRequests.current,
    ])
  }, [])

  const serverNames = useMemo(() => {
    const names = new Set<string>()
    for (const t of tools) {
      if (t.mcp_server) names.add(t.mcp_server)
    }
    return Array.from(names).sort()
  }, [tools])

  const toggleTool = (id: string) => {
    setSelectedToolIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const startFromSuggestion = (suggestion: Suggestion) => {
    composeRevision.current += 1
    setTab('compose')
    setComposeServer(suggestion.mcp_server)
    setComposeName((prev) => prev || suggestedAgentName(suggestion.mcp_server))
    setComposeDescription(
      (prev) => prev || `Uses the ${suggestion.mcp_server} tools: ${suggestion.sample_tools.join(', ')}.`,
    )
    void fetchTools(suggestion.mcp_server)
    toast.message(`Composing an agent for '${suggestion.mcp_server}'`)
  }

  const startNewAgent = () => {
    // A completed compose request must not clear a newly opened form merely
    // because the operator briefly visited the library and clicked New agent.
    composeRevision.current += 1
    setTab('compose')
  }

  const handleCompose = async () => {
    const name = composeName.trim()
    const instructions = composeInstructions.trim()
    const validationError = composeValidationError(name, instructions)
    if (validationError) {
      toast.error(validationError)
      return
    }
    const composeRevisionAtStart = composeRevision.current
    const tabAtStart = tab
    setComposing(true)
    try {
      const result = await postJson(
        '/api/enhanced/agent-library/agents',
        {
          name,
          description: composeDescription.trim(),
          instructions,
          bind_server: composeServer || undefined,
          model_preference: composeModel || undefined,
          tool_ids: Array.from(selectedToolIds),
        },
        'Failed to compose the agent',
      )
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`Agent '${name}' saved and ready to delegate to`)
      if (composeRevision.current === composeRevisionAtStart && tab === tabAtStart) {
        setComposeName('')
        setComposeDescription('')
        setComposeInstructions('')
        setComposeServer('')
        setComposeModel('')
        setSelectedToolIds(new Set())
        setTab('library')
      }
      void fetchAgents()
      void fetchSuggestions()
    } catch {
      toast.error('Network error composing the agent')
    } finally {
      setComposing(false)
    }
  }

  const handleArchive = async (agent: LibraryAgent) => {
    try {
      const res = await fetch(`/api/enhanced/agent-library/agents/${encodeURIComponent(agent.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        toast.error('Failed to archive that agent')
        return
      }
      toast.success(`Archived '${agent.name}'`)
      void fetchAgents()
    } catch {
      toast.error('Network error archiving the agent')
    }
  }

  const handleRegisterA2A = async () => {
    const registration = validateExternalRegistration(a2aUrl, a2aCardJson)
    if (registration.error) {
      toast.error(registration.error)
      return
    }
    const a2aRevisionAtStart = a2aRevision.current
    const tabAtStart = tab
    setRegistering(true)
    try {
      const result = await postJson(
        '/api/enhanced/agent-library/a2a',
        { url: registration.url, agent_card: registration.agentCard },
        'Failed to register that agent',
      )
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('External agent registered')
      if (a2aRevision.current === a2aRevisionAtStart && tab === tabAtStart) {
        setA2aUrl('')
        setA2aCardJson('')
      }
      void fetchAgents()
    } catch {
      toast.error('Network error registering the external agent')
    } finally {
      setRegistering(false)
    }
  }

  const filteredAgents = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase()),
  )

  const tabs: { id: TabId; label: string; icon: typeof Bot }[] = [
    { id: 'library', label: 'Library', icon: Bot },
    { id: 'compose', label: 'Compose an Agent', icon: Plus },
    { id: 'external', label: 'External Agents', icon: Globe },
    { id: 'config', label: 'Model & Config', icon: Sparkles },
  ]

  const handleTabChange = (value: string) => {
    const nextTab = isTabId(value) ? value : tab
    bumpTabRevisionsIfChanged(nextTab, tab, composeRevision, a2aRevision)
    setTab(nextTab)
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/40 bg-card/60 backdrop-blur-md">
        <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
          <CardHeader>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <CardTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 via-emerald-400 to-green-500">
                  Agent Library
                </CardTitle>
                <CardDescription>
                  Compose agents from prompts and tools you already have, register outside A2A agents, and call on any
                  of them whenever you need. Saved agents live in the knowledge graph, not in this browser.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigateTo('/prompts')
                  }}
                >
                  Prompts Registry <ExternalLink className="size-3.5 ml-1.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigateTo('/skills')
                  }}
                >
                  Tools &amp; Skills <ExternalLink className="size-3.5 ml-1.5" />
                </Button>
              </div>
            </div>

            <TabsList
              aria-label="Agent library sections"
              className="flex flex-wrap justify-start h-auto gap-2 mt-4 rounded-none border-b border-border/40 bg-transparent p-0 pb-2"
            >
              {tabs.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="flex items-center gap-2 rounded-md border border-transparent px-3 py-1.5 text-xs font-semibold data-[state=active]:border-emerald-500/30 data-[state=active]:bg-emerald-500/10 data-[state=active]:font-bold data-[state=active]:text-emerald-400"
                >
                  <t.icon className="size-3.5" />
                  <span>{t.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </CardHeader>

          <CardContent>
            <TabsContent value="library">
              {renderLibraryTab({
                loadingSuggestions,
                suggestionsUnavailable,
                suggestions,
                onStartFromSuggestion: startFromSuggestion,
                search,
                onSearchChange: setSearch,
                onRefresh: () => {
                  void fetchAgents()
                  void fetchSuggestions()
                },
                loadingAgents,
                onNewAgent: startNewAgent,
                agentsUnavailable,
                filteredAgents,
                onArchive: (agent) => {
                  void handleArchive(agent)
                },
              })}
            </TabsContent>

            <TabsContent value="compose">
              {renderComposeTab({
                composeName,
                onComposeNameChange: (value) => {
                  composeRevision.current += 1
                  setComposeName(value)
                },
                composeDescription,
                onComposeDescriptionChange: (value) => {
                  composeRevision.current += 1
                  setComposeDescription(value)
                },
                composeInstructions,
                onComposeInstructionsChange: (value) => {
                  composeRevision.current += 1
                  setComposeInstructions(value)
                },
                composeServer,
                onComposeServerChange: (v) => {
                  composeRevision.current += 1
                  setComposeServer(v)
                  void fetchTools(v || undefined)
                },
                serverNames,
                composeModel,
                onComposeModelChange: (value) => {
                  composeRevision.current += 1
                  setComposeModel(value)
                },
                chatModels: config.chat_models,
                loadingTools,
                toolsUnavailable,
                tools,
                selectedToolIds,
                onToggleTool: (id) => {
                  composeRevision.current += 1
                  toggleTool(id)
                },
                composing,
                onCompose: () => {
                  void handleCompose()
                },
              })}
            </TabsContent>

            <TabsContent value="external">
              {renderExternalTab({
                a2aUrl,
                onA2aUrlChange: (value) => {
                  a2aRevision.current += 1
                  setA2aUrl(value)
                },
                a2aCardJson,
                onA2aCardJsonChange: (value) => {
                  a2aRevision.current += 1
                  setA2aCardJson(value)
                },
                registering,
                onRegister: () => {
                  void handleRegisterA2A()
                },
              })}
            </TabsContent>

            <TabsContent value="config">{renderConfigTab({ loadingConfig, config, configUnavailable })}</TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  )
}
