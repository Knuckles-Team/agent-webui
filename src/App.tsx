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

import { useMemo, Suspense, lazy, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppSidebar } from './components/app-sidebar.tsx'
import { AuthModeBanner } from './components/AuthModeBanner.tsx'
import { ConsentBanner } from './components/ConsentBanner.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { PageHead } from './components/PageHead.tsx'
import { ResponsiveLimitation } from './components/ResponsiveLimitation.tsx'
import { SignInPanel } from './components/SignInPanel.tsx'
import { ThemeProvider } from './components/theme-provider.tsx'
import { SidebarProvider } from './components/ui/sidebar.tsx'
import { Toaster } from './components/ui/sonner.tsx'
import ChatPanel from './components/ChatPanel'
import { useIdentity, type Identity } from './lib/auth.ts'
import { MCPProvider } from './lib/mcp-context.tsx'
import {
  getRoutePageMetadata,
  NOT_FOUND_ROUTE,
  ROUTES,
  matchRoute,
  roleAtLeast,
  type RouteDef,
} from './lib/nav-registry.ts'
import { getDefaultPageActions, PageContextProvider, type PageContextSelection } from './lib/page-context.tsx'
import { cn } from './lib/utils.ts'
import { conversationOwnerKey } from '@/lib/chat-store'
import { WorkspaceCommandsProvider } from './components/workspace/WorkspaceCommands'
import { WorkspaceContextRail } from './components/workspace/WorkspaceContextRail'
import { WorkspaceViewport } from './components/workspace/WorkspaceViewport'
import { WorkspaceFrame } from './components/workspace/WorkspaceFrame'
import { WorkspaceNavigation } from './components/WorkspaceNavigation'
import { resolveWorkspaceRedirect, useWorkspaceEntry, useWorkspaceLocation } from './lib/workspace-navigation'
import { WebMcpProvider, WorkspaceWebMcpControl } from './lib/webmcp/provider.tsx'

// Lazy: only reachable behind `isObjectDetail`. A static import here pinned it
// into the entry chunk and defeated nav-registry's dynamic import of the same
// module (vite: "dynamically imported ... but also statically imported").
//
// Declared below the complete import block: placing a lazy initializer between
// imports breaks the `import-x/first` module-order contract.
const ObjectView = lazy(() => import('./components/views/ObjectView'))

/**
 * Global React Query client instance for managing server state.
 */
const queryClient = new QueryClient()

/** The always-mounted homepage route (visibility is toggled, never unmounted). */
const DASHBOARD_ROUTE = ROUTES.find((route) => route.id === 'observability.dashboard')
if (!DASHBOARD_ROUTE) throw new Error('nav-registry: observability.dashboard route is missing')
const DashboardElement = DASHBOARD_ROUTE.element
const dashboardPurpose = DASHBOARD_ROUTE.blurb

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
  const isNotFound = activeRoute === null
  const isChat = activeRoute?.id === 'chat.console'
  const isDashboard = activeRoute?.id === 'observability.dashboard'
  const isObjectDetail = activeRoute?.id === 'knowledge.object-detail'
  const objectId = isObjectDetail ? (match?.params.id ?? '') : ''
  const currentView = activeRoute ? legacyViewId(activeRoute) : 'not-found'
  return { activeRoute, isChat, isDashboard, isNotFound, isObjectDetail, objectId, currentView }
}

/** All URL-routing state derived for the current render: which `RouteDef` (if any)
 * matched, the bespoke-view flags App needs (chat/dashboard/object-detail), the
 * legacy `view` id, and the R9 role-gate verdict. Pulled out of `App` itself so the
 * component body reads as layout, not route arithmetic — this is pure derivation
 * plus two small effects/hooks, nothing stateful enough to need splitting further.
 */
