import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  createContactIdempotencyKey,
  storeContactReceipt,
  submitContact,
  validateContactFields,
  type ContactField,
  type ContactFieldErrors,
  type ContactFields,
} from '@/lib/contact'

const EMPTY_FIELDS: ContactFields = { name: '', email: '', subject: '', message: '' }

export function ContactForm() {
  const [fields, setFields] = useState<ContactFields>(EMPTY_FIELDS)
  const [errors, setErrors] = useState<ContactFieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const submissionInFlight = useRef(false)
  const idempotencyKey = useRef<string | null>(null)
  const requestController = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestController.current?.abort()
    }
  }, [])

  function setField(field: ContactField, value: string): void {
    setFields((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setSubmitError(null)
    idempotencyKey.current = null
  }

  function submissionFailed(): void {
    requestController.current = null
    submissionInFlight.current = false
    if (!mounted.current) return
    setSubmitting(false)
    setSubmitError('Your message could not be confirmed. Your entries are still here; please try again.')
  }

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (submissionInFlight.current) return
    const validation = validateContactFields(fields)
    setErrors(validation.errors)
    setSubmitError(null)
    if (!validation.data) {
      setSubmitError('Review the highlighted fields and try again.')
      return
    }
    submissionInFlight.current = true
    setSubmitting(true)
    idempotencyKey.current ??= createContactIdempotencyKey()
    const controller = new AbortController()
    requestController.current = controller
    submitContact(validation.data, idempotencyKey.current, controller.signal).then((receipt) => {
      requestController.current = null
      if (!mounted.current) return
      if (!storeContactReceipt(receipt)) {
        submissionFailed()
        return
      }
      submissionInFlight.current = false
      idempotencyKey.current = null
      setSubmitting(false)
      window.history.pushState({}, '', '/thank-you')
      window.dispatchEvent(new Event('history-state-changed'))
    }, submissionFailed)
  }

  return (
    <form className="space-y-5 rounded-lg border bg-card p-5" noValidate onSubmit={handleSubmit}>
      <div>
        <h2 className="text-lg font-semibold">Send a message</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Delivery is available only when this deployment has a governed destination and retention policy.
        </p>
      </div>
      <SubmissionError message={submitError} />
      <ContactInput
        field="name"
        label="Name"
        value={fields.name}
        error={errors.name}
        maxLength={80}
        autoComplete="name"
        onChange={setField}
      />
      <ContactInput
        field="email"
        label="Email"
        type="email"
        value={fields.email}
        error={errors.email}
        maxLength={254}
        autoComplete="email"
        onChange={setField}
      />
      <ContactInput
        field="subject"
        label="Subject"
        value={fields.subject}
        error={errors.subject}
        maxLength={120}
        onChange={setField}
      />
      <ContactMessage value={fields.message} error={errors.message} onChange={setField} />
      <ContactSubmit submitting={submitting} />
    </form>
  )
}

function SubmissionError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
      {message}
    </div>
  )
}

interface ContactInputProps {
  field: Exclude<ContactField, 'message'>
  label: string
  value: string
  error?: string
  type?: 'text' | 'email'
  maxLength: number
  autoComplete?: string
  onChange: (field: ContactField, value: string) => void
}

function ContactInput({
  field,
  label,
  value,
  error,
  type = 'text',
  maxLength,
  autoComplete,
  onChange,
}: ContactInputProps) {
  const id = `contact-${field}`
  const errorId = `${id}-error`
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        maxLength={maxLength}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          onChange(field, event.target.value)
        }}
      />
      <FieldError id={errorId} error={error} />
    </div>
  )
}

function ContactMessage({
  value,
  error,
  onChange,
}: {
  value: string
  error?: string
  onChange: (field: ContactField, value: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor="contact-message">
        Message
      </label>
      <Textarea
        id="contact-message"
        value={value}
        maxLength={4000}
        rows={7}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'contact-message-error' : undefined}
        onChange={(event) => {
          onChange('message', event.target.value)
        }}
      />
      <FieldError id="contact-message-error" error={error} />
    </div>
  )
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null
  return (
    <p id={id} className="text-sm text-destructive">
      {error}
    </p>
  )
}

function ContactSubmit({ submitting }: { submitting: boolean }) {
  return (
    <>
      <Button type="submit" disabled={submitting} aria-describedby={submitting ? 'contact-submit-status' : undefined}>
        {submitting && <LoaderCircle aria-hidden="true" className="animate-spin" />}
        {submitting ? 'Sending…' : 'Send message'}
      </Button>
      {submitting && (
        <p id="contact-submit-status" className="text-sm text-muted-foreground" role="status" aria-live="polite">
          Sending your message and waiting for delivery confirmation.
        </p>
      )}
    </>
  )
}
