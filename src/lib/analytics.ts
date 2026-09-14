import { useEffect, useMemo, useRef, useState } from 'react'
import type { RouteDef } from '@/lib/nav-registry'
import { getRoutePageMetadata } from '@/lib/nav-registry'
import { readConsent, useConsent } from '@/lib/consent'
import { getSiteConfig, type AnalyticsConfig } from '@/lib/site-config'

export type AnalyticsStatus = 'disabled' | 'loading' | 'ready' | 'error'

export interface SanitizedAnalyticsEvent {
  name: string
  route?: string
  cta?: string
}

export interface AnalyticsRuntime {
  status: AnalyticsStatus
  track: (event: SanitizedAnalyticsEvent) => void
}

const EVENT_NAME = /^[a-z][a-z0-9_.-]{0,63}$/
const SAFE_VALUE = /^[a-zA-Z0-9_.:/-]{1,128}$/

export function sanitizeAnalyticsEvent(event: SanitizedAnalyticsEvent): SanitizedAnalyticsEvent | null {
  if (!EVENT_NAME.test(event.name)) return null
  const result: SanitizedAnalyticsEvent = { name: event.name }
  if (event.route && SAFE_VALUE.test(event.route)) result.route = event.route
  if (event.cta && SAFE_VALUE.test(event.cta)) result.cta = event.cta
  return result
}

function scriptUrl(config: AnalyticsConfig): string | null {
  if (config.scriptUrl) return config.scriptUrl
  if (config.provider === 'ga4') {
    return `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.measurementId)}`
  }
  return null
}

function sendEvent(config: AnalyticsConfig, event: SanitizedAnalyticsEvent): void {
  const sanitized = sanitizeAnalyticsEvent(event)
  if (!sanitized || typeof window === 'undefined') return

  if (config.provider === 'ga4') {
    const maybeWindow = window as Window & {
      dataLayer?: unknown[]
      gtag?: (...args: unknown[]) => void
    }
    maybeWindow.dataLayer ??= []
    if (typeof maybeWindow.gtag === 'function') {
      maybeWindow.gtag('event', sanitized.name, {
        route: sanitized.route,
        cta: sanitized.cta,
      })
    } else {
      maybeWindow.dataLayer.push(['event', sanitized.name, sanitized])
    }
    return
  }

  if (config.provider === 'plausible') {
    const maybeWindow = window as Window & { plausible?: (name: string, options?: unknown) => void }
    maybeWindow.plausible?.(sanitized.name, { props: { route: sanitized.route, cta: sanitized.cta } })
    return
  }

  const maybeWindow = window as Window & { agentWebUiAnalytics?: (event: SanitizedAnalyticsEvent) => void }
  maybeWindow.agentWebUiAnalytics?.(sanitized)
}

let runtimeHandle: { config: AnalyticsConfig; track: (event: SanitizedAnalyticsEvent) => void } | null = null

/** Track a metadata-owned UI event when a consented runtime is active. */
export function trackAnalyticsEvent(event: SanitizedAnalyticsEvent): void {
  if (readConsent()?.choice !== 'granted') return
  runtimeHandle?.track(event)
}

/** Load a configured provider only after affirmative consent. */
export function loadAnalytics(config: AnalyticsConfig): { status: AnalyticsStatus; track: AnalyticsRuntime['track'] } {
  if (typeof document === 'undefined') return { status: 'disabled', track: () => undefined }
  if (
    runtimeHandle?.config.measurementId === config.measurementId &&
    runtimeHandle.config.provider === config.provider
  ) {
    return { status: 'ready', track: runtimeHandle.track }
  }

  const source = scriptUrl(config)
  if (!source && config.provider !== 'custom') return { status: 'disabled', track: () => undefined }

  if (source) {
    let script = document.head.querySelector<HTMLScriptElement>(
      `script[data-agent-webui-analytics="${config.provider}"]`,
    )
    if (!script) {
      script = document.createElement('script')
      script.async = true
      script.src = source
      script.dataset.agentWebuiAnalytics = config.provider
      document.head.appendChild(script)
    }
  }

  if (config.provider === 'ga4') {
    const maybeWindow = window as Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
    maybeWindow.dataLayer ??= []
    maybeWindow.gtag ??= (...args: unknown[]) => {
      maybeWindow.dataLayer?.push(args)
    }
    maybeWindow.gtag('js', new Date())
    maybeWindow.gtag('config', config.measurementId, { anonymize_ip: true })
  }

  const track = (event: SanitizedAnalyticsEvent) => {
    sendEvent(config, event)
  }
  runtimeHandle = { config, track }
  return { status: 'ready', track }
}

export function useAnalytics(route: RouteDef): AnalyticsRuntime {
  const { record } = useConsent()
  const config = useMemo(() => getSiteConfig().analytics, [])
  const [status, setStatus] = useState<AnalyticsStatus>(config ? 'disabled' : 'disabled')
  const trackRef = useRef<AnalyticsRuntime['track']>(() => undefined)
  const metadata = getRoutePageMetadata(route)

  useEffect(() => {
    if (record?.choice !== 'granted' || !config) {
      setStatus(config ? 'disabled' : 'disabled')
      trackRef.current = () => undefined
      return
    }
    try {
      const loaded = loadAnalytics(config)
      setStatus(loaded.status)
      trackRef.current = loaded.track
    } catch {
      setStatus('error')
      trackRef.current = () => undefined
    }
  }, [config, record?.choice])

  useEffect(() => {
    if (metadata.visibility !== 'public' || record?.choice !== 'granted' || status !== 'ready') return
    trackRef.current({ name: 'page_view', route: metadata.webmcpPageId })
  }, [metadata.visibility, metadata.webmcpPageId, record?.choice, status])

  return {
    status,
    track: (event) => {
      trackRef.current(event)
    },
  }
}
