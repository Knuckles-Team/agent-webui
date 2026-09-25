import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONSENT_STORAGE_KEY, writeConsent } from '@/lib/consent'
import { RUM_SESSION_KEY, buildSample, dailySession, safeRoute, sendSample } from '@/lib/rum'

describe('first-party RUM (EH-410)', () => {
  afterEach(() => {
    window.localStorage.removeItem(RUM_SESSION_KEY)
    window.localStorage.removeItem(CONSENT_STORAGE_KEY)
    vi.restoreAllMocks()
  })

  it('rotates the session id with the UTC day and keeps it within the day', () => {
    const mint = vi
      .fn()
      .mockReturnValueOnce('rum_' + 'a'.repeat(32))
      .mockReturnValueOnce('rum_' + 'b'.repeat(32))
    const morning = dailySession(new Date('2026-09-24T01:00:00Z'), mint)
    const evening = dailySession(new Date('2026-09-24T23:00:00Z'), mint)
    const tomorrow = dailySession(new Date('2026-09-25T00:00:01Z'), mint)
    expect(evening).toEqual(morning)
    expect(tomorrow.session).not.toBe(morning.session)
    expect(tomorrow.day).toBe('2026-09-25')
  })

  it('reports route templates only, never query strings or odd paths', () => {
    expect(safeRoute('/objects/:id?token=secret#x')).toBe('/objects/:id')
    expect(safeRoute('javascript:alert(1)')).toBe('/')
    const sample = buildSample('/graph?q=alice', { LCP: 1200 })
    expect(Object.keys(sample).sort()).toEqual(['day', 'route', 'session', 'vitals'])
    expect(sample.route).toBe('/graph')
  })

  it('is on by default, same-origin, and silent once consent is denied', () => {
    const beacon = vi.fn().mockReturnValue(true)
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
    sendSample(buildSample('/graph', { LCP: 900 }))
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(beacon.mock.calls[0][0]).toBe('/api/rum')
    writeConsent('denied')
    sendSample(buildSample('/graph', { LCP: 900 }))
    expect(beacon).toHaveBeenCalledTimes(1)
  })
})
