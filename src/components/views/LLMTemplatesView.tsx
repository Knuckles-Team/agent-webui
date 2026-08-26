/**
 * @file LLMTemplatesView.tsx
 * @description LLM Models / configuration section (D-AOBS-4, W-8 fix): the
 * PRIMARY, sidebar-bound list is the live `AgentConfig.chat_models`/
 * `embedding_models` registries (`GET /api/enhanced/llm/models` and
 * `/api/enhanced/llm/embedding-models` — the same registries `create_model`/
 * the embedding factory resolve against), not the system-prompt store.
 * Picking a model surfaces its actual AgentConfig settings in an EDITABLE
 * "Model configuration" form (BUG-260), then optionally lets you pair the
 * model with generation parameters and a system prompt into a saved
 * template.
 *
 * BUG-260 — the model-settings form is schema-derived, not hand-maintained:
 * `GET /api/enhanced/llm/model-schema` returns `ChatModelConfig`'s and
 * `EmbeddingModelConfig`'s own `model_json_schema()` output, so the set of
 * editable fields (and their types/required-ness) is whatever those Pydantic
 * models actually declare — it cannot drift from what AgentConfig permits,
 * for BOTH chat and embedding models. Saving validates against that exact
 * schema server-side (`PUT /api/enhanced/llm/models` /
 * `.../llm/embedding-models`) before anything is written.
 *
 * Before this fix the sidebar listed prompt documents from
 * `/api/enhanced/prompts` — i.e. system prompts — which is what the
 * "Models" section is NOT supposed to show (that already has its own
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
import { Cpu, Eye, Layers, Plus, RefreshCw, Save, Search, Sparkles, Trash2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { fetchValidated, ApiError, looseArray } from '@/lib/api-validation'
import { SessionExpiredNotice } from '@/components/SessionExpiredNotice'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'

type ModelKind = 'chat' | 'embedding'

interface LLMModel {
  id: string
  provider: string
  intelligence_level?: string
  vision?: boolean
  reasoning?: boolean
  tools_enabled?: boolean
  context_window?: number | null
  can_route?: boolean
  can_kg?: boolean
  chunk_size?: number
  gpu_group?: string | null
}
/** Loose: the two browse-list routes (`/llm/models`, `/llm/embedding-models`)
 *  return different subsets of fields for chat vs. embedding models — this
 *  view only needs `id`/`provider` plus whichever badges a given kind has. */
