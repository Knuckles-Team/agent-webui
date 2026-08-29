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
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { z } from 'zod'
import { Cpu, Eye, Layers, Plus, RefreshCw, Save, Search, Sparkles, Trash2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { fetchValidated, ApiError, looseArray } from '@/lib/api-validation'
import { SessionExpiredNotice } from '@/components/SessionExpiredNotice'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'

type ModelKind = 'chat' | 'embedding'
type TemplateField = 'title' | 'goal' | 'core_directive' | 'model'

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
const TEMPLATE_PARAMETER_KEYS: (keyof TemplateParameters)[] = [
  'temperature',
  'top_p',
  'max_tokens',
  'reasoning_effort',
]

/** Loosely-shaped (`z.looseObject` keeps unknown keys) so it round-trips
 *  whatever else a prompt document already carries (identity/instructions/
 *  metadata/tools/...) without this view needing to understand every field
 *  PromptsView.tsx manages. */
const templateDetailSchema = z
  .looseObject({
    title: z.string().nullable().optional(),
    goal: z.string().nullable().optional(),
    core_directive: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    // Parameters are provider-owned hints. Keep their complete JSON value so a
    // document with a null/array/provider-specific shape can still round-trip
    // unchanged; the four common fields are normalized only for this editor.
    parameters: z.unknown().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Template document must not be empty')

type TemplateDetail = z.infer<typeof templateDetailSchema>

const modelDetailSchema = z.looseObject({
  id: z.string().min(1),
  provider: z.string().min(1),
})

// ── BUG-260: schema-derived model-settings form ────────────────────────────
// `ChatModelConfig`/`EmbeddingModelConfig` field types, as JSON Schema
// (`model_json_schema()`) renders them: a plain `type`, or an `anyOf` of
// `[<type>, {type: "null"}]` for an Optional field.
interface JsonSchemaProperty {
  type?: string
  enum?: unknown[]
  const?: unknown
  anyOf?: JsonSchemaBranch[]
  default?: unknown
  title?: string
  description?: string
  minimum?: number
  maximum?: number
  multipleOf?: number
  exclusiveMinimum?: number | boolean
  exclusiveMaximum?: number | boolean
}
interface JsonSchemaBranch {
  type?: string
  enum?: unknown[]
  const?: unknown
  anyOf?: JsonSchemaBranch[]
  minimum?: number
  maximum?: number
  multipleOf?: number
  exclusiveMinimum?: number | boolean
  exclusiveMaximum?: number | boolean
}
interface ModelJsonSchema {
  properties: Record<string, JsonSchemaProperty>
  required?: string[]
}
const jsonSchemaBranchSchema: z.ZodType<JsonSchemaBranch> = z.lazy(() =>
  z.looseObject({
    type: z.string().optional(),
    enum: z.array(z.unknown()).optional(),
    const: z.unknown().optional(),
    anyOf: z.array(jsonSchemaBranchSchema).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    multipleOf: z.number().optional(),
    exclusiveMinimum: z.union([z.number(), z.boolean()]).optional(),
    exclusiveMaximum: z.union([z.number(), z.boolean()]).optional(),
  }),
)
const jsonSchemaPropertySchema: z.ZodType<JsonSchemaProperty> = z.looseObject({
  type: z.string().optional(),
  enum: z.array(z.unknown()).optional(),
  const: z.unknown().optional(),
  anyOf: z.array(jsonSchemaBranchSchema).optional(),
  default: z.unknown().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  multipleOf: z.number().optional(),
  exclusiveMinimum: z.union([z.number(), z.boolean()]).optional(),
  exclusiveMaximum: z.union([z.number(), z.boolean()]).optional(),
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
type JsonSchemaNode = JsonSchemaProperty | JsonSchemaBranch

function nestedEnumValues(branches: JsonSchemaBranch[] | undefined): unknown[] | undefined {
  return (branches ?? []).map(fieldEnumValues).find((values) => values !== undefined)
}

function fieldEnumValues(prop: JsonSchemaNode): unknown[] | undefined {
  return prop.enum ?? (prop.const !== undefined ? [prop.const] : nestedEnumValues(prop.anyOf))
}

const NUMERIC_CONSTRAINT_KEYS: (keyof JsonSchemaBranch)[] = [
  'minimum',
  'maximum',
  'multipleOf',
  'exclusiveMinimum',
  'exclusiveMaximum',
]

function hasNumericConstraint(node: JsonSchemaNode): boolean {
  return NUMERIC_CONSTRAINT_KEYS.some((key) => node[key] !== undefined)
}

function typedNumericNode(node: JsonSchemaNode): JsonSchemaBranch[] {
  return node.type === 'integer' || node.type === 'number' ? [node] : []
}

function numericConstraintNodes(node: JsonSchemaNode): JsonSchemaBranch[] {
  // Prefer an actual constrained node over a merely-typed parent. JSON
  // Schema can wrap a constrained numeric branch in more than one `anyOf`;
  // returning the parent first would hide the nested bounds.
  const own = hasNumericConstraint(node) ? [node] : []
  const nested = (node.anyOf ?? []).flatMap((branch) => numericConstraintNodes(branch))
  return own.length === 0 ? [...nested, ...typedNumericNode(node)] : [...own, ...nested]
}

function schemaNodeType(node: JsonSchemaNode): string | undefined {
  if (node.type && node.type !== 'null') return node.type
  for (const branch of node.anyOf ?? []) {
    const type = schemaNodeType(branch)
    if (type) return type
  }
  return undefined
}

function numericConstraints(prop: JsonSchemaNode): JsonSchemaBranch {
  const [branch = {}] = numericConstraintNodes(prop)
  return {
    minimum: prop.minimum ?? branch.minimum,
    maximum: prop.maximum ?? branch.maximum,
    multipleOf: prop.multipleOf ?? branch.multipleOf,
    exclusiveMinimum: prop.exclusiveMinimum ?? branch.exclusiveMinimum,
    exclusiveMaximum: prop.exclusiveMaximum ?? branch.exclusiveMaximum,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function finiteNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function isAborted(controller: AbortController | null): boolean {
  return controller?.signal.aborted ?? false
}

function normalizeTemplateParameters(value: unknown): TemplateParameters {
  const parameters = isRecord(value) ? value : {}
  return {
    temperature: finiteNumberOrDefault(parameters.temperature, DEFAULT_PARAMETERS.temperature),
    top_p: finiteNumberOrDefault(parameters.top_p, DEFAULT_PARAMETERS.top_p),
    max_tokens: finiteNumberOrDefault(parameters.max_tokens, DEFAULT_PARAMETERS.max_tokens),
    reasoning_effort: stringOrDefault(parameters.reasoning_effort, DEFAULT_PARAMETERS.reasoning_effort),
  }
}

function mergeTemplateParameters(
  original: unknown,
  edited: TemplateParameters,
  editedFields: ReadonlySet<keyof TemplateParameters>,
  includeDefaults: boolean,
): unknown {
  if (shouldPreserveOriginalParameters(original, editedFields, includeDefaults)) return original
  const originalParameters = isRecord(original) ? original : {}
  const merged = { ...originalParameters }
  const keys = includeDefaults
    ? TEMPLATE_PARAMETER_KEYS
    : TEMPLATE_PARAMETER_KEYS.filter((key) => editedFields.has(key))
  for (const key of keys) merged[key] = edited[key]
  return merged
}

function shouldPreserveOriginalParameters(
  original: unknown,
  editedFields: ReadonlySet<keyof TemplateParameters>,
  includeDefaults: boolean,
): boolean {
  return !includeDefaults && editedFields.size === 0 && original !== undefined
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

const FIELD_KINDS_BY_SCHEMA_TYPE: Record<string, Exclude<FieldKind, 'enum' | 'json'>> = {
  boolean: 'boolean',
  integer: 'integer',
  number: 'number',
  string: 'string',
}

function fieldKind(prop: JsonSchemaProperty): FieldKind {
  const declared = schemaNodeType(prop)
  return fieldEnumValues(prop) !== undefined ? 'enum' : (FIELD_KINDS_BY_SCHEMA_TYPE[declared ?? ''] ?? 'json')
}

function titledFieldLabel(prop: JsonSchemaProperty): string | undefined {
  const title = prop.title?.trim() ?? ''
  return title === '' ? undefined : title
}

function defaultFieldLabel(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function fieldLabel(name: string, prop: JsonSchemaProperty): string {
  return titledFieldLabel(prop) ?? defaultFieldLabel(name)
}

function fieldDescription(prop: JsonSchemaProperty, isRequired: boolean): string {
  const description = prop.description?.trim()
  if (description) return description
  return isRequired ? 'Required.' : ''
}

function modelFieldId(name: string): string {
  return `model-field-${name}`
}

function modelFieldHelpId(name: string): string {
  return `${modelFieldId(name)}-help`
}

function requiredMarker(isRequired: boolean): string {
  return isRequired ? ' *' : ''
}

function modelFieldDescribedBy(name: string, description: string, error?: string): string | undefined {
  const ids = [
    description === '' ? null : modelFieldHelpId(name),
    error ? `${modelFieldId(name)}-error` : null,
  ].filter(Boolean)
  return ids.length === 0 ? undefined : ids.join(' ')
}

function modelFieldError(fieldId: string, error: string | undefined): ReactNode {
  if (!error) return null
  return (
    <p id={`${fieldId}-error`} role="alert" className="text-[11px] leading-normal text-red-400">
      {error}
    </p>
  )
}

function parseNumberFieldValue(raw: string, kind: FieldKind): number | null | undefined {
  if (raw === '') return null
  const next = Number(raw)
  return Number.isFinite(next) && (kind !== 'integer' || Number.isInteger(next)) ? next : undefined
}

function handleNumberFieldChange(
  name: string,
  raw: string,
  kind: FieldKind,
  onChange: (field: string, value: unknown) => void,
): void {
  const next = parseNumberFieldValue(raw, kind)
  if (next !== undefined) onChange(name, next)
}

function parseEnumFieldValue(raw: string, options: unknown[]): unknown {
  if (raw === '') return null
  return options.find((option) => stringifyValue(option) === raw) ?? raw
}

function optionalEnumOption(isRequired: boolean): ReactNode {
  return isRequired ? null : <option value="">— unset —</option>
}

function jsonFieldDisplayValue(draft: string | undefined, value: unknown): string {
  if (draft !== undefined) return draft
  return value == null ? '' : JSON.stringify(value, null, 2)
}

function numberFieldDisplayValue(value: unknown): number | '' {
  return typeof value === 'number' && Number.isFinite(value) ? value : ''
}

function numberFieldStep(kind: FieldKind, constraints: JsonSchemaBranch): number | 'any' {
  return constraints.multipleOf ?? (kind === 'integer' ? 1 : 'any')
}

function enumFieldDisplayValue(value: unknown): string {
  return value == null ? '' : stringifyValue(value)
}

function stringFieldDisplayValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function modelFieldDescription(name: string, prop: JsonSchemaProperty, isRequired: boolean): ReactNode {
  const description = fieldDescription(prop, isRequired)
  if (!description) return null
  return (
    <p id={modelFieldHelpId(name)} className="text-[11px] leading-normal text-muted-foreground">
      {description}
    </p>
  )
}

type ModelFieldRenderer = (
  name: string,
  prop: JsonSchemaProperty,
  kind: FieldKind,
  value: unknown,
  isRequired: boolean,
  onChange: (field: string, value: unknown) => void,
  draft: string | undefined,
  error: string | undefined,
  onDraftChange: (field: string, raw: string) => void,
) => ReactNode

function booleanModelField(
  name: string,
  prop: JsonSchemaProperty,
  _kind: FieldKind,
  value: unknown,
  _isRequired: boolean,
  onChange: (field: string, value: unknown) => void,
): ReactNode {
  const description = fieldDescription(prop, _isRequired)
  return (
    <div key={name} className="flex items-center justify-between rounded-md border border-border/40 p-2.5">
      <div className="space-y-0.5">
        <label htmlFor={modelFieldId(name)} className="text-xs font-medium">
          {fieldLabel(name, prop)}
          {requiredMarker(_isRequired)}
        </label>
        {modelFieldDescription(name, prop, _isRequired)}
      </div>
      <Switch
        id={modelFieldId(name)}
        aria-required={_isRequired}
        aria-describedby={modelFieldDescribedBy(name, description)}
        checked={Boolean(value)}
        onCheckedChange={(checked) => {
          onChange(name, checked)
        }}
      />
    </div>
  )
}

function numberModelField(
  name: string,
  prop: JsonSchemaProperty,
  kind: FieldKind,
  value: unknown,
  isRequired: boolean,
  onChange: (field: string, value: unknown) => void,
): ReactNode {
  const fieldId = modelFieldId(name)
  const description = fieldDescription(prop, isRequired)
  const constraints = numericConstraints(prop)
  return (
    <div key={name} className="space-y-1.5">
      <label htmlFor={fieldId} className="text-xs font-semibold text-muted-foreground">
        {fieldLabel(name, prop)}
        {requiredMarker(isRequired)}
      </label>
      <Input
        id={fieldId}
        type="number"
        required={isRequired}
        min={constraints.minimum}
        max={constraints.maximum}
        step={numberFieldStep(kind, constraints)}
        aria-describedby={modelFieldDescribedBy(name, description)}
        value={numberFieldDisplayValue(value)}
        onChange={(e) => {
          handleNumberFieldChange(name, e.target.value, kind, onChange)
        }}
        className="font-mono text-xs"
      />
      {modelFieldDescription(name, prop, isRequired)}
    </div>
  )
}

function enumModelField(
  name: string,
  prop: JsonSchemaProperty,
  _kind: FieldKind,
  value: unknown,
  isRequired: boolean,
  onChange: (field: string, value: unknown) => void,
): ReactNode {
  const options = fieldEnumValues(prop) ?? []
  const fieldId = modelFieldId(name)
  const description = fieldDescription(prop, isRequired)
  return (
    <div key={name} className="space-y-1.5">
      <label htmlFor={fieldId} className="text-xs font-semibold text-muted-foreground">
        {fieldLabel(name, prop)}
        {requiredMarker(isRequired)}
      </label>
      <select
        id={fieldId}
        required={isRequired}
        aria-describedby={modelFieldDescribedBy(name, description)}
        value={enumFieldDisplayValue(value)}
        onChange={(e) => {
          onChange(name, parseEnumFieldValue(e.target.value, options))
        }}
        className="w-full h-9 px-3 rounded-md border border-input bg-muted/20 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        {optionalEnumOption(isRequired)}
        {options.map((opt) => (
          <option key={stringifyValue(opt)} value={stringifyValue(opt)}>
            {stringifyValue(opt)}
          </option>
        ))}
      </select>
      {modelFieldDescription(name, prop, isRequired)}
    </div>
  )
}

function jsonModelField(
  name: string,
  prop: JsonSchemaProperty,
  _kind: FieldKind,
  value: unknown,
  _isRequired: boolean,
  _onChange: (field: string, value: unknown) => void,
  draft: string | undefined,
  error: string | undefined,
  onDraftChange: (field: string, raw: string) => void,
): ReactNode {
  const fieldId = modelFieldId(name)
  const description = fieldDescription(prop, _isRequired)
  return (
    <div key={name} className="space-y-1.5 md:col-span-2">
      <label htmlFor={fieldId} className="text-xs font-semibold text-muted-foreground">
        {fieldLabel(name, prop)} (JSON)
      </label>
      <Textarea
        id={fieldId}
        required={_isRequired}
        aria-describedby={modelFieldDescribedBy(name, description, error)}
        aria-invalid={Boolean(error)}
        value={jsonFieldDisplayValue(draft, value)}
        onChange={(e) => {
          onDraftChange(name, e.target.value)
        }}
        rows={3}
        className="font-mono text-xs"
        placeholder="null"
      />
      {modelFieldDescription(name, prop, _isRequired)}
      {modelFieldError(fieldId, error)}
    </div>
  )
}

function stringModelField(
  name: string,
  prop: JsonSchemaProperty,
  _kind: FieldKind,
  value: unknown,
  isRequired: boolean,
  onChange: (field: string, value: unknown) => void,
): ReactNode {
  const fieldId = modelFieldId(name)
  const description = fieldDescription(prop, isRequired)
  return (
    <div key={name} className="space-y-1.5">
      <label htmlFor={fieldId} className="text-xs font-semibold text-muted-foreground">
        {fieldLabel(name, prop)}
        {requiredMarker(isRequired)}
      </label>
      <Input
        id={fieldId}
        required={isRequired}
        aria-describedby={modelFieldDescribedBy(name, description)}
        value={stringFieldDisplayValue(value)}
        onChange={(e) => {
          onChange(name, e.target.value)
        }}
        className="font-mono text-xs"
      />
      {modelFieldDescription(name, prop, isRequired)}
    </div>
  )
}

const MODEL_FIELD_RENDERERS: Record<FieldKind, ModelFieldRenderer> = {
  boolean: booleanModelField,
  integer: numberModelField,
  number: numberModelField,
  enum: enumModelField,
  string: stringModelField,
  json: jsonModelField,
}

/** One schema-derived input for a single AgentConfig model field, dispatched
 *  by `FieldKind` — a component-map instead of a long discriminated-union
 *  chain (both score far better and it reads better). */
function modelFieldControl(
  name: string,
  prop: JsonSchemaProperty,
  value: unknown,
  isRequired: boolean,
  onChange: (field: string, value: unknown) => void,
  draft: string | undefined,
  error: string | undefined,
  onDraftChange: (field: string, raw: string) => void,
): ReactNode {
  const kind = fieldKind(prop)
  return MODEL_FIELD_RENDERERS[kind](name, prop, kind, value, isRequired, onChange, draft, error, onDraftChange)
}

function shouldRenderModelField(name: string, excludeProvider: boolean): boolean {
  return name !== 'id' && (!excludeProvider || name !== 'provider')
}

/** Which fields exist, their order, types, and required-ness all come from
 *  `schema` (BUG-260) — nothing here hand-lists a field name. */
function ModelSettingsForm({
  schema,
  values,
  onChange,
  jsonDrafts,
  jsonErrors,
  onJsonDraftChange,
  excludeProvider = false,
}: {
  schema: ModelJsonSchema
  values: Record<string, unknown>
  onChange: (field: string, value: unknown) => void
  jsonDrafts: Record<string, string>
  jsonErrors: Record<string, string>
  onJsonDraftChange: (field: string, raw: string) => void
  excludeProvider?: boolean
}) {
  const required = new Set(schema.required ?? [])
  const entries = Object.entries(schema.properties).filter(([name]) => shouldRenderModelField(name, excludeProvider))

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {entries.map(([name, prop]) =>
        modelFieldControl(
          name,
          prop,
          values[name],
          required.has(name),
          onChange,
          jsonDrafts[name],
          jsonErrors[name],
          onJsonDraftChange,
        ),
      )}
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

/** Resolves and validates the id/provider a model save should target,
 *  toasting and returning `null` on the first missing piece. */
function resolveModelSaveTarget({
  isNewModelEntry,
  newModelId,
  modelId,
  newModelProvider,
  modelSettings,
}: {
  isNewModelEntry: boolean
  newModelId: string
  modelId: string
  newModelProvider: string
  modelSettings: Record<string, unknown>
}): { targetId: string; provider: string } | null {
  const targetId = isNewModelEntry ? newModelId.trim() : modelId
  if (!targetId) {
    toast.error('Give the model an id first')
    return null
  }
  const rawProvider = isNewModelEntry ? newModelProvider : modelSettings.provider
  const provider = typeof rawProvider === 'string' ? rawProvider.trim() : ''
  if (!provider) {
    toast.error('A provider is required')
    return null
  }
  return { targetId, provider }
}

type ModelValueValidator = (name: string, prop: JsonSchemaProperty, value: unknown) => string | null

function exclusiveMinimumError(label: string, value: number, constraints: JsonSchemaBranch): string | null {
  const bound = constraints.exclusiveMinimum
  return typeof bound === 'number' && value <= bound ? `${label} must be greater than ${bound}` : null
}

function exclusiveMaximumError(label: string, value: number, constraints: JsonSchemaBranch): string | null {
  const bound = constraints.exclusiveMaximum
  return typeof bound === 'number' && value >= bound ? `${label} must be less than ${bound}` : null
}

function minimumError(label: string, value: number, constraints: JsonSchemaBranch): string | null {
  const minimum = constraints.minimum
  return minimum !== undefined && value < minimum ? `${label} must be at least ${minimum}` : null
}

function maximumError(label: string, value: number, constraints: JsonSchemaBranch): string | null {
  const maximum = constraints.maximum
  return maximum !== undefined && value > maximum ? `${label} must be at most ${maximum}` : null
}

function exclusiveMinimumBooleanError(label: string, value: number, constraints: JsonSchemaBranch): string | null {
  const minimum = constraints.minimum
  return constraints.exclusiveMinimum === true && minimum !== undefined && value <= minimum
    ? `${label} must be greater than ${minimum}`
    : null
}

function exclusiveMaximumBooleanError(label: string, value: number, constraints: JsonSchemaBranch): string | null {
  const maximum = constraints.maximum
  return constraints.exclusiveMaximum === true && maximum !== undefined && value >= maximum
    ? `${label} must be less than ${maximum}`
    : null
}

function multipleOfError(label: string, value: number, constraints: JsonSchemaBranch): string | null {
  const multipleOf = constraints.multipleOf
  if (multipleOf === undefined || multipleOf <= 0) return null
  const quotient = value / multipleOf
  return Math.abs(quotient - Math.round(quotient)) > 1e-9 ? `${label} must use increments of ${multipleOf}` : null
}

function numericConstraintError(name: string, prop: JsonSchemaProperty, value: number): string | null {
  const constraints = numericConstraints(prop)
  const label = fieldLabel(name, prop)
  return (
    exclusiveMinimumError(label, value, constraints) ??
    exclusiveMaximumError(label, value, constraints) ??
    minimumError(label, value, constraints) ??
    maximumError(label, value, constraints) ??
    exclusiveMinimumBooleanError(label, value, constraints) ??
    exclusiveMaximumBooleanError(label, value, constraints) ??
    multipleOfError(label, value, constraints)
  )
}

function invalidFieldError(name: string, prop: JsonSchemaProperty, message: string): string {
  return `${fieldLabel(name, prop)} ${message}`
}

function validateBooleanValue(name: string, prop: JsonSchemaProperty, value: unknown): string | null {
  return typeof value === 'boolean' ? null : invalidFieldError(name, prop, 'must be true or false')
}

function validateNumberValue(name: string, prop: JsonSchemaProperty, value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalidFieldError(name, prop, 'must be a valid number')
  }
  return numericConstraintError(name, prop, value)
}

function validateIntegerValue(name: string, prop: JsonSchemaProperty, value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalidFieldError(name, prop, 'must be a valid number')
  }
  if (!Number.isInteger(value)) return invalidFieldError(name, prop, 'must be a whole number')
  return numericConstraintError(name, prop, value)
}

function validateEnumValue(name: string, prop: JsonSchemaProperty, value: unknown): string | null {
  const options = fieldEnumValues(prop) ?? []
  return options.some((option) => stringifyValue(option) === stringifyValue(value))
    ? null
    : invalidFieldError(name, prop, 'has an unsupported value')
}

function validateStringValue(name: string, prop: JsonSchemaProperty, value: unknown): string | null {
  return typeof value === 'string' ? null : invalidFieldError(name, prop, 'must be text')
}

const MODEL_VALUE_VALIDATORS: Record<FieldKind, ModelValueValidator> = {
  boolean: validateBooleanValue,
  integer: validateIntegerValue,
  number: validateNumberValue,
  enum: validateEnumValue,
  string: validateStringValue,
  json: () => null,
}

function validateModelField(
  name: string,
  prop: JsonSchemaProperty,
  value: unknown,
  isRequired: boolean,
): string | null {
  const missing = value == null || (typeof value === 'string' && !value.trim())
  if (missing) return isRequired ? invalidFieldError(name, prop, 'is required') : null
  return MODEL_VALUE_VALIDATORS[fieldKind(prop)](name, prop, value)
}

function isEditableModelField(name: string): boolean {
  return name !== 'id' && name !== 'provider'
}

function providerValidationError(required: ReadonlySet<string>, provider: string): string | null {
  return required.has('provider') && !provider ? 'A provider is required' : null
}

/** Validate schema-derived values before sending the full registry replace.
 * The API still performs the authoritative Pydantic validation, but catching
 * missing/incorrect values here keeps the form understandable when a field
 * has a required marker or a numeric bound in its JSON Schema. */
function validateModelSettings(
  schema: ModelJsonSchema,
  values: Record<string, unknown>,
  provider: string,
): string | null {
  const required = new Set(schema.required ?? [])
  const providerError = providerValidationError(required, provider)
  if (providerError) return providerError
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (!isEditableModelField(name)) continue
    const error = validateModelField(name, prop, values[name], required.has(name))
    if (error) return error
  }
  return null
}

interface ModelSavePreflightInput {
  schema: ModelJsonSchema | undefined
  modelSettings: Record<string, unknown> | null
  modelJsonInvalid: boolean
  isNewModelEntry: boolean
  newModelId: string
  modelId: string
  newModelProvider: string
}

interface PreparedModelSave {
  modelSettings: Record<string, unknown>
  targetId: string
  provider: string
}

function prepareModelSave({
  schema,
  modelSettings,
  modelJsonInvalid,
  isNewModelEntry,
  newModelId,
  modelId,
  newModelProvider,
}: ModelSavePreflightInput): PreparedModelSave | null {
  if (!schema || !modelSettings) return null
  if (modelJsonInvalid) {
    toast.error('Fix the invalid JSON field before saving model settings')
    return null
  }
  const target = resolveModelSaveTarget({ isNewModelEntry, newModelId, modelId, newModelProvider, modelSettings })
  if (!target) return null
  const settingsError = validateModelSettings(schema, modelSettings, target.provider)
  if (settingsError) toast.error(settingsError)
  return settingsError ? null : { modelSettings, ...target }
}

function modelRegistryUrl(kind: ModelKind): string {
  return `/api/enhanced/llm/${kind === 'chat' ? 'models' : 'embedding-models'}`
}

function activeSchemaForKind(schemas: ModelSchemas | null, kind: ModelKind): ModelJsonSchema | null {
  return schemas?.[kind] ?? null
}

function modelDetailRequestInit(signal: AbortSignal | undefined): RequestInit | undefined {
  return signal ? { signal } : undefined
}

function throwIfSignalAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('The model save was cancelled', 'AbortError')
}

function fetchOtherModelDetails(
  kind: ModelKind,
  otherModels: LLMModel[],
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    otherModels.map((model) =>
      fetchValidated(
        `/api/enhanced/llm/model-detail?kind=${kind}&model_id=${encodeURIComponent(model.id)}`,
        modelDetailSchema,
        modelDetailRequestInit(signal),
      ),
    ),
  )
}

/** Full-registry-replace upsert: fetches every OTHER model's full settings
 *  so the write doesn't drop them back to their schema defaults, then PUTs
 *  the whole registry back with `payload` included. */
async function upsertModelRegistry(
  kind: ModelKind,
  payload: Record<string, unknown>,
  otherModels: LLMModel[],
  signal?: AbortSignal,
): Promise<Response> {
  const otherDetails = await fetchOtherModelDetails(kind, otherModels, signal)
  throwIfSignalAborted(signal)
  return fetch(modelRegistryUrl(kind), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ models: [...otherDetails, payload] }),
    signal,
  })
}

function activeAbortController(controller: AbortController | null): AbortController | null {
  return controller === null || isAborted(controller) ? null : controller
}

function currentModelMutation({
  mutationSequence,
  mutationId,
  detailSequence,
  selectionRequestId,
  editorRevision,
  editorRevisionAtStart,
  mutationController,
  selectionController,
}: {
  mutationSequence: number
  mutationId: number
  detailSequence: number
  selectionRequestId: number
  editorRevision: number
  editorRevisionAtStart: number
  mutationController: AbortController
  selectionController: AbortController | null
}): boolean {
  return (
    mutationSequence === mutationId &&
    detailSequence === selectionRequestId &&
    editorRevision === editorRevisionAtStart &&
    !isAborted(mutationController) &&
    !isAborted(selectionController)
  )
}

async function responseDetailMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { detail?: string } | null
  return body?.detail ?? fallback
}

interface ModelSaveWorkflowInput {
  kind: ModelKind
  payload: Record<string, unknown>
  otherModels: LLMModel[]
  targetId: string
  mutationSignal: AbortSignal
  isCurrentMutation: () => boolean
  loadAll: () => Promise<void>
  setIsNewModelEntry: (value: boolean) => void
  setModelId: (value: string) => void
  setModelSettings: (value: Record<string, unknown>) => void
  setModelJsonDrafts: (value: Record<string, string>) => void
  setModelJsonErrors: (value: Record<string, string>) => void
}

async function runModelSaveWorkflow({
  kind,
  payload,
  otherModels,
  targetId,
  mutationSignal,
  isCurrentMutation,
  loadAll,
  setIsNewModelEntry,
  setModelId,
  setModelSettings,
  setModelJsonDrafts,
  setModelJsonErrors,
}: ModelSaveWorkflowInput): Promise<void> {
  const response = await upsertModelRegistry(kind, payload, otherModels, mutationSignal)
  if (!isCurrentMutation()) return
  if (!response.ok) {
    toast.error(await responseDetailMessage(response, 'Failed to save model settings'))
    return
  }
  toast.success(`Model "${targetId}" saved`)
  setIsNewModelEntry(false)
  setModelId(targetId)
  await loadAll()
  if (!isCurrentMutation()) return
  const refreshed = await fetchValidated(
    `/api/enhanced/llm/model-detail?kind=${kind}&model_id=${encodeURIComponent(targetId)}`,
    modelDetailSchema,
    { signal: mutationSignal },
  )
  if (!isCurrentMutation()) return
  setModelSettings(refreshed)
  setModelJsonDrafts({})
  setModelJsonErrors({})
}

interface MutableNumberRef {
  current: number
}

interface MutableAbortControllerRef {
  current: AbortController | null
}

interface ModelSaveExecutionInput {
  kind: ModelKind
  payload: Record<string, unknown>
  otherModels: LLMModel[]
  targetId: string
  selectionRequestId: number
  editorRevisionAtStart: number
  selectionController: AbortController | null
  modelDetailSequence: MutableNumberRef
  modelMutationSequence: MutableNumberRef
  modelMutationAbort: MutableAbortControllerRef
  modelEditorRevision: MutableNumberRef
  setSavingModel: (value: boolean) => void
  loadAll: () => Promise<void>
  setIsNewModelEntry: (value: boolean) => void
  setModelId: (value: string) => void
  setModelSettings: (value: Record<string, unknown>) => void
  setModelJsonDrafts: (value: Record<string, string>) => void
  setModelJsonErrors: (value: Record<string, string>) => void
}

async function executeModelSave(input: ModelSaveExecutionInput): Promise<void> {
  const {
    kind,
    payload,
    otherModels,
    targetId,
    selectionRequestId,
    editorRevisionAtStart,
    selectionController,
    modelDetailSequence,
    modelMutationSequence,
    modelMutationAbort,
    modelEditorRevision,
    setSavingModel,
    loadAll,
    setIsNewModelEntry,
    setModelId,
    setModelSettings,
    setModelJsonDrafts,
    setModelJsonErrors,
  } = input
  modelMutationAbort.current?.abort()
  const mutationId = modelMutationSequence.current + 1
  modelMutationSequence.current = mutationId
  const mutationController = new AbortController()
  modelMutationAbort.current = mutationController
  const isCurrentMutation = () =>
    currentModelMutation({
      mutationSequence: modelMutationSequence.current,
      mutationId,
      detailSequence: modelDetailSequence.current,
      selectionRequestId,
      editorRevision: modelEditorRevision.current,
      editorRevisionAtStart,
      mutationController,
      selectionController,
    })
  setSavingModel(true)
  try {
    await runModelSaveWorkflow({
      kind,
      payload,
      otherModels,
      targetId,
      mutationSignal: mutationController.signal,
      isCurrentMutation,
      loadAll,
      setIsNewModelEntry,
      setModelId,
      setModelSettings,
      setModelJsonDrafts,
      setModelJsonErrors,
    })
  } catch (error) {
    if (isAbortError(error) || !isCurrentMutation()) return
    toast.error('Error saving model settings')
  } finally {
    if (modelMutationSequence.current === mutationId) {
      setSavingModel(false)
      if (modelMutationAbort.current === mutationController) modelMutationAbort.current = null
    }
  }
}

function currentModelSelection(
  sequence: number,
  requestId: number,
  selectionController: AbortController | null,
): boolean {
  return sequence === requestId && !isAborted(selectionController)
}

function currentModelDetail(sequence: number, requestId: number, controller: AbortController): boolean {
  return sequence === requestId && !controller.signal.aborted
}

async function loadSelectedModelSettings({
  kind,
  modelId,
  requestId,
  controller,
  currentSequence,
  setModelSettings,
}: {
  kind: ModelKind
  modelId: string
  requestId: number
  controller: AbortController
  currentSequence: MutableNumberRef
  setModelSettings: (value: Record<string, unknown> | null) => void
}): Promise<void> {
  try {
    const detail = await fetchValidated(
      `/api/enhanced/llm/model-detail?kind=${kind}&model_id=${encodeURIComponent(modelId)}`,
      modelDetailSchema,
      { signal: controller.signal },
    )
    if (!currentModelDetail(currentSequence.current, requestId, controller)) return
    setModelSettings(detail)
  } catch (error) {
    if (isAbortError(error) || !currentModelDetail(currentSequence.current, requestId, controller)) return
    toast.error('Failed to load model settings')
    setModelSettings(null)
  }
}

interface ModelDeleteWorkflowInput {
  kind: ModelKind
  otherModels: LLMModel[]
  targetId: string
  selectionController: AbortController | null
  isCurrentSelection: () => boolean
  loadAll: () => Promise<void>
  setModelSettings: (value: Record<string, unknown> | null) => void
  setModelJsonDrafts: (value: Record<string, string>) => void
  setModelJsonErrors: (value: Record<string, string>) => void
  setModelId: (value: string) => void
}

async function runModelDeleteWorkflow({
  kind,
  otherModels,
  targetId,
  selectionController,
  isCurrentSelection,
  loadAll,
  setModelSettings,
  setModelJsonDrafts,
  setModelJsonErrors,
  setModelId,
}: ModelDeleteWorkflowInput): Promise<void> {
  const signal = selectionController?.signal
  const otherDetails = await fetchOtherModelDetails(kind, otherModels, signal)
  if (!isCurrentSelection()) return
  const response = await fetch(modelRegistryUrl(kind), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ models: otherDetails }),
    signal,
  })
  if (!isCurrentSelection()) return
  if (!response.ok) {
    toast.error(await responseDetailMessage(response, 'Failed to remove model'))
    return
  }
  toast.success(`Model "${targetId}" removed`)
  setModelSettings(null)
  setModelJsonDrafts({})
  setModelJsonErrors({})
  setModelId('')
  await loadAll()
}

