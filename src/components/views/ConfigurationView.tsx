/**
 * @file ConfigurationView.tsx
 * @description 1:1 form UI for the ENTIRE `AgentConfig` — every field the
 * config layer accepts gets an editable control, and every constrained-value
 * field (a Pydantic `Literal`) gets a real dropdown of its actual permitted
 * values, never a free-text box.
 *
 * Schema-derived, not hand-maintained: the field list, types, `enum`s,
 * defaults, descriptions, and required-ness all come from
 * `GET /api/enhanced/config/schema` (`AgentConfig.model_json_schema()` on the
 * backend, `agent/agent_webui/api_extensions.py::get_agent_config_schema`) —
 * the same discipline BUG-260 established for the LLM model forms
 * (`LLMTemplatesView.tsx`). A field this form cannot render with a rich,
 * typed control (a nested Pydantic model, `dict[str, Any]`, `list[dict]`, …)
 * still gets ONE — a labelled raw-JSON editor — so nothing is silently
 * dropped; which fields fall into that bucket is a structural decision
 * (`classifyField`, driven by the JSON Schema shape), not a hand-picked list.
 *
 * Two fields — `chat_models`/`embedding_models` — are excluded on purpose:
 * they already have their own dedicated, schema-derived CRUD surface (the
 * LLM Endpoints page, BUG-260). The backend reports the exclusion explicitly
 * (`excluded_fields`) and this view surfaces it as a link-out card rather
 * than silently omitting them.
 *
 * Secrets: `GET /config` redacts every literal-secret-shaped field
 * (`_is_inline_secret_key`) to `''` — this view never shows or round-trips a
 * secret VALUE. A secret-shaped field renders as a presence badge
 * (Configured / Not set / Status unknown, from `GET /config/secret-status`,
 * itself presence-only) plus a "Clear" action that sends the backend's
 * `secret_clear_sentinel` — the ONE explicit way to blank a secret. Leaving
 * the field untouched preserves whatever is already persisted (the backend
 * carries an unedited blank forward instead of destroying it — see
 * `_preserve_unedited_secrets` server-side). A `_ref`/`_reference`-suffixed
 * sibling is a reference, editable as ordinary text.
 *
 * All three honest states apply here: `loadError` (schema/config genuinely
 * unreachable) is a distinct panel from a normal empty result, and the two
 * best-effort companions (`/config/groups`, `/config/secret-status`) degrade
 * VISIBLY (an `UnavailableNotice` / a "Status unknown" badge) rather than
 * silently rendering as if nothing were wrong.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import {
  ChevronRight,
  ExternalLink,
  FolderCog,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import { toast } from 'sonner'
import { ApiError, fetchValidated } from '@/lib/api-validation'
import { SessionExpiredNotice } from '@/components/SessionExpiredNotice'

// ── AgentConfig JSON Schema, as `model_json_schema()` renders it ───────────

interface JsonSchemaNode {
  type?: string
  enum?: unknown[]
  const?: unknown
  anyOf?: JsonSchemaNode[]
  items?: JsonSchemaNode
  additionalProperties?: JsonSchemaNode | boolean
  default?: unknown
  title?: string
  description?: string
  minimum?: number
  maximum?: number
}
const jsonSchemaNodeSchema: z.ZodType<JsonSchemaNode> = z.looseObject({
  type: z.string().optional(),
  enum: z.array(z.unknown()).optional(),
  const: z.unknown().optional(),
  anyOf: z.array(z.lazy((): z.ZodType<JsonSchemaNode> => jsonSchemaNodeSchema)).optional(),
  items: z.lazy((): z.ZodType<JsonSchemaNode> => jsonSchemaNodeSchema).optional(),
  additionalProperties: z
    .union([z.lazy((): z.ZodType<JsonSchemaNode> => jsonSchemaNodeSchema), z.boolean()])
    .optional(),
  default: z.unknown().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
})

const agentConfigSchemaResponseSchema = z.object({
  schema: z.looseObject({
    properties: z.record(z.string(), jsonSchemaNodeSchema),
    required: z.array(z.string()).optional(),
  }),
  excluded_fields: z.array(z.string()),
  secret_fields: z.array(z.string()),
  secret_clear_sentinel: z.string(),
})
type AgentConfigSchemaResponse = z.infer<typeof agentConfigSchemaResponseSchema>

// The persisted config document: arbitrary JSON per field (D-WUI-20: a bare
// `null` document is a legitimate "no config yet" state, coerced to `{}`).
const configDocumentSchema = z.preprocess((value) => value ?? {}, z.record(z.string(), z.unknown()))

const configGroupsSchema = z.preprocess(
  (value) => value ?? {},
  z.object({ fields: z.record(z.string(), z.string()).optional() }),
)

const secretStatusSchema = z.preprocess(
  (value) => value ?? {},
  z.object({ fields: z.record(z.string(), z.boolean()).optional() }),
)

/** Strips the trailing `(CONCEPT:...)` provenance tag `config.py`'s own section
 *  comments carry — useful in the source, noise in a settings label. */