function useRouteState() {
  const location = useWorkspaceLocation()
  const { identity, loading: identityLoading } = useIdentity()
  const admitted = !identityLoading && !identity.needsSignIn
  useWorkspaceEntry(identity.role, admitted)
  // Derive the destination before rendering, not one effect later. This keeps the
  // same Work instance (and unsaved drafts) when revisiting a compatibility link.
  const currentRoute = (admitted ? resolveWorkspaceRedirect(location, identity.role) : null) ?? location
  const pathname = useMemo(() => new URL(currentRoute, window.location.origin).pathname, [currentRoute])
  const match = useMemo(() => matchRoute(pathname), [pathname])
  const { activeRoute, isChat, isDashboard, isNotFound, isObjectDetail, objectId, currentView } =
    deriveRouteFlags(match)

  /** The route-guard half of R9: the sidebar already hides what `identity.role` cannot
   * reach, but a caller who navigates (or is deep-linked) straight to a hidden path must
   * still be stopped here rather than seeing the page render. While `/auth/session` is
   * in flight, hold off rendering a page-required-elsewhere page to avoid a flash of
   * content that then gets pulled back. */
  const routeAccessDenied = isRouteAccessDenied(activeRoute, identity, identityLoading)

  return {
    currentRoute,
    activeRoute,
    isChat,
    isDashboard,
    isNotFound,
    isObjectDetail,
    objectId,
    currentView,
    identity,
    identityLoading,
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

/** Routes whose page owns the complete heading and needs no generic shell heading. */
const ROUTES_WITH_OWN_HEADING = new Set<RouteDef['id']>([
  'workspace.explore-proof',
  'workspace.work-proof',
  'workspace.operate',
  'knowledge.atlas',
  'apps.markets.chart',
  'apps.markets.share',
])

function routeOwnsHeading(route: RouteDef): boolean {
  return ROUTES_WITH_OWN_HEADING.has(route.id)
}

function renderRouteHeading(route: RouteDef): ReactNode {
  return (
    <>
      {!routeOwnsHeading(route) && <h1 className="text-2xl font-bold mb-1">{route.label}</h1>}
      <p className="text-sm text-muted-foreground mb-4">{route.blurb}</p>
    </>
  )
}

/** The generic "other route" body: either the Object-detail view or the route's own
 * `RouteDef.element`. `route` is guaranteed non-null by the caller (see above). */
function renderRouteBody(route: RouteDef, isObjectDetail: boolean, objectId: string): ReactNode {
  if (isObjectDetail) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <>
          <p className="mb-4 text-sm text-muted-foreground">{route.blurb}</p>
          <ObjectView objectId={objectId} onNavigate={navigateToObjectId} />
        </>
      </Suspense>
    )
  }
  return (
    <>
      {renderRouteHeading(route)}
      <Suspense fallback={<RouteLoadingFallback />}>
        <route.element />
      </Suspense>
    </>
  )
}

function isRouteAccessDenied(activeRoute: RouteDef | null, identity: Identity, identityLoading: boolean): boolean {
  if (identityLoading || !activeRoute) return false
  if (getRoutePageMetadata(activeRoute).visibility === 'public') return false
  return !roleAtLeast(identity.role, activeRoute.minRole)
}

function shouldEnableMcpCatalog({
  isPublicRoute,
  isNotFound,
  identityLoading,
  identity,
  routeAccessDenied,
}: {
  isPublicRoute: boolean
  isNotFound: boolean
  identityLoading: boolean
  identity: Identity
  routeAccessDenied: boolean
}): boolean {
  return !isPublicRoute && !isNotFound && !identityLoading && !identity.needsSignIn && !routeAccessDenied
}

function PublicAppSurface({ pageRoute }: { pageRoute: RouteDef }) {
  return (
    <div className="min-h-screen">
      <Suspense fallback={<RouteLoadingFallback />}>
        <pageRoute.element />
      </Suspense>
    </div>
  )
}

function DashboardSurface({ isDashboard }: { isDashboard: boolean }) {
  return (
    <div className={cn('flex flex-col w-full h-full overflow-hidden', isDashboard ? 'block' : 'hidden')}>
      <Suspense fallback={<RouteLoadingFallback />}>
        <>
          <p className="shrink-0 px-6 pt-3 text-sm text-muted-foreground">{dashboardPurpose}</p>
          <DashboardElement />
        </>
      </Suspense>
    </div>
  )
}

interface RouteContentSurfaceProps {
  isChat: boolean
  isDashboard: boolean
  route: RouteDef
  routeAccessDenied: boolean
  identity: Identity
  isObjectDetail: boolean
  objectId: string
}