function resolveModelDeleteTarget(
  isNewModelEntry: boolean,
  selectedModel: LLMModel | undefined,
  kind: ModelKind,
): string | null {
  if (isNewModelEntry || !selectedModel) return null
  const targetId = selectedModel.id
  return window.confirm(`Remove ${targetId} from the ${kind} model registry?`) ? targetId : null
}

interface ModelDeleteExecutionInput {
  kind: ModelKind
  models: LLMModel[]
  targetId: string
  selectionRequestId: number
  modelDetailSequence: MutableNumberRef
  modelDetailAbort: MutableAbortControllerRef
  setDeletingModel: (value: boolean) => void
  loadAll: () => Promise<void>
  setModelSettings: (value: Record<string, unknown> | null) => void
  setModelJsonDrafts: (value: Record<string, string>) => void
  setModelJsonErrors: (value: Record<string, string>) => void
  setModelId: (value: string) => void
}

async function executeModelDelete(input: ModelDeleteExecutionInput): Promise<void> {
  const {
    kind,
    models,
    targetId,
    selectionRequestId,
    modelDetailSequence,
    modelDetailAbort,
    setDeletingModel,
    loadAll,
    setModelSettings,
    setModelJsonDrafts,
    setModelJsonErrors,
    setModelId,
  } = input
  const selectionController = activeAbortController(modelDetailAbort.current)
  const otherModels = models.filter((model) => model.id !== targetId)
  const isCurrentSelection = () =>
    currentModelSelection(modelDetailSequence.current, selectionRequestId, selectionController)
  setDeletingModel(true)
  try {
    await runModelDeleteWorkflow({
      kind,
      otherModels,
      targetId,
      selectionController,
      isCurrentSelection,
      loadAll,
      setModelSettings,
      setModelJsonDrafts,
      setModelJsonErrors,
      setModelId,
    })
  } catch (error) {
    if (isAbortError(error) || modelDetailSequence.current !== selectionRequestId) return
    toast.error('Error removing model')
  } finally {
    if (modelDetailSequence.current === selectionRequestId) setDeletingModel(false)
  }
}

