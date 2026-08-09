/**
 * @file LLMTemplatesView.tsx
 * @description LLM Models / configuration section (D-AOBS-4, W-8 fix): the
 * PRIMARY, sidebar-bound list is the live `AgentConfig.chat_models` registry
 * (`GET /api/enhanced/llm/models` — the same registry `create_model` resolves
 * against), not the system-prompt store. Picking a model surfaces its actual
 * AgentConfig settings (provider, intelligence level, context window,
 * vision/reasoning/tools capability, routing/KG eligibility — e.g. the
 * `qwen` model's configured settings) in a read-only "Model configuration"
 * card, then optionally lets you pair it with generation parameters and a
 * system prompt into a saved template.
 *
 * Before this fix the sidebar listed prompt documents from
 * `/api/enhanced/prompts` — i.e. system prompts — which is what the
 * "LLM Templates" section is NOT supposed to show (that already has its own
 * dedicated home: `control-plane.prompts` / `PromptsView.tsx`, the Prompts
 * Registry). Templates (a prompt document with `model` + `parameters`
 * fields attached) are still composed and saved through the EXISTING prompt
 * store (`/api/enhanced/prompts/{name}`) — no second storage layer — but
 * loading one is now a secondary "load existing template" action, not the
 * panel's primary binding.
 *
 * `w3-agent-library` (a sibling lane) owns the full agent library and its
 * graph-node storage — this view does not touch that store or duplicate it;
 * it only composes model + parameters + system prompt into the prompt file
 * format the Prompts Registry already reads and writes.
 */
import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import { Cpu, Eye, Plus, RefreshCw, Save, Search, Sparkles, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { fetchValidated, ApiError, looseArray } from '@/lib/api-validation'
import { SessionExpiredNotice } from '@/components/SessionExpiredNotice'

interface LLMModel {
  id: string
  provider: string
  intelligence_level: string
  vision: boolean
  reasoning: boolean
  tools_enabled: boolean
  context_window: number | null
  can_route: boolean
  can_kg: boolean
}
const modelSchema: z.ZodType<LLMModel> = z.object({
  id: z.string(),
  provider: z.string(),
  intelligence_level: z.string(),
  vision: z.boolean(),
  reasoning: z.boolean(),
  tools_enabled: z.boolean(),
  context_window: z.number().nullable(),
  can_route: z.boolean(),
  can_kg: z.boolean(),
})

interface TemplateSummary {
  name: string
  title: string
  goal: string
  core_directive: string
  file_path: string
}
const templateSummarySchema: z.ZodType<TemplateSummary> = z.object({
  name: z.string(),
  title: z.string(),
  goal: z.string(),
  core_directive: z.string(),
  file_path: z.string(),
})

interface TemplateParameters {
  temperature: number
  top_p: number
  max_tokens: number
  reasoning_effort: string
}
const DEFAULT_PARAMETERS: TemplateParameters = {
  temperature: 0.7,
  top_p: 1,
  max_tokens: 4096,
  reasoning_effort: 'inherit',
}
const REASONING_EFFORTS = ['inherit', 'none', 'low', 'medium', 'high', 'xhigh']

/** Loosely-shaped (`z.looseObject` keeps unknown keys) so it round-trips
 *  whatever else a prompt document already carries (identity/instructions/
 *  metadata/tools/...) without this view needing to understand every field
 *  PromptsView.tsx manages. */
const templateDetailSchema = z.looseObject({
  title: z.string().optional(),
  goal: z.string().optional(),
  core_directive: z.string().optional(),
  model: z.string().optional(),
  parameters: z
    .looseObject({
      temperature: z.number().optional(),
      top_p: z.number().optional(),
      max_tokens: z.number().optional(),
      reasoning_effort: z.string().optional(),
    })
    .optional(),
})

function ModelBadges({ model }: { model: LLMModel }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant="outline" className="text-[9px]">
        {model.provider}
      </Badge>
      <Badge variant="outline" className="text-[9px]">
        {model.intelligence_level}
      </Badge>
      {model.reasoning && (
        <Badge variant="secondary" className="text-[9px]">
          reasoning
        </Badge>
      )}
      {model.vision && (
        <Badge variant="secondary" className="text-[9px]">
          vision
        </Badge>
      )}
      {model.tools_enabled && (
        <Badge variant="secondary" className="text-[9px]">
          tools
        </Badge>
      )}
      {model.context_window && (
        <Badge variant="outline" className="text-[9px]">
          {(model.context_window / 1000).toFixed(0)}k ctx
        </Badge>
      )}
    </div>
  )
}

