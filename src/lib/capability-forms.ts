import type { PageContextEnvelope } from './page-context'

/** A (subset of) JSON Schema, as returned by the fleet's live schema-introspection routes. */
export interface JsonSchema {
  $ref?: string
  $defs?: Record<string, JsonSchema>
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  type?: string | string[]
  title?: string
  description?: string
  format?: string
  default?: unknown
  const?: unknown
  enum?: unknown[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  additionalProperties?: boolean | JsonSchema
  writeOnly?: boolean
  'x-sensitive'?: boolean
}

export type SchemaFormValue = string | boolean
export type SchemaFormState = Record<string, SchemaFormValue>

export interface MaterializedInputs {
  inputs: Record<string, unknown>
  issues: { field: string; message: string }[]
}

function localRef(root: JsonSchema, ref: string): JsonSchema | undefined {
  if (!ref.startsWith('#/')) return undefined
  let current: unknown = root
  for (const part of ref.slice(2).split('/')) {
    if (!current || typeof current !== 'object') return undefined
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~')
    current = (current as Record<string, unknown>)[key]
  }
  return current && typeof current === 'object' ? current : undefined
}

/** Resolve the useful local schema branch while retaining annotations from the wrapper. */
export function resolveJsonSchema(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const referenced = schema.$ref ? localRef(root, schema.$ref) : undefined
  const base = referenced ? { ...referenced, ...schema, $ref: undefined } : schema
  const variants = base.anyOf ?? base.oneOf
  const variant = variants?.find((item) => schemaType(item, root) !== 'null')
  return variant ? { ...base, ...resolveJsonSchema(variant, root), anyOf: undefined, oneOf: undefined } : base
}

/** First concrete (non-null) type named by a `anyOf`/`oneOf` variant list. */
function firstVariantType(variants: JsonSchema[] | undefined, root: JsonSchema): string | undefined {
  if (!variants) return undefined
  for (const variant of variants) {
    const type = schemaType(variant, root)
    if (type && type !== 'null') return type
  }
  return undefined
}

export function schemaType(schema: JsonSchema, root: JsonSchema): string | undefined {
  if (schema.$ref) {
    const target = localRef(root, schema.$ref)
    if (target) return schemaType(target, root)
  }
  if (Array.isArray(schema.type)) return schema.type.find((item) => item !== 'null')
  if (schema.type) return schema.type
  const fromVariants = firstVariantType(schema.anyOf ?? schema.oneOf, root)
  if (fromVariants) return fromVariants
  if (schema.properties) return 'object'
  return undefined
}

/** A field name matching one of `context.filters`, exactly or case-insensitively. */
function filterValue(name: string, normalized: string, context: PageContextEnvelope): unknown {
  if (name in context.filters) return context.filters[name]
  const matchingFilter = Object.entries(context.filters).find(([key]) => key.toLowerCase() === normalized)
  return matchingFilter?.[1]
}

const CONTEXT_NAMES = new Set(['page_context', 'context'])
const ROUTE_NAMES = new Set(['route', 'page_route'])
const VIEW_NAMES = new Set(['view', 'page_view'])

/** Whole-page-context aliases: the envelope itself, its filters, the route, or the view. */
function pageValue(normalized: string, type: string | undefined, context: PageContextEnvelope): unknown {
  if (CONTEXT_NAMES.has(normalized)) return type === 'object' ? context : undefined
  if (normalized === 'filters') return type === 'object' ? context.filters : undefined
  if (ROUTE_NAMES.has(normalized)) return context.route
  if (VIEW_NAMES.has(normalized)) return context.view
  return undefined
}

const TIME_ASOF_NAMES = new Set(['as_of', 'asof', 'timestamp'])
const TIME_START_NAMES = new Set(['from', 'start', 'start_time'])
const TIME_END_NAMES = new Set(['to', 'end', 'end_time'])

/** Active time-range aliases, when the page context carries a time range. */
function timeRangeValue(normalized: string, context: PageContextEnvelope): unknown {
  if (!context.timeRange) return undefined
  if (TIME_ASOF_NAMES.has(normalized)) return context.timeRange.asOf
  if (TIME_START_NAMES.has(normalized)) return context.timeRange.start
  if (TIME_END_NAMES.has(normalized)) return context.timeRange.end
  if (normalized === 'timezone') return context.timeRange.timezone
  return undefined
}

const SELECTION_ID_NAMES = new Set(['id', 'selection_id', 'node_id', 'object_id', 'memory_id', 'vertex_id', 'target'])
const SELECTION_IDS_NAMES = new Set(['ids', 'node_ids', 'object_ids', 'selection_ids'])

/** Active-selection aliases: a single id, an array of ids, or the selection's label. */
function selectionValue(normalized: string, type: string | undefined, context: PageContextEnvelope): unknown {
  const selection = context.selection.at(0)
  if (!selection) return undefined
  if (SELECTION_ID_NAMES.has(normalized)) return selection.id
  if (type === 'array' && SELECTION_IDS_NAMES.has(normalized)) return context.selection.map((item) => item.id)
  if (normalized === 'label' || normalized === 'name') return selection.label
  return undefined
}

function contextualValue(name: string, field: JsonSchema, context: PageContextEnvelope): unknown {
  const normalized = name.toLowerCase()
  const type = schemaType(field, field)

  const filtered = filterValue(name, normalized, context)
  if (filtered !== undefined) return filtered

  const paged = pageValue(normalized, type, context)
  if (paged !== undefined) return paged

  const timed = timeRangeValue(normalized, context)
  if (timed !== undefined) return timed

  return selectionValue(normalized, type, context)
}

function formValue(value: unknown, type: string | undefined): SchemaFormValue {
  if (type === 'boolean') return Boolean(value)
  if (type === 'object' || type === 'array') return JSON.stringify(value, null, 2)
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return `${value}`
  return JSON.stringify(value)
}

/** Build visible form state from schema defaults, constants, and the typed page context. */
export function createSchemaFormState(schema: JsonSchema, context: PageContextEnvelope): SchemaFormState {
  const state: SchemaFormState = {}
  for (const [name, rawField] of Object.entries(schema.properties ?? {})) {
    const field = resolveJsonSchema(rawField, schema)
    const type = schemaType(field, schema)
    const value = field.const ?? field.default ?? contextualValue(name, field, context)
    if (value !== undefined) state[name] = formValue(value, type)
    else if (type === 'boolean') state[name] = false
    else state[name] = ''
  }
  return state
}

function isEmpty(value: SchemaFormValue | undefined): boolean {
  return value === undefined || (typeof value === 'string' && value.trim() === '')
}

interface FieldResult {
  value?: unknown
  issue?: string
}

/** Parse one form value as a JSON-schema number/integer, or report why it can't be. */
function materializeNumber(type: string, raw: SchemaFormValue | undefined): FieldResult {
  const number = Number(raw)
  if (!Number.isFinite(number) || (type === 'integer' && !Number.isInteger(number))) {
    return { issue: `Expected ${type}` }
  }
  return { value: number }
}

/** Parse one form value as a JSON-schema object/array, or report why it can't be. */
function materializeJson(type: string, raw: SchemaFormValue | undefined): FieldResult {
  try {
    const parsed = JSON.parse(String(raw)) as unknown
    const validShape =
      type === 'array'
        ? Array.isArray(parsed)
        : Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed)
    return validShape ? { value: parsed } : { issue: `Expected a JSON ${type}` }
  } catch {
    return { issue: `Expected valid JSON ${type}` }
  }
}