interface ModelListPanelProps {
  loading: boolean
  loadError: string | null
  filteredModels: LLMModel[]
  kind: ModelKind
  modelId: string
  isNewModelEntry: boolean
  onSelectModel: (m: LLMModel) => void
}

type ModelListState = 'loading' | 'unavailable' | 'empty' | 'models'

function modelListState({ loading, loadError, filteredModels }: ModelListPanelProps): ModelListState {
  return loading ? 'loading' : loadError ? 'unavailable' : filteredModels.length === 0 ? 'empty' : 'models'
}

function modelIsSelected(model: LLMModel, modelId: string, isNewModelEntry: boolean): boolean {
  return !isNewModelEntry && modelId === model.id
}

function firstModelId(models: LLMModel[]): string {
  return models.at(0)?.id ?? ''
}

function modelListButtonClass(selected: boolean): string {
  return `w-full text-left rounded-md p-2 text-sm hover:bg-muted/40 ${selected ? 'bg-muted/60' : ''}`
}

function modelListButton({
  model,
  kind,
  modelId,
  isNewModelEntry,
  onSelectModel,
}: Omit<ModelListPanelProps, 'loading' | 'loadError' | 'filteredModels'> & { model: LLMModel }): ReactNode {
  const selected = modelIsSelected(model, modelId, isNewModelEntry)
  return (
    <button
      key={model.id}
      type="button"
      aria-pressed={selected}
      aria-label={`Edit ${kind} model ${model.id} from ${model.provider}`}
      onClick={() => {
        onSelectModel(model)
      }}
      className={modelListButtonClass(selected)}
    >
      <div className="font-medium truncate">{model.id}</div>
      <div className="text-xs text-muted-foreground truncate">{model.provider}</div>
      <div className="mt-1">
        <ModelBadges model={model} />
      </div>
    </button>
  )
}

