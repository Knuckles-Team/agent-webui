/**
 * @file App.tsx
 * @description Root application component for the Agent Web Quickstart.
 *
 * Orchestrates the overall layout, theme management, sidebar navigation,
 * and routing between different views (Chat, Files, Skills, Scheduling, etc.).
 * Initializes the React Query client and MCP context provider.
 *
 * Routing is derived from `src/lib/nav-registry.ts` (`ROUTES`) — that module is the
 * sole source of truth for what pages exist. Three routes get bespoke handling here
 * because they need something the generic zero-prop `RouteDef.element` contract can't
 * express: Dashboard (always mounted, toggled visible) and Chat (a persistent
 * prop-driven singleton, full-page on `/chat` and a drawer everywhere else — its session
 * list is read from the one store in `lib/chat-store.ts`) and Object detail (needs a
 * `:id` route param). Every other route is mounted generically from its `RouteDef`.
 *
 * Role enforcement (R9): `activeRoute.minRole` is checked against the signed-in identity
 * (`lib/auth.ts`, itself sourced from the server's `/auth/session`) before a route's
 * element is ever mounted — this is in addition to, not instead of, the sidebar hiding
 * routes the caller cannot use (`app-sidebar.tsx`) and the server enforcing the same
 * ladder in `WebUIAuthorizationMiddleware`. A caller who guesses a hidden path directly
 * still hits this guard.
 */

import { useEffect, useMemo, useState, Suspense, lazy, type ReactNode } from 'react'
import { AppSidebar } from './components/app-sidebar.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { ThemeProvider } from './components/theme-provider.tsx'
import { SidebarProvider, SidebarTrigger } from './components/ui/sidebar.tsx'
import { Toaster } from './components/ui/sonner.tsx'
import { cn } from './lib/utils.ts'
import ChatPanel from './components/ChatPanel'
import { ROUTES, matchRoute, roleAtLeast, type RouteDef } from './lib/nav-registry.ts'
import { useIdentity, type Identity } from './lib/auth.ts'

// Lazy: only reachable behind `isObjectDetail`. A static import here pinned it
// into the entry chunk and defeated nav-registry's dynamic import of the same
// module (vite: "dynamically imported ... but also statically imported").
//
// Declared BELOW every import, not among them: WD4-WEB-03 placed it mid-import
// block, which is exactly what raised the five `import-x/first` errors that
// WD4-WEB-00 cleared on main. Both changes are kept; only the placement moves.
const ObjectView = lazy(() => import('./components/views/ObjectView'))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MCPProvider } from './lib/mcp-context.tsx'
import { getDefaultPageActions, PageContextProvider, type PageContextSelection } from './lib/page-context.tsx'
// Lazy: only reachable behind `isObjectDetail`. A static import here pinned it
// into the entry chunk and defeated nav-registry's dynamic import of the same
// module (vite: "dynamically imported ... but also statically imported").
const ObjectView = lazy(() => import('./components/views/ObjectView'))

/**
 * Global React Query client instance for managing server state.
 */
const queryClient = new QueryClient()

/** The always-mounted homepage route (visibility is toggled, never unmounted). */
const DASHBOARD_ROUTE = ROUTES.find((route) => route.id === 'observability.dashboard')
if (!DASHBOARD_ROUTE) throw new Error('nav-registry: observability.dashboard route is missing')
const DashboardElement = DASHBOARD_ROUTE.element

/**
 * Maps a RouteDef id to the pre-registry `view` identifier that page-context.tsx's
 * per-view `allowedActions` table still keys off (`chat`, `files`, `graph`,
 * `temporalgraph`, `workflows`, `goals`, `object`, `dashboard`). Routes not listed
 * here just use their own RouteDef id as the view identifier — safe, since untouched
 * keys simply fall back to the common action set there.
 */
