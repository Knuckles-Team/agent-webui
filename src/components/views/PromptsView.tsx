import { useState, useEffect } from 'react'
import { z } from 'zod'
import { FileText, Search, Save, RefreshCw, Code, X, Wrench, Sparkles, Settings, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { fetchValidated, ApiError, looseArray, looseObject } from '@/lib/api-validation'
import { SessionExpiredNotice } from '@/components/SessionExpiredNotice'

interface PromptSummary {
  name: string
  title: string
  goal: string
  core_directive: string
  file_path: string
}

interface PromptDetail {
  title?: string
  task?: string
  type?: string
  version?: string
  identity?: { role?: string; goal?: string }
  goal?: string
  core_directive?: string
  instructions?: { core_directive?: string; [k: string]: unknown }
  tools?: string[]
  metadata?: { topic?: string; tone?: string; style?: string; [k: string]: unknown }
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

// Matches the backend's own name validation (`resolve_prompt_file`,
// api_extensions.py:1139) so an invalid name is rejected client-side before
// a request is ever issued.
const PROMPT_NAME_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

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

// PUT is a genuine upsert with no existence check server-side, so a "create"
// that reuses an existing name would SILENTLY overwrite it -- require
// explicit confirmation first.
function confirmOverwriteIfExisting(targetName: string, prompts: PromptSummary[]): boolean {
  if (!prompts.some((p) => p.name === targetName)) return true
  return window.confirm(`A prompt named "${targetName}" already exists. Saving will overwrite it. Continue?`)
}

function parseSavePayload(
  editMode: 'form' | 'json',
  promptDetail: PromptDetail | null,
  rawJsonText: string,
): { ok: true; payload: PromptDetail | null } | { ok: false; message: string } {
  if (editMode !== 'json') return { ok: true, payload: promptDetail }
  try {
    return { ok: true, payload: JSON.parse(rawJsonText) as PromptDetail }
  } catch (e) {
    return { ok: false, message: `Invalid JSON syntax: ${e instanceof Error ? e.message : String(e)}` }
  }
}

function renderPromptSidebarList({
  loading,
  filteredPrompts,
  selectedName,
  onSelect,
}: {
  loading: boolean
  filteredPrompts: PromptSummary[]
  selectedName: string | null
  onSelect: (name: string) => void
}) {
  if (loading) return <div className="text-center py-8 text-sm text-muted-foreground">Loading...</div>
  if (filteredPrompts.length === 0) {
    return <div className="text-center py-8 text-sm text-muted-foreground">No prompts found</div>
  }
  return (
    <>
      {filteredPrompts.map((p) => (
        <button
          key={p.name}
          onClick={() => {
            onSelect(p.name)
          }}
          className={`w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 ${
            selectedName === p.name
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-semibold'
              : 'border-border/30 bg-muted/10 text-muted-foreground hover:text-foreground'
          }`}
        >
          <FileText className="size-4 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="font-bold text-xs truncate">{p.title}</div>
            <div className="text-[10px] opacity-70 truncate font-mono mt-0.5">{p.name}.json</div>
          </div>
        </button>
      ))}
    </>
  )
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
        value={newName}
        onChange={(e) => {
          onChange(e.target.value)
        }}
        placeholder="e.g. release-notes-writer"
        className="mt-1 h-8 bg-muted/20 text-xs font-mono"
      />
      {nameError && (
        <p role="alert" className="mt-1.5 text-xs text-red-400 font-medium">
          {nameError}
        </p>
      )}
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
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Task ID</label>
        <Input
          value={promptDetail.task ?? ''}
          onChange={(e) => {
            onFieldChange('task', e.target.value)
          }}
          className="mt-1 h-8 bg-muted/20 text-xs font-semibold"
        />
      </div>
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Profile Type</label>
        <Input
          value={promptDetail.type ?? ''}
          onChange={(e) => {
            onFieldChange('type', e.target.value)
          }}
          className="mt-1 h-8 bg-muted/20 text-xs font-semibold"
        />
      </div>
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Version</label>
        <Input
          value={promptDetail.version ?? ''}
          onChange={(e) => {
            onFieldChange('version', e.target.value)
          }}
          className="mt-1 h-8 bg-muted/20 text-xs font-semibold"
        />
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
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Role / Title</label>
        <Input
          value={promptDetail.identity?.role ?? promptDetail.title ?? ''}
          onChange={(e) => {
            onNestedFieldChange('identity', 'role', e.target.value)
          }}
          className="mt-1.5 bg-muted/20 text-xs font-medium"
        />
      </div>
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Goal / Core Intent
        </label>
        <Textarea
          value={promptDetail.identity?.goal ?? promptDetail.goal ?? ''}
          onChange={(e) => {
            onNestedFieldChange('identity', 'goal', e.target.value)
          }}
          className="mt-1.5 bg-muted/20 text-xs leading-relaxed"
          rows={3}
        />
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
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Topic</label>
        <Input
          value={promptDetail.metadata?.topic ?? ''}
          onChange={(e) => {
            onNestedFieldChange('metadata', 'topic', e.target.value)
          }}
          className="mt-1 h-8 bg-muted/20 text-xs"
        />
      </div>
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tone</label>
        <Input
          value={promptDetail.metadata?.tone ?? ''}
          onChange={(e) => {
            onNestedFieldChange('metadata', 'tone', e.target.value)
          }}
          className="mt-1 h-8 bg-muted/20 text-xs"
        />
      </div>
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Style</label>
        <Input
          value={promptDetail.metadata?.style ?? ''}
          onChange={(e) => {
            onNestedFieldChange('metadata', 'style', e.target.value)
          }}
          className="mt-1 h-8 bg-muted/20 text-xs"
        />
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
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          System Prompt Directive
        </label>
        <Textarea
          value={promptDetail.instructions?.core_directive ?? promptDetail.core_directive ?? ''}
          onChange={(e) => {
            onNestedFieldChange('instructions', 'core_directive', e.target.value)
          }}
          className="mt-1.5 bg-muted/20 font-mono text-xs leading-relaxed"
          rows={12}
        />
      </div>
    </div>
  )
}

function renderToolsSection({
  promptDetail,
  newTool,
  onNewToolChange,
  onAddTool,
  onRemoveTool,
}: {
  promptDetail: PromptDetail
  newTool: string
  onNewToolChange: (v: string) => void
  onAddTool: () => void
  onRemoveTool: (toolName: string) => void
}) {
  const tools = promptDetail.tools ?? []
  return (
    <div className="space-y-4 border border-border/20 rounded-xl p-4 bg-muted/5 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border/30 pb-2 mb-2">
        <Wrench className="size-4 text-emerald-400" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Provisioned Capabilities</h3>
      </div>
      <div>
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Active Skill &amp; Tool Tokens
        </label>
        <div className="flex flex-wrap gap-1.5 mt-2 p-2 border border-border/20 rounded-lg min-h-[4rem] bg-muted/10 items-start">
          {tools.length === 0 ? (
            <span className="text-xs text-muted-foreground italic p-1">No tools bound to this profile.</span>
          ) : (
            tools.map((tool: string) => (
              <Badge
                key={tool}
                variant="secondary"
                className="flex items-center gap-1 text-[10px] bg-emerald-500/10 border-emerald-500/20 text-emerald-400 px-2 py-0.75 hover:bg-emerald-500/20 transition-all font-semibold"
              >
                {tool}
                <button
                  onClick={() => {
                    onRemoveTool(tool)
                  }}
                  className="hover:text-red-400 transition-colors ml-0.5 shrink-0"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))
          )}
        </div>
        <div className="flex gap-2 mt-2">
          <Input
            placeholder="Enter tool or skill name (e.g. react-docs)..."
            value={newTool}
            onChange={(e) => {
              onNewToolChange(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onAddTool()
              }
            }}
            className="h-8 bg-muted/20 text-xs"
          />
          <Button
            size="sm"
            onClick={onAddTool}
            className="h-8 bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold shrink-0"
          >
            Bind Tool
          </Button>
        </div>
      </div>
    </div>
  )
}

interface FormEditorProps {
  promptDetail: PromptDetail
  newTool: string
  onFieldChange: (key: string, val: string) => void
  onNestedFieldChange: (section: string, key: string, val: string) => void
  onNewToolChange: (v: string) => void
  onAddTool: () => void
  onRemoveTool: (toolName: string) => void
}

function renderFormEditor(props: FormEditorProps) {
  const { promptDetail, newTool, onFieldChange, onNestedFieldChange, onNewToolChange, onAddTool, onRemoveTool } = props
  return (
    <div className="space-y-6 pb-8">
      {renderGeneralParamsSection({ promptDetail, onFieldChange })}
      {renderIdentitySection({ promptDetail, onNestedFieldChange })}
      {renderMetadataSection({ promptDetail, onNestedFieldChange })}
      {renderBehaviorSection({ promptDetail, onNestedFieldChange })}
      {renderToolsSection({ promptDetail, newTool, onNewToolChange, onAddTool, onRemoveTool })}
    </div>
  )
}

function renderJsonEditor({ rawJsonText, onChange }: { rawJsonText: string; onChange: (v: string) => void }) {
  return (
    <div className="h-full flex flex-col pb-4">
      <Textarea
        value={rawJsonText}
        onChange={(e) => {
          onChange(e.target.value)
        }}
        className="flex-1 font-mono text-xs bg-muted/10 border-border/40 p-4 resize-none h-[calc(100vh-22rem)]"
        placeholder="Enter valid configuration JSON..."
      />
    </div>
  )
}

function editorTitle(isNew: boolean, promptDetail: PromptDetail | null, selectedName: string | null): string {
  if (isNew) return 'New Prompt'
  return promptDetail?.title || selectedName || 'Prompt Editor'
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
  onSave: () => void
}

function renderEditorHeader(props: EditorHeaderProps) {
  const { isNew, promptDetail, selectedName, editMode, onSetEditMode, saving, onSave } = props
  return (
    <div className="flex items-center justify-between">
      <div>
        <CardTitle className="text-lg font-bold text-foreground">
          {editorTitle(isNew, promptDetail, selectedName)}
        </CardTitle>
        <CardDescription>Customize behavior directives, goals, and role specifications.</CardDescription>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex border border-border/40 rounded-lg p-0.5 bg-muted/30">
          <Button
            variant="ghost"
            size="sm"
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
          onClick={onSave}
          disabled={saving || !promptDetail}
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
  onRawJsonTextChange: (v: string) => void
}

function renderEditorPanel(props: EditorPanelProps) {
  const { promptDetail, isNew, newName, nameError, onNewNameChange, editMode, rawJsonText, onRawJsonTextChange } =
    props
  if (!promptDetail) return renderEmptyEditorState()
  return (
    <ScrollArea className="h-full pr-2">
      {isNew && renderNewPromptNameField({ newName, nameError, onChange: onNewNameChange })}
      {editMode === 'form'
        ? renderFormEditor({ ...props, promptDetail })
        : renderJsonEditor({ rawJsonText, onChange: onRawJsonTextChange })}
    </ScrollArea>
  )
}

export default function PromptsView() {
  const [prompts, setPrompts] = useState<PromptSummary[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [promptDetail, setPromptDetail] = useState<PromptDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [editMode, setEditMode] = useState<'form' | 'json'>('form')
  const [rawJsonText, setRawJsonText] = useState('')
  const [newTool, setNewTool] = useState('')
  const [sessionExpired, setSessionExpired] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)

  useEffect(() => {
    void loadPrompts()
  }, [])

  const loadPrompts = async () => {
    try {
      setLoading(true)
      const data = await fetchValidated('/api/enhanced/prompts', looseArray(promptSummarySchema))
      setSessionExpired(false)
      setPrompts(data)
      if (data.length > 0 && !selectedName) {
        void loadPromptDetail(data[0].name)
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSessionExpired(true)
      } else {
        toast.error('Error connecting to prompts registry')
      }
    } finally {
      setLoading(false)
    }
  }

  const loadPromptDetail = async (name: string) => {
    try {
      setIsNew(false)
      setNameError(null)
      setSelectedName(name)
      const data = (await fetchValidated(`/api/enhanced/prompts/${name}`, looseObject())) as PromptDetail
      setPromptDetail(data)
      setRawJsonText(JSON.stringify(data, null, 4))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSessionExpired(true)
      } else {
        toast.error('Error fetching prompt content')
      }
    }
  }

  /** Enter a blank, editable "create" state without requiring a prior GET —
   * the sidebar has no affordance to reach this today (Lane 4). */
  const startNewPrompt = () => {
    setIsNew(true)
    setNameError(null)
    setSelectedName(null)
    setNewName('')
    setPromptDetail(DEFAULT_PROMPT_DETAIL)
    setRawJsonText(JSON.stringify(DEFAULT_PROMPT_DETAIL, null, 4))
    setEditMode('form')
  }

  const handleFieldChange = (key: string, val: string) => {
    const updated = { ...promptDetail, [key]: val }
    setPromptDetail(updated)
    setRawJsonText(JSON.stringify(updated, null, 4))
  }

  const handleNestedFieldChange = (section: string, key: string, val: string) => {
    if (!promptDetail) return
    const updated = {
      ...promptDetail,
      [section]: {
        ...((promptDetail[section] as Record<string, unknown> | undefined) ?? {}),
        [key]: val,
      },
    }
    // Sync flat fields for compatibility
    if (section === 'identity' && key === 'role') updated.title = val
    if (section === 'identity' && key === 'goal') updated.goal = val
    if (section === 'instructions' && key === 'core_directive') updated.core_directive = val

    setPromptDetail(updated)
    setRawJsonText(JSON.stringify(updated, null, 4))
  }

  const handleAddTool = () => {
    if (!newTool.trim() || !promptDetail) return
    const currentTools = promptDetail.tools ?? []
    if (currentTools.includes(newTool.trim())) {
      toast.error('Tool already added')
      return
    }
    const updatedTools = [...currentTools, newTool.trim()]
    const updated = { ...promptDetail, tools: updatedTools }
    setPromptDetail(updated)
    setRawJsonText(JSON.stringify(updated, null, 4))
    setNewTool('')
  }

  const handleRemoveTool = (toolName: string) => {
    if (!promptDetail) return
    const currentTools = promptDetail.tools ?? []
    const updatedTools = currentTools.filter((t: string) => t !== toolName)
    const updated = { ...promptDetail, tools: updatedTools }
    setPromptDetail(updated)
    setRawJsonText(JSON.stringify(updated, null, 4))
  }

  const handleSave = async () => {
    const targetName = resolveTargetName(isNew, newName, selectedName)

    if (isNew) {
      const nameErr = validateNewPromptName(targetName)
      if (nameErr) {
        setNameError(nameErr)
        return
      }
      if (!confirmOverwriteIfExisting(targetName, prompts)) return
    }

    if (!targetName) return
    setNameError(null)
    setSaving(true)
    try {
      const parsed = parseSavePayload(editMode, promptDetail, rawJsonText)
      if (!parsed.ok) {
        toast.error(parsed.message)
        return
      }
      const res = await fetch(`/api/enhanced/prompts/${targetName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.payload),
      })
      if (!res.ok) {
        toast.error(isNew ? 'Failed to create prompt' : 'Failed to save prompt config')
        return
      }
      toast.success(isNew ? `Prompt "${targetName}" created successfully` : 'Prompt configuration saved successfully')
      setIsNew(false)
      setNewName('')
      await loadPrompts()
      void loadPromptDetail(targetName)
    } catch {
      toast.error('Error sending save request')
    } finally {
      setSaving(false)
    }
  }

  const filteredPrompts = prompts.filter(
    (p) =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

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
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={startNewPrompt} title="New prompt">
                <Plus className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  void loadPrompts()
                }}
                title="Refresh"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
          </div>
          <CardDescription>System prompts stored in agent-utilities prompts package.</CardDescription>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
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
            onSetEditMode: setEditMode,
            saving,
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
            onNewNameChange: (v) => {
              setNewName(v)
              setNameError(null)
            },
            editMode,
            rawJsonText,
            onRawJsonTextChange: setRawJsonText,
            newTool,
            onFieldChange: handleFieldChange,
            onNestedFieldChange: handleNestedFieldChange,
            onNewToolChange: setNewTool,
            onAddTool: handleAddTool,
            onRemoveTool: handleRemoveTool,
          })}
        </CardContent>
      </Card>
    </div>
  )
}
