import { useState } from 'react'
import type { ReactElement, SyntheticEvent } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'

interface JSONSchema {
  type?: string
  title?: string
  description?: string
  properties?: Record<string, JSONSchema>
}

interface Props {
  message: string
  schema: JSONSchema
  onSubmit: (data: Record<string, unknown>) => void
  onCancel: () => void
  onDecline: () => void
}

interface FieldProps {
  id: string
  prop: JSONSchema
  value: unknown
  onChange: (value: unknown) => void
}

function StringField({ id, prop, value, onChange }: FieldProps) {
  return (
    <div key={id} className="grid w-full items-center gap-1.5 mb-4">
      <label htmlFor={id} className="text-sm font-medium leading-none">
        {prop.title ?? id}
      </label>
      <Input
        type="text"
        id={id}
        placeholder={prop.description ?? prop.title ?? id}
        value={(value as string | undefined) ?? ''}
        onChange={(e) => {
          onChange(e.target.value)
        }}
      />
    </div>
  )
}

function BooleanField({ id, prop, value, onChange }: FieldProps) {
  return (
    <div key={id} className="flex items-center space-x-2 mb-4">
      <Checkbox
        id={id}
        checked={(value as boolean | undefined) ?? false}
        onCheckedChange={(checked) => {
          onChange(!!checked)
        }}
      />
      <label
        htmlFor={id}
        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        {prop.title ?? id}
      </label>
    </div>
  )
}

function NumberField({ id, prop, value, onChange }: FieldProps) {
  return (
    <div key={id} className="grid w-full items-center gap-1.5 mb-4">
      <label htmlFor={id} className="text-sm font-medium leading-none">
        {prop.title ?? id}
      </label>
      <Input
        type="number"
        id={id}
        placeholder={prop.description ?? prop.title ?? id}
        value={(value as number | undefined) ?? ''}
        onChange={(e) => {
          onChange(parseFloat(e.target.value))
        }}
      />
    </div>
  )
}

/** Dispatch table: JSON Schema `type` -> the field component that renders it.
 * `renderField` below falls back to an "unsupported" message for any type
 * not listed here (matches the original if-chain's default branch). */
const FIELD_COMPONENTS: Partial<Record<string, (props: FieldProps) => ReactElement>> = {
  string: StringField,
  boolean: BooleanField,
  number: NumberField,
  integer: NumberField,
}

export function ElicitationModal({ message, schema, onSubmit, onCancel, onDecline }: Props) {
  const [formData, setFormData] = useState<Record<string, unknown>>({})

  const renderField = (key: string, prop: JSONSchema) => {
    const type = prop.type ?? 'string'
    const Field = FIELD_COMPONENTS[type]
    if (!Field) return <div key={key}>Unsupported field type: {type}</div>
    return (
      <Field
        key={key}
        id={key}
        prop={prop}
        value={formData[key]}
        onChange={(value) => {
          setFormData({ ...formData, [key]: value })
        }}
      />
    )
  }

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          onCancel()
        }
      }}
    >
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Additional Information Needed</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="py-4">
          {schema.properties && Object.entries(schema.properties).map(([key, prop]) => renderField(key, prop))}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={onDecline}>
              Decline
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onCancel()
              }}
            >
              Cancel
            </Button>
            <Button type="submit">Submit</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