const modelSchema: z.ZodType<LLMModel> = z.looseObject({
  id: z.string(),
  provider: z.string(),
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

// ── BUG-260: schema-derived model-settings form ────────────────────────────
// `ChatModelConfig`/`EmbeddingModelConfig` field types, as JSON Schema
// (`model_json_schema()`) renders them: a plain `type`, or an `anyOf` of
// `[<type>, {type: "null"}]` for an Optional field.
interface JsonSchemaProperty {
  type?: string
  enum?: unknown[]
  const?: unknown
  anyOf?: { type?: string; enum?: unknown[]; const?: unknown }[]
  default?: unknown
  title?: string
  description?: string
}
interface ModelJsonSchema {
  properties: Record<string, JsonSchemaProperty>
  required?: string[]
}
const jsonSchemaPropertySchema: z.ZodType<JsonSchemaProperty> = z.looseObject({
  type: z.string().optional(),
  enum: z.array(z.unknown()).optional(),
  const: z.unknown().optional(),
  anyOf: z
    .array(
      z.looseObject({
        type: z.string().optional(),
        enum: z.array(z.unknown()).optional(),
        const: z.unknown().optional(),
      }),
    )
    .optional(),
  default: z.unknown().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
})
const modelJsonSchemaSchema: z.ZodType<ModelJsonSchema> = z.looseObject({
  properties: z.record(z.string(), jsonSchemaPropertySchema),
  required: z.array(z.string()).optional(),
})
const modelSchemasResponseSchema = z.object({
  chat: modelJsonSchemaSchema,
  embedding: modelJsonSchemaSchema,
})
type ModelSchemas = z.infer<typeof modelSchemasResponseSchema>

type FieldKind = 'boolean' | 'integer' | 'number' | 'enum' | 'string' | 'json'

/** A `Literal[...]` field's permitted values (`enum`, or a single-value
 *  `const` for a one-member `Literal`) — resolved through an `Optional`
 *  field's `anyOf` branch too. A constrained value set always wins into a
 *  real dropdown over its base type, so a future enum-typed ChatModelConfig/
 *  EmbeddingModelConfig field (there are none today) renders correctly with
 *  no change to this form. */
function fieldEnumValues(prop: JsonSchemaProperty): unknown[] | undefined {
  if (prop.enum) return prop.enum
  if (prop.const !== undefined) return [prop.const]
  const branch = prop.anyOf?.find((entry) => entry.enum ?? entry.const !== undefined)
  if (branch?.enum) return branch.enum
  if (branch?.const !== undefined) return [branch.const]
  return undefined
}

/** A JSON-value-safe `String()` -- an enum entry is typed `unknown` (straight
 *  off the wire), and a plain object's default `toString()` silently renders
 *  `[object Object]`. Primitives stringify normally; anything else falls
 *  back to its JSON form. */
function stringifyValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function fieldKind(prop: JsonSchemaProperty): FieldKind {
  if (fieldEnumValues(prop)) return 'enum'
  const declared = prop.type ?? prop.anyOf?.find((entry) => entry.type && entry.type !== 'null')?.type
  if (declared === 'boolean' || declared === 'integer' || declared === 'number' || declared === 'string') {
    return declared
  }
  return 'json'
}

function fieldLabel(name: string, prop: JsonSchemaProperty): string {
  return prop.title ?? name
}

/** One schema-derived input for a single AgentConfig model field. Which
 *  fields exist, their order, types, and required-ness all come from
 *  `schema` (BUG-260) — nothing here hand-lists a field name. */
function ModelSettingsForm({
  schema,
  values,
  onChange,
}: {
  schema: ModelJsonSchema
  values: Record<string, unknown>
  onChange: (field: string, value: unknown) => void
}) {
  const required = new Set(schema.required ?? [])
  const entries = Object.entries(schema.properties).filter(([name]) => name !== 'id')

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {entries.map(([name, prop]) => {
        const kind = fieldKind(prop)
        const label = fieldLabel(name, prop)
        const value = values[name]
        const isRequired = required.has(name)

        if (kind === 'boolean') {
          return (
            <div key={name} className="flex items-center justify-between rounded-md border border-border/40 p-2.5">
              <label htmlFor={`model-field-${name}`} className="text-xs font-medium">
                {label}
              </label>
              <Switch
                id={`model-field-${name}`}
                checked={Boolean(value)}
                onCheckedChange={(checked) => {
                  onChange(name, checked)
                }}
              />
            </div>
          )
        }

        if (kind === 'integer' || kind === 'number') {
          return (
            <div key={name} className="space-y-1.5">
              <label htmlFor={`model-field-${name}`} className="text-xs font-semibold text-muted-foreground">
                {label}
                {isRequired && ' *'}
              </label>
              <Input
                id={`model-field-${name}`}
                type="number"
                value={typeof value === 'number' ? value : ''}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === '') {
                    onChange(name, null)
                    return
                  }
                  const next = kind === 'integer' ? Number.parseInt(raw, 10) : Number.parseFloat(raw)
                  if (Number.isFinite(next)) onChange(name, next)
                }}
                className="font-mono text-xs"
              />
            </div>
          )
        }

        if (kind === 'enum') {
          const options = fieldEnumValues(prop) ?? []
          return (
            <div key={name} className="space-y-1.5">
              <label htmlFor={`model-field-${name}`} className="text-xs font-semibold text-muted-foreground">
                {label}
                {isRequired && ' *'}
              </label>
              <select
                id={`model-field-${name}`}
                value={value == null ? '' : stringifyValue(value)}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === '') {
                    onChange(name, null)
                    return
                  }
                  const match = options.find((opt) => stringifyValue(opt) === raw)
                  onChange(name, match ?? raw)
                }}
                className="w-full h-9 px-3 rounded-md border border-input bg-muted/20 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {!isRequired && <option value="">— unset —</option>}
                {options.map((opt) => (
                  <option key={stringifyValue(opt)} value={stringifyValue(opt)}>
                    {stringifyValue(opt)}
                  </option>
                ))}
              </select>
            </div>
          )
        }

        if (kind === 'json') {
          return (
            <div key={name} className="space-y-1.5 md:col-span-2">
              <label htmlFor={`model-field-${name}`} className="text-xs font-semibold text-muted-foreground">
                {label} (JSON)
              </label>
              <Textarea
                id={`model-field-${name}`}
                value={value == null ? '' : JSON.stringify(value, null, 2)}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw.trim() === '') {
                    onChange(name, null)
                    return
                  }
                  try {
                    onChange(name, JSON.parse(raw))
                  } catch {
                    // Leave the last-valid value in place until the JSON parses;
                    // the field keeps the operator's raw text on screen via
                    // `defaultValue`-less controlled input re-render is skipped
                    // by React only re-rendering from `values`, so nothing here
                    // needs to track invalid intermediate text separately.
                  }
                }}
                rows={3}
                className="font-mono text-xs"
                placeholder="null"
              />
            </div>
          )
        }

        return (
          <div key={name} className="space-y-1.5">
            <label htmlFor={`model-field-${name}`} className="text-xs font-semibold text-muted-foreground">
              {label}
              {isRequired && ' *'}
            </label>
            <Input
              id={`model-field-${name}`}
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => {
                onChange(name, e.target.value)
              }}
              className="font-mono text-xs"
            />
          </div>
        )
      })}
    </div>
  )
}

