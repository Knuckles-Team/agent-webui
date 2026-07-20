import type { JsonSchema } from './capabilities-api'
import type { PageContextEnvelope } from './page-context'

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
  return current && typeof current === 'object' ? (current as JsonSchema) : undefined
}

/** Resolve the useful local schema branch while retaining annotations from the wrapper. */
export function resolveJsonSchema(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const referenced = schema.$ref ? localRef(root, schema.$ref) : undefined
  const base = referenced ? { ...referenced, ...schema, $ref: undefined } : schema
  const variants = base.anyOf ?? base.oneOf
  const variant = variants?.find((item) => schemaType(item, root) !== 'null')
  return variant ? { ...base, ...resolveJsonSchema(variant, root), anyOf: undefined, oneOf: undefined } : base
}

export function schemaType(schema: JsonSchema, root: JsonSchema): string | undefined {
  if (schema.$ref) {
    const target = localRef(root, schema.$ref)
    if (target) return schemaType(target, root)
  }
  if (Array.isArray(schema.type)) return schema.type.find((item) => item !== 'null')
  if (schema.type) return schema.type
  const variants = schema.anyOf ?? schema.oneOf
  if (variants) {
    for (const variant of variants) {
      const type = schemaType(variant, root)
      if (type && type !== 'null') return type
    }
  }
  if (schema.properties) return 'object'
  return undefined
}

function contextualValue(name: string, field: JsonSchema, context: PageContextEnvelope): unknown {
  const normalized = name.toLowerCase()
  const type = schemaType(field, field)
  const selection = context.selection.at(0)

  if (name in context.filters) return context.filters[name]
  const matchingFilter = Object.entries(context.filters).find(([key]) => key.toLowerCase() === normalized)
  if (matchingFilter) return matchingFilter[1]

  if (normalized === 'page_context' || normalized === 'context') return type === 'object' ? context : undefined
  if (normalized === 'filters') return type === 'object' ? context.filters : undefined
  if (normalized === 'route' || normalized === 'page_route') return context.route
  if (normalized === 'view' || normalized === 'page_view') return context.view

  if (context.timeRange) {
    if (['as_of', 'asof', 'timestamp'].includes(normalized)) return context.timeRange.asOf
    if (['from', 'start', 'start_time'].includes(normalized)) return context.timeRange.start
    if (['to', 'end', 'end_time'].includes(normalized)) return context.timeRange.end
    if (normalized === 'timezone') return context.timeRange.timezone
  }

  if (!selection) return undefined
  if (['id', 'selection_id', 'node_id', 'object_id', 'memory_id', 'vertex_id', 'target'].includes(normalized)) {
    return selection.id
  }
  if (type === 'array' && ['ids', 'node_ids', 'object_ids', 'selection_ids'].includes(normalized)) {
    return context.selection.map((item) => item.id)
  }
  if (normalized === 'label' || normalized === 'name') return selection.label
  return undefined
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

/** Convert editable form state back into the exact typed proposal sent to preflight. */
export function materializeSchemaInputs(schema: JsonSchema, state: SchemaFormState): MaterializedInputs {
  const inputs: Record<string, unknown> = {}
  const issues: MaterializedInputs['issues'] = []
  const required = new Set(schema.required ?? [])

  for (const [name, rawField] of Object.entries(schema.properties ?? {})) {
    const field = resolveJsonSchema(rawField, schema)
    const type = schemaType(field, schema)
    const raw = field.const !== undefined ? formValue(field.const, type) : state[name]

    if (isEmpty(raw)) {
      if (required.has(name)) issues.push({ field: name, message: 'Required value is missing' })
      continue
    }

    if (field.const !== undefined) {
      inputs[name] = field.const
      continue
    }

    if (type === 'boolean') {
      inputs[name] = typeof raw === 'boolean' ? raw : raw === 'true'
      continue
    }
    if (type === 'number' || type === 'integer') {
      const number = Number(raw)
      if (!Number.isFinite(number) || (type === 'integer' && !Number.isInteger(number))) {
        issues.push({ field: name, message: `Expected ${type}` })
      } else inputs[name] = number
      continue
    }
    if (type === 'object' || type === 'array') {
      try {
        const parsed = JSON.parse(String(raw)) as unknown
        const validShape =
          type === 'array'
            ? Array.isArray(parsed)
            : Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed)
        if (!validShape) issues.push({ field: name, message: `Expected a JSON ${type}` })
        else inputs[name] = parsed
      } catch {
        issues.push({ field: name, message: `Expected valid JSON ${type}` })
      }
      continue
    }
    inputs[name] = String(raw)
  }

  return { inputs, issues }
}

/** Rank capabilities that match explicit actions and vocabulary from the current view. */
export function contextualCapabilityScore(
  capability: { id: string; title: string; actions: { id: string }[]; typed_io: { tags: string[] } },
  context: PageContextEnvelope,
): number {
  const actionIds = new Set(context.allowedActions.map((action) => action.id.toLowerCase()))
  let score = capability.actions.reduce(
    (total, action) => total + (actionIds.has(action.id.toLowerCase()) ? 100 : 0),
    0,
  )
  const terms = [
    capability.id,
    capability.title,
    ...capability.typed_io.tags,
    ...capability.actions.map((action) => action.id),
  ]
    .join(' ')
    .toLowerCase()
  if (terms.includes(context.view.toLowerCase())) score += 20
  for (const selected of context.selection) {
    if (terms.includes(selected.kind.toLowerCase())) score += 10
  }
  return score
}