function RouteContentSurface({
  isChat,
  isDashboard,
  route,
  routeAccessDenied,
  identity,
  isObjectDetail,
  objectId,
}: RouteContentSurfaceProps) {
  if (isChat || isDashboard) return null
  // Compatibility entries never mount their retired standalone body, including while identity loads.
  if (route.redirects && !routeAccessDenied) return <RouteLoadingFallback />

  const body = routeAccessDenied ? (
    renderRouteAccessDenied(route, identity)
  ) : (
    <ResponsiveLimitation route={route}>{renderRouteBody(route, isObjectDetail, objectId)}</ResponsiveLimitation>
  )

  return (
    <div className="workspace-route-content flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-3 sm:p-5">
      <div className="mx-auto w-full">{body}</div>
    </div>
  )
}

function isWorkspaceProof(route: RouteDef): boolean {
  return ['workspace.entry', 'workspace.work-proof', 'workspace.explore-proof', 'workspace.operate'].includes(route.id)
}

function workspaceBodyClass(route: RouteDef): string {
  if (route.id === 'workspace.work-proof')
    return 'workspace-body grid min-h-0 flex-1 overflow-auto grid-rows-[minmax(14rem,1fr)_minmax(16rem,1fr)] lg:grid-cols-2 lg:grid-rows-[minmax(16rem,1fr)]'
  return isWorkspaceProof(route) ? 'workspace-body workspace-body-flow' : 'contents'
}

interface PrivateAppSurfaceProps extends Omit<RouteContentSurfaceProps, 'route'> {
  identityLoading?: boolean
  route: RouteDef
  currentView: string
}

export function PrivateAppSurface({
  route,
  currentView,
  identityLoading = false,
  ...routeContentProps
}: PrivateAppSurfaceProps) {
  return (
    <WorkspaceCommandsProvider
      enabled={!identityLoading && !routeContentProps.identity.needsSignIn}
      owner={conversationOwnerKey(routeContentProps.identity)}
      role={routeContentProps.identity.role}
    >
      <SidebarProvider defaultOpen>
        {!isWorkspaceProof(route) && <AppSidebar />}
        <WorkspaceViewport enabled={isWorkspaceProof(route)}>
          <AuthModeBanner identity={routeContentProps.identity} />
          {!isWorkspaceProof(route) && (
            <WorkspaceNavigation route={route} currentRole={routeContentProps.identity.role} />
          )}
          {isWorkspaceProof(route) && (
            <WorkspaceContextRail
              key={conversationOwnerKey(routeContentProps.identity)}
              active={
                route.id === 'workspace.work-proof' ? 'work' : route.id === 'workspace.operate' ? 'operate' : 'explore'
              }
              role={routeContentProps.identity.role}
            />
          )}
          <ConsentBanner placement="workspace" />
          <div className="max-h-[35dvh] shrink-0 overflow-auto">
            <WorkspaceWebMcpControl collapsible={!isWorkspaceProof(route)} />
          </div>

          {/* Legacy dashboard remains mounted only outside the redesigned workspace contexts */}
          {!isWorkspaceProof(route) && <DashboardSurface isDashboard={routeContentProps.isDashboard} />}
          <WorkspaceFrame enabled={isWorkspaceProof(route)}>
            <div className={workspaceBodyClass(route)}>
              <RouteContentSurface route={route} {...routeContentProps} />
              {/* One stable assistant instance across workspace contexts. */}
              <ChatPanel
                currentView={currentView}
                purpose={routeContentProps.isChat ? route.blurb : undefined}
                isPrimary={routeContentProps.isChat || route.id === 'workspace.work-proof'}
              />
            </div>
          </WorkspaceFrame>
        </WorkspaceViewport>
      </SidebarProvider>
    </WorkspaceCommandsProvider>
  )
}

interface AppSurfaceProps {
  pageRoute: RouteDef
  isPublicRoute: boolean
  isNotFound: boolean
  activeRoute: RouteDef | null
  isChat: boolean
  isDashboard: boolean
  routeAccessDenied: boolean
  identity: Identity
  identityLoading: boolean
  isObjectDetail: boolean
  objectId: string
  currentView: string
}