export default function LLMTemplatesView() {
  const [models, setModels] = useState<LLMModel[]>([])
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [coreDirective, setCoreDirective] = useState('')
  const [modelId, setModelId] = useState('')
  const [parameters, setParameters] = useState<TemplateParameters>(DEFAULT_PARAMETERS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sessionExpired, setSessionExpired] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [m, t] = await Promise.all([
        fetchValidated('/api/enhanced/llm/models', looseArray(modelSchema)),
        fetchValidated('/api/enhanced/prompts', looseArray(templateSummarySchema)),
      ])
      setSessionExpired(false)
      setModels(m)
      setTemplates(t)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSessionExpired(true)
      } else {
        toast.error('Error connecting to the LLM template composer')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const loadTemplate = useCallback(async (name: string) => {
    try {
      const detail = await fetchValidated(`/api/enhanced/prompts/${name}`, templateDetailSchema)
      setSelectedName(name)
      setIsNew(false)
      setTitle(detail.title ?? name)
      setGoal(detail.goal ?? '')
      setCoreDirective(detail.core_directive ?? '')
      setModelId(detail.model ?? '')
      setParameters({ ...DEFAULT_PARAMETERS, ...detail.parameters })
    } catch {
      toast.error('Failed to load template')
    }
  }, [])

  const startNewTemplate = () => {
    setSelectedName(null)
    setIsNew(true)
    setNewName('')
    setTitle('')
    setGoal('')
    setCoreDirective('')
    setModelId(models[0]?.id ?? '')
    setParameters(DEFAULT_PARAMETERS)
  }

  /** Selecting a model from the (now primary) AgentConfig-bound sidebar list
   * — starts a fresh, unsaved template scoped to that model so its
   * configuration card renders immediately, without loading any prompt. */
  const selectModel = (m: LLMModel) => {
    setSelectedName(null)
    setIsNew(true)
    setNewName('')
    setTitle('')
    setGoal('')
    setCoreDirective('')
    setModelId(m.id)
    setParameters(DEFAULT_PARAMETERS)
  }

  const handleSave = async () => {
    const targetName = isNew ? newName.trim() : selectedName
    if (!targetName) {
      toast.error('Give the template a name first')
      return
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(targetName)) {
      toast.error('Template name may only contain letters, numbers, "-", and "_"')
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        title: title || targetName,
        goal,
        core_directive: coreDirective,
        model: modelId,
        parameters,
      }
      const res = await fetch(`/api/enhanced/prompts/${targetName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        toast.error('Failed to save template')
        return
      }
      toast.success(`Template "${targetName}" saved`)
      setIsNew(false)
      setSelectedName(targetName)
      void loadAll()
    } catch {
      toast.error('Error sending save request')
    } finally {
      setSaving(false)
    }
  }

  const filteredModels = models.filter(
    (m) =>
      m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.provider.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.intelligence_level.toLowerCase().includes(searchQuery.toLowerCase()),
  )
  const selectedModel = models.find((m) => m.id === modelId)

  if (sessionExpired) {
    return <SessionExpiredNotice />
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-12rem)]">
      {/* 1. Sidebar - LLM Models (AgentConfig.chat_models — W-8: this is the
          panel's primary binding, not the prompt/system-prompt store). */}
      <Card className="lg:col-span-1 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <Cpu className="size-5 text-emerald-400" />
              LLM Templates
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={startNewTemplate}>
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  void loadAll()
                }}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
          <CardDescription>Model/LLM configuration from AgentConfig&apos;s chat_models registry.</CardDescription>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
              }}
              className="pl-8 h-9"
            />
          </div>
        </CardHeader>
        <ScrollArea className="flex-1">
          <CardContent className="space-y-1 pt-0">
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading models…</div>
            ) : filteredModels.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No models are configured in AgentConfig&apos;s `chat_models` yet.
              </div>
            ) : (
              filteredModels.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    selectModel(m)
                  }}
                  className={`w-full text-left rounded-md p-2 text-sm hover:bg-muted/40 ${
                    modelId === m.id ? 'bg-muted/60' : ''
                  }`}
                >
                  <div className="font-medium truncate">{m.id}</div>
                  <div className="text-xs text-muted-foreground truncate">{m.provider}</div>
                  <div className="mt-1">
                    <ModelBadges model={m} />
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </ScrollArea>
      </Card>

      {/* 2. Composer */}
      <Card className="lg:col-span-2 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Sparkles className="size-4 text-emerald-400" />
              {selectedModel ? selectedModel.id : 'Select a model'}
            </CardTitle>
            <CardDescription>
              Model configuration from AgentConfig, plus an optional saved template (generation parameters + system
              prompt) that pairs with it.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => {
              void handleSave()
            }}
            disabled={saving || (!isNew && !selectedName)}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Save className="size-4 mr-1.5" />
            {saving ? 'Saving...' : 'Save template'}
          </Button>
        </CardHeader>
        <ScrollArea className="flex-1">
          <CardContent className="space-y-5 pb-8">
            {selectedModel && (
              <div className="space-y-2 rounded-md border border-border/40 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  Model configuration
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <dt className="text-muted-foreground">Model id</dt>
                  <dd className="font-mono">{selectedModel.id}</dd>
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd>{selectedModel.provider}</dd>
                  <dt className="text-muted-foreground">Intelligence level</dt>
                  <dd>{selectedModel.intelligence_level}</dd>
                  <dt className="text-muted-foreground">Context window</dt>
                  <dd>{selectedModel.context_window ? `${String(selectedModel.context_window)} tokens` : '—'}</dd>
                  <dt className="text-muted-foreground">Can route</dt>
                  <dd>{selectedModel.can_route ? 'yes' : 'no'}</dd>
                  <dt className="text-muted-foreground">Can serve KG queries</dt>
                  <dd>{selectedModel.can_kg ? 'yes' : 'no'}</dd>
                </dl>
                <ModelBadges model={selectedModel} />
              </div>
            )}

            {templates.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Load an existing template</label>
                <Select
                  value={selectedName ?? ''}
                  onValueChange={(name) => {
                    void loadTemplate(name)
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick a saved template…" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.name} value={t.name}>
                        {t.title || t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {isNew && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Template name (id)</label>
                <Input
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value)
                  }}
                  placeholder="e.g. release-notes-writer"
                  className="font-mono text-xs"
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Display title</label>
                <Input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Goal (one sentence)</label>
                <Input
                  value={goal}
                  onChange={(e) => {
                    setGoal(e.target.value)
                  }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                System prompt / core directive
              </label>
              <Textarea
                value={coreDirective}
                onChange={(e) => {
                  setCoreDirective(e.target.value)
                }}
                rows={6}
                className="font-mono text-xs"
                placeholder="You are ..."
              />
            </div>

            <div className="space-y-4 rounded-md border border-border/40 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Wrench className="h-4 w-4 text-muted-foreground" />
                Parameters
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Temperature</span>
                  <span className="tabular-nums">{parameters.temperature.toFixed(2)}</span>
                </div>
                <Slider
                  value={parameters.temperature}
                  onValueChange={(v) => {
                    setParameters((p) => ({ ...p, temperature: v }))
                  }}
                  min={0}
                  max={2}
                  step={0.05}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Top P</span>
                  <span className="tabular-nums">{parameters.top_p.toFixed(2)}</span>
                </div>
                <Slider
                  value={parameters.top_p}
                  onValueChange={(v) => {
                    setParameters((p) => ({ ...p, top_p: v }))
                  }}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Max tokens</label>
                  <Input
                    type="number"
                    value={parameters.max_tokens}
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      setParameters((p) => ({ ...p, max_tokens: Number.isFinite(next) ? next : p.max_tokens }))
                    }}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Reasoning effort</label>
                  <Select
                    value={parameters.reasoning_effort}
                    onValueChange={(v) => {
                      setParameters((p) => ({ ...p, reasoning_effort: v }))
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REASONING_EFFORTS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardContent>
        </ScrollArea>
      </Card>
    </div>
  )
}
