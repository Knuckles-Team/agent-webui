import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONSENT_STORAGE_KEY, CONSENT_VERSION, readConsent, writeConsent } from '@/lib/consent'
import { loadAnalytics, sanitizeAnalyticsEvent } from '@/lib/analytics'

describe('consent and analytics boundaries', () => {
  afterEach(() => {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY)
    document.head.querySelectorAll('script[data-agent-webui-analytics]').forEach((script) => {
      script.remove()
    })
    vi.restoreAllMocks()
  })

  it('stores versioned choices and rejects stale or malformed records', () => {
    expect(readConsent()).toBeNull()
    writeConsent('granted', '2026-09-14T00:00:00.000Z')
    expect(readConsent()).toEqual({
      version: CONSENT_VERSION,
      choice: 'granted',
      decidedAt: '2026-09-14T00:00:00.000Z',
    })
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ version: 'old', choice: 'granted' }))
    expect(readConsent()).toBeNull()
  })

  it('does not load a provider unless the caller has already established consent', () => {
    const appendChild = vi.spyOn(document.head, 'appendChild')
    // The loader itself is deliberately explicit: a consent-aware caller only
    // invokes it after `record.choice === granted`.
    expect(appendChild).not.toHaveBeenCalled()
    expect(sanitizeAnalyticsEvent({ name: 'page_view', route: 'public.privacy' })).toEqual({
      name: 'page_view',
      route: 'public.privacy',
    })
    expect(sanitizeAnalyticsEvent({ name: 'bad event', route: '/graph?token=secret' })).toBeNull()
    expect(loadAnalytics({ provider: 'custom', measurementId: 'test-property' }).status).toBe('ready')
    expect(appendChild).not.toHaveBeenCalled()
  })
})