function AppSurface({
  pageRoute,
  isPublicRoute,
  isNotFound,
  activeRoute,
  isChat,
  isDashboard,
  routeAccessDenied,
  identity,
  identityLoading,
  isObjectDetail,
  objectId,
  currentView,
}: AppSurfaceProps) {
  if (isPublicRoute || isNotFound) return <PublicAppSurface pageRoute={pageRoute} />
  // No principal (or a session still owing its second factor): the server's
  // sign-in screens, never a page rendered under a guessed role.
  if (!identityLoading && identity.needsSignIn) return <SignInPanel identity={identity} />

  return (
    <PrivateAppSurface
      route={activeRoute!}
      currentView={currentView}
      isChat={isChat}
      isDashboard={isDashboard}
      routeAccessDenied={routeAccessDenied}
      identity={identity}
      identityLoading={identityLoading}
      isObjectDetail={isObjectDetail}
      objectId={objectId}
    />
  )
}

/**
 * Root Application Component
 *
 * Manages view state based on URL path and provides the necessary context
 * providers for theme, sidebar, MCP tools, and data fetching.
 */
/** Public, unknown and signed-out pages use floating chrome; signed-in workspaces keep it in flow. */
function isFloatingChrome(isPublicRoute: boolean, isNotFound: boolean, identityLoading: boolean, identity: Identity) {
  return isPublicRoute || isNotFound || (!identityLoading && identity.needsSignIn)
}

function showsPublicConsent(routeId: string, floatingChrome: boolean) {
  return routeId !== 'public.privacy' && floatingChrome
}

export default function App() {
  const {
    currentRoute,
    activeRoute,
    isChat,
    isDashboard,
    isNotFound,
    isObjectDetail,
    objectId,
    currentView,
    identity,
    identityLoading,
    routeAccessDenied,
  } = useRouteState()

  const baseSelection = useMemo<PageContextSelection[]>(
    () => (isObjectDetail && objectId ? [{ kind: 'ontology-object', id: objectId, label: objectId }] : []),
    [isObjectDetail, objectId],
  )
  const allowedActions = useMemo(() => getDefaultPageActions(currentView), [currentView])
  const pageRoute = activeRoute ?? NOT_FOUND_ROUTE
  const pageMetadata = getRoutePageMetadata(pageRoute)
  const isPublicRoute = pageMetadata.visibility === 'public'
  const usesFloatingChrome = isFloatingChrome(isPublicRoute, isNotFound, identityLoading, identity)
  const mcpCatalogEnabled = shouldEnableMcpCatalog({
    isPublicRoute,
    isNotFound,
    identityLoading,
    identity,
    routeAccessDenied,
  })

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MCPProvider enabled={mcpCatalogEnabled}>
          <ThemeProvider defaultTheme="system" storageKey="pydantic-chat-ui-theme">
            <PageContextProvider
              route={isWorkspaceProof(pageRoute) ? pageRoute.path : currentRoute}
              view={currentView}
              baseSelection={baseSelection}
              allowedActions={allowedActions}
            >
              <WebMcpProvider
                identity={identity}
                identityLoading={identityLoading}
                controlPlacement={usesFloatingChrome ? 'floating' : 'workspace'}
              >
                <PageHead
                  route={pageRoute}
                  pathname={new URL(currentRoute, window.location.origin).pathname}
                  authMode={identity.raw?.mode}
                />
                {showsPublicConsent(pageRoute.id, usesFloatingChrome) && <ConsentBanner />}
                <AppSurface
                  pageRoute={pageRoute}
                  isPublicRoute={isPublicRoute}
                  isNotFound={isNotFound}
                  activeRoute={activeRoute}
                  isChat={isChat}
                  isDashboard={isDashboard}
                  routeAccessDenied={routeAccessDenied}
                  identity={identity}
                  identityLoading={identityLoading}
                  isObjectDetail={isObjectDetail}
                  objectId={objectId}
                  currentView={currentView}
                />
              </WebMcpProvider>
            </PageContextProvider>
          </ThemeProvider>
        </MCPProvider>
        <Toaster richColors />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
