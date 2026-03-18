import { useState } from 'react'
import type { SyntheticEvent } from 'react'
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

export function ElicitationModal({ message, schema, onSubmit, onCancel, onDecline }: Props) {
  const [formData, setFormData] = useState<Record<string, unknown>>({})

  const renderField = (key: string, prop: JSONSchema) => {
    const type = prop.type ?? 'string'

    if (type === 'string') {
      return (
        <div key={key} className="grid w-full items-center gap-1.5 mb-4">
          <label htmlFor={key} className="text-sm font-medium leading-none">
            {prop.title ?? key}
          </label>
          <Input
            type="text"
            id={key}
            placeholder={prop.description ?? prop.title ?? key}
            value={(formData[key] as string | undefined) ?? ''}
            onChange={(e) => {
              setFormData({ ...formData, [key]: e.target.value })
            }}
          />
        </div>
      )
    }

    if (type === 'boolean') {
      return (
        <div key={key} className="flex items-center space-x-2 mb-4">
          <Checkbox
            id={key}
            checked={(formData[key] as boolean | undefined) ?? false}
            onCheckedChange={(checked) => {
              setFormData({ ...formData, [key]: !!checked })
            }}
          />
          <label
            htmlFor={key}
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            {prop.title ?? key}
          </label>
        </div>
      )
    }

    if (type === 'number' || type === 'integer') {
      return (
        <div key={key} className="grid w-full items-center gap-1.5 mb-4">
          <label htmlFor={key} className="text-sm font-medium leading-none">
            {prop.title ?? key}
          </label>
          <Input
            type="number"
            id={key}
            placeholder={prop.description ?? prop.title ?? key}
            value={(formData[key] as number | undefined) ?? ''}
            onChange={(e) => {
              setFormData({ ...formData, [key]: parseFloat(e.target.value) })
            }}
          />
        </div>
      )
    }

    return <div key={key}>Unsupported field type: {type}</div>
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