function displayGroupTitle(title: string): string {
  return title.replace(/\s*\(CONCEPT:[^)]*\)\s*$/, '').trim() || title
}

// ── Field classification (schema-driven, not a hand-picked field list) ─────

type FieldKind =
  | 'boolean'
  | 'integer'
  | 'number'
  | 'enum'
  | 'string-array'
  | 'enum-array'
  | 'kv-string'
  | 'kv-number'
  | 'string'
  | 'json'

/** The non-null branch of an `Optional[...]` field (`anyOf: [<type>, {type:
 *  "null"}]`), or the node itself when there is no `anyOf`. */
function primitiveNode(prop: JsonSchemaNode): JsonSchemaNode {
  if (prop.type ?? prop.enum ?? prop.const !== undefined) return prop
  return prop.anyOf?.find((entry) => entry.type !== 'null') ?? prop
}

/** A `Literal[...]` field's permitted values (`enum`), or a single-value
 *  `const` (pydantic's rendering of a one-member `Literal`). */
function enumValues(prop: JsonSchemaNode): unknown[] | undefined {
  const node = primitiveNode(prop)
  if (node.enum) return node.enum
  if (node.const !== undefined) return [node.const]
  return undefined
}

/** A JSON-value-safe `String()` -- schema `enum`/dict-value entries are typed
 *  `unknown` (they come straight off the wire), and a plain object's default
 *  `toString()` silently renders `[object Object]`. Primitives stringify
 *  normally; anything else falls back to its JSON form. */
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

/** Which control a field's JSON Schema shape gets. A constrained value set
 *  (`enum`/`const`) always wins into a dropdown/multi-select over its base
 *  type — the whole point of deriving from the schema instead of a
 *  hand-maintained field list. Shapes this form cannot render richly (a
 *  nested Pydantic model, `dict[str, Any]`, `list[dict]`, …) fall through to
 *  `'json'` — still editable, just as raw JSON rather than a typed control. */
function classifyField(prop: JsonSchemaNode): FieldKind {
  const node = primitiveNode(prop)
  const values = enumValues(prop)
  switch (node.type) {
    case 'boolean':
      return 'boolean'
    case 'integer':
      return values ? 'enum' : 'integer'
    case 'number':
      return values ? 'enum' : 'number'
    case 'string':
      return values ? 'enum' : 'string'
    case 'array': {
      const items = node.items
      if (items && enumValues(items)) return 'enum-array'
      const itemType = items ? primitiveNode(items).type : undefined
      if (itemType === 'string' || itemType === 'integer' || itemType === 'number') return 'string-array'
      return 'json'
    }
    case 'object': {
      const additional = node.additionalProperties
      if (additional && typeof additional === 'object') {
        const addType = primitiveNode(additional).type
        if (addType === 'string') return 'kv-string'
        if (addType === 'integer' || addType === 'number') return 'kv-number'
      }
      return 'json'
    }
    default:
      return values ? 'enum' : 'json'
  }
}

