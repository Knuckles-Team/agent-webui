import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONTACT_SUBMISSION_TIMEOUT_MS,
  createContactIdempotencyKey,
  isValidContactReceipt,
  submitContact,
  type ContactFields,
} from '@/lib/contact'

const FIELDS: ContactFields = {
  name: 'Test Operator',
  email: 'operator@example.test',
  subject: 'A bounded question',
  message: 'Please confirm this synthetic submission.',
}
const IDEMPOTENCY_KEY = 'contactreq_0123456789abcdef0123456789abcdef'

afterEach(() => {
  vi.useRealTimers()
})

describe('contact client boundary', () => {
  it('uses the same exact receipt contract as the thank-you page', () => {
    expect(isValidContactReceipt('contact_abcdefghijklmnop')).toBe(true)
    expect(isValidContactReceipt('x')).toBe(false)
    expect(isValidContactReceipt('provider-message-id')).toBe(false)
  })

  it('creates a bounded non-PII idempotency key', () => {
    expect(createContactIdempotencyKey()).toMatch(/^contactreq_[a-f0-9]{32}$/)
  })

  it('aborts a submission at the bounded client deadline', async () => {
    vi.useFakeTimers()
    let observedSignal: AbortSignal | undefined
    global.fetch = vi.fn((_input, init) => {
      observedSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    })

    const rejection = expect(submitContact(FIELDS, IDEMPOTENCY_KEY)).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(CONTACT_SUBMISSION_TIMEOUT_MS)

    await rejection
    expect(observedSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