function renderLoadingModelList(): ReactNode {
  return <div className="py-8 text-center text-sm text-muted-foreground">Loading models…</div>
}

function renderUnavailableModelList(): ReactNode {
  return (
    <div className="py-8 px-2">
      <UnavailableNotice what="The LLM model registry" />
    </div>
  )
}

function renderEmptyModelList({ kind }: ModelListPanelProps): ReactNode {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">
      No {kind} models are configured in AgentConfig yet.
    </div>
  )
}

function renderConfiguredModelList({
  filteredModels,
  kind,
  modelId,
  isNewModelEntry,
  onSelectModel,
}: ModelListPanelProps): ReactNode {
  return filteredModels.map((model) => modelListButton({ model, kind, modelId, isNewModelEntry, onSelectModel }))
}

const MODEL_LIST_RENDERERS: Record<ModelListState, (props: ModelListPanelProps) => ReactNode> = {
  loading: renderLoadingModelList,
  unavailable: renderUnavailableModelList,
  empty: renderEmptyModelList,
  models: renderConfiguredModelList,
}

/** The sidebar's model list body: loading/unavailable/empty, or the list. */
function modelListPanel(props: ModelListPanelProps): ReactNode {
  return MODEL_LIST_RENDERERS[modelListState(props)](props)
}

function modelMatchesSearch(model: LLMModel, query: string): boolean {
  const normalizedQuery = query.toLowerCase()
  return (
    model.id.toLowerCase().includes(normalizedQuery) ||
    model.provider.toLowerCase().includes(normalizedQuery) ||
    (model.intelligence_level ?? '').toLowerCase().includes(normalizedQuery)
  )
}

function filterModels(models: LLMModel[], query: string): LLMModel[] {
  return models.filter((model) => modelMatchesSearch(model, query))
}

/** The composer card's title: the in-progress new-model label, the selected
 *  model's id, or the not-yet-selected placeholder. */
function composerTitle(isNewModelEntry: boolean, kind: ModelKind, selectedModel: LLMModel | undefined): string {
  if (isNewModelEntry) return `New ${kind} model`
  if (selectedModel) return selectedModel.id
  return 'Select a model'
}

interface ModelConfigActionProps {
  isNewModelEntry: boolean
  selectedModel: LLMModel | undefined
  deletingModel: boolean
  savingModel: boolean
  modelJsonInvalid: boolean
  onDeleteModel: () => void
  onSaveModelSettings: () => void
}

function modelRemoveButton({
  isNewModelEntry,
  selectedModel,
  deletingModel,
  savingModel,
  onDeleteModel,
}: Pick<
  ModelConfigActionProps,
  'isNewModelEntry' | 'selectedModel' | 'deletingModel' | 'savingModel' | 'onDeleteModel'
>): ReactNode {
  if (isNewModelEntry || selectedModel === undefined) return null
  return (
    <Button
      size="sm"
      variant="outline"
      type="button"
      className="text-rose-400 hover:text-rose-400 hover:bg-rose-500/10 border-rose-500/30"
      onClick={onDeleteModel}
      disabled={deletingModel || savingModel}
    >
      <Trash2 className="size-3.5 mr-1.5" />
      {modelRemoveButtonLabel(deletingModel)}
    </Button>
  )
}

function modelRemoveButtonLabel(deletingModel: boolean): string {
  return deletingModel ? 'Removing...' : 'Remove model'
}

function modelSaveButtonLabel(savingModel: boolean): string {
  return savingModel ? 'Saving...' : 'Save model settings'
}

function modelSaveButtonDisabled({
  savingModel,
  deletingModel,
  modelJsonInvalid,
}: Pick<ModelConfigActionProps, 'savingModel' | 'deletingModel' | 'modelJsonInvalid'>): boolean {
  return savingModel || deletingModel || modelJsonInvalid
}

/** The Remove/Save action buttons in the model-configuration panel header. */
function modelConfigActions(props: ModelConfigActionProps): ReactNode {
  return (
    <div className="flex items-center gap-2">
      {modelRemoveButton(props)}
      <Button
        size="sm"
        variant="outline"
        type="button"
        onClick={props.onSaveModelSettings}
        disabled={modelSaveButtonDisabled(props)}
      >
        <Save className="size-3.5 mr-1.5" />
        {modelSaveButtonLabel(props.savingModel)}
      </Button>
    </div>
  )
}

/** The model-id/provider inputs (a brand-new model entry) or the read-only
 *  id line (an existing selection). */
function modelIdentityFields({
  isNewModelEntry,
  selectedModel,
  newModelId,
  newModelProvider,
  setNewModelId,
  setNewModelProvider,
}: {
  isNewModelEntry: boolean
  selectedModel: LLMModel | undefined
  newModelId: string
  newModelProvider: string
  setNewModelId: (value: string) => void
  setNewModelProvider: (value: string) => void
}): ReactNode {
  if (!isNewModelEntry) {
    return <div className="text-xs font-mono text-muted-foreground">{selectedModel?.id}</div>
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <label htmlFor="new-model-id" className="text-xs font-semibold text-muted-foreground">
          Model id *
        </label>
        <Input
          id="new-model-id"
          required
          aria-describedby="new-model-id-help"
          value={newModelId}
          onChange={(e) => {
            setNewModelId(e.target.value)
          }}
          placeholder="e.g. qwen/qwen3.8-27b"
          className="font-mono text-xs"
        />
        <p id="new-model-id-help" className="text-[11px] leading-normal text-muted-foreground">
          Required. Use the provider&apos;s model identifier, such as qwen/qwen3.6-27b.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="new-model-provider" className="text-xs font-semibold text-muted-foreground">
          Provider *
        </label>
        <Input
          id="new-model-provider"
          required
          aria-describedby="new-model-provider-help"
          value={newModelProvider}
          onChange={(e) => {
            setNewModelProvider(e.target.value)
          }}
          placeholder="openai"
          className="font-mono text-xs"
        />
        <p id="new-model-provider-help" className="text-[11px] leading-normal text-muted-foreground">
          Required. Enter the integration name that serves this model, such as openai or ollama.
        </p>
      </div>
    </div>
  )
}

