import { useEffect, useState } from 'react'

export const CONSENT_VERSION = 'overstory-consent-v1'
export const CONSENT_STORAGE_KEY = 'overstory.consent'
export const CONSENT_DISMISSED_KEY = 'overstory.consent-dismissed'
export const CONSENT_CHANGED_EVENT = 'overstory-consent-changed'

export type ConsentChoice = 'granted' | 'denied'

export interface ConsentRecord {
  version: string
  choice: ConsentChoice
  decidedAt: string
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

// A failed storage write still applies to this document and all mounted consumers.
// Never claim this in-memory fallback survives a full browser reload.
const volatileWrites = new Map<string, string>()

function readStored(key: string): string | null {
  if (volatileWrites.has(key)) return volatileWrites.get(key) ?? null
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    const target = storage()
    if (!target) throw new Error('Storage unavailable')
    target.setItem(key, value)
    volatileWrites.delete(key)
  } catch {
    volatileWrites.set(key, value)
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT))
}

export function consentStorageUnavailable(): boolean {
  return volatileWrites.size > 0
}

export function readConsentDismissed(): boolean {
  return readStored(CONSENT_DISMISSED_KEY) === CONSENT_VERSION
}

export function dismissConsentPrompt(): void {
  // Dismissal is presentation state only. It never grants or denies consent.
  writeStored(CONSENT_DISMISSED_KEY, CONSENT_VERSION)
}

function isConsentChoice(value: unknown): value is ConsentChoice {
  return value === 'granted' || value === 'denied'
}

export function readConsent(): ConsentRecord | null {
  try {
    const parsed: unknown = JSON.parse(readStored(CONSENT_STORAGE_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Partial<ConsentRecord>
    if (candidate.version !== CONSENT_VERSION || !isConsentChoice(candidate.choice)) return null
    if (typeof candidate.decidedAt !== 'string' || !candidate.decidedAt) return null
    return { version: CONSENT_VERSION, choice: candidate.choice, decidedAt: candidate.decidedAt }
  } catch {
    return null
  }
}

export function writeConsent(choice: ConsentChoice, now = new Date().toISOString()): ConsentRecord {
  const record: ConsentRecord = { version: CONSENT_VERSION, choice, decidedAt: now }
  writeStored(CONSENT_STORAGE_KEY, JSON.stringify(record))
  return record
}

export function revokeConsent(): ConsentRecord {
  return writeConsent('denied')
}

export function useConsent(): {
  record: ConsentRecord | null
  dismissed: boolean
  dismiss: () => void
  choose: (choice: ConsentChoice) => ConsentRecord
  revoke: () => ConsentRecord
} {
  const [record, setRecord] = useState<ConsentRecord | null>(() => readConsent())

  const [dismissed, setDismissed] = useState(readConsentDismissed)

  useEffect(() => {
    const refresh = () => {
      setRecord(readConsent())
      setDismissed(readConsentDismissed())
    }
    window.addEventListener(CONSENT_CHANGED_EVENT, refresh)
    const storageRefresh = (event: StorageEvent) => {
      const local = storage()
      if (!local || event.storageArea !== local) return
      if (event.key !== null && event.key !== CONSENT_STORAGE_KEY && event.key !== CONSENT_DISMISSED_KEY) return
      if (event.key === null) volatileWrites.clear()
      else volatileWrites.delete(event.key)
      refresh()
    }
    window.addEventListener('storage', storageRefresh)
    refresh()
    return () => {
      window.removeEventListener(CONSENT_CHANGED_EVENT, refresh)
      window.removeEventListener('storage', storageRefresh)
    }
  }, [])

  return {
    record,
    dismissed,
    dismiss: dismissConsentPrompt,
    choose: (choice) => {
      const next = writeConsent(choice)
      setRecord(next)
      return next
    },
    revoke: () => {
      const next = revokeConsent()
      setRecord(next)
      return next
    },
  }
}
