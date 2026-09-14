import { useEffect, useState, type ReactNode } from 'react'
import { isDynamicPath, roleAtLeast, ROUTES, type RouteDef } from '@/lib/nav-registry'

const MOBILE_BREAKPOINT = 768

/** Select an accessible registered route for an unsupported mobile page. */
export function findMobileAlternative(route: RouteDef): RouteDef | null {
  const candidates = ROUTES.filter(
    (candidate) =>
      candidate.id !== route.id &&
      candidate.mobile !== 'unsupported' &&
      !isDynamicPath(candidate.path) &&
      roleAtLeast(route.minRole, candidate.minRole),
  )
  return (
    candidates.find((candidate) => candidate.section === route.section) ??
    candidates.find((candidate) => candidate.id === 'observability.dashboard') ??
    candidates.find((candidate) => candidate.id === 'chat.console') ??
    null
  )
}

interface ResponsiveLimitationProps {
  route: RouteDef
  children: ReactNode
}

/**
 * Keeps desktop behavior unchanged while making unsupported mobile routes
 * explicit and recoverable. The route body is not mounted on mobile, so heavy
 * desktop-only views cannot issue requests behind an inaccessible surface.
 */
export function ResponsiveLimitation({ route, children }: ResponsiveLimitationProps) {
  // App is client-rendered, so reading the current viewport here avoids a
  // desktop-only flash of the mobile support check while the effect subscribes
  // to subsequent viewport changes. The `typeof` guard keeps the component
  // safe if it is rendered by a non-browser test or prerenderer.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false,
  )
  const alternative = findMobileAlternative(route)

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const sync = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    media.addEventListener('change', sync)
    sync()
    return () => {
      media.removeEventListener('change', sync)
    }
  }, [])

  if (route.mobile !== 'unsupported') return children
  if (!isMobile) return children

  return (
    <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-6" role="status" aria-live="polite">
      <h1 className="text-xl font-semibold">{route.label} needs a larger screen</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        This view is not supported on small screens because its controls need more space. Open it on a larger screen to
        continue.
      </p>
      {alternative && (
        <a
          href={alternative.path}
          className="mt-4 inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Open {alternative.label}
        </a>
      )}
    </section>
  )
}