/** `prop.title` is populated for every AgentConfig field (pydantic derives
 *  it from the attribute name) and used whenever present; this fallback
 *  only matters if a future schema omits it. `name` here is the alias
 *  (`OPENAI_API_KEY`), so lowercase the tail of each word before
 *  capitalizing rather than assuming mixed case already. */
function fieldLabel(name: string, prop: JsonSchemaNode): string {
  if (prop.title) return prop.title
  return name
    .split('_')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(' ')
}

/** Case-insensitive: AgentConfig's schema/document keys are alias-keyed
 *  (`OPENAI_API_KEY_REF`), not the Python attribute name
 *  (`openai_api_key_ref`) -- see the module docstring. */
function isRefHintField(name: string): boolean {
  const upper = name.toUpperCase()
  return upper.endsWith('_REF') || upper.endsWith('_REFERENCE')
}

interface FieldDescriptor {
  name: string
  prop: JsonSchemaNode
  kind: FieldKind
  required: boolean
  isSecret: boolean
  group: string
}

// ── Reusable field controls ─────────────────────────────────────────────

function FieldShell({
  name,
  prop,
  required,
  children,
}: {
  name: string
  prop: JsonSchemaNode
  required: boolean
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
        {fieldLabel(name, prop)}
        {required && <span className="text-rose-400">*</span>}
        {isRefHintField(name) && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 font-normal">
            secret ref
          </Badge>
        )}
      </label>
      {children}
      {prop.description && <p className="text-[10px] text-muted-foreground/70">{prop.description}</p>}
    </div>
  )
}

function StringArrayEditor({ value, onChange }: { value: unknown; onChange: (v: string[]) => void }) {
  const items = Array.isArray(value) ? value.map(String) : []
  const [draft, setDraft] = useState('')
  const commit = () => {
    const v = draft.trim()
    if (v) {
      onChange([...items, v])
      setDraft('')
    }
  }
  return (
    <div className="space-y-1.5">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {items.map((item, idx) => (
            <Badge key={`${item}-${idx}`} variant="outline" className="gap-1 text-[10px] font-mono">
              {item}
              <button
                type="button"
                onClick={() => {
                  onChange(items.filter((_, i) => i !== idx))
                }}
                aria-label={`Remove ${item}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
          }}
          placeholder="Add value…"
          className="h-8 text-xs font-mono"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
        <Button type="button" size="sm" variant="outline" className="h-8 px-2" onClick={commit}>
          <Plus className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function EnumArrayEditor({
  options,
  value,
  onChange,
}: {
  options: unknown[]
  value: unknown
  onChange: (v: string[]) => void
}) {
  const selected = new Set(Array.isArray(value) ? value.map(String) : [])
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const key = stringifyValue(opt)
        const active = selected.has(key)
        return (
          <button
            key={key}
            type="button"
            onClick={() => {
              const next = active ? [...selected].filter((s) => s !== key) : [...selected, key]
              onChange(next)
            }}
            className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
              active
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'border-border/50 text-muted-foreground hover:bg-muted/30'
            }`}
          >
            {key}
          </button>
        )
      })}
    </div>
  )
}

function KVEditor({
  value,
  numeric,
  onChange,
}: {
  value: unknown
  numeric: boolean
  onChange: (v: Record<string, unknown>) => void
}) {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const entries = Object.entries(record)
  const [newKey, setNewKey] = useState('')
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1.5 items-center">
          <Input value={k} disabled className="h-8 text-xs font-mono w-1/3 opacity-70" />
          <Input
            type={numeric ? 'number' : 'text'}
            value={numeric ? (typeof v === 'number' ? v : '') : stringifyValue(v)}
            onChange={(e) => {
              const raw = e.target.value
              const nextValue: unknown = numeric ? (raw === '' ? null : Number(raw)) : raw
              onChange({ ...record, [k]: nextValue })
            }}
            className="h-8 text-xs font-mono flex-1"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              const next = Object.fromEntries(entries.filter(([entryKey]) => entryKey !== k))
              onChange(next)
            }}
            aria-label={`Remove ${k}`}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <Input
          value={newKey}
          onChange={(e) => {
            setNewKey(e.target.value)
          }}
          placeholder="key"
          className="h-8 text-xs font-mono w-1/3"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => {
            const k = newKey.trim()
            if (!k || k in record) return
            onChange({ ...record, [k]: numeric ? 0 : '' })
            setNewKey('')
          }}
        >
          <Plus className="size-3.5 mr-1" /> Add key
        </Button>
      </div>
    </div>
  )
}

