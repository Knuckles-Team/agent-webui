import { useState, useEffect, useRef, type ChangeEvent, type KeyboardEvent } from 'react'
import { z } from 'zod'
import { FileText, Search, Save, RefreshCw, Code, X, Wrench, Sparkles, Settings, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import { toast } from 'sonner'
import { fetchValidated, ApiError, looseArray } from '@/lib/api-validation'
import { SessionExpiredNotice } from '@/components/SessionExpiredNotice'

interface PromptSummary {
  name: string
  title: string
  goal: string
  core_directive: string
  file_path: string
}

interface PromptDetail {
  title?: string | null
  task?: string | null
  type?: string | null
  version?: string | null
  identity?: { role?: string | null; goal?: string | null; [k: string]: unknown } | null
  goal?: string | null
  core_directive?: string | null
  instructions?: { core_directive?: string | null; [k: string]: unknown } | null
  tools?: string[] | null
  metadata?: { topic?: string | null; tone?: string | null; style?: string | null; [k: string]: unknown } | null
  rules?: Record<string, unknown>
  [key: string]: unknown
}

const promptSummarySchema: z.ZodType<PromptSummary> = z.object({
  name: z.string(),
  title: z.string(),
  goal: z.string(),
  core_directive: z.string(),
  file_path: z.string(),
})

// The prompt document intentionally keeps unknown top-level keys, but the
// fields rendered by this page still need runtime checks. In particular,
// `tools` must really be an array before the editor calls `.map()` on it.
const promptDetailSchema: z.ZodType<PromptDetail> = z
  .looseObject({
    title: z.string().nullable().optional(),
    task: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    version: z.string().nullable().optional(),
    identity: z
      .looseObject({
        role: z.string().nullable().optional(),
        goal: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    goal: z.string().nullable().optional(),
    core_directive: z.string().nullable().optional(),
    instructions: z
      .looseObject({
        core_directive: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    tools: z.array(z.string()).nullable().optional(),
    metadata: z
      .looseObject({
        topic: z.string().nullable().optional(),
        tone: z.string().nullable().optional(),
        style: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Prompt document must not be empty')

// Matches the backend's own name validation (`resolve_prompt_file`,
// api_extensions.py:1139) so an invalid name is rejected client-side before
// a request is ever issued.
const PROMPT_NAME_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

// Keep capability validation aligned with the server's bounded identifier
// contract (`_bounded_identifier_list`): each identifier is measured in UTF-8
// bytes and the collection is capped at 256 entries. Do not use a character
// count or an HTML `maxLength` here; either would reject valid multi-byte names
// before the server sees them.
const MAX_TOOL_IDENTIFIER_BYTES = 512
const MAX_TOOL_COUNT = 256

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function validatePromptTools(tools: string[] | null | undefined): string | null {
  const boundTools = tools ?? []
  if (boundTools.length > MAX_TOOL_COUNT) {
    return `A prompt may bind at most ${MAX_TOOL_COUNT} tools`
  }
  if (boundTools.some((tool) => tool.length === 0)) {
    return 'Each tool identifier must be non-empty'
  }
  if (boundTools.some((tool) => utf8ByteLength(tool) > MAX_TOOL_IDENTIFIER_BYTES)) {
    return `Each tool identifier must be ${MAX_TOOL_IDENTIFIER_BYTES} UTF-8 bytes or fewer`
  }
  return null
}

interface PromptRequest {
  requestId: number
  controller: AbortController
}

interface SequenceRef {
  current: number
}

interface AbortRef {
  current: AbortController | null
}

function beginPromptRequest(sequence: SequenceRef, abort: AbortRef): PromptRequest {
  abort.current?.abort()
  const requestId = sequence.current + 1
  sequence.current = requestId
  const controller = new AbortController()
  abort.current = controller
  return { requestId, controller }
}

function invalidatePromptRequest(sequence: SequenceRef, abort: AbortRef): void {
  sequence.current += 1
  abort.current?.abort()
  abort.current = null
}

function isCurrentPromptRequest(sequence: SequenceRef, abort: AbortRef, request: PromptRequest): boolean {
  return (
    sequence.current === request.requestId &&
    abort.current === request.controller &&
    !request.controller.signal.aborted
  )
}

function clearPromptRequest(abort: AbortRef, request: PromptRequest): void {
  if (abort.current === request.controller) abort.current = null
}

function isCurrentSaveRequest(
  sequence: SequenceRef,
  abort: AbortRef,
  request: PromptRequest,
  detailSequence: SequenceRef,
  selectionAtStart: number,
  editorRevision: SequenceRef,
  editorRevisionAtStart: number,
): boolean {
  return (
    isCurrentPromptRequest(sequence, abort, request) &&
    detailSequence.current === selectionAtStart &&
    editorRevision.current === editorRevisionAtStart
  )
}

// A minimal but complete instance of the prompt shape the PUT handler
// expects (agent_utilities/prompts/*.json + api_extensions.py:7164-7222's
// flat<->nested sync) so a brand-new prompt starts from a fully-formed,
// editable document rather than requiring a prior GET.
const DEFAULT_PROMPT_DETAIL: PromptDetail = {
  task: '',
  type: 'prompt',
  title: '',
  goal: '',
  core_directive: '',
  version: '1.0.0',
  schema_version: '1.0',
  source: 'agent-utilities:base',
  metadata: { description: '', topic: '', tone: '', style: '' },
  identity: { role: '', goal: '' },
  instructions: { core_directive: '', responsibilities: [], quality_checklist: [] },
  tools: [],
  rules: { quality_gates: [], responsibilities: [] },
}

function resolveTargetName(isNew: boolean, newName: string, selectedName: string | null): string {
  return isNew ? newName.trim() : (selectedName ?? '')
}

function validateNewPromptName(targetName: string): string | null {
  if (!targetName) return 'Enter a name for the new prompt'
  if (!PROMPT_NAME_PATTERN.test(targetName)) {
    return 'Name may only contain letters, numbers, "-", and "_" (max 128 characters)'
  }
  return null
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

// PUT is a genuine upsert with no existence check server-side, so a "create"
// that reuses an existing name would SILENTLY overwrite it -- require
// explicit confirmation first.
function confirmOverwriteIfExisting(targetName: string, prompts: PromptSummary[]): boolean {
  if (!prompts.some((p) => p.name === targetName)) return true
  return window.confirm(`A prompt named "${targetName}" already exists. Saving will overwrite it. Continue?`)
}

type SavePayloadResult = { ok: true; payload: PromptDetail } | { ok: false; message: string }

function parseFormSavePayload(promptDetail: PromptDetail | null): SavePayloadResult {
  if (!promptDetail) return { ok: false, message: 'Select or create a prompt before saving' }
  const toolsError = validatePromptTools(promptDetail.tools)
  return toolsError ? { ok: false, message: toolsError } : { ok: true, payload: promptDetail }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidPromptJsonValue(error: z.ZodError): SavePayloadResult {
  const issue = error.issues[0]
  const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : ''
  return { ok: false, message: `Prompt JSON has an invalid value${path}: ${issue.message}` }
}

function parsePromptJson(rawJsonText: string): SavePayloadResult {
  try {
    const parsed: unknown = JSON.parse(rawJsonText)
    if (!isJsonObject(parsed)) {
      return { ok: false, message: 'Prompt JSON must be a JSON object, not a list or primitive value' }
    }
    const validated = promptDetailSchema.safeParse(parsed)
    if (!validated.success) return invalidPromptJsonValue(validated.error)
    const toolsError = validatePromptTools(validated.data.tools)
    if (toolsError) return { ok: false, message: `Prompt JSON ${toolsError}` }
    return { ok: true, payload: validated.data }
  } catch (error) {
    return { ok: false, message: `Invalid JSON syntax: ${error instanceof Error ? error.message : String(error)}` }
  }
}

type SavePayloadParser = (promptDetail: PromptDetail | null, rawJsonText: string) => SavePayloadResult

const SAVE_PAYLOAD_PARSERS: Record<'form' | 'json', SavePayloadParser> = {
  form: (promptDetail) => parseFormSavePayload(promptDetail),
  json: (_promptDetail, rawJsonText) => parsePromptJson(rawJsonText),
}

function parseSavePayload(
  editMode: 'form' | 'json',
  promptDetail: PromptDetail | null,
  rawJsonText: string,
): SavePayloadResult {
  return SAVE_PAYLOAD_PARSERS[editMode](promptDetail, rawJsonText)
}

interface PromptSidebarProps {
  loading: boolean
  unavailable: boolean
  filteredPrompts: PromptSummary[]
  selectedName: string | null
  onSelect: (name: string) => void
}

function promptSidebarButtonClass(selected: boolean): string {
  return selected
    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-semibold'
    : 'border-border/30 bg-muted/10 text-muted-foreground hover:text-foreground'
}

function renderPromptSidebarItem(
  prompt: PromptSummary,
  selectedName: string | null,
  onSelect: (name: string) => void,
) {
  const selected = selectedName === prompt.name
  return (
    <button
      key={prompt.name}
      type="button"
      aria-pressed={selected}
      aria-label={`Edit prompt ${prompt.title || prompt.name}`}
      onClick={() => {
        onSelect(prompt.name)
      }}
      className={`w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 ${promptSidebarButtonClass(
        selected,
      )}`}
    >
      <FileText className="size-4 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="font-bold text-xs truncate">{prompt.title}</div>
        <div className="text-[10px] opacity-70 truncate font-mono mt-0.5">{prompt.name}.json</div>
      </div>
    </button>
  )
}

function renderLoadedPromptSidebar({ filteredPrompts, selectedName, onSelect, unavailable }: PromptSidebarProps) {
  if (unavailable) {
    return (
      <div className="py-8 px-2">
        <UnavailableNotice what="The prompts registry" />
      </div>
    )
  }
  if (filteredPrompts.length === 0) {
    return <div className="text-center py-8 text-sm text-muted-foreground">No prompts found</div>
  }
  return <>{filteredPrompts.map((prompt) => renderPromptSidebarItem(prompt, selectedName, onSelect))}</>
}

function renderPromptSidebarList(props: PromptSidebarProps) {
  const { loading } = props
  if (loading) return <div className="text-center py-8 text-sm text-muted-foreground">Loading...</div>
  return renderLoadedPromptSidebar(props)
}

function newPromptNameDescribedBy(nameError: string | null): string {
  return nameError ? 'new-prompt-name-help new-prompt-name-error' : 'new-prompt-name-help'
}

function renderNewPromptNameError(nameError: string | null) {
  return nameError ? (
    <p id="new-prompt-name-error" role="alert" className="mt-1.5 text-xs text-red-400 font-medium">
      {nameError}
    </p>
  ) : null
}

function renderNewPromptNameField({
  newName,
  nameError,
  onChange,
}: {
  newName: string
  nameError: string | null
  onChange: (v: string) => void
}) {
  return (
    <div className="mb-4 border border-emerald-500/20 rounded-xl p-4 bg-emerald-500/5 backdrop-blur-sm">
      <label
        htmlFor="new-prompt-name"
        className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
      >
        Prompt Name (id) *
      </label>
      <Input
        id="new-prompt-name"
        required
        maxLength={128}
        pattern="[A-Za-z0-9_-]{1,128}"
        aria-describedby={newPromptNameDescribedBy(nameError)}
        aria-invalid={Boolean(nameError)}
        value={newName}
        onChange={(e) => {
          onChange(e.target.value)
        }}
        placeholder="e.g. release-notes-writer"
        className="mt-1 h-8 bg-muted/20 text-xs font-mono"
      />
      <p id="new-prompt-name-help" className="mt-1.5 text-[11px] text-muted-foreground">
        Required. Use 1–128 letters, numbers, hyphens, or underscores; this becomes the prompt file name.
      </p>
      {renderNewPromptNameError(nameError)}
    </div>
  )
}

function renderGeneralParamsSection({
  promptDetail,
  onFieldChange,
}: {
  promptDetail: PromptDetail
  onFieldChange: (key: string, val: string) => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border border-border/20 rounded-xl p-4 bg-muted/5 backdrop-blur-sm">
      <div className="md:col-span-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">General information</h3>
        <p className="mt-1 text-[11px] leading-normal text-muted-foreground">
          Optional values that identify the task and version of this prompt.
        </p>
      </div>
      <div>
        <label
          htmlFor="prompt-task-id"
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        >
          Task ID
        </label>
        <Input
          id="prompt-task-id"
          aria-describedby="prompt-task-id-help"
          value={promptDetail.task ?? ''}
          onChange={(e) => {
            onFieldChange('task', e.target.value)
          }}
          className="mt-1 h-8 bg-muted/20 text-xs font-semibold"
        />
        <p id="prompt-task-id-help" className="mt-1 text-[11px] text-muted-foreground">
          Optional identifier for the task this prompt supports.
        </p>
      </div>
      <div>
        <label
          htmlFor="prompt-profile-type"
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        >
          Profile Type
        </label>
        <Input
          id="prompt-profile-type"
          aria-describedby="prompt-profile-type-help"
          value={promptDetail.type ?? ''}
          onChange={(e) => {
            onFieldChange('type', e.target.value)
          }}
          className="mt-1 h-8 bg-muted/20 text-xs font-semibold"
        />
        <p id="prompt-profile-type-help" className="mt-1 text-[11px] text-muted-foreground">
          Optional category, such as prompt or workflow.
        </p>
      </div>
      <div>
        <label
          htmlFor="prompt-version"
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        >
          Version
        </label>
        <Input
          id="prompt-version"
          aria-describedby="prompt-version-help"
          value={promptDetail.version ?? ''}
          onChange={(e) => {
            onFieldChange('version', e.target.value)
          }}
          className="mt-1 h-8 bg-muted/20 text-xs font-semibold"
        />
        <p id="prompt-version-help" className="mt-1 text-[11px] text-muted-foreground">
          Optional version label for tracking revisions.
        </p>
      </div>
    </div>
  )
}

function renderIdentitySection({
  promptDetail,
  onNestedFieldChange,
}: {
  promptDetail: PromptDetail
  onNestedFieldChange: (section: string, key: string, val: string) => void
}) {
  return (
    <div className="space-y-4 border border-border/20 rounded-xl p-4 bg-muted/5 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border/30 pb-2 mb-2">
        <Sparkles className="size-4 text-emerald-400" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Identity &amp; Mission</h3>
      </div>
      <p className="text-[11px] leading-normal text-muted-foreground">
        Give the prompt a recognizable role and explain the outcome it should produce.
      </p>
      <div>
        <label htmlFor="prompt-role" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Role / Title
        </label>
        <Input
          id="prompt-role"
          aria-describedby="prompt-role-help"
          value={promptDetail.identity?.role ?? promptDetail.title ?? ''}
          onChange={(e) => {
            onNestedFieldChange('identity', 'role', e.target.value)
          }}
          className="mt-1.5 bg-muted/20 text-xs font-medium"
        />
        <p id="prompt-role-help" className="mt-1 text-[11px] text-muted-foreground">
          The role or title the assistant should use.
        </p>
      </div>
      <div>
        <label htmlFor="prompt-goal" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Goal / Core Intent
        </label>
        <Textarea
          id="prompt-goal"
          aria-describedby="prompt-goal-help"
          value={promptDetail.identity?.goal ?? promptDetail.goal ?? ''}
          onChange={(e) => {
            onNestedFieldChange('identity', 'goal', e.target.value)
          }}
          className="mt-1.5 bg-muted/20 text-xs leading-relaxed"
          rows={3}
        />
        <p id="prompt-goal-help" className="mt-1 text-[11px] text-muted-foreground">
          State the main goal in plain language; this is also shown in the prompt registry.
        </p>
      </div>
    </div>
  )
}

function renderMetadataSection({
  promptDetail,
  onNestedFieldChange,
}: {
  promptDetail: PromptDetail
  onNestedFieldChange: (section: string, key: string, val: string) => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border border-border/20 rounded-xl p-4 bg-muted/5 backdrop-blur-sm">
      <div className="md:col-span-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Metadata</h3>
        <p className="mt-1 text-[11px] leading-normal text-muted-foreground">
          Optional tags that help people find and choose this prompt.
        </p>
      </div>
      <div>
        <label htmlFor="prompt-topic" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Topic
        </label>
        <Input
          id="prompt-topic"
          aria-describedby="prompt-topic-help"
          value={promptDetail.metadata?.topic ?? ''}
          onChange={(e) => {
            onNestedFieldChange('metadata', 'topic', e.target.value)
          }}
          className="mt-1 h-8 bg-muted/20 text-xs"
        />
        <p id="prompt-topic-help" className="mt-1 text-[11px] text-muted-foreground">
          Subject area, such as release notes or support.
        </p>
      </div>
      <div>
        <label htmlFor="prompt-tone" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Tone
        </label>
        <Input
          id="prompt-tone"
          aria-describedby="prompt-tone-help"
          value={promptDetail.metadata?.tone ?? ''}
          onChange={(e) => {
            onNestedFieldChange('metadata', 'tone', e.target.value)
          }}
          className="mt-1 h-8 bg-muted/20 text-xs"
        />
        <p id="prompt-tone-help" className="mt-1 text-[11px] text-muted-foreground">
          Desired voice, such as concise, friendly, or formal.
        </p>
      </div>
      <div>
        <label htmlFor="prompt-style" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Style
        </label>
        <Input
          id="prompt-style"
          aria-describedby="prompt-style-help"
          value={promptDetail.metadata?.style ?? ''}
          onChange={(e) => {
            onNestedFieldChange('metadata', 'style', e.target.value)
          }}
          className="mt-1 h-8 bg-muted/20 text-xs"
        />
        <p id="prompt-style-help" className="mt-1 text-[11px] text-muted-foreground">
          Output format or conventions, such as bullets or Markdown.
        </p>
      </div>
    </div>
  )
}

function renderBehaviorSection({
  promptDetail,
  onNestedFieldChange,
}: {
  promptDetail: PromptDetail
  onNestedFieldChange: (section: string, key: string, val: string) => void
}) {
  return (
    <div className="space-y-4 border border-border/20 rounded-xl p-4 bg-muted/5 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border/30 pb-2 mb-2">
        <Settings className="size-4 text-emerald-400" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Behavior Directives</h3>
      </div>
      <p className="text-[11px] leading-normal text-muted-foreground">
        Write the system instruction that guides every response from this prompt.
      </p>
      <div>
        <label
          htmlFor="prompt-core-directive"
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        >
          System Prompt Directive
        </label>
        <Textarea
          id="prompt-core-directive"
          aria-describedby="prompt-core-directive-help"
          value={promptDetail.instructions?.core_directive ?? promptDetail.core_directive ?? ''}
          onChange={(e) => {
            onNestedFieldChange('instructions', 'core_directive', e.target.value)
          }}
          className="mt-1.5 bg-muted/20 font-mono text-xs leading-relaxed"
          rows={12}
        />
        <p id="prompt-core-directive-help" className="mt-1 text-[11px] text-muted-foreground">
          Be specific about boundaries, priorities, and what a good answer should contain.
        </p>
      </div>
    </div>
  )
}

function handleToolKeyDown(event: KeyboardEvent<HTMLInputElement>, onAddTool: () => void): void {
  if (event.key !== 'Enter') return
  event.preventDefault()
  onAddTool()
}

interface ToolNameInputProps {
  initialValue: string
  onChange: (value: string) => void
  onAdd: (value: string) => boolean
}

function ToolNameInput({ initialValue, onChange, onAdd }: ToolNameInputProps) {
  const [value, setValue] = useState(initialValue)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value
    setValue(nextValue)
    onChange(nextValue)
  }

  const handleAdd = () => {
    if (onAdd(value)) setValue('')
  }

  return (
    <div className="flex gap-2 mt-2">
      <Input
        id="prompt-new-tool"
        aria-describedby="prompt-new-tool-help"
        placeholder="Enter tool or skill name (e.g. react-docs)..."
        value={value}
        onChange={handleChange}
        onKeyDown={(event) => {
          handleToolKeyDown(event, handleAdd)
        }}
        className="h-8 bg-muted/20 text-xs"
      />
      <Button
        type="button"
        size="sm"
        onClick={handleAdd}
        className="h-8 bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold shrink-0"
      >
        Bind Tool
      </Button>
    </div>
  )
}

function renderToolBadge(tool: string, onRemoveTool: (toolName: string) => void) {
  return (
    <Badge
      key={tool}
      variant="secondary"
      className="flex items-center gap-1 text-[10px] bg-emerald-500/10 border-emerald-500/20 text-emerald-400 px-2 py-0.75 hover:bg-emerald-500/20 transition-all font-semibold"
    >
      {tool}
      <button
        type="button"
        aria-label={`Remove ${tool}`}
        onClick={() => {
          onRemoveTool(tool)
        }}
        className="hover:text-red-400 transition-colors ml-0.5 shrink-0"
      >
        <X className="size-3" />
      </button>
    </Badge>
  )
}

function renderToolBadges(tools: string[], onRemoveTool: (toolName: string) => void) {
  if (tools.length === 0) {
    return <span className="text-xs text-muted-foreground italic p-1">No tools bound to this profile.</span>
  }
  return <>{tools.map((tool) => renderToolBadge(tool, onRemoveTool))}</>
}

function renderToolsSection({
  promptDetail,
  newTool,
  toolInputResetKey,
  onNewToolChange,
  onAddTool,
  onRemoveTool,
}: {
  promptDetail: PromptDetail
  newTool: string
  toolInputResetKey: number
  onNewToolChange: (v: string) => void
  onAddTool: (value: string) => boolean
  onRemoveTool: (toolName: string) => void
}) {
  const tools = promptDetail.tools ?? []
  return (
    <div className="space-y-4 border border-border/20 rounded-xl p-4 bg-muted/5 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border/30 pb-2 mb-2">
        <Wrench className="size-4 text-emerald-400" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Provisioned Capabilities</h3>
      </div>
      <p className="text-[11px] leading-normal text-muted-foreground">
        Add the skill or tool names this prompt may use. Leave the list empty for a prompt-only profile.
      </p>
      <div>
        <label
          htmlFor="prompt-new-tool"
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        >
          Active Skill &amp; Tool Tokens
        </label>
        <div className="flex flex-wrap gap-1.5 mt-2 p-2 border border-border/20 rounded-lg min-h-[4rem] bg-muted/10 items-start">
          {renderToolBadges(tools, onRemoveTool)}
        </div>
        <ToolNameInput key={toolInputResetKey} initialValue={newTool} onChange={onNewToolChange} onAdd={onAddTool} />
        <p id="prompt-new-tool-help" className="mt-1 text-[11px] text-muted-foreground">
          Enter one name, then press Enter or choose Bind Tool. Each identifier may use up to 512 UTF-8 bytes, with up
          to 256 identifiers per prompt.
        </p>
      </div>
    </div>
  )
}

interface FormEditorProps {
  promptDetail: PromptDetail
  newTool: string
  toolInputResetKey: number
  onFieldChange: (key: string, val: string) => void
  onNestedFieldChange: (section: string, key: string, val: string) => void
  onNewToolChange: (v: string) => void
  onAddTool: (value: string) => boolean
  onRemoveTool: (toolName: string) => void
}

function renderFormEditor(props: FormEditorProps) {
  const {
    promptDetail,
    newTool,
    toolInputResetKey,
    onFieldChange,
    onNestedFieldChange,
    onNewToolChange,
    onAddTool,
    onRemoveTool,
  } = props
  return (
    <div className="space-y-6 pb-8">
      {renderGeneralParamsSection({ promptDetail, onFieldChange })}
      {renderIdentitySection({ promptDetail, onNestedFieldChange })}
      {renderMetadataSection({ promptDetail, onNestedFieldChange })}
      {renderBehaviorSection({ promptDetail, onNestedFieldChange })}
      {renderToolsSection({
        promptDetail,
        newTool,
        toolInputResetKey,
        onNewToolChange,
        onAddTool,
        onRemoveTool,
      })}
    </div>
  )
}

function jsonEditorDescribedBy(error: string | null): string {
  const ids = ['prompt-json-help']
  if (error) ids.push('prompt-json-error')
  return ids.join(' ')
}

function renderJsonEditorError(error: string | null) {
  return error ? (
    <p id="prompt-json-error" role="alert" className="mt-1 text-[11px] leading-normal text-red-400">
      {error}
    </p>
  ) : null
}

function renderJsonEditor({
  rawJsonText,
  onChange,
  error,
}: {
  rawJsonText: string
  onChange: (v: string) => void
  error: string | null
}) {
  return (
    <div className="h-full flex flex-col pb-4">
      <Textarea
        aria-label="Prompt configuration JSON"
        aria-describedby={jsonEditorDescribedBy(error)}
        aria-invalid={Boolean(error)}
        value={rawJsonText}
        onChange={(e) => {
          onChange(e.target.value)
        }}
        className="flex-1 font-mono text-xs bg-muted/10 border-border/40 p-4 resize-none h-[calc(100vh-22rem)]"
        placeholder="Enter valid configuration JSON..."
      />
      <p id="prompt-json-help" className="mt-1 text-[11px] leading-normal text-muted-foreground">
        Advanced mode: edit the complete prompt as a JSON object. Saving rejects invalid JSON.
      </p>
      {renderJsonEditorError(error)}
    </div>
  )
}

/** The editor header's title.
 *
 * Falls through on an EMPTY STRING as well as null/undefined, which is why this
 * is written as explicit checks rather than `||` or `??`. The original used
 * `||`; commit ecc3331's eslint sweep rewrote it to `??` to satisfy
 * `prefer-nullish-coalescing`, and that silently changed behaviour — a prompt
 * whose `title` is `''` rendered a blank header instead of falling through to
 * `selectedName`. Explicit truthiness checks preserve the original behaviour
 * and do not trip the rule, so no disable comment is needed.
 */
function editorTitle(isNew: boolean, promptDetail: PromptDetail | null, selectedName: string | null): string {
  if (isNew) return 'New Prompt'
  if (promptDetail?.title) return promptDetail.title
  if (selectedName) return selectedName
  return 'Prompt Editor'
}

function editModeButtonClass(active: boolean): string {
  return `h-7 px-2.5 text-xs font-semibold ${active ? 'bg-emerald-500/10 text-emerald-400 font-bold' : ''}`
}

function saveButtonLabel(saving: boolean, isNew: boolean): string {
  if (saving) return 'Saving…'
  return isNew ? 'Create Prompt' : 'Save Config'
}

interface EditorHeaderProps {
  isNew: boolean
  promptDetail: PromptDetail | null
  selectedName: string | null
  editMode: 'form' | 'json'
  onSetEditMode: (mode: 'form' | 'json') => void
  saving: boolean
  jsonError: string | null
  onSave: () => void
}

function renderEditorHeader(props: EditorHeaderProps) {
  const { isNew, promptDetail, selectedName, editMode, onSetEditMode, saving, jsonError, onSave } = props
  return (
    <div className="flex items-center justify-between">
      <div>
        <CardTitle className="text-lg font-bold text-foreground">
          {editorTitle(isNew, promptDetail, selectedName)}
        </CardTitle>
        <CardDescription>
          Start with Form mode to edit the role, goal, instructions, and optional tools. Raw JSON is for advanced
          edits.
        </CardDescription>
      </div>
      <div className="flex items-center gap-2">
        <div
          role="group"
          aria-label="Prompt editor mode"
          className="flex border border-border/40 rounded-lg p-0.5 bg-muted/30"
        >
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-pressed={editMode === 'form'}
            onClick={() => {
              onSetEditMode('form')
            }}
            className={editModeButtonClass(editMode === 'form')}
          >
            Form
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-pressed={editMode === 'json'}
            onClick={() => {
              onSetEditMode('json')
            }}
            className={editModeButtonClass(editMode === 'json')}
          >
            Raw JSON
          </Button>
        </div>
        <Button
          size="sm"
          type="button"
          onClick={onSave}
          disabled={isPromptSaveDisabled(saving, promptDetail, jsonError)}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          <Save className="size-4 mr-1.5" />
          {saveButtonLabel(saving, isNew)}
        </Button>
      </div>
    </div>
  )
}

function renderEmptyEditorState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8">
      <Code className="size-12 text-muted-foreground/30 mb-2" />
      <div className="text-sm font-semibold text-muted-foreground">No Prompt Selected</div>
      <p className="text-xs text-muted-foreground/75 mt-1 max-w-xs">
        Select a prompt profile from the sidebar list to inspect or modify its parameters.
      </p>
    </div>
  )
}

interface EditorPanelProps extends Omit<FormEditorProps, 'promptDetail'> {
  promptDetail: PromptDetail | null
  isNew: boolean
  newName: string
  nameError: string | null
  onNewNameChange: (v: string) => void
  editMode: 'form' | 'json'
  rawJsonText: string
  jsonError: string | null
  onRawJsonTextChange: (v: string) => void
}

function isPromptSaveDisabled(saving: boolean, promptDetail: PromptDetail | null, jsonError: string | null): boolean {
  return saving || !promptDetail || Boolean(jsonError)
}

function renderNewPromptName(props: EditorPanelProps) {
  if (!props.isNew) return null
  return renderNewPromptNameField({
    newName: props.newName,
    nameError: props.nameError,
    onChange: props.onNewNameChange,
  })
}

function renderEditorContent(props: EditorPanelProps, promptDetail: PromptDetail) {
  if (props.editMode === 'form') return renderFormEditor({ ...props, promptDetail })
  return renderJsonEditor({
    rawJsonText: props.rawJsonText,
    error: props.jsonError,
    onChange: props.onRawJsonTextChange,
  })
}

function renderEditorPanel(props: EditorPanelProps) {
  if (!props.promptDetail) return renderEmptyEditorState()
  return (
    <ScrollArea className="h-full pr-2">
      {renderNewPromptName(props)}
      {renderEditorContent(props, props.promptDetail)}
    </ScrollArea>
  )
}

function firstPromptNameToLoad(
  loadFirstPrompt: boolean,
  prompts: PromptSummary[],
  selectedName: string | null,
  isNewPrompt: boolean,
  detailSequenceAtStart: number,
  currentDetailSequence: number,
): string | null {
  if (
    isNewPrompt ||
    !loadFirstPrompt ||
    prompts.length === 0 ||
    selectedName ||
    currentDetailSequence !== detailSequenceAtStart
  ) {
    return null
  }
  return prompts[0].name
}

function handlePromptListError(
  error: unknown,
  setSessionExpired: (value: boolean) => void,
  setPrompts: (value: PromptSummary[]) => void,
  setPromptsUnavailable: (value: boolean) => void,
): void {
  if (isAbortError(error)) return
  if (error instanceof ApiError && error.status === 401) {
    setSessionExpired(true)
    return
  }
  setPrompts([])
  setPromptsUnavailable(true)
  toast.error('Error connecting to prompts registry')
}

function handlePromptDetailError(error: unknown, setSessionExpired: (value: boolean) => void): void {
  if (isAbortError(error)) return
  if (error instanceof ApiError && error.status === 401) {
    setSessionExpired(true)
    return
  }
  toast.error('Error fetching prompt content')
}

type PromptSaveTarget = { ok: true; targetName: string } | { ok: false; nameError?: string }

function resolvePromptSaveTarget(
  isNew: boolean,
  newName: string,
  selectedName: string | null,
  prompts: PromptSummary[],
): PromptSaveTarget {
  const targetName = resolveTargetName(isNew, newName, selectedName)
  if (!isNew) return targetName ? { ok: true, targetName } : { ok: false }
  const nameError = validateNewPromptName(targetName)
  if (nameError) return { ok: false, nameError }
  if (!confirmOverwriteIfExisting(targetName, prompts)) return { ok: false }
  return { ok: true, targetName }
}

function setPromptSaveNameError(nameError: string | undefined, setNameError: (value: string) => void): void {
  if (nameError) setNameError(nameError)
}

function promptSaveFailureMessage(isNew: boolean): string {
  return isNew ? 'Failed to create prompt' : 'Failed to save prompt config'
}

function promptSaveSuccessMessage(isNew: boolean, targetName: string): string {
  return isNew ? `Prompt "${targetName}" created successfully` : 'Prompt configuration saved successfully'
}

function handlePromptSaveError(error: unknown, sequence: SequenceRef, abort: AbortRef, request: PromptRequest): void {
  if (!isCurrentPromptRequest(sequence, abort, request)) return
  if (isAbortError(error)) return
  toast.error('Error sending save request')
}

function finishPromptSave(
  sequence: SequenceRef,
  abort: AbortRef,
  request: PromptRequest,
  setSaving: (value: boolean) => void,
): void {
  if (!isCurrentPromptRequest(sequence, abort, request)) return
  setSaving(false)
  clearPromptRequest(abort, request)
}

function updatePromptField(promptDetail: PromptDetail, key: string, val: string): PromptDetail {
  return { ...promptDetail, [key]: val }
}

function applyPromptFieldChange(
  promptDetail: PromptDetail | null,
  key: string,
  val: string,
  editorRevision: SequenceRef,
  setPromptDetail: (value: PromptDetail) => void,
  setRawJsonText: (value: string) => void,
): void {
  if (!promptDetail) return
  editorRevision.current += 1
  const updated = updatePromptField(promptDetail, key, val)
  setPromptDetail(updated)
  setRawJsonText(JSON.stringify(updated, null, 4))
}

const PROMPT_FLAT_FIELD_MAP: Partial<Record<string, Record<string, string>>> = {
  identity: { role: 'title', goal: 'goal' },
  instructions: { core_directive: 'core_directive' },
}

function updateNestedPromptField(promptDetail: PromptDetail, section: string, key: string, val: string): PromptDetail {
  const sectionValue = promptDetail[section]
  const existingSection = typeof sectionValue === 'object' && sectionValue !== null ? sectionValue : {}
  const updated: PromptDetail = {
    ...promptDetail,
    [section]: {
      ...existingSection,
      [key]: val,
    },
  }
  const flatKey = PROMPT_FLAT_FIELD_MAP[section]?.[key]
  if (flatKey) updated[flatKey] = val
  return updated
}

type ToolMutationResult = { ok: true; tools: string[] } | { ok: false; message?: string }

function appendPromptTool(tools: string[], rawTool: string): ToolMutationResult {
  const toolName = rawTool.trim()
  if (toolName.length === 0) return { ok: false }
  if (tools.includes(toolName)) return { ok: false, message: 'Tool already added' }
  const updatedTools = [...tools, toolName]
  const toolsError = validatePromptTools(updatedTools)
  return toolsError ? { ok: false, message: toolsError } : { ok: true, tools: updatedTools }
}

function showToolMutationError(result: ToolMutationResult): void {
  if (!result.ok && result.message) toast.error(result.message)
}

function removePromptTool(tools: string[], toolName: string): string[] {
  return tools.filter((tool) => tool !== toolName)
}

function getJsonSaveError(
  editMode: 'form' | 'json',
  promptDetail: PromptDetail | null,
  rawJsonText: string,
): string | null {
  if (editMode !== 'json' || !promptDetail) return null
  const result = parseSavePayload('json', promptDetail, rawJsonText)
  return result.ok ? null : result.message
}

function matchesPromptSearch(prompt: PromptSummary, searchQuery: string): boolean {
  const query = searchQuery.toLowerCase()
  return prompt.title.toLowerCase().includes(query) || prompt.name.toLowerCase().includes(query)
}

function filterPrompts(prompts: PromptSummary[], searchQuery: string): PromptSummary[] {
  return prompts.filter((prompt) => matchesPromptSearch(prompt, searchQuery))
}

export default function PromptsView() {
  const [prompts, setPrompts] = useState<PromptSummary[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [promptDetail, setPromptDetail] = useState<PromptDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [promptsUnavailable, setPromptsUnavailable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [editMode, setEditMode] = useState<'form' | 'json'>('form')
  const [rawJsonText, setRawJsonText] = useState('')
  const newToolRef = useRef('')
  const [toolInputResetKey, setToolInputResetKey] = useState(0)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const detailSequence = useRef(0)
  const detailAbort = useRef<AbortController | null>(null)
  const isNewPromptRef = useRef(false)
  const editorRevision = useRef(0)
  const saveSequence = useRef(0)
  const saveAbort = useRef<AbortController | null>(null)
  const listSequence = useRef(0)
  const listAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    void loadPrompts()
    return () => {
      invalidatePromptRequest(detailSequence, detailAbort)
      invalidatePromptRequest(saveSequence, saveAbort)
      invalidatePromptRequest(listSequence, listAbort)
    }
  }, [])

  const loadPrompts = async (loadFirstPrompt = true) => {
    const request = beginPromptRequest(listSequence, listAbort)
    const detailRequestAtStart = detailSequence.current
    try {
      setLoading(true)
      const data = await fetchValidated('/api/enhanced/prompts', looseArray(promptSummarySchema), {
        signal: request.controller.signal,
      })
      if (!isCurrentPromptRequest(listSequence, listAbort, request)) return
      setSessionExpired(false)
      setPrompts(data)
      setPromptsUnavailable(false)
      const firstPrompt = firstPromptNameToLoad(
        loadFirstPrompt,
        data,
        selectedName,
        isNewPromptRef.current,
        detailRequestAtStart,
        detailSequence.current,
      )
      if (firstPrompt) void loadPromptDetail(firstPrompt)
    } catch (err) {
      if (isCurrentPromptRequest(listSequence, listAbort, request)) {
        handlePromptListError(err, setSessionExpired, setPrompts, setPromptsUnavailable)
      }
    } finally {
      if (isCurrentPromptRequest(listSequence, listAbort, request)) {
        setLoading(false)
        clearPromptRequest(listAbort, request)
      }
    }
  }

  const loadPromptDetail = async (name: string) => {
    invalidatePromptRequest(saveSequence, saveAbort)
    setSaving(false)
    editorRevision.current += 1
    const request = beginPromptRequest(detailSequence, detailAbort)
    try {
      isNewPromptRef.current = false
      setIsNew(false)
      setNameError(null)
      setSelectedName(name)
      // Do not leave the previous document editable while this detail request
      // is pending; otherwise Save could send that stale document to `name`.
      setPromptDetail(null)
      setRawJsonText('')
      const data = await fetchValidated(`/api/enhanced/prompts/${name}`, promptDetailSchema, {
        signal: request.controller.signal,
      })
      if (!isCurrentPromptRequest(detailSequence, detailAbort, request)) return
      setPromptDetail(data)
      setRawJsonText(JSON.stringify(data, null, 4))
    } catch (err) {
      if (isCurrentPromptRequest(detailSequence, detailAbort, request)) {
        handlePromptDetailError(err, setSessionExpired)
      }
    } finally {
      clearPromptRequest(detailAbort, request)
    }
  }

  /** Enter a blank, editable "create" state without requiring a prior GET —
   * the sidebar has no affordance to reach this today (Lane 4). */
  const startNewPrompt = () => {
    invalidatePromptRequest(saveSequence, saveAbort)
    setSaving(false)
    editorRevision.current += 1
    invalidatePromptRequest(detailSequence, detailAbort)
    isNewPromptRef.current = true
    setIsNew(true)
    setNameError(null)
    setSelectedName(null)
    setNewName('')
    newToolRef.current = ''
    setToolInputResetKey((key) => key + 1)
    setPromptDetail(DEFAULT_PROMPT_DETAIL)
    setRawJsonText(JSON.stringify(DEFAULT_PROMPT_DETAIL, null, 4))
    setEditMode('form')
  }

  const handleFieldChange = (key: string, val: string) => {
    applyPromptFieldChange(promptDetail, key, val, editorRevision, setPromptDetail, setRawJsonText)
  }

  const handleNestedFieldChange = (section: string, key: string, val: string) => {
    if (!promptDetail) return
    editorRevision.current += 1
    const updated = updateNestedPromptField(promptDetail, section, key, val)
    setPromptDetail(updated)
    setRawJsonText(JSON.stringify(updated, null, 4))
  }

  const handleAddTool = (rawTool: string): boolean => {
    if (!promptDetail) return false
    const currentTools = promptDetail.tools ?? []
    const result = appendPromptTool(currentTools, rawTool)
    if (!result.ok) {
      showToolMutationError(result)
      return false
    }
    editorRevision.current += 1
    const updated = { ...promptDetail, tools: result.tools }
    setPromptDetail(updated)
    setRawJsonText(JSON.stringify(updated, null, 4))
    newToolRef.current = ''
    return true
  }

  const handleRemoveTool = (toolName: string) => {
    if (!promptDetail) return
    editorRevision.current += 1
    const currentTools = promptDetail.tools ?? []
    const updatedTools = removePromptTool(currentTools, toolName)
    const updated = { ...promptDetail, tools: updatedTools }
    setPromptDetail(updated)
    setRawJsonText(JSON.stringify(updated, null, 4))
  }

  const handleSave = async () => {
    const target = resolvePromptSaveTarget(isNew, newName, selectedName, prompts)
    if (!target.ok) {
      setPromptSaveNameError(target.nameError, setNameError)
      return
    }
    setNameError(null)
    const selectionAtStart = detailSequence.current
    const editorRevisionAtStart = editorRevision.current
    const request = beginPromptRequest(saveSequence, saveAbort)
    setSaving(true)
    try {
      const parsed = parseSavePayload(editMode, promptDetail, rawJsonText)
      if (!parsed.ok) {
        toast.error(parsed.message)
        return
      }
      const res = await fetch(`/api/enhanced/prompts/${target.targetName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.payload),
        signal: request.controller.signal,
      })
      if (
        !isCurrentSaveRequest(
          saveSequence,
          saveAbort,
          request,
          detailSequence,
          selectionAtStart,
          editorRevision,
          editorRevisionAtStart,
        )
      )
        return
      if (!res.ok) {
        toast.error(promptSaveFailureMessage(isNew))
        return
      }
      toast.success(promptSaveSuccessMessage(isNew, target.targetName))
      isNewPromptRef.current = false
      setIsNew(false)
      setNewName('')
      await loadPrompts(false)
      if (
        !isCurrentSaveRequest(
          saveSequence,
          saveAbort,
          request,
          detailSequence,
          selectionAtStart,
          editorRevision,
          editorRevisionAtStart,
        )
      ) {
        return
      }
      void loadPromptDetail(target.targetName)
    } catch (error) {
      handlePromptSaveError(error, saveSequence, saveAbort, request)
    } finally {
      finishPromptSave(saveSequence, saveAbort, request, setSaving)
    }
  }

  const jsonSaveError = getJsonSaveError(editMode, promptDetail, rawJsonText)

  const handleSetEditMode = (mode: 'form' | 'json') => {
    if (mode === editMode) return
    if (mode === 'form' && promptDetail) {
      const parsed = parseSavePayload('json', promptDetail, rawJsonText)
      if (!parsed.ok) {
        toast.error(parsed.message)
        return
      }
      setPromptDetail(parsed.payload)
      setRawJsonText(JSON.stringify(parsed.payload, null, 4))
    }
    editorRevision.current += 1
    setEditMode(mode)
  }

  const handleRawJsonTextChange = (value: string) => {
    editorRevision.current += 1
    setRawJsonText(value)
  }

  const handleNewNameChange = (value: string) => {
    editorRevision.current += 1
    setNewName(value)
    setNameError(null)
  }

  const handleNewToolChange = (value: string) => {
    editorRevision.current += 1
    newToolRef.current = value
  }

  const filteredPrompts = filterPrompts(prompts, searchQuery)

  if (sessionExpired) {
    return <SessionExpiredNotice />
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-12rem)]">
      {/* 1. Sidebar - Prompt List */}
      <Card className="lg:col-span-1 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-teal-400">
              Prompt Profiles
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                type="button"
                className="h-8 w-8"
                onClick={startNewPrompt}
                title="New prompt"
                aria-label="New prompt"
              >
                <Plus className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                type="button"
                className="h-8 w-8"
                onClick={() => {
                  void loadPrompts()
                }}
                title="Refresh"
                aria-label="Refresh prompts"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
          </div>
          <CardDescription>
            Choose a saved instruction profile, or use New Prompt to create one for future runs.
          </CardDescription>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              aria-label="Search prompts"
              placeholder="Search prompts..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
              }}
              className="pl-9 h-8 bg-muted/20"
            />
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full px-4">
            <div className="space-y-2 pb-4">
              {renderPromptSidebarList({
                loading,
                unavailable: promptsUnavailable,
                filteredPrompts,
                selectedName,
                onSelect: (name) => {
                  void loadPromptDetail(name)
                },
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* 2. Main Prompt Editor panel */}
      <Card className="lg:col-span-2 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
        <CardHeader className="border-b border-border/30 pb-3">
          {renderEditorHeader({
            isNew,
            promptDetail,
            selectedName,
            editMode,
            onSetEditMode: handleSetEditMode,
            saving,
            jsonError: jsonSaveError,
            onSave: () => {
              void handleSave()
            },
          })}
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-4">
          {renderEditorPanel({
            promptDetail,
            isNew,
            newName,
            nameError,
            onNewNameChange: handleNewNameChange,
            editMode,
            rawJsonText,
            jsonError: jsonSaveError,
            onRawJsonTextChange: handleRawJsonTextChange,
            newTool: newToolRef.current,
            toolInputResetKey,
            onFieldChange: handleFieldChange,
            onNestedFieldChange: handleNestedFieldChange,
            onNewToolChange: handleNewToolChange,
            onAddTool: handleAddTool,
            onRemoveTool: handleRemoveTool,
          })}
        </CardContent>
      </Card>
    </div>
  )
}
