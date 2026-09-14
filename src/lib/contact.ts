import { z } from 'zod'

export const CONTACT_RECEIPT_KEY = 'agent-webui.confirmed-receipt'
export const CONTACT_SUBMISSION_TIMEOUT_MS = 15_000
const CONTACT_RECEIPT_PATTERN = /^contact_[A-Za-z0-9_-]{16,56}$/
const CONTACT_IDEMPOTENCY_PATTERN = /^contactreq_[a-f0-9]{32}$/

export interface ContactFields {
  name: string
  email: string
  subject: string
  message: string
}

export type ContactField = keyof ContactFields
export type ContactFieldErrors = Partial<Record<ContactField, string>>

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(80, 'Name must be 80 characters or fewer.'),
  email: z.email('Enter a valid email address.').trim().max(254, 'Email must be 254 characters or fewer.'),
  subject: z.string().trim().min(1, 'Enter a subject.').max(120, 'Subject must be 120 characters or fewer.'),
  message: z.string().trim().min(1, 'Enter a message.').max(4000, 'Message must be 4,000 characters or fewer.'),
})

const receiptSchema = z.object({
  receipt: z.string().min(24).max(64).regex(CONTACT_RECEIPT_PATTERN),
})

export function validateContactFields(fields: ContactFields): {
  data: ContactFields | null
  errors: ContactFieldErrors
} {
  const parsed = contactSchema.safeParse(fields)
  if (parsed.success) return { data: parsed.data, errors: {} }
  const errors: ContactFieldErrors = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && field in fields && !errors[field as ContactField]) {
      errors[field as ContactField] = issue.message
    }
  }
  return { data: null, errors }
}

export function createContactIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `contactreq_${token}`
}

export async function submitContact(
  fields: ContactFields,
  idempotencyKey: string,
  callerSignal?: AbortSignal,
): Promise<string> {
  if (!CONTACT_IDEMPOTENCY_PATTERN.test(idempotencyKey)) throw new Error('contact-request-invalid')
  const controller = new AbortController()
  const abortFromCaller = () => {
    controller.abort()
  }
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  if (callerSignal?.aborted) controller.abort()
  const deadline = window.setTimeout(() => {
    controller.abort()
  }, CONTACT_SUBMISSION_TIMEOUT_MS)
  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ ...fields, idempotency_key: idempotencyKey }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('contact-submission-refused')
    const parsed = receiptSchema.safeParse(await response.json())
    if (!parsed.success) throw new Error('contact-receipt-invalid')
    return parsed.data.receipt
  } finally {
    window.clearTimeout(deadline)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}

export function isValidContactReceipt(receipt: string): boolean {
  return receiptSchema.shape.receipt.safeParse(receipt).success
}

export function storeContactReceipt(receipt: string): boolean {
  if (!isValidContactReceipt(receipt)) return false
  try {
    window.sessionStorage.setItem(CONTACT_RECEIPT_KEY, receipt)
    return true
  } catch {
    return false
  }
}