/** The "Model configuration" panel (BUG-260): shown once a model is
 *  selected or being newly created, with a schema and settings to edit.
 *  Renders nothing otherwise. */
function modelConfigurationPanel(props: {
  kind: ModelKind
  isNewModelEntry: boolean
  selectedModel: LLMModel | undefined
  activeSchema: ModelJsonSchema | null
  modelSettings: Record<string, unknown> | null
  deletingModel: boolean
  savingModel: boolean
  newModelId: string
  newModelProvider: string
  jsonDrafts: Record<string, string>
  jsonErrors: Record<string, string>
  setNewModelId: (value: string) => void
  setNewModelProvider: (value: string) => void
  onModelSettingsChange: (field: string, value: unknown) => void
  onJsonDraftChange: (field: string, raw: string) => void
  modelJsonInvalid: boolean
  onDeleteModel: () => void
  onSaveModelSettings: () => void
}): ReactNode {
  const {
    kind,
    isNewModelEntry,
    selectedModel,
    activeSchema,
    modelSettings,
    deletingModel,
    savingModel,
    newModelId,
    newModelProvider,
    jsonDrafts,
    jsonErrors,
    setNewModelId,
    setNewModelProvider,
    onModelSettingsChange,
    onJsonDraftChange,
    modelJsonInvalid,
    onDeleteModel,
    onSaveModelSettings,
  } = props
  if (!activeSchema || !modelSettings || !(selectedModel ?? isNewModelEntry)) return null
  return (
    <div className="space-y-3 rounded-md border border-border/40 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="h-4 w-4 text-muted-foreground" />
          Model configuration ({kind})
        </div>
        {modelConfigActions({
          isNewModelEntry,
          selectedModel,
          deletingModel,
          savingModel,
          modelJsonInvalid,
          onDeleteModel,
          onSaveModelSettings,
        })}
      </div>

      {modelIdentityFields({
        isNewModelEntry,
        selectedModel,
        newModelId,
        newModelProvider,
        setNewModelId,
        setNewModelProvider,
      })}

      <ModelSettingsForm
        schema={activeSchema}
        values={modelSettings}
        jsonDrafts={jsonDrafts}
        jsonErrors={jsonErrors}
        excludeProvider={isNewModelEntry}
        onJsonDraftChange={onJsonDraftChange}
        onChange={onModelSettingsChange}
      />
    </div>
  )
}

