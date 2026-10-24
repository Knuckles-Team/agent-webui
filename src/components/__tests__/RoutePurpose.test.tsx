// spec: WEBUI-APPS-R005.6.2
import { lazy, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PrivateAppSurface } from '@/App'
import PrivacyPage from '@/components/public/PrivacyPage'
import TermsPage from '@/components/public/TermsPage'
import { PublicPageLayout } from '@/components/public/PublicPageLayout'
import { getRoutePageMetadata, ROUTE_REGISTRY } from '@/lib/nav-registry'
import { PageContextProvider } from '@/lib/page-context'
const content = lazy(async () => ({ default: () => <h2>Feature-owned heading</h2> }))
vi.mock('@/Chat', () => ({ default: () => <p>Conversation content</p> }))
vi.mock('@/components/views/ObjectView', () => ({ default: () => <h2>Object-owned heading</h2> }))
vi.mock('@/components/views/DashboardView', () => ({ default: () => <h2>Dashboard-owned heading</h2> }))
vi.mock('@/components/app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/WorkspaceNavigation', () => ({ WorkspaceNavigation: () => null }))
vi.mock('@/components/ConsentBanner', () => ({
  ConsentBanner: () => null,
  PrivacyConsentSettings: () => <button>Privacy choices</button>,
}))
vi.mock('@/lib/webmcp/provider', () => ({
  WebMcpProvider: ({ children }: { children: ReactNode }) => children,
  WorkspaceWebMcpControl: () => null,
  useWebMcpToolSet: vi.fn(),
}))
describe('registry purpose is visible in every shell path', () => {
  for (const definition of ROUTE_REGISTRY) {
    it(definition.id, async () => {
      const route = { ...definition, element: content }
      if (getRoutePageMetadata(route).visibility === 'public') {
        render(
          <PublicPageLayout route={route} title={route.label}>
            Public content
          </PublicPageLayout>,
        )
      } else {
        render(
          <PageContextProvider route={route.path} view={route.id}>
            <PrivateAppSurface
              route={route}
              currentView={route.id}
              isChat={route.id === 'chat.console'}
              isDashboard={route.id === 'observability.dashboard'}
              routeAccessDenied={false}
              identity={{
                userKey: 'purpose-fixture',
                role: 'admin',
                ssoConfigured: true,
                needsSignIn: false,
                raw: null,
              }}
              isObjectDetail={route.id === 'knowledge.object-detail'}
              objectId="entity"
            />
          </PageContextProvider>,
        )
      }
      expect(await screen.findByText(route.blurb)).toBeVisible()
      if (route.redirects) expect(screen.queryByText('Feature-owned heading')).not.toBeInTheDocument()
    })
  }
})

// spec: WEBUI-APPS-R005.6.2
it.each([
  ['public.privacy', PrivacyPage, 'The reviewed privacy policy for this deployment.'],
  ['public.terms', TermsPage, 'The reviewed terms and safe agent-control boundaries for this deployment.'],
] as const)('keeps %s purpose without a redundant description', (id, Page, redundant) => {
  render(<Page />)
  const route = ROUTE_REGISTRY.find((entry) => entry.id === id)!
  expect(screen.getAllByText(route.blurb)).toHaveLength(1)
  expect(screen.queryByText(redundant)).not.toBeInTheDocument()
})

it('preserves distinct public page description content', () => {
  const route = ROUTE_REGISTRY.find((entry) => entry.id === 'public.contact')!
  render(
    <PublicPageLayout route={route} title="Contact" description="Deployment contact details.">
      Contact form
    </PublicPageLayout>,
  )
  expect(screen.getByText(route.blurb)).toBeVisible()
  expect(screen.getByText('Deployment contact details.')).toBeVisible()
})