/** Convert one field's raw form value into its typed proposal value, or a validation issue. */
function materializeField(
  name: string,
  field: JsonSchema,
  type: string | undefined,
  raw: SchemaFormValue | undefined,
  required: Set<string>,
): FieldResult {
  if (isEmpty(raw)) {
    return required.has(name) ? { issue: 'Required value is missing' } : {}
  }
  if (field.const !== undefined) return { value: field.const }
  if (type === 'boolean') return { value: typeof raw === 'boolean' ? raw : raw === 'true' }
  if (type === 'number' || type === 'integer') return materializeNumber(type, raw)
  if (type === 'object' || type === 'array') return materializeJson(type, raw)
  return { value: String(raw) }
}

/** Convert editable form state back into the exact typed proposal sent to preflight. */
export function materializeSchemaInputs(schema: JsonSchema, state: SchemaFormState): MaterializedInputs {
  const inputs: Record<string, unknown> = {}
  const issues: MaterializedInputs['issues'] = []
  const required = new Set(schema.required ?? [])

  for (const [name, rawField] of Object.entries(schema.properties ?? {})) {
    const field = resolveJsonSchema(rawField, schema)
    const type = schemaType(field, schema)
    const raw = field.const !== undefined ? formValue(field.const, type) : state[name]
    const result = materializeField(name, field, type, raw, required)

    if (result.issue) issues.push({ field: name, message: result.issue })
    else if (result.value !== undefined) inputs[name] = result.value
  }

  return { inputs, issues }
}