const LEGACY_VIEW_IDS: Record<string, string> = {
  'chat.console': 'chat',
  'workspace.files': 'files',
  'knowledge.graph': 'graph',
  'knowledge.temporal-graph': 'temporalgraph',
  'control-plane.workflows': 'workflows',
  'control-plane.goals': 'goals',
  'knowledge.object-detail': 'object',
  'observability.dashboard': 'dashboard',
}

function currentPathAndSearch(): string {
  return `${window.location.pathname}${window.location.search}`
}

function RouteLoadingFallback() {
  return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
}

/** Maps a matched route to the legacy `view` id (falling back to the route's own id). */
function legacyViewId(route: RouteDef): string {
  return LEGACY_VIEW_IDS[route.id] ?? route.id
}

/** The bespoke-view flags App needs (chat/dashboard/object-detail) plus the legacy
 * `view` id, derived once from a `matchRoute` result. Pure — no hooks — so it is
 * free to live outside `useRouteState` and keep that hook's own branch count down. */
function deriveRouteFlags(match: ReturnType<typeof matchRoute>) {
  const activeRoute = match?.route ?? null
  /** Unregistered paths fall back to Chat, matching the pre-registry behavior. */
  const isChat = !activeRoute || activeRoute.id === 'chat.console'
  const isDashboard = activeRoute?.id === 'observability.dashboard'
  const isObjectDetail = activeRoute?.id === 'knowledge.object-detail'
  const objectId = isObjectDetail ? (match?.params.id ?? '') : ''
  const currentView = activeRoute ? legacyViewId(activeRoute) : 'chat'
  return { activeRoute, isChat, isDashboard, isObjectDetail, objectId, currentView }
}

/** All URL-routing state derived for the current render: which `RouteDef` (if any)
 * matched, the bespoke-view flags App needs (chat/dashboard/object-detail), the
 * legacy `view` id, and the R9 role-gate verdict. Pulled out of `App` itself so the
 * component body reads as layout, not route arithmetic — this is pure derivation
 * plus two small effects/hooks, nothing stateful enough to need splitting further.
 */
function useRouteState() {
  /** Exact route included in the assistant's typed page-context envelope. */
  const [currentRoute, setCurrentRoute] = useState(currentPathAndSearch)

  /**
   * Effect hook to synchronize the current view with the browser URL path.
   * Listens for custom 'history-state-changed' events for reactive navigation.
   */
  useEffect(() => {
    const handleNavigation = () => {
      setCurrentRoute(currentPathAndSearch())
    }

    // Listen for custom navigation events emitted by sidebar/links
    window.addEventListener('history-state-changed', handleNavigation)
    handleNavigation() // Initial check on mount

    return () => {
      window.removeEventListener('history-state-changed', handleNavigation)
    }
  }, [])

  const pathname = useMemo(() => new URL(currentRoute, window.location.origin).pathname, [currentRoute])
  const match = useMemo(() => matchRoute(pathname), [pathname])
  const { activeRoute, isChat, isDashboard, isObjectDetail, objectId, currentView } = deriveRouteFlags(match)

  const { identity, loading: identityLoading } = useIdentity()
  /** The route-guard half of R9: the sidebar already hides what `identity.role` cannot
   * reach, but a caller who navigates (or is deep-linked) straight to a hidden path must
   * still be stopped here rather than seeing the page render. While `/auth/session` is
   * in flight, hold off rendering a page-required-elsewhere page to avoid a flash of
   * content that then gets pulled back. */
  const routeAccessDenied =
    !identityLoading && Boolean(activeRoute) && !roleAtLeast(identity.role, activeRoute!.minRole)

  return {
    currentRoute,
    activeRoute,
    isChat,
    isDashboard,
    isObjectDetail,
    objectId,
    currentView,
    identity,
    routeAccessDenied,
  }
}

/** The "Insufficient role" R9 denial panel. `route` is guaranteed non-null by the
 * caller: it only renders once `routeAccessDenied` is true, which itself requires
 * a matched route (see `useRouteState`). */
