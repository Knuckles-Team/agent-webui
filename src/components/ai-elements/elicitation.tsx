import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoIcon, Loader2Icon } from 'lucide-react'

export interface ElicitationSchema {
  type: 'object'
  properties: Record<
    string,
    {
      type: string
      description?: string
      enum?: string[]
      [key: string]: unknown
    }
  >
  required?: string[]
}

export interface ElicitationProps {
  id: string
  message: string
  schema: ElicitationSchema | null
}

export const Elicitation: React.FC<ElicitationProps> = ({ id, message, schema }) => {
  const [formData, setFormData] = useState<Record<string, string | number | undefined>>({})
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<'pending' | 'resolved' | 'error'>('pending')

  const handleSubmit = async (action: 'accept' | 'decline' | 'cancel') => {
    setSubmitting(true)
    try {
      const result = action === 'accept' ? formData : { _action: action }
      const res = await fetch('/api/elicit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, result }),
      })
      if (res.ok) {
        setStatus('resolved')
      } else {
        setStatus('error')
      }
    } catch (error) {
      console.error('Failed to resolve elicitation:', error)
      setStatus('error')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'resolved') {
    return (
      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground italic border rounded-md bg-muted/5">
        <InfoIcon className="size-4" />
        Input provided successfully.
      </div>
    )
  }

  return (
    <Card className="max-w-md my-4 border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">Input Required</CardTitle>
        <CardDescription className="text-foreground">{message}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {schema?.properties &&
          Object.entries(schema.properties).map(([key, info]) => (
            <div key={key} className="space-y-1.5">
              <label
                htmlFor={`${id}-${key}`}
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground block"
              >
                {info.description ?? key}
              </label>
              {info.enum ? (
                <select
                  id={`${id}-${key}`}
                  className="w-full h-9 px-3 py-1 text-sm rounded-md border border-input bg-background"
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, [key]: e.target.value }))
                  }}
                  value={formData[key] ?? ''}
                >
                  <option value="">Select...</option>
                  {info.enum.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`${id}-${key}`}
                  type={info.type === 'integer' || info.type === 'number' ? 'number' : 'text'}
                  placeholder={info.description ?? key}
                  onChange={(e) => {
                    let val: string | number | undefined = e.target.value
                    if (info.type === 'integer' || info.type === 'number') {
                      val = info.type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value)
                      if (isNaN(val)) val = undefined
                    }
                    setFormData((prev) => ({ ...prev, [key]: val }))
                  }}
                  value={formData[key] ?? ''}
                />
              )}
            </div>
          ))}
        {!schema && (
          <Input
            placeholder="Your response..."
            onChange={(e) => {
              setFormData({ response: e.target.value })
            }}
          />
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-2 pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void handleSubmit('cancel')
          }}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void handleSubmit('decline')
          }}
          disabled={submitting}
        >
          Decline
        </Button>
        <Button
          size="sm"
          onClick={() => {
            void handleSubmit('accept')
          }}
          disabled={submitting}
        >
          {submitting && <Loader2Icon className="mr-2 size-3 animate-spin" />}
          Submit
        </Button>
      </CardFooter>
      {status === 'error' && (
        <CardFooter className="pt-0 text-xs text-destructive">Failed to send response. Please try again.</CardFooter>
      )}
    </Card>
  )
}