function ModelBadges({ model }: { model: LLMModel }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant="outline" className="text-[9px]">
        {model.provider}
      </Badge>
      {model.intelligence_level && (
        <Badge variant="outline" className="text-[9px]">
          {model.intelligence_level}
        </Badge>
      )}
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
      {model.chunk_size && (
        <Badge variant="outline" className="text-[9px]">
          chunk {model.chunk_size}
        </Badge>
      )}
    </div>
  )
}

export default function LLMTemplatesView() {
  const [kind, setKind] = useState<ModelKind>('chat')
  const [chatModels, setChatModels] = useState<LLMModel[]>([])
  const [embeddingModels, setEmbeddingModels] = useState<LLMModel[]>([])
  const [schemas, setSchemas] = useState<ModelSchemas | null>(null)
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingModel, setSavingModel] = useState(false)
  const [deletingModel, setDeletingModel] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sessionExpired, setSessionExpired] = useState(false)

  // BUG-260: the model's OWN AgentConfig settings, editable, schema-derived.
  const [isNewModelEntry, setIsNewModelEntry] = useState(false)
  const [newModelId, setNewModelId] = useState('')
  const [newModelProvider, setNewModelProvider] = useState('')
  const [modelSettings, setModelSettings] = useState<Record<string, unknown> | null>(null)

  const models = kind === 'chat' ? chatModels : embeddingModels

  const loadAll = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [chat, embedding, t, s] = await Promise.all([
        fetchValidated('/api/enhanced/llm/models', looseArray(modelSchema)),
        fetchValidated('/api/enhanced/llm/embedding-models', looseArray(modelSchema)),
        fetchValidated('/api/enhanced/prompts', looseArray(templateSummarySchema)),
        fetchValidated('/api/enhanced/llm/model-schema', modelSchemasResponseSchema),
      ])
      setSessionExpired(false)
      setChatModels(chat)
      setEmbeddingModels(embedding)
      setTemplates(t)
      setSchemas(s)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSessionExpired(true)
      } else {
        // Distinct from "zero models configured": the list below must never
        // render an unreachable backend identically to a genuine empty
        // registry (the honest-state requirement this view was flagged for).
        setLoadError('Could not reach the LLM model registry.')
        toast.error('Error connecting to the LLM model registry')
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
   * — starts a fresh, unsaved template scoped to that model, and loads the
   * model's full editable settings (BUG-260) into the settings form. */
  const selectModel = useCallback(
    (m: LLMModel) => {
      setSelectedName(null)
      setIsNew(true)
      setNewName('')
      setTitle('')
      setGoal('')
      setCoreDirective('')
      setModelId(m.id)
      setParameters(DEFAULT_PARAMETERS)
      setIsNewModelEntry(false)

      void (async () => {
        try {
          const detail = await fetchValidated(
            `/api/enhanced/llm/model-detail?kind=${kind}&model_id=${encodeURIComponent(m.id)}`,
            z.record(z.string(), z.unknown()),
          )
          setModelSettings(detail)
        } catch {
          toast.error('Failed to load model settings')
          setModelSettings(null)
        }
      })()
    },
    [kind],
  )

  /** Start defining a brand-new model entry (BUG-260's "creating a model")
   *  rather than editing an existing one — every field defaults per the
   *  schema (`default` on each property, or empty/false for one with none). */
  const startNewModel = useCallback(() => {
    setSelectedName(null)
    setIsNew(false)
    setIsNewModelEntry(true)
    setNewModelId('')
    setNewModelProvider('')
    const schema = schemas?.[kind]
    const defaults: Record<string, unknown> = {}
    if (schema) {
      for (const [name, prop] of Object.entries(schema.properties)) {
        if (name === 'id') continue
        defaults[name] = prop.default ?? null
      }
    }
    setModelSettings(defaults)
  }, [kind, schemas])

  const handleSaveModelSettings = async () => {
    const schema = schemas?.[kind]
    if (!schema || !modelSettings) return
    const targetId = isNewModelEntry ? newModelId.trim() : modelId
    if (!targetId) {
      toast.error('Give the model an id first')
      return
    }
    const provider = isNewModelEntry ? newModelProvider.trim() : ((modelSettings.provider as string | undefined) ?? '')
    if (!provider) {
      toast.error('A provider is required')
      return
    }
    setSavingModel(true)
    try {
      const payload = { ...modelSettings, id: targetId, provider }
      const existing = kind === 'chat' ? chatModels : embeddingModels
      const others = existing.filter((m) => m.id !== targetId)
      const detailUrl = `/api/enhanced/llm/${kind === 'chat' ? 'models' : 'embedding-models'}`
      // Upsert: fetch every OTHER model's full settings so the write is a
      // faithful full-registry replace, not a partial that would drop them
      // back to their schema defaults.
      const otherDetails = await Promise.all(
        others.map((m) =>
          fetchValidated(
            `/api/enhanced/llm/model-detail?kind=${kind}&model_id=${encodeURIComponent(m.id)}`,
            z.record(z.string(), z.unknown()),
          ),
        ),
      )
      const res = await fetch(detailUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models: [...otherDetails, payload] }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        toast.error(body?.detail ?? 'Failed to save model settings')
        return
      }
      toast.success(`Model "${targetId}" saved`)
      setIsNewModelEntry(false)
      setModelId(targetId)
      await loadAll()
      const refreshed = await fetchValidated(
        `/api/enhanced/llm/model-detail?kind=${kind}&model_id=${encodeURIComponent(targetId)}`,
        z.record(z.string(), z.unknown()),
      )
      setModelSettings(refreshed)
    } catch {
      toast.error('Error saving model settings')
    } finally {
      setSavingModel(false)
    }
  }

  /** Remove a model from AgentConfig's `chat_models`/`embedding_models`
   *  registry — the "remove an LLM endpoint" half of native add/modify/
   *  remove management. `PUT /llm/models`/`.../embedding-models` replace the
   *  WHOLE registry (see the docstring on those routes), so "delete" is
   *  "resubmit the list without this entry," the same full-registry-replace
   *  discipline `handleSaveModelSettings` already uses for create/edit. */
  const handleDeleteModel = async () => {
    if (isNewModelEntry || !selectedModel) return
    const targetId = selectedModel.id
    if (!window.confirm(`Remove ${targetId} from the ${kind} model registry?`)) return
    setDeletingModel(true)
    try {
      const existing = kind === 'chat' ? chatModels : embeddingModels
      const others = existing.filter((m) => m.id !== targetId)
      const detailUrl = `/api/enhanced/llm/${kind === 'chat' ? 'models' : 'embedding-models'}`
      const otherDetails = await Promise.all(
        others.map((m) =>
          fetchValidated(
            `/api/enhanced/llm/model-detail?kind=${kind}&model_id=${encodeURIComponent(m.id)}`,
            z.record(z.string(), z.unknown()),
          ),
        ),
      )
      const res = await fetch(detailUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models: otherDetails }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        toast.error(body?.detail ?? 'Failed to remove model')
        return
      }
      toast.success(`Model "${targetId}" removed`)
      setModelSettings(null)
      setModelId('')
      await loadAll()
    } catch {
      toast.error('Error removing model')
    } finally {
      setDeletingModel(false)
    }
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
      (m.intelligence_level ?? '').toLowerCase().includes(searchQuery.toLowerCase()),
  )
  const selectedModel = models.find((m) => m.id === modelId)
  const activeSchema = schemas?.[kind] ?? null

  if (sessionExpired) {
    return <SessionExpiredNotice />
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-12rem)]">
      {/* 1. Sidebar - LLM Models (AgentConfig.chat_models/embedding_models —
          W-8/BUG-260: this is the panel's primary binding, not the
          prompt/system-prompt store, and covers BOTH model kinds). */}
      <Card className="lg:col-span-1 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <Cpu className="size-5 text-emerald-400" />
              Models
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={startNewTemplate}
                title="New template"
              >
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
          <CardDescription>Model/LLM configuration from AgentConfig&apos;s chat/embedding registries.</CardDescription>
          <Tabs
            value={kind}
            onValueChange={(v) => {
              setKind(v as ModelKind)
            }}
            className="mt-1"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="chat">Chat models</TabsTrigger>
              <TabsTrigger value="embedding">Embedding models</TabsTrigger>
            </TabsList>
          </Tabs>
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
          <Button variant="outline" size="sm" className="mt-2 w-full" onClick={startNewModel}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New {kind === 'chat' ? 'chat' : 'embedding'} model
          </Button>
        </CardHeader>
        <ScrollArea className="flex-1">
          <CardContent className="space-y-1 pt-0">
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading models…</div>
            ) : loadError ? (
              <div className="py-8 px-2">
                <UnavailableNotice what="The LLM model registry" />
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No {kind} models are configured in AgentConfig yet.
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
                    modelId === m.id && !isNewModelEntry ? 'bg-muted/60' : ''
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
              {isNewModelEntry ? `New ${kind} model` : selectedModel ? selectedModel.id : 'Select a model'}
            </CardTitle>
            <CardDescription>
              Model configuration from AgentConfig (editable, BUG-260), plus an optional saved template (generation
              parameters + system prompt) that pairs with it.
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
            {(selectedModel ?? isNewModelEntry) && activeSchema && modelSettings && (
              <div className="space-y-3 rounded-md border border-border/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    Model configuration ({kind})
                  </div>
                  <div className="flex items-center gap-2">
                    {!isNewModelEntry && selectedModel && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-rose-400 hover:text-rose-400 hover:bg-rose-500/10 border-rose-500/30"
                        onClick={() => {
                          void handleDeleteModel()
                        }}
                        disabled={deletingModel || savingModel}
                      >
                        <Trash2 className="size-3.5 mr-1.5" />
                        {deletingModel ? 'Removing...' : 'Remove model'}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void handleSaveModelSettings()
                      }}
                      disabled={savingModel || deletingModel}
                    >
                      <Save className="size-3.5 mr-1.5" />
                      {savingModel ? 'Saving...' : 'Save model settings'}
                    </Button>
                  </div>
                </div>

                {isNewModelEntry ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">Model id *</label>
                      <Input
                        value={newModelId}
                        onChange={(e) => {
                          setNewModelId(e.target.value)
                        }}
                        placeholder="e.g. qwen/qwen3.6-27b"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">Provider *</label>
                      <Input
                        value={newModelProvider}
                        onChange={(e) => {
                          setNewModelProvider(e.target.value)
                        }}
                        placeholder="openai"
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-xs font-mono text-muted-foreground">{selectedModel?.id}</div>
                )}

                <ModelSettingsForm
                  schema={activeSchema}
                  values={modelSettings}
                  onChange={(field, value) => {
                    setModelSettings((prev) => ({ ...(prev ?? {}), [field]: value }))
                  }}
                />
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