function renderRouteAccessDenied(route: RouteDef, identity: Identity): ReactNode {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
      <h1 className="text-xl font-bold mb-1">Insufficient role</h1>
      <p className="text-sm text-muted-foreground">
        {route.label} requires the <strong>{route.minRole}</strong> role or higher.{' '}
        {identity.needsSignIn
          ? 'Sign in with an account that has it.'
          : 'Your current role does not have access to this page.'}
      </p>
      {identity.needsSignIn && (
        <a href="/auth/login" className="text-sm text-primary underline mt-2 inline-block">
          Sign in
        </a>
      )}
    </div>
  )
}

function navigateToObjectId(id: string): void {
  window.history.pushState({}, '', `/object/${encodeURIComponent(id)}`)
  window.dispatchEvent(new Event('history-state-changed'))
}

/** The generic "other route" body: either the Object-detail view or the route's own
 * `RouteDef.element`. `route` is guaranteed non-null by the caller (see above). */
function renderRouteBody(route: RouteDef, isObjectDetail: boolean, objectId: string): ReactNode {
  if (isObjectDetail) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <ObjectView objectId={objectId} onNavigate={navigateToObjectId} />
      </Suspense>
    )
  }
  return (
    <>
      <h1 className="text-2xl font-bold mb-1">{route.label}</h1>
      <p className="text-sm text-muted-foreground mb-4">{route.blurb}</p>
      <Suspense fallback={<RouteLoadingFallback />}>
        <route.element />
      </Suspense>
    </>
  )
}

/**
 * Root Application Component
 *
 * Manages view state based on URL path and provides the necessary context
 * providers for theme, sidebar, MCP tools, and data fetching.
 */
export default function App() {
  const {
    currentRoute,
    activeRoute,
    isChat,
    isDashboard,
    isObjectDetail,
    objectId,
    currentView,
    identity,
    routeAccessDenied,
  } = useRouteState()

  const baseSelection = useMemo<PageContextSelection[]>(
    () => (isObjectDetail && objectId ? [{ kind: 'ontology-object', id: objectId, label: objectId }] : []),
    [isObjectDetail, objectId],
  )
  const allowedActions = useMemo(() => getDefaultPageActions(currentView), [currentView])

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MCPProvider>
          <ThemeProvider defaultTheme="system" storageKey="pydantic-chat-ui-theme">
            <PageContextProvider
              route={currentRoute}
              view={currentView}
              baseSelection={baseSelection}
              allowedActions={allowedActions}
            >
              <SidebarProvider defaultOpen>
                <AppSidebar />

                <div className="flex flex-col justify-center flex-1 h-screen overflow-hidden">
                  {/* Mobile Header: Only visible on small screens */}
                  <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 md:hidden">
                    <SidebarTrigger className="-ml-1" />
                    <div className="flex items-center gap-2 px-3">
                      <span className="text-lg">🤖</span>
                      <span className="text-sm font-bold truncate">Genius Agent</span>
                    </div>
                  </header>

                  {/* Dashboard View — Agent-OS Homepage (default landing, always mounted) */}
                  <div className={cn('flex flex-col w-full h-full overflow-hidden', isDashboard ? 'block' : 'hidden')}>
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <DashboardElement />
                    </Suspense>
                  </div>

                  {/* Every other registered route (rendered conditionally) */}
                  {!isChat && !isDashboard && (
                    <div className="flex flex-col flex-1 h-screen overflow-auto p-8">
                      <div className="mx-auto w-full">
                        {routeAccessDenied
                          ? renderRouteAccessDenied(activeRoute!, identity)
                          : renderRouteBody(activeRoute!, isObjectDetail, objectId)}
                      </div>
                    </div>
                  )}
                  {/* One stable assistant instance: full-page on /chat, drawer everywhere else. */}
                  <ChatPanel currentView={currentView} isPrimary={currentView === 'chat'} />
                </div>
              </SidebarProvider>
            </PageContextProvider>
          </ThemeProvider>
        </MCPProvider>
        <Toaster richColors />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