/** Fallback for shapes this form does not render as a rich typed control
 *  (a nested Pydantic model, `dict[str, Any]`, `list[dict]`, …) — still
 *  editable, as raw JSON. Invalid JSON is never committed to the working
 *  document (mirrors `LLMTemplatesView.tsx`'s model-settings JSON field);
 *  the operator sees an inline error until it parses again. */
function JsonFallbackEditor({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="space-y-1">
      <Textarea
        value={value == null ? '' : JSON.stringify(value, null, 2)}
        onChange={(e) => {
          const raw = e.target.value
          if (raw.trim() === '') {
            setError(null)
            onChange(null)
            return
          }
          try {
            onChange(JSON.parse(raw))
            setError(null)
          } catch {
            setError('Invalid JSON — not applied until this parses.')
          }
        }}
        rows={4}
        className="font-mono text-xs"
        placeholder="null"
      />
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
    </div>
  )
}

/** Never a text box: a literal-secret-shaped field is presence-only here.
 *  `state` comes from `/config/secret-status` (`null` = that best-effort
 *  fetch itself failed — 'unknown', not fabricated as 'not-set'). */
function SecretFieldRow({
  name,
  prop,
  state,
  cleared,
  onClear,
  hasRefSibling,
}: {
  name: string
  prop: JsonSchemaNode
  state: boolean | null | undefined
  cleared: boolean
  onClear: () => void
  hasRefSibling: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-muted-foreground">{fieldLabel(name, prop)}</label>
      <div className="flex items-center gap-2 flex-wrap">
        {cleared ? (
          <Badge variant="destructive" className="gap-1 text-[10px]">
            Will be cleared on save
          </Badge>
        ) : state === undefined || state === null ? (
          <Badge variant="outline" className="gap-1 text-[10px] text-amber-500 border-amber-500/40">
            <ShieldQuestion className="size-3" /> Status unknown
          </Badge>
        ) : state ? (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <ShieldCheck className="size-3" /> Configured (redacted)
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <ShieldAlert className="size-3" /> Not set
          </Badge>
        )}
        {state === true && !cleared && (
          <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground/70">
        Never displayed or editable as a literal value here.{' '}
        {hasRefSibling
          ? `Set ${name}_REF instead — this workspace stores secrets only as env://, secret://, or vault:// references.`
          : 'Configure this provider via a secret reference field, not a literal value.'}
      </p>
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────

export default function ConfigurationView() {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [schemaResp, setSchemaResp] = useState<AgentConfigSchemaResponse | null>(null)
  const [persisted, setPersisted] = useState<Record<string, unknown>>({})
  const [fieldGroups, setFieldGroups] = useState<Record<string, string>>({})
  const [groupsUnavailable, setGroupsUnavailable] = useState(false)
  const [secretStatus, setSecretStatus] = useState<Record<string, boolean> | null>(null)
  const [edits, setEdits] = useState<Record<string, unknown>>({})
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [search, setSearch] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [schemaRes, configDocRes] = await Promise.all([
        fetchValidated('/api/enhanced/config/schema', agentConfigSchemaResponseSchema),
        fetchValidated('/api/enhanced/config', configDocumentSchema),
      ])
      setSessionExpired(false)
      setSchemaResp(schemaRes)
      setPersisted(configDocRes)
      setEdits({})
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSessionExpired(true)
      } else if (err instanceof ApiError) {
        setLoadError(`Backend returned HTTP ${err.status}.`)
      } else if (err instanceof Error) {
        setLoadError(err.message)
      } else {
        setLoadError('Configuration is unavailable.')
      }
      setLoading(false)
      return
    }

    // Best-effort companions: their absence degrades visibly (a notice / a
    // "Status unknown" badge), never silently as a confirmed empty/false.
    try {
      const groupsRes = await fetchValidated('/api/enhanced/config/groups', configGroupsSchema)
      setFieldGroups(groupsRes.fields ?? {})
      setGroupsUnavailable(false)
    } catch {
      setFieldGroups({})
      setGroupsUnavailable(true)
    }
    try {
      const statusRes = await fetchValidated('/api/enhanced/config/secret-status', secretStatusSchema)
      setSecretStatus(statusRes.fields ?? {})
    } catch {
      setSecretStatus(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const fields: FieldDescriptor[] = useMemo(() => {
    if (!schemaResp) return []
    const excluded = new Set(schemaResp.excluded_fields)
    const secretSet = new Set(schemaResp.secret_fields)
    const required = new Set(schemaResp.schema.required ?? [])
    return Object.entries(schemaResp.schema.properties)
      .filter(([name]) => !excluded.has(name))
      .map(([name, prop]) => ({
        name,
        prop,
        kind: classifyField(prop),
        required: required.has(name),
        isSecret: secretSet.has(name),
        group: displayGroupTitle(fieldGroups[name] ?? 'Other'),
      }))
  }, [schemaResp, fieldGroups])

  // Case-insensitive: schema property names are alias-keyed
  // (`OPENAI_API_KEY_REF`), so a sibling lookup by exact-cased string
  // concatenation would miss.
  const upperPropertyNames = useMemo(
    () => new Set(Object.keys(schemaResp?.schema.properties ?? {}).map((n) => n.toUpperCase())),
    [schemaResp],
  )

  const valueFor = useCallback(
    (field: FieldDescriptor): unknown => {
      if (field.name in edits) return edits[field.name]
      if (field.name in persisted) return persisted[field.name]
      return field.prop.default ?? null
    },
    [edits, persisted],
  )

  const setValue = useCallback((name: string, value: unknown) => {
    setEdits((prev) => ({ ...prev, [name]: value }))
  }, [])

  const { secretFields, groupedFields, sortedGroupNames } = useMemo(() => {
    const query = search.trim().toLowerCase()
    const matches = (f: FieldDescriptor) =>
      query === '' || f.name.toLowerCase().includes(query) || fieldLabel(f.name, f.prop).toLowerCase().includes(query)
    const secrets = fields.filter((f) => f.isSecret && matches(f))
    const rest = fields.filter((f) => !f.isSecret && matches(f))
    const grouped: Record<string, FieldDescriptor[]> = {}
    for (const f of rest) {
      ;(grouped[f.group] ??= []).push(f)
    }
    const names = Object.keys(grouped).sort((a, b) => {
      if (a === 'Other') return 1
      if (b === 'Other') return -1
      return grouped[b].length - grouped[a].length || a.localeCompare(b)
    })
    return { secretFields: secrets, groupedFields: grouped, sortedGroupNames: names }
  }, [fields, search])

  const toggleGroup = (group: string) => {
    setOpenGroups((prev) => ({ ...prev, [group]: !prev[group] }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = { ...persisted, ...edits }
      const res = await fetch('/api/enhanced/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        toast.success('Configuration saved')
        await fetchAll()
      } else {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        toast.error(body?.detail ?? `Failed to save configuration (HTTP ${res.status})`)
      }
    } catch {
      toast.error('Network error saving configuration')
    } finally {
      setSaving(false)
    }
  }

  const handleReload = async () => {
    setReloading(true)
    try {
      const res = await fetch('/api/enhanced/reload', { method: 'POST' })
      if (res.ok) {
        toast.success('Agent-utilities background workers reloaded')
      } else {
        toast.error('Reload trigger failed')
      }
    } catch {
      toast.error('Network error during reload trigger')
    } finally {
      setReloading(false)
    }
  }

  const goToLlmEndpoints = () => {
    window.history.pushState({}, '', '/llm-templates')
    window.dispatchEvent(new Event('history-state-changed'))
  }

  if (sessionExpired) {
    return <SessionExpiredNotice />
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-[calc(100vh-12rem)] flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
        <div>
          <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-500 flex items-center gap-2">
            <Settings className="size-6 text-emerald-400" />
            Configuration Dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            Every field AgentConfig accepts, one form — derived from its own schema.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void handleReload()
            }}
            disabled={reloading || loading}
            className="border-emerald-500/20 hover:bg-emerald-500/5 text-emerald-400"
          >
            <RefreshCw className={`size-4 mr-1.5 ${reloading ? 'animate-spin' : ''}`} />
            Reload Engine
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void handleSave()
            }}
            disabled={saving || loading || !!loadError}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Save className="size-4 mr-1.5" />
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 pr-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <RefreshCw className="size-8 text-emerald-500 animate-spin" />
            <span className="text-sm text-muted-foreground">Reading AgentConfig schema and values...</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <UnavailableNotice what="The AgentConfig schema or the active configuration" />
            <p className="text-xs text-muted-foreground max-w-md">{loadError}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void fetchAll()
              }}
            >
              <RefreshCw className="size-4 mr-1.5" /> Retry
            </Button>
          </div>
        ) : fields.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            The schema was fetched successfully but declared zero editable fields.
          </div>
        ) : (
          <div className="space-y-6 pb-12">
            {schemaResp && schemaResp.excluded_fields.length > 0 && (
              <Card className="border-border/40 bg-card/40">
                <CardContent className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{schemaResp.excluded_fields.join(', ')}</span>{' '}
                    {schemaResp.excluded_fields.length === 1 ? 'has' : 'have'} a dedicated schema-derived editor — the
                    LLM Endpoints page — instead of a second copy here.
                  </p>
                  <Button variant="outline" size="sm" onClick={goToLlmEndpoints} className="shrink-0">
                    <ExternalLink className="size-3.5 mr-1.5" /> Open LLM Endpoints
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="relative shrink-0">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={`Search ${fields.length.toString()} fields...`}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                }}
                className="pl-8 h-9"
              />
            </div>

            {secretFields.length > 0 && (
              <Card className="border-border/40 bg-card/60 backdrop-blur-md">
                <CardHeader className="pb-3 flex flex-row items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <ShieldCheck className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Secrets</CardTitle>
                    <CardDescription>
                      Literal-secret-shaped fields. Never rendered as a value — presence only, from{' '}
                      {secretStatus === null ? 'an unavailable status check' : 'the live document'}.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {secretFields.map((field) => (
                      <SecretFieldRow
                        key={field.name}
                        name={field.name}
                        prop={field.prop}
                        state={secretStatus ? secretStatus[field.name] : undefined}
                        cleared={valueFor(field) === schemaResp?.secret_clear_sentinel}
                        onClear={() => {
                          if (schemaResp) setValue(field.name, schemaResp.secret_clear_sentinel)
                        }}
                        hasRefSibling={upperPropertyNames.has(`${field.name.toUpperCase()}_REF`)}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {groupsUnavailable && <UnavailableNotice what="Field section grouping" className="px-1" />}

            {sortedGroupNames.length > 0 && (
              <Card className="border-border/40 bg-card/60 backdrop-blur-md">
                <CardHeader className="pb-3 flex flex-row items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <FolderCog className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Settings</CardTitle>
                    <CardDescription>
                      Every other AgentConfig field, grouped the same way `agent_utilities/core/config.py` organizes
                      itself.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {sortedGroupNames.map((group) => (
                    <Collapsible
                      key={group}
                      open={openGroups[group] ?? false}
                      onOpenChange={() => {
                        toggleGroup(group)
                      }}
                      className="rounded-md border border-border/40"
                    >
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/20"
                        >
                          <span className="flex items-center gap-2 text-sm font-medium">
                            <FolderCog className="size-4 text-muted-foreground" />
                            {group}
                            <Badge variant="outline" className="text-[10px]">
                              {groupedFields[group].length}
                            </Badge>
                          </span>
                          <ChevronRight
                            className={`size-4 text-muted-foreground transition-transform ${openGroups[group] ? 'rotate-90' : ''}`}
                          />
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="border-t border-border/40 p-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {groupedFields[group].map((field) => {
                            const value = valueFor(field)
                            const onChange = (v: unknown) => {
                              setValue(field.name, v)
                            }
                            if (field.kind === 'boolean') {
                              return (
                                <div
                                  key={field.name}
                                  className="flex items-center justify-between rounded-md border border-border/40 p-2.5"
                                >
                                  <label htmlFor={`cfg-${field.name}`} className="text-xs font-medium">
                                    {fieldLabel(field.name, field.prop)}
                                  </label>
                                  <Switch
                                    id={`cfg-${field.name}`}
                                    checked={Boolean(value)}
                                    onCheckedChange={onChange}
                                  />
                                </div>
                              )
                            }
                            return (
                              <FieldShell
                                key={field.name}
                                name={field.name}
                                prop={field.prop}
                                required={field.required}
                              >
                                {field.kind === 'integer' || field.kind === 'number' ? (
                                  <Input
                                    type="number"
                                    value={typeof value === 'number' ? value : ''}
                                    min={field.prop.minimum}
                                    max={field.prop.maximum}
                                    onChange={(e) => {
                                      const raw = e.target.value
                                      if (raw === '') {
                                        onChange(null)
                                        return
                                      }
                                      const next =
                                        field.kind === 'integer' ? Number.parseInt(raw, 10) : Number.parseFloat(raw)
                                      if (Number.isFinite(next)) onChange(next)
                                    }}
                                    className="font-mono text-xs"
                                  />
                                ) : field.kind === 'enum' ? (
                                  <select
                                    value={value == null ? '' : stringifyValue(value)}
                                    onChange={(e) => {
                                      const raw = e.target.value
                                      if (raw === '') {
                                        onChange(null)
                                        return
                                      }
                                      const options = enumValues(field.prop) ?? []
                                      const match = options.find((o) => stringifyValue(o) === raw)
                                      onChange(match ?? raw)
                                    }}
                                    className="w-full h-9 px-3 rounded-md border border-input bg-muted/20 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                  >
                                    <option value="">— unset —</option>
                                    {(enumValues(field.prop) ?? []).map((opt) => (
                                      <option key={stringifyValue(opt)} value={stringifyValue(opt)}>
                                        {stringifyValue(opt)}
                                      </option>
                                    ))}
                                  </select>
                                ) : field.kind === 'string-array' ? (
                                  <StringArrayEditor value={value} onChange={onChange} />
                                ) : field.kind === 'enum-array' ? (
                                  <EnumArrayEditor
                                    options={(field.prop.items && enumValues(field.prop.items)) ?? []}
                                    value={value}
                                    onChange={onChange}
                                  />
                                ) : field.kind === 'kv-string' ? (
                                  <KVEditor value={value} numeric={false} onChange={onChange} />
                                ) : field.kind === 'kv-number' ? (
                                  <KVEditor value={value} numeric onChange={onChange} />
                                ) : field.kind === 'json' ? (
                                  <JsonFallbackEditor value={value} onChange={onChange} />
                                ) : (
                                  <Input
                                    id={`cfg-${field.name}`}
                                    value={typeof value === 'string' ? value : ''}
                                    onChange={(e) => {
                                      onChange(e.target.value)
                                    }}
                                    className="bg-muted/20 font-mono text-xs"
                                  />
                                )}
                              </FieldShell>
                            )
                          })}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
