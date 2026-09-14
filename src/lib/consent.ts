import { useEffect, useState } from 'react'

export const CONSENT_VERSION = 'agent-webui-consent-v1'
export const CONSENT_STORAGE_KEY = 'agent-webui.consent'
export const CONSENT_CHANGED_EVENT = 'agent-webui-consent-changed'

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

function isConsentChoice(value: unknown): value is ConsentChoice {
  return value === 'granted' || value === 'denied'
}

export function readConsent(): ConsentRecord | null {
  const stored = storage()
  if (!stored) return null
  try {
    const parsed: unknown = JSON.parse(stored.getItem(CONSENT_STORAGE_KEY) ?? 'null')
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
  const stored = storage()
  try {
    stored?.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record))
  } catch {
    // A blocked/private storage implementation should not prevent the user
    // from making a choice for this page lifetime.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT))
  return record
}

export function revokeConsent(): ConsentRecord {
  return writeConsent('denied')
}

export function useConsent(): {
  record: ConsentRecord | null
  choose: (choice: ConsentChoice) => ConsentRecord
  revoke: () => ConsentRecord
} {
  const [record, setRecord] = useState<ConsentRecord | null>(() => readConsent())

  useEffect(() => {
    const refresh = () => {
      setRecord(readConsent())
    }
    window.addEventListener(CONSENT_CHANGED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    refresh()
    return () => {
      window.removeEventListener(CONSENT_CHANGED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  return {
    record,
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
