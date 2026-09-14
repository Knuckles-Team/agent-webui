import type { MouseEvent } from 'react'
import type { RouteDef } from '@/lib/nav-registry'
import { getRoutePageMetadata } from '@/lib/nav-registry'
import { useAnalytics } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import { MOBILE_SURFACE, mobileSurfaceStyle } from './mobile-surface'

function followLocalNavigation(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const target = new URL(event.currentTarget.href)
  if (target.origin !== window.location.origin) return
  event.preventDefault()
  window.history.pushState({}, '', `${target.pathname}${target.search}${target.hash}`)
  window.dispatchEvent(new Event('history-state-changed'))
}

/** Metadata-driven sticky action for public mobile flows. */
export function MobileCta({ route }: { route: RouteDef }) {
  const metadata = getRoutePageMetadata(route)
  const analytics = useAnalytics(route)
  const cta = metadata.cta
  if (!cta || route.mobile === 'unsupported') return null

  return (
    <div
      className="fixed inset-x-0 bottom-0 border-t bg-background/95 px-4 shadow-lg backdrop-blur md:hidden motion-reduce:transition-none"
      style={{
        ...mobileSurfaceStyle,
        paddingBottom: `calc(${MOBILE_SURFACE.safeAreaBottom} + ${MOBILE_SURFACE.ctaPadding})`,
        paddingTop: MOBILE_SURFACE.ctaPadding,
        zIndex: MOBILE_SURFACE.ctaZIndex,
      }}
      data-mobile-surface="cta"
    >
      <Button
        asChild
        className="h-auto w-full touch-manipulation text-base"
        style={{ minHeight: MOBILE_SURFACE.ctaButtonHeight }}
        onClick={() => {
          analytics.track({ name: cta.eventName, route: metadata.webmcpPageId, cta: cta.label })
        }}
      >
        <a href={cta.target} onClick={followLocalNavigation} aria-label={cta.label}>
          {cta.label}
        </a>
      </Button>
    </div>
  )
}
