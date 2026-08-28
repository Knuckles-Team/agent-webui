import { useEffect, useId, useMemo, useState, type SyntheticEvent } from 'react'
import { Braces, CheckCircle2 } from 'lucide-react'

import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import {
  createSchemaFormState,
  materializeSchemaInputs,
  resolveJsonSchema,
  schemaType,
  type JsonSchema,
  type SchemaFormState,
  type SchemaFormValue,
} from '../../lib/capability-forms'
import type { PageContextEnvelope } from '../../lib/page-context'

interface SchemaActionFormProps {
  schema: JsonSchema
  context: PageContextEnvelope
  busy?: boolean
  onDirty?: () => void
  onSubmit: (inputs: Record<string, unknown>) => void
}

function fieldLabel(name: string, schema: JsonSchema): string {
  if (schema.title) return schema.title
  return name.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function usesTextarea(name: string, schema: JsonSchema, type: string | undefined): boolean {
  if (schema.format === 'password' || schema.writeOnly || schema['x-sensitive']) return false
  return (
    type === 'object' ||
    type === 'array' ||
    ['query', 'cypher', 'content', 'prompt', 'description', 'expression'].includes(name.toLowerCase()) ||
    Boolean(schema.description && schema.description.length > 100)
  )
}

interface FieldRenderContext {
  formId: string
  state: SchemaFormState
  issues: { field: string; message: string }[]
  required: Set<string>
  update: (name: string, value: SchemaFormValue) => void
}

function renderConstField(name: string, label: string, field: JsonSchema) {
  return (
    <div key={name} className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">Fixed by the selected action schema</div>
      </div>
      <code className="rounded bg-muted px-2 py-1 text-xs">{JSON.stringify(field.const)}</code>
    </div>
  )
}

function renderBooleanField(name: string, label: string, field: JsonSchema, ctx: FieldRenderContext) {
  const { formId, state, issues, required, update } = ctx
  const id = `${formId}-${name}`
  const issue = issues.find((item) => item.field === name)
  return (
    <div key={name} className="space-y-1.5">
      <label htmlFor={id} className="flex items-start gap-2 rounded-lg border px-3 py-2.5">
        <Checkbox
          id={id}
          checked={Boolean(state[name])}
          onCheckedChange={(checked) => {
            update(name, checked === true)
          }}
        />
        <span>
          <span className="block text-sm font-medium">
            {label} {required.has(name) && <span className="text-destructive">*</span>}
          </span>
          {field.description && <span className="block text-xs text-muted-foreground">{field.description}</span>}
        </span>
      </label>
      {issue && <p className="text-xs text-destructive">{issue.message}</p>}
    </div>
  )
}

function inputTypeFor(field: JsonSchema, type: string | undefined): string {
  if (field.format === 'password' || field.writeOnly || field['x-sensitive']) return 'password'
  if (type === 'number' || type === 'integer') return 'number'
  if (field.format === 'date-time') return 'datetime-local'
  return 'text'
}

interface ValueWidgetCommon {
  id: string
  name: string
  value: string
  'aria-invalid': boolean
  'aria-describedby': string | undefined
}

function renderSelectWidget(
  name: string,
  field: JsonSchema,
  common: ValueWidgetCommon,
  required: Set<string>,
  update: FieldRenderContext['update'],
) {
  return (
    <select
      {...common}
      className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onChange={(event) => {
        update(name, event.target.value)
      }}
    >
      {!required.has(name) && <option value="">Not set</option>}
      {field.enum?.map((option) => (
        <option key={JSON.stringify(option)} value={String(option)}>
          {String(option)}
        </option>
      ))}
    </select>
  )
}

function renderTextareaWidget(
  name: string,
  type: string | undefined,
  common: ValueWidgetCommon,
  update: FieldRenderContext['update'],
) {
  return (
    <div className="relative">
      <Textarea
        {...common}
        className="min-h-24 resize-y pr-9 font-mono text-xs"
        onChange={(event) => {
          update(name, event.target.value)
        }}
      />
      {(type === 'object' || type === 'array') && (
        <Braces className="absolute right-3 top-3 size-4 text-muted-foreground" />
      )}
    </div>
  )
}

function renderInputWidget(
  name: string,
  field: JsonSchema,
  type: string | undefined,
  isSensitive: boolean,
  common: ValueWidgetCommon,
  update: FieldRenderContext['update'],
) {
  return (
    <Input
      {...common}
      type={inputTypeFor(field, type)}
      autoComplete={isSensitive ? 'new-password' : undefined}
      step={type === 'integer' ? 1 : type === 'number' ? 'any' : undefined}
      onChange={(event) => {
        update(name, event.target.value)
      }}
    />
  )
}

function renderValueWidget(
  name: string,
  field: JsonSchema,
  type: string | undefined,
  isSensitive: boolean,
  common: ValueWidgetCommon,
  ctx: FieldRenderContext,
) {
  if (field.enum) return renderSelectWidget(name, field, common, ctx.required, ctx.update)
  if (usesTextarea(name, field, type)) return renderTextareaWidget(name, type, common, ctx.update)
  return renderInputWidget(name, field, type, isSensitive, common, ctx.update)
}

function renderValueField(
  name: string,
  label: string,
  field: JsonSchema,
  type: string | undefined,
  ctx: FieldRenderContext,
) {
  const { formId, state, issues, required } = ctx
  const id = `${formId}-${name}`
  const issue = issues.find((item) => item.field === name)
  const isSensitive = field.format === 'password' || field.writeOnly === true || field['x-sensitive'] === true
  const common: ValueWidgetCommon = {
    id,
    name,
    value: String(state[name] ?? ''),
    'aria-invalid': Boolean(issue),
    'aria-describedby': field.description ? `${id}-description` : undefined,
  }

  return (
    <div key={name} className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label} {required.has(name) && <span className="text-destructive">*</span>}
      </label>
      {renderValueWidget(name, field, type, isSensitive, common, ctx)}
      {field.description && (
        <p id={`${id}-description`} className="text-xs text-muted-foreground">
          {field.description}
        </p>
      )}
      {issue && <p className="text-xs text-destructive">{issue.message}</p>}
    </div>
  )
}

