import { useEffect } from 'react'
import { readConsent } from '@/lib/consent'

/**
 * First-party browser RUM (EH-410, operator ruling 2026-09-24).
 *
 * The dashboard measures its own Core Web Vitals with the browser's
 * PerformanceObserver -- no third-party SDK -- and reports them once per page
 * view to the same-origin `POST /api/rum`. A report carries only the vitals,
 * the route path, the UTC day and a random session id that rotates every UTC
 * day; never an address, user agent, user id or query string. RUM is on by
 * default and off for a browser whose consent choice is `denied`.
 */

export const RUM_ENDPOINT = '/api/rum'
export const RUM_SESSION_KEY = 'graphos.rum.session'

export type VitalName = 'LCP' | 'INP' | 'FCP' | 'TTFB' | 'CLS'

export interface RumSample {
  session: string
  day: string
  route: string
  vitals: Partial<Record<VitalName, number>>
}

interface StoredSession {
  day: string
  session: string
}

const SAFE_ROUTE = /^\/[A-Za-z0-9_./:-]{0,127}$/

export function rumEnabled(): boolean {
  return readConsent()?.choice !== 'denied'
}

function randomSession(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return 'rum_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The UTC day's session id, minted afresh when the day changes. */
export function dailySession(now = new Date(), mint = randomSession): StoredSession {
  const day = now.toISOString().slice(0, 10)
  try {
    const stored = JSON.parse(window.localStorage.getItem(RUM_SESSION_KEY) ?? 'null') as StoredSession | null
    if (stored?.day === day && /^rum_[a-f0-9]{32}$/.test(stored.session)) return stored
  } catch {
    // Unreadable storage only means a fresh session for this page.
  }
  const fresh = { day, session: mint() }
  try {
    window.localStorage.setItem(RUM_SESSION_KEY, JSON.stringify(fresh))
  } catch {
    // Blocked storage: the session lasts this page lifetime.
  }
  return fresh
}

/** The route path only: no query string, no fragment, bounded and safe. */
export function safeRoute(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || '/'
  return SAFE_ROUTE.test(path) ? path : '/'
}

export function buildSample(route: string, vitals: RumSample['vitals'], now = new Date()): RumSample {
  const { day, session } = dailySession(now)
  return { session, day, route: safeRoute(route), vitals }
}

export function sendSample(sample: RumSample): void {
  if (!rumEnabled() || Object.keys(sample.vitals).length === 0) return
  const body = JSON.stringify(sample)
  if (typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(RUM_ENDPOINT, new Blob([body], { type: 'application/json' }))
    return
  }
  void fetch(RUM_ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } })
}

type Observed = Partial<Record<VitalName, number>>

function observe(type: string, onEntries: (entries: PerformanceEntryList) => void): void {
  try {
    new PerformanceObserver((list) => {
      onEntries(list.getEntries())
    }).observe({ type, buffered: true })
  } catch {
    // An unsupported entry type simply reports nothing.
  }
}

function observeVitals(vitals: Observed): void {
  observe('largest-contentful-paint', (entries) => {
    const last = entries.at(-1)
    if (last) vitals.LCP = last.startTime
  })
  observe('paint', (entries) => {
    const fcp = entries.find((entry) => entry.name === 'first-contentful-paint')
    if (fcp) vitals.FCP = fcp.startTime
  })
  observe('layout-shift', (entries) => {
    for (const entry of entries as unknown as { value: number; hadRecentInput: boolean }[]) {
      if (!entry.hadRecentInput) vitals.CLS = (vitals.CLS ?? 0) + entry.value
    }
  })
  observe('event', (entries) => {
    for (const entry of entries) vitals.INP = Math.max(vitals.INP ?? 0, entry.duration)
  })
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (navigation) vitals.TTFB = navigation.responseStart
}

/** Measure this page view and report it once, when the page is hidden. */
export function useRum(pathname: string): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !rumEnabled()) return
    const vitals: Observed = {}
    observeVitals(vitals)
    let sent = false
    const flush = (event: Event) => {
      if (sent || (event.type !== 'pagehide' && document.visibilityState !== 'hidden')) return
      sent = true
      sendSample(buildSample(pathname, { ...vitals }))
    }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', flush)
    }
  }, [pathname])
}
