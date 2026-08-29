/**
 * @file AtlasWorkspace.tsx
 * @description The progressive-disclosure shell around the Atlas workbench.
 *
 * Knowledge still has specialist pages because some capabilities need dedicated
 * controls. They are not competing top-level destinations, though: the registry
 * marks them as Atlas routes and this component gives common tasks a short guided
 * path while keeping the specialist index one disclosure away.
 */
import type React from 'react'
import { ArrowRight, Compass, ExternalLink, SlidersHorizontal } from 'lucide-react'

import { AtlasWorkbench } from './AtlasWorkbench'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useIdentity } from '@/lib/auth'
import { roleAtLeast, routesForAtlas, type RouteDef } from '@/lib/nav-registry'

function navigateLocally(event: React.MouseEvent<HTMLAnchorElement>): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const url = new URL(event.currentTarget.href)
  if (url.origin !== window.location.origin) return
  window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`)
  window.dispatchEvent(new Event('history-state-changed'))
  event.preventDefault()
}

function AtlasRouteCard({ route }: { route: RouteDef }) {
  const Icon = route.icon
  return (
    <Card className="group h-full transition-colors hover:border-primary/50 motion-reduce:transition-none">
      <a
        href={route.path}
        aria-label={`${route.label}: ${route.blurb}`}
        className="flex h-full flex-col rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={navigateLocally}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <ArrowRight
              className="text-muted-foreground size-4 transition-transform motion-reduce:transition-none group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </div>
          <CardTitle className="text-base">{route.label}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          <CardDescription>{route.blurb}</CardDescription>
          {route.mobile === 'unsupported' && (
            <Badge variant="outline" className="w-fit">
              Desktop view
            </Badge>
          )}
        </CardContent>
      </a>
    </Card>
  )
}

function AtlasRouteGrid({ routes, loading = false }: { routes: RouteDef[]; loading?: boolean }) {
  if (loading) {
    return (
      <p className="text-muted-foreground text-sm" aria-hidden="true">
        Loading available Atlas tools…
      </p>
    )
  }
  if (routes.length === 0) {
    return <p className="text-muted-foreground text-sm">No routes are available for your current role.</p>
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {routes.map((route) => (
        <AtlasRouteCard key={route.id} route={route} />
      ))}
    </div>
  )
}

export function AtlasWorkspace() {
  const { identity, loading } = useIdentity()
  // `useIdentity` starts with a deliberately unresolved admin-shaped identity for
  // local development. Do not let that sentinel leak privileged Atlas links while
  // the signed-in role is still being resolved; server-side authorization remains
  // authoritative, but the index should be fail-closed as well.
  const guidedRoutes = loading
    ? []
    : routesForAtlas('guided').filter((route) => roleAtLeast(identity.role, route.minRole))
  const expertRoutes = loading
    ? []
    : routesForAtlas('expert').filter((route) => roleAtLeast(identity.role, route.minRole))

  return (
    <div className="space-y-6" data-testid="atlas-workspace">
      <header className="space-y-2" data-testid="atlas-introduction">
        <div className="flex items-center gap-2">
          <Compass className="size-5 text-primary" aria-hidden="true" />
          <Badge variant="secondary">Knowledge workspace</Badge>
        </div>
        <h1 className="text-2xl font-semibold">Atlas</h1>
        <p className="max-w-3xl text-muted-foreground">
          One place to explore connected objects, documents, tables, and graph data. Start with a guided view, or open
          the expert tools when you need a focused surface.
        </p>
        {loading && (
          <p className="text-muted-foreground text-sm" role="status" aria-live="polite">
            Loading available Atlas tools…
          </p>
        )}
      </header>

      <section aria-labelledby="atlas-guided-title" className="space-y-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="atlas-guided-title" className="text-lg font-semibold">
              Start with a question
            </h2>
            <Badge variant="outline">Guided</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            These starting points keep the first step simple. You can always return here for another kind of answer.
          </p>
        </div>
        <nav aria-label="Guided Atlas starting points">
          <AtlasRouteGrid routes={guidedRoutes} loading={loading} />
        </nav>
        <a
          href="#atlas-workbench"
          className="text-primary inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open the unified Atlas workbench
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </a>
      </section>

      <details className="rounded-lg border" data-testid="atlas-expert-tools">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />
          <span>Expert tools</span>
          <span className="text-muted-foreground text-sm font-normal">Focused controls for advanced exploration</span>
        </summary>
        <div className="border-t p-4">
          <nav aria-label="Atlas expert tools">
            <AtlasRouteGrid routes={expertRoutes} loading={loading} />
          </nav>
          <p className="text-muted-foreground mt-3 flex items-center gap-1 text-xs">
            <ExternalLink className="size-3" aria-hidden="true" />
            These links preserve the specialist routes for bookmarks, capability checks, and deep links.
          </p>
        </div>
      </details>

      <section id="atlas-workbench" aria-labelledby="atlas-workbench-title" className="space-y-3">
        <div>
          <h2 id="atlas-workbench-title" className="text-lg font-semibold">
            Explore across sources
          </h2>
          <p className="text-muted-foreground text-sm">
            Choose a source, add filters, and switch between table, JSON, and graph renderings from one query.
          </p>
        </div>
        <AtlasWorkbench />
      </section>
    </div>
  )
}