function renderSchemaField(name: string, rawField: JsonSchema, schema: JsonSchema, ctx: FieldRenderContext) {
  const field = resolveJsonSchema(rawField, schema)
  const type = schemaType(field, schema)
  const label = fieldLabel(name, field)

  if (field.const !== undefined) return renderConstField(name, label, field)
  if (type === 'boolean') return renderBooleanField(name, label, field, ctx)
  return renderValueField(name, label, field, type, ctx)
}

export function SchemaActionForm({ schema, context, busy = false, onDirty, onSubmit }: SchemaActionFormProps) {
  const formId = useId()
  const initialState = useMemo(() => createSchemaFormState(schema, context), [context, schema])
  const [state, setState] = useState<SchemaFormState>(initialState)
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([])

  useEffect(() => {
    setState(initialState)
    setIssues([])
  }, [initialState])

  const update = (name: string, value: SchemaFormValue) => {
    setState((current) => ({ ...current, [name]: value }))
    setIssues((current) => current.filter((issue) => issue.field !== name))
    onDirty?.()
  }

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const materialized = materializeSchemaInputs(schema, state)
    setIssues(materialized.issues)
    if (materialized.issues.length === 0) onSubmit(materialized.inputs)
  }

  const fields = Object.entries(schema.properties ?? {})
  const required = new Set(schema.required ?? [])

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
        <span>
          Inputs are generated from the live schema. Matching selection, filters, route, and time fields are prefilled
          from the current <strong className="text-foreground">{context.view}</strong> context.
        </span>
      </div>

      {fields.length === 0 && (
        <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          This action takes no inputs.
        </div>
      )}

      {fields.map(([name, rawField]) =>
        renderSchemaField(name, rawField, schema, { formId, state, issues, required, update }),
      )}

      <Button type="submit" disabled={busy} className="w-full sm:w-auto">
        {busy ? 'Checking…' : 'Review preflight'}
      </Button>
    </form>
  )
}