/** "Load an existing template" picker, or nothing when there are none. */
function existingTemplatePicker({
  templates,
  selectedName,
  onLoadTemplate,
}: {
  templates: TemplateSummary[]
  selectedName: string | null
  onLoadTemplate: (name: string) => void
}): ReactNode {
  if (templates.length === 0) return null
  return (
    <div className="space-y-1.5">
      <label
        htmlFor="existing-template"
        id="existing-template-label"
        className="text-xs font-semibold text-muted-foreground"
      >
        Load an existing template
      </label>
      <Select
        value={selectedName ?? ''}
        onValueChange={(name) => {
          onLoadTemplate(name)
        }}
      >
        <SelectTrigger
          id="existing-template"
          aria-labelledby="existing-template-label"
          aria-describedby="existing-template-help"
          className="w-full"
        >
          <SelectValue placeholder="Pick a saved template…" />
        </SelectTrigger>
        <SelectContent>
          {templates.map((t) => (
            <SelectItem key={t.name} value={t.name}>
              {t.title === '' ? t.name : t.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id="existing-template-help" className="text-[11px] leading-normal text-muted-foreground">
        Optional. Loading a template fills the fields below so you can reuse or adjust it.
      </p>
    </div>
  )
}

/** The new-template name field, or nothing once a template is selected. */
function newTemplateNameField({
  isNew,
  newName,
  setNewName,
}: {
  isNew: boolean
  newName: string
  setNewName: (value: string) => void
}): ReactNode {
  if (!isNew) return null
  return (
    <div className="space-y-1.5">
      <label htmlFor="template-name" className="text-xs font-semibold text-muted-foreground">
        Template name (id) *
      </label>
      <Input
        id="template-name"
        required
        maxLength={128}
        pattern="[A-Za-z0-9_-]{1,128}"
        aria-describedby="template-name-help"
        value={newName}
        onChange={(e) => {
          setNewName(e.target.value)
        }}
        placeholder="e.g. release-notes-writer"
        className="font-mono text-xs"
      />
      <p id="template-name-help" className="text-[11px] leading-normal text-muted-foreground">
        Required. Use 1–128 letters, numbers, hyphens, or underscores; this becomes the saved file name.
      </p>
    </div>
  )
}

type TemplateParameterKind = 'number' | 'string'

interface TemplateParameterDescriptor {
  field: keyof TemplateParameters
  id: string
  label: string
  helpId: string
  help: string
  kind: TemplateParameterKind
  inputType: 'number' | 'text'
  step?: 'any'
  inputMode?: 'decimal'
  labelId?: string
  placeholder?: string
}

const TEMPLATE_PARAMETER_GROUPS: { id: string; className: string; fields: TemplateParameterDescriptor[] }[] = [
  {
    id: 'temperature',
    className: 'space-y-1.5',
    fields: [
      {
        field: 'temperature',
        id: 'template-temperature',
        label: 'Temperature',
        helpId: 'template-temperature-help',
        help: "Optional numeric hint passed to the selected provider; leave the default unless you know the provider's accepted values.",
        kind: 'number',
        inputType: 'number',
        step: 'any',
      },
    ],
  },
  {
    id: 'top-p',
    className: 'space-y-1.5',
    fields: [
      {
        field: 'top_p',
        id: 'template-top-p',
        label: 'Top P',
        helpId: 'template-top-p-help',
        help: 'Optional numeric hint passed to the selected provider; the endpoint does not define a universal range.',
        kind: 'number',
        inputType: 'number',
        step: 'any',
      },
    ],
  },
  {
    id: 'max-tokens-reasoning-effort',
    className: 'grid grid-cols-2 gap-4',
    fields: [
      {
        field: 'max_tokens',
        id: 'template-max-tokens',
        label: 'Max tokens',
        helpId: 'template-max-tokens-help',
        help: 'Optional numeric hint for the response budget; accepted values depend on the selected provider.',
        kind: 'number',
        inputType: 'number',
        step: 'any',
        inputMode: 'decimal',
      },
      {
        field: 'reasoning_effort',
        id: 'template-reasoning-effort',
        label: 'Reasoning effort',
        helpId: 'template-reasoning-effort-help',
        help: 'Optional provider-specific text hint, such as inherit or a documented effort level.',
        kind: 'string',
        inputType: 'text',
        labelId: 'template-reasoning-effort-label',
        placeholder: 'inherit',
      },
    ],
  },
]

function setNumericTemplateParameter(
  field: keyof TemplateParameters,
  raw: string,
  onParameterChange: (field: keyof TemplateParameters, value: number | string) => void,
): void {
  const next = Number(raw)
  if (raw === '') {
    onParameterChange(field, 0)
  } else if (Number.isFinite(next)) {
    onParameterChange(field, next)
  }
}

function setStringTemplateParameter(
  field: keyof TemplateParameters,
  raw: string,
  onParameterChange: (field: keyof TemplateParameters, value: number | string) => void,
): void {
  onParameterChange(field, raw)
}

type TemplateParameterChangeHandler = (
  field: keyof TemplateParameters,
  raw: string,
  onParameterChange: (field: keyof TemplateParameters, value: number | string) => void,
) => void

const TEMPLATE_PARAMETER_INPUT_HANDLERS: Record<TemplateParameterKind, TemplateParameterChangeHandler> = {
  number: setNumericTemplateParameter,
  string: setStringTemplateParameter,
}

function templateParameterField({
  descriptor,
  parameters,
  onParameterChange,
}: {
  descriptor: TemplateParameterDescriptor
  parameters: TemplateParameters
  onParameterChange: (field: keyof TemplateParameters, value: number | string) => void
}): ReactNode {
  return (
    <div key={descriptor.field} className="space-y-1.5">
      <label htmlFor={descriptor.id} id={descriptor.labelId} className="text-xs font-semibold text-muted-foreground">
        {descriptor.label}
      </label>
      <Input
        id={descriptor.id}
        type={descriptor.inputType}
        step={descriptor.step}
        inputMode={descriptor.inputMode}
        aria-labelledby={descriptor.labelId}
        aria-describedby={descriptor.helpId}
        value={parameters[descriptor.field]}
        onChange={(event) => {
          TEMPLATE_PARAMETER_INPUT_HANDLERS[descriptor.kind](descriptor.field, event.target.value, onParameterChange)
        }}
        className="font-mono text-xs"
        placeholder={descriptor.placeholder}
      />
      <p id={descriptor.helpId} className="text-[11px] text-muted-foreground">
        {descriptor.help}
      </p>
    </div>
  )
}

/** The generation-parameters panel (temperature/top_p/max_tokens/reasoning
 *  effort) at the bottom of the composer. */
function templateParametersPanel({
  parameters,
  onParameterChange,
}: {
  parameters: TemplateParameters
  onParameterChange: (field: keyof TemplateParameters, value: number | string) => void
}): ReactNode {
  return (
    <div className="space-y-4 rounded-md border border-border/40 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Wrench className="h-4 w-4 text-muted-foreground" />
        Parameters
      </div>
      <p className="text-[11px] leading-normal text-muted-foreground">
        These values are stored with the template as optional provider hints. The server keeps them as supplied and
        does not enforce a shared range here.
      </p>
      {TEMPLATE_PARAMETER_GROUPS.map(({ id, className, fields }) => (
        <div key={id} className={className}>
          {fields.map((descriptor) => templateParameterField({ descriptor, parameters, onParameterChange }))}
        </div>
      ))}
    </div>
  )
}

/** Save-template button is disabled while saving, or when there is no
 * target name yet (a new, unnamed template or an unselected existing one). */
function isSaveTemplateDisabled(
  saving: boolean,
  isNew: boolean,
  selectedName: string | null,
  newName: string,
): boolean {
  return saving || (isNew ? !newName.trim() : !selectedName)
}

const TEMPLATE_FIELDS: TemplateField[] = ['title', 'goal', 'core_directive', 'model']

function resolveTemplateSaveTarget(isNew: boolean, newName: string, selectedName: string | null): string | null {
  const targetName = isNew ? newName.trim() : selectedName
  if (!targetName) {
    toast.error('Give the template a name first')
    return null
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(targetName)) {
    toast.error('Template name may only contain letters, numbers, "-", and "_"')
    return null
  }
  return targetName
}

interface TemplatePayloadInput {
  templateDocument: Record<string, unknown> | null
  parameters: TemplateParameters
  editedParameterFields: ReadonlySet<keyof TemplateParameters>
  editedTemplateFields: ReadonlySet<TemplateField>
  targetName: string
  title: string
  goal: string
  coreDirective: string
  modelId: string
}

function shouldSaveTemplateParameters(
  isNewDocument: boolean,
  document: Record<string, unknown>,
  editedFields: ReadonlySet<keyof TemplateParameters>,
): boolean {
  return isNewDocument || Object.prototype.hasOwnProperty.call(document, 'parameters') || editedFields.size > 0
}

function templateFieldValues(input: TemplatePayloadInput, isNewDocument: boolean): Record<TemplateField, string> {
  return {
    title: isNewDocument && input.title === '' ? input.targetName : input.title,
    goal: input.goal,
    core_directive: input.coreDirective,
    model: input.modelId,
  }
}

function applyTemplateFieldValues(
  payload: Record<string, unknown>,
  input: TemplatePayloadInput,
  isNewDocument: boolean,
): void {
  const fields = isNewDocument ? TEMPLATE_FIELDS : [...input.editedTemplateFields]
  const values = templateFieldValues(input, isNewDocument)
  for (const field of fields) payload[field] = values[field]
}

function buildTemplatePayload(input: TemplatePayloadInput): Record<string, unknown> {
  const isNewDocument = input.templateDocument === null
  const existingDocument = input.templateDocument ?? {}
  const payload: Record<string, unknown> = { ...existingDocument }
  if (shouldSaveTemplateParameters(isNewDocument, existingDocument, input.editedParameterFields)) {
    payload.parameters = mergeTemplateParameters(
      existingDocument.parameters,
      input.parameters,
      input.editedParameterFields,
      isNewDocument,
    )
  }
  applyTemplateFieldValues(payload, input, isNewDocument)
  return payload
}

function isCurrentTemplateMutation({
  mutationSequence,
  mutationId,
  detailSequence,
  selectionAtStart,
  editorRevision,
  editorRevisionAtStart,
  controller,
}: {
  mutationSequence: number
  mutationId: number
  detailSequence: number
  selectionAtStart: number
  editorRevision: number
  editorRevisionAtStart: number
  controller: AbortController
}): boolean {
  return (
    mutationSequence === mutationId &&
    detailSequence === selectionAtStart &&
    editorRevision === editorRevisionAtStart &&
    !controller.signal.aborted
  )
}

function templateMutationWasSuperseded(
  error: unknown,
  mutationSequence: number,
  mutationId: number,
  detailSequence: number,
  selectionAtStart: number,
  editorRevision: number,
  editorRevisionAtStart: number,
): boolean {
  return (
    isAbortError(error) ||
    mutationSequence !== mutationId ||
    detailSequence !== selectionAtStart ||
    editorRevision !== editorRevisionAtStart
  )
}

interface TemplateSaveWorkflowInput {
  targetName: string
  payload: Record<string, unknown>
  controller: AbortController
  selectionAtStart: number
  editorRevisionAtStart: number
  templateMutationSequence: MutableNumberRef
  templateMutationId: number
  templateDetailSequence: MutableNumberRef
  templateEditorRevision: MutableNumberRef
  setIsNew: (value: boolean) => void
  setSelectedName: (value: string) => void
  setTemplateDocument: (value: Record<string, unknown>) => void
  setEditedTemplateFields: (value: Set<TemplateField>) => void
  setEditedParameterFields: (value: Set<keyof TemplateParameters>) => void
  loadAll: () => Promise<void>
}

function currentTemplateSave(input: TemplateSaveWorkflowInput): boolean {
  return isCurrentTemplateMutation({
    mutationSequence: input.templateMutationSequence.current,
    mutationId: input.templateMutationId,
    detailSequence: input.templateDetailSequence.current,
    selectionAtStart: input.selectionAtStart,
    editorRevision: input.templateEditorRevision.current,
    editorRevisionAtStart: input.editorRevisionAtStart,
    controller: input.controller,
  })
}

async function runTemplateSaveWorkflow(input: TemplateSaveWorkflowInput): Promise<void> {
  const {
    targetName,
    payload,
    controller,
    setIsNew,
    setSelectedName,
    setTemplateDocument,
    setEditedTemplateFields,
    setEditedParameterFields,
    loadAll,
  } = input
  const response = await fetch(`/api/enhanced/prompts/${targetName}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
  if (!currentTemplateSave(input)) return
  if (!response.ok) {
    toast.error('Failed to save template')
    return
  }
  toast.success(`Template "${targetName}" saved`)
  setIsNew(false)
  setSelectedName(targetName)
  setTemplateDocument(payload)
  setEditedTemplateFields(new Set())
  setEditedParameterFields(new Set())
  void loadAll()
}

interface TemplateSaveErrorInput {
  error: unknown
  mutationSequence: MutableNumberRef
  mutationId: number
  detailSequence: MutableNumberRef
  selectionAtStart: number
  editorRevision: MutableNumberRef
  editorRevisionAtStart: number
}

function reportTemplateSaveError(input: TemplateSaveErrorInput): void {
  const {
    error,
    mutationSequence,
    mutationId,
    detailSequence,
    selectionAtStart,
    editorRevision,
    editorRevisionAtStart,
  } = input
  if (
    templateMutationWasSuperseded(
      error,
      mutationSequence.current,
      mutationId,
      detailSequence.current,
      selectionAtStart,
      editorRevision.current,
      editorRevisionAtStart,
    )
  )
    return
  toast.error('Error sending save request')
}

function finishTemplateSave(
  mutationSequence: MutableNumberRef,
  mutationId: number,
  controller: AbortController,
  mutationAbort: MutableAbortControllerRef,
  setSaving: (value: boolean) => void,
): void {
  if (mutationSequence.current !== mutationId) return
  setSaving(false)
  if (mutationAbort.current === controller) mutationAbort.current = null
}

function modelJsonErrorUpdate(
  previous: Record<string, string>,
  field: string,
  required: boolean,
): Record<string, string> {
  if (required) {
    return { ...previous, [field]: 'This field is required; enter a JSON value before saving model settings.' }
  }
  const { [field]: _removed, ...rest } = previous
  return rest
}

function clearModelJsonError(previous: Record<string, string>, field: string): Record<string, string> {
  const { [field]: _removed, ...rest } = previous
  return rest
}

function updateModelSetting(
  previous: Record<string, unknown> | null,
  field: string,
  value: unknown,
): Record<string, unknown> {
  return { ...(previous ?? {}), [field]: value }
}

interface CatalogResponse {
  chat: LLMModel[]
  embedding: LLMModel[]
  templates: TemplateSummary[]
  schemas: ModelSchemas
}

interface CatalogStateSetters {
  setSessionExpired: (value: boolean) => void
  setChatModels: (value: LLMModel[]) => void
  setEmbeddingModels: (value: LLMModel[]) => void
  setTemplates: (value: TemplateSummary[]) => void
  setSchemas: (value: ModelSchemas | null) => void
  setLoadError: (value: string | null) => void
}

function isCurrentCatalogRequest(sequence: MutableNumberRef, requestId: number, controller: AbortController): boolean {
  return sequence.current === requestId && !controller.signal.aborted
}

function applyCatalogResponse(response: CatalogResponse, setters: CatalogStateSetters): void {
  setters.setSessionExpired(false)
  setters.setChatModels(response.chat)
  setters.setEmbeddingModels(response.embedding)
  setters.setTemplates(response.templates)
  setters.setSchemas(response.schemas)
}

function clearCatalogState(setters: CatalogStateSetters): void {
  setters.setChatModels([])
  setters.setEmbeddingModels([])
  setters.setTemplates([])
  setters.setSchemas(null)
  setters.setLoadError('Could not reach the LLM model registry.')
  toast.error('Error connecting to the LLM model registry')
}

function handleCatalogError(
  error: unknown,
  sequence: MutableNumberRef,
  requestId: number,
  setters: CatalogStateSetters,
): void {
  if (isAbortError(error) || sequence.current !== requestId) return
  if (error instanceof ApiError && error.status === 401) {
    setters.setSessionExpired(true)
    return
  }
  clearCatalogState(setters)
}

function finishCatalogLoad(
  sequence: MutableNumberRef,
  requestId: number,
  controller: AbortController,
  abortRef: MutableAbortControllerRef,
  setLoading: (value: boolean) => void,
): void {
  if (!isCurrentCatalogRequest(sequence, requestId, controller)) return
  setLoading(false)
  if (abortRef.current === controller) abortRef.current = null
}

interface TemplateLoadResetInput {
  templateMutationSequence: MutableNumberRef
  templateMutationAbort: MutableAbortControllerRef
  templateEditorRevision: MutableNumberRef
  setSaving: (value: boolean) => void
  templateDetailAbort: MutableAbortControllerRef
  modelDetailAbort: MutableAbortControllerRef
  modelDetailSequence: MutableNumberRef
  modelMutationSequence: MutableNumberRef
  modelMutationAbort: MutableAbortControllerRef
  modelEditorRevision: MutableNumberRef
  setModelSettings: (value: Record<string, unknown> | null) => void
  setSavingModel: (value: boolean) => void
  setDeletingModel: (value: boolean) => void
  setModelJsonDrafts: (value: Record<string, string>) => void
  setModelJsonErrors: (value: Record<string, string>) => void
}

function resetStateForTemplateLoad(input: TemplateLoadResetInput): void {
  input.templateMutationSequence.current += 1
  input.templateMutationAbort.current?.abort()
  input.templateMutationAbort.current = null
  input.templateEditorRevision.current += 1
  input.setSaving(false)
  input.templateDetailAbort.current?.abort()
  input.modelDetailAbort.current?.abort()
  input.modelDetailSequence.current += 1
  input.modelMutationSequence.current += 1
  input.modelMutationAbort.current?.abort()
  input.modelEditorRevision.current += 1
  input.setModelSettings(null)
  input.setSavingModel(false)
  input.setDeletingModel(false)
  input.setModelJsonDrafts({})
  input.setModelJsonErrors({})
}

interface NewTemplateResetInput extends TemplateLoadResetInput {
  templateDetailSequence: MutableNumberRef
  setLoadingTemplateDetail: (value: boolean) => void
  setTemplateDocument: (value: Record<string, unknown> | null) => void
  setSelectedName: (value: string | null) => void
  setIsNew: (value: boolean) => void
  setIsNewModelEntry: (value: boolean) => void
  setNewName: (value: string) => void
  setTitle: (value: string) => void
  setGoal: (value: string) => void
  setCoreDirective: (value: string) => void
  setModelId: (value: string) => void
  setParameters: (value: TemplateParameters) => void
  setEditedTemplateFields: (value: Set<TemplateField>) => void
  setEditedParameterFields: (value: Set<keyof TemplateParameters>) => void
}

function resetStateForNewTemplate(input: NewTemplateResetInput, firstModelId: string): void {
  input.templateMutationSequence.current += 1
  input.templateMutationAbort.current?.abort()
  input.templateMutationAbort.current = null
  input.templateEditorRevision.current += 1
  input.setSaving(false)
  input.templateDetailAbort.current?.abort()
  input.templateDetailSequence.current += 1
  input.modelDetailAbort.current?.abort()
  input.modelDetailSequence.current += 1
  input.modelMutationSequence.current += 1
  input.modelMutationAbort.current?.abort()
  input.modelEditorRevision.current += 1
  input.setLoadingTemplateDetail(false)
  input.setSavingModel(false)
  input.setDeletingModel(false)
  input.setTemplateDocument(null)
  input.setSelectedName(null)
  input.setIsNew(true)
  // A new template is a different workflow from creating an AgentConfig
  // model. Clear the model-entry mode so the composer cannot claim that a
  // blank template is an unsaved model after the operator clicks "New
  // template" from the model editor.
  input.setIsNewModelEntry(false)
  input.setNewName('')
  input.setTitle('')
  input.setGoal('')
  input.setCoreDirective('')
  input.setModelId(firstModelId)
  input.setParameters(DEFAULT_PARAMETERS)
  input.setEditedTemplateFields(new Set())
  input.setEditedParameterFields(new Set())
  input.setModelSettings(null)
  input.setModelJsonDrafts({})
  input.setModelJsonErrors({})
}

interface TemplateDetailSetters {
  setTemplateDocument: (value: Record<string, unknown>) => void
  setSelectedName: (value: string) => void
  setIsNew: (value: boolean) => void
  setTitle: (value: string) => void
  setGoal: (value: string) => void
  setCoreDirective: (value: string) => void
  setModelId: (value: string) => void
  setParameters: (value: TemplateParameters) => void
  setEditedTemplateFields: (value: Set<TemplateField>) => void
  setEditedParameterFields: (value: Set<keyof TemplateParameters>) => void
}

function applyTemplateDetail(detail: TemplateDetail, name: string, setters: TemplateDetailSetters): void {
  const document: Record<string, unknown> = detail
  setters.setTemplateDocument(document)
  setters.setSelectedName(name)
  setters.setIsNew(false)
  setters.setTitle(detail.title ?? name)
  setters.setGoal(detail.goal ?? '')
  setters.setCoreDirective(detail.core_directive ?? '')
  setters.setModelId(detail.model ?? '')
  setters.setParameters(normalizeTemplateParameters(detail.parameters))
  setters.setEditedTemplateFields(new Set())
  setters.setEditedParameterFields(new Set())
}

function isCurrentTemplateDetailRequest(
  sequence: MutableNumberRef,
  requestId: number,
  controller: AbortController,
): boolean {
  return sequence.current === requestId && !controller.signal.aborted
}

function finishTemplateDetailLoad(
  sequence: MutableNumberRef,
  requestId: number,
  controller: AbortController,
  setLoadingTemplateDetail: (value: boolean) => void,
): void {
  if (isCurrentTemplateDetailRequest(sequence, requestId, controller)) setLoadingTemplateDetail(false)
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
  const [editedTemplateFields, setEditedTemplateFields] = useState<Set<TemplateField>>(new Set())
  const [editedParameterFields, setEditedParameterFields] = useState<Set<keyof TemplateParameters>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadingTemplateDetail, setLoadingTemplateDetail] = useState(false)
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
  const [modelJsonDrafts, setModelJsonDrafts] = useState<Record<string, string>>({})
  const [modelJsonErrors, setModelJsonErrors] = useState<Record<string, string>>({})
  const [templateDocument, setTemplateDocument] = useState<Record<string, unknown> | null>(null)
  const modelDetailSequence = useRef(0)
  const modelDetailAbort = useRef<AbortController | null>(null)
  const modelMutationSequence = useRef(0)
  const modelMutationAbort = useRef<AbortController | null>(null)
  const catalogSequence = useRef(0)
  const catalogAbort = useRef<AbortController | null>(null)
  const modelEditorRevision = useRef(0)
  const templateDetailSequence = useRef(0)
  const templateDetailAbort = useRef<AbortController | null>(null)
  const templateEditorRevision = useRef(0)
  const templateMutationSequence = useRef(0)
  const templateMutationAbort = useRef<AbortController | null>(null)

  const models = kind === 'chat' ? chatModels : embeddingModels
  const modelJsonInvalid = Object.values(modelJsonErrors).some(Boolean)

  const handleModelJsonDraftChange = (field: string, raw: string) => {
    modelEditorRevision.current += 1
    setModelJsonDrafts((previous) => ({ ...previous, [field]: raw }))
    if (raw.trim() === '') {
      const required = schemas?.[kind].required?.includes(field) ?? false
      setModelJsonErrors((previous) => modelJsonErrorUpdate(previous, field, required))
      setModelSettings((previous) => updateModelSetting(previous, field, null))
      return
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      setModelJsonErrors((previous) => clearModelJsonError(previous, field))
      setModelSettings((previous) => updateModelSetting(previous, field, parsed))
    } catch {
      setModelJsonErrors((previous) => ({ ...previous, [field]: 'Enter valid JSON before saving model settings.' }))
    }
  }

  const handleNewModelIdChange = (value: string) => {
    modelEditorRevision.current += 1
    setNewModelId(value)
  }

  const handleNewModelProviderChange = (value: string) => {
    modelEditorRevision.current += 1
    setNewModelProvider(value)
  }

  function handleTemplateParameterChange(field: keyof TemplateParameters, value: number | string): void {
    templateEditorRevision.current += 1
    setParameters((previous) => ({ ...previous, [field]: value }))
    setEditedParameterFields((previous) => {
      const next = new Set(previous)
      next.add(field)
      return next
    })
  }

  function markTemplateFieldEdited(field: TemplateField): void {
    templateEditorRevision.current += 1
    setEditedTemplateFields((previous) => {
      const next = new Set(previous)
      next.add(field)
      return next
    })
  }

  const loadAll = useCallback(async function loadAll() {
    catalogAbort.current?.abort()
    const requestId = catalogSequence.current + 1
    catalogSequence.current = requestId
    const controller = new AbortController()
    catalogAbort.current = controller
    setLoading(true)
    setLoadError(null)
    try {
      const [chat, embedding, templates, schemas] = await Promise.all([
        fetchValidated('/api/enhanced/llm/models', looseArray(modelSchema), { signal: controller.signal }),
        fetchValidated('/api/enhanced/llm/embedding-models', looseArray(modelSchema), { signal: controller.signal }),
        fetchValidated('/api/enhanced/prompts', looseArray(templateSummarySchema), { signal: controller.signal }),
        fetchValidated('/api/enhanced/llm/model-schema', modelSchemasResponseSchema, { signal: controller.signal }),
      ])
      if (!isCurrentCatalogRequest(catalogSequence, requestId, controller)) return
      applyCatalogResponse(
        { chat, embedding, templates, schemas },
        {
          setSessionExpired,
          setChatModels,
          setEmbeddingModels,
          setTemplates,
          setSchemas,
          setLoadError,
        },
      )
    } catch (err) {
      handleCatalogError(err, catalogSequence, requestId, {
        setSessionExpired,
        setChatModels,
        setEmbeddingModels,
        setTemplates,
        setSchemas,
        setLoadError,
      })
    } finally {
      finishCatalogLoad(catalogSequence, requestId, controller, catalogAbort, setLoading)
    }
  }, [])

  useEffect(
    function loadCatalogOnMount() {
      void loadAll()
    },
    [loadAll],
  )

  useEffect(function invalidatePendingRequests() {
    return function cleanupPendingRequests() {
      templateDetailSequence.current += 1
      templateDetailAbort.current?.abort()
      templateMutationSequence.current += 1
      templateMutationAbort.current?.abort()
      modelDetailSequence.current += 1
      modelDetailAbort.current?.abort()
      modelMutationSequence.current += 1
      modelMutationAbort.current?.abort()
      catalogSequence.current += 1
      catalogAbort.current?.abort()
      modelMutationAbort.current = null
    }
  }, [])

  const loadTemplate = useCallback(async function loadTemplate(name: string) {
    resetStateForTemplateLoad({
      templateMutationSequence,
      templateMutationAbort,
      templateEditorRevision,
      setSaving,
      templateDetailAbort,
      modelDetailAbort,
      modelDetailSequence,
      modelMutationSequence,
      modelMutationAbort,
      modelEditorRevision,
      setModelSettings,
      setSavingModel,
      setDeletingModel,
      setModelJsonDrafts,
      setModelJsonErrors,
    })
    const requestId = templateDetailSequence.current + 1
    templateDetailSequence.current = requestId
    const controller = new AbortController()
    templateDetailAbort.current = controller
    setLoadingTemplateDetail(true)
    try {
      const detail = await fetchValidated(`/api/enhanced/prompts/${name}`, templateDetailSchema, {
        signal: controller.signal,
      })
      if (!isCurrentTemplateDetailRequest(templateDetailSequence, requestId, controller)) return
      applyTemplateDetail(detail, name, {
        setTemplateDocument,
        setSelectedName,
        setIsNew,
        setTitle,
        setGoal,
        setCoreDirective,
        setModelId,
        setParameters,
        setEditedTemplateFields,
        setEditedParameterFields,
      })
    } catch (error) {
      if (isAbortError(error) || templateDetailSequence.current !== requestId) return
      toast.error('Failed to load template')
    } finally {
      finishTemplateDetailLoad(templateDetailSequence, requestId, controller, setLoadingTemplateDetail)
    }
  }, [])

  const startNewTemplate = () => {
    resetStateForNewTemplate(
      {
        templateMutationSequence,
        templateMutationAbort,
        templateEditorRevision,
        setSaving,
        templateDetailAbort,
        modelDetailAbort,
        modelDetailSequence,
        modelMutationSequence,
        modelMutationAbort,
        modelEditorRevision,
        setModelSettings,
        setSavingModel,
        setDeletingModel,
        setModelJsonDrafts,
        setModelJsonErrors,
        templateDetailSequence,
        setLoadingTemplateDetail,
        setTemplateDocument,
        setSelectedName,
        setIsNew,
        setIsNewModelEntry,
        setNewName,
        setTitle,
        setGoal,
        setCoreDirective,
        setModelId,
        setParameters,
        setEditedTemplateFields,
        setEditedParameterFields,
      },
      firstModelId(models),
    )
  }

  /** Selecting a model from the (now primary) AgentConfig-bound sidebar list
   * — starts a fresh, unsaved template scoped to that model, and loads the
   * model's full editable settings (BUG-260) into the settings form. */
  const selectModel = useCallback(
    function selectModel(m: LLMModel) {
      templateMutationSequence.current += 1
      templateMutationAbort.current?.abort()
      templateMutationAbort.current = null
      templateEditorRevision.current += 1
      setSaving(false)
      templateDetailAbort.current?.abort()
      templateDetailSequence.current += 1
      setLoadingTemplateDetail(false)
      setSavingModel(false)
      setDeletingModel(false)
      modelDetailAbort.current?.abort()
      modelMutationSequence.current += 1
      modelMutationAbort.current?.abort()
      modelEditorRevision.current += 1
      const requestId = modelDetailSequence.current + 1
      modelDetailSequence.current = requestId
      const controller = new AbortController()
      modelDetailAbort.current = controller
      setSelectedName(null)
      setIsNew(true)
      setTemplateDocument(null)
      setNewName('')
      setTitle('')
      setGoal('')
      setCoreDirective('')
      setModelId(m.id)
      setParameters(DEFAULT_PARAMETERS)
      setEditedTemplateFields(new Set())
      setEditedParameterFields(new Set())
      setIsNewModelEntry(false)
      setModelSettings(null)
      setModelJsonDrafts({})
      setModelJsonErrors({})

      void loadSelectedModelSettings({
        kind,
        modelId: m.id,
        requestId,
        controller,
        currentSequence: modelDetailSequence,
        setModelSettings,
      })
    },
    [kind],
  )

  /** Start defining a brand-new model entry (BUG-260's "creating a model")
   *  rather than editing an existing one — every field defaults per the
   *  schema (`default` on each property, or empty/false for one with none). */
  const startNewModel = useCallback(
    function startNewModel() {
      templateMutationSequence.current += 1
      templateMutationAbort.current?.abort()
      templateMutationAbort.current = null
      templateEditorRevision.current += 1
      setSaving(false)
      templateDetailAbort.current?.abort()
      templateDetailSequence.current += 1
      setLoadingTemplateDetail(false)
      setSavingModel(false)
      setDeletingModel(false)
      modelDetailAbort.current?.abort()
      modelDetailSequence.current += 1
      modelMutationSequence.current += 1
      modelMutationAbort.current?.abort()
      modelMutationAbort.current = null
      modelEditorRevision.current += 1
      modelDetailAbort.current = new AbortController()
      setSelectedName(null)
      setIsNew(false)
      setIsNewModelEntry(true)
      setTemplateDocument(null)
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
      setModelJsonDrafts({})
      setModelJsonErrors({})
      setEditedTemplateFields(new Set())
      setEditedParameterFields(new Set())
    },
    [kind, schemas],
  )

  const handleKindChange = useCallback(function handleKindChange(value: string) {
    if (value !== 'chat' && value !== 'embedding') return
    templateMutationSequence.current += 1
    templateMutationAbort.current?.abort()
    templateMutationAbort.current = null
    templateEditorRevision.current += 1
    setSaving(false)
    templateDetailAbort.current?.abort()
    templateDetailSequence.current += 1
    setLoadingTemplateDetail(false)
    modelDetailAbort.current?.abort()
    modelDetailSequence.current += 1
    modelMutationSequence.current += 1
    modelMutationAbort.current?.abort()
    modelMutationAbort.current = null
    modelEditorRevision.current += 1
    setSavingModel(false)
    setDeletingModel(false)
    setKind(value)
    setModelSettings(null)
    setModelJsonDrafts({})
    setModelJsonErrors({})
    setEditedParameterFields(new Set())
  }, [])

  const handleSaveModelSettings = async () => {
    const schema = schemas?.[kind]
    const target = prepareModelSave({
      schema,
      modelSettings,
      modelJsonInvalid,
      isNewModelEntry,
      newModelId,
      modelId,
      newModelProvider,
    })
    if (!target) return
    const { targetId, provider, modelSettings: settings } = target
    const selectionRequestId = modelDetailSequence.current
    const selectionController = activeAbortController(modelDetailAbort.current)
    const editorRevisionAtStart = modelEditorRevision.current
    const payload = { ...settings, id: targetId, provider }
    const otherModels = models.filter((model) => model.id !== targetId)
    await executeModelSave({
      kind,
      payload,
      otherModels,
      targetId,
      selectionRequestId,
      editorRevisionAtStart,
      selectionController,
      modelDetailSequence,
      modelMutationSequence,
      modelMutationAbort,
      modelEditorRevision,
      setSavingModel,
      loadAll,
      setIsNewModelEntry,
      setModelId,
      setModelSettings,
      setModelJsonDrafts,
      setModelJsonErrors,
    })
  }

  /** Remove a model from AgentConfig's `chat_models`/`embedding_models`
   *  registry — the "remove an LLM endpoint" half of native add/modify/
   *  remove management. `PUT /llm/models`/`.../embedding-models` replace the
   *  WHOLE registry (see the docstring on those routes), so "delete" is
   *  "resubmit the list without this entry," the same full-registry-replace
   *  discipline `handleSaveModelSettings` already uses for create/edit. */
  const handleDeleteModel = async () => {
    const targetId = resolveModelDeleteTarget(isNewModelEntry, selectedModel, kind)
    if (!targetId) return
    await executeModelDelete({
      kind,
      models,
      targetId,
      selectionRequestId: modelDetailSequence.current,
      modelDetailSequence,
      modelDetailAbort,
      setDeletingModel,
      loadAll,
      setModelSettings,
      setModelJsonDrafts,
      setModelJsonErrors,
      setModelId,
    })
  }

  const handleSave = async () => {
    const targetName = resolveTemplateSaveTarget(isNew, newName, selectedName)
    if (!targetName) return
    const selectionAtStart = templateDetailSequence.current
    const editorRevisionAtStart = templateEditorRevision.current
    templateMutationAbort.current?.abort()
    const mutationId = templateMutationSequence.current + 1
    templateMutationSequence.current = mutationId
    const controller = new AbortController()
    templateMutationAbort.current = controller
    setSaving(true)
    try {
      const payload = buildTemplatePayload({
        templateDocument,
        parameters,
        editedParameterFields,
        editedTemplateFields,
        targetName,
        title,
        goal,
        coreDirective,
        modelId,
      })
      await runTemplateSaveWorkflow({
        targetName,
        payload,
        controller,
        selectionAtStart,
        editorRevisionAtStart,
        templateMutationSequence,
        templateMutationId: mutationId,
        templateDetailSequence,
        templateEditorRevision,
        setIsNew,
        setSelectedName,
        setTemplateDocument,
        setEditedTemplateFields,
        setEditedParameterFields,
        loadAll,
      })
    } catch (error) {
      reportTemplateSaveError({
        error,
        mutationSequence: templateMutationSequence,
        mutationId,
        detailSequence: templateDetailSequence,
        selectionAtStart,
        editorRevision: templateEditorRevision,
        editorRevisionAtStart,
      })
    } finally {
      finishTemplateSave(templateMutationSequence, mutationId, controller, templateMutationAbort, setSaving)
    }
  }

  const handleRefreshModels = () => {
    void loadAll()
  }

  const handleSearchModels = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value)
  }

  const handleTemplateSaveClick = () => {
    void handleSave()
  }

  const handleModelSettingsChange = (field: string, value: unknown) => {
    modelEditorRevision.current += 1
    setModelSettings((previous) => updateModelSetting(previous, field, value))
  }

  const handleDeleteModelClick = () => {
    void handleDeleteModel()
  }

  const handleSaveModelClick = () => {
    void handleSaveModelSettings()
  }

  const handleLoadTemplate = (name: string) => {
    void loadTemplate(name)
  }

  const handleNewTemplateNameChange = (value: string) => {
    templateEditorRevision.current += 1
    setNewName(value)
  }

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTitle(event.target.value)
    markTemplateFieldEdited('title')
  }

  const handleGoalChange = (event: ChangeEvent<HTMLInputElement>) => {
    setGoal(event.target.value)
    markTemplateFieldEdited('goal')
  }

  const handleCoreDirectiveChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setCoreDirective(event.target.value)
    markTemplateFieldEdited('core_directive')
  }

  const filteredModels = filterModels(models, searchQuery)
  const selectedModel = models.find((m) => m.id === modelId)
  const activeSchema = activeSchemaForKind(schemas, kind)

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
                type="button"
                className="h-8 w-8"
                onClick={startNewTemplate}
                title="New template"
                aria-label="New template"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                type="button"
                className="h-8 w-8"
                onClick={handleRefreshModels}
                aria-label="Refresh models and templates"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
          <CardDescription>
            Choose a chat or embedding model from the active AgentConfig registry, then select it to edit its settings.
          </CardDescription>
          <Tabs value={kind} onValueChange={handleKindChange} className="mt-1">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="chat">Chat models</TabsTrigger>
              <TabsTrigger value="embedding">Embedding models</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search models"
              placeholder="Search models..."
              value={searchQuery}
              onChange={handleSearchModels}
              className="pl-8 h-9"
            />
          </div>
          <Button variant="outline" size="sm" type="button" className="mt-2 w-full" onClick={startNewModel}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New {kind} model
          </Button>
        </CardHeader>
        <ScrollArea className="flex-1">
          <CardContent className="space-y-1 pt-0">
            {modelListPanel({
              loading,
              loadError,
              filteredModels,
              kind,
              modelId,
              isNewModelEntry,
              onSelectModel: selectModel,
            })}
          </CardContent>
        </ScrollArea>
      </Card>

      {/* 2. Composer */}
      <Card className="lg:col-span-2 border-border/40 bg-card/60 backdrop-blur-md flex flex-col overflow-hidden">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Sparkles className="size-4 text-emerald-400" />
              {composerTitle(isNewModelEntry, kind, selectedModel)}
            </CardTitle>
            <CardDescription>
              Edit the selected model, or create a reusable template with a system instruction and generation settings.
            </CardDescription>
          </div>
          <Button
            size="sm"
            type="button"
            onClick={handleTemplateSaveClick}
            disabled={loadingTemplateDetail || isSaveTemplateDisabled(saving, isNew, selectedName, newName)}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Save className="size-4 mr-1.5" />
            {saving ? 'Saving...' : 'Save template'}
          </Button>
        </CardHeader>
        <ScrollArea className="flex-1">
          <CardContent className="space-y-5 pb-8">
            {modelConfigurationPanel({
              kind,
              isNewModelEntry,
              selectedModel,
              activeSchema,
              modelSettings,
              deletingModel,
              savingModel,
              newModelId,
              newModelProvider,
              jsonDrafts: modelJsonDrafts,
              jsonErrors: modelJsonErrors,
              setNewModelId: handleNewModelIdChange,
              setNewModelProvider: handleNewModelProviderChange,
              onModelSettingsChange: handleModelSettingsChange,
              onJsonDraftChange: handleModelJsonDraftChange,
              modelJsonInvalid,
              onDeleteModel: handleDeleteModelClick,
              onSaveModelSettings: handleSaveModelClick,
            })}

            {existingTemplatePicker({
              templates,
              selectedName,
              onLoadTemplate: handleLoadTemplate,
            })}

            {newTemplateNameField({
              isNew,
              newName,
              setNewName: handleNewTemplateNameChange,
            })}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="template-display-title" className="text-xs font-semibold text-muted-foreground">
                  Display title
                </label>
                <Input
                  id="template-display-title"
                  aria-describedby="template-display-title-help"
                  value={title}
                  onChange={handleTitleChange}
                  placeholder="e.g. Release notes writer"
                />
                <p id="template-display-title-help" className="text-[11px] text-muted-foreground">
                  The friendly title people see when they choose this template.
                </p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="template-goal" className="text-xs font-semibold text-muted-foreground">
                  Goal (one sentence)
                </label>
                <Input
                  id="template-goal"
                  aria-describedby="template-goal-help"
                  value={goal}
                  onChange={handleGoalChange}
                  placeholder="e.g. Turn a code diff into concise release notes"
                />
                <p id="template-goal-help" className="text-[11px] text-muted-foreground">
                  A short description helps others decide when to use this template.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="template-core-directive"
                className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"
              >
                <Eye className="h-3.5 w-3.5" />
                System prompt / core directive
              </label>
              <Textarea
                id="template-core-directive"
                aria-describedby="template-core-directive-help"
                value={coreDirective}
                onChange={handleCoreDirectiveChange}
                rows={6}
                className="font-mono text-xs"
                placeholder="You are ..."
              />
              <p id="template-core-directive-help" className="text-[11px] text-muted-foreground">
                The system instruction the model receives before the user&apos;s request.
              </p>
            </div>

            {templateParametersPanel({ parameters, onParameterChange: handleTemplateParameterChange })}
          </CardContent>
        </ScrollArea>
      </Card>
    </div>
  )
}
