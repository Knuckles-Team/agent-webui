// spec: WEBUI-APPS-R049.1.4
// spec: WEBUI-APPS-R049.1.3
// spec: WEBUI-APPS-R049.1.1
import { Suspense, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PrivateAppSurface } from '@/App'
import { ROUTES } from '@/lib/nav-registry'
import type { Identity } from '@/lib/auth'
const probes = vi.hoisted(() => ({ dashboard: vi.fn(), chat: vi.fn(), mounts: 0 }))
vi.mock('@/components/views/DashboardView', () => ({
  default: () => {
    probes.dashboard()
    return <p>Legacy dashboard</p>
  },
}))
vi.mock('@/components/workspace/OperateWorkspace', () => ({ default: () => <p>Operate evidence</p> }))
vi.mock('@/components/workspace/WorkWorkspace', () => ({ default: () => <p>Work evidence</p> }))
vi.mock('@/components/workspace/ExploreQueryWorkspace', () => ({ default: () => <p>Explore evidence</p> }))
vi.mock('@/components/app-sidebar', () => ({ AppSidebar: () => <p>Legacy sidebar</p> }))
vi.mock('@/components/WorkspaceNavigation', () => ({ WorkspaceNavigation: () => <p>Legacy navigation</p> }))
vi.mock('@/components/ConsentBanner', () => ({ ConsentBanner: () => null }))
vi.mock('@/components/ChatPanel', () => ({
  default: () => {
    probes.chat()
    const [instance] = useState(() => ++probes.mounts)
    return <p data-instance={instance}>Conversation</p>
  },
}))
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: vi.fn(),
  WebMcpProvider: ({ children }: { children: React.ReactNode }) => children,
  WorkspaceWebMcpControl: ({ collapsible }: { collapsible?: boolean }) => (
    <p data-collapsible={String(collapsible)}>Attended control</p>
  ),
}))
const identity: Identity = { userKey: 'reader', role: 'reader', ssoConfigured: true, needsSignIn: false, raw: null }
const route = ROUTES.find((entry) => entry.id === 'workspace.explore-proof')!
describe('new workspace composition', () => {
  it('does not mount the hidden dashboard and retains control on a denied route', async () => {
    render(
      <Suspense fallback={<p>Loading</p>}>
        <PrivateAppSurface
          route={route}
          currentView={route.id}
          isChat={false}
          isDashboard={false}
          routeAccessDenied
          identity={identity}
          isObjectDetail={false}
          objectId=""
        />
      </Suspense>,
    )
    expect(await screen.findByText('Attended control')).toBeInTheDocument()
    expect(screen.getByText('Conversation')).toBeInTheDocument()
    expect(screen.queryByText('Legacy sidebar')).not.toBeInTheDocument()
    expect(screen.queryByText('Legacy dashboard')).not.toBeInTheDocument()
    expect(probes.dashboard).not.toHaveBeenCalled()
  })
  it('does not admit command destinations while identity is unresolved', async () => {
    render(
      <Suspense fallback={<p>Loading</p>}>
        <PrivateAppSurface
          route={route}
          currentView={route.id}
          isChat={false}
          isDashboard={false}
          routeAccessDenied
          identity={identity}
          identityLoading
          isObjectDetail={false}
          objectId=""
        />
      </Suspense>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Find destination' }))
    expect(screen.getByRole('status')).toHaveTextContent('No matching available destinations')
  })
  it('retains one assistant while switching actual workspace contexts and keeps the rail outside scrolling content', async () => {
    const work = ROUTES.find((entry) => entry.id === 'workspace.work-proof')!
    const surface = (selected: typeof route) => (
      <Suspense fallback={<p>Loading</p>}>
        <PrivateAppSurface
          route={selected}
          currentView={selected.id}
          isChat={false}
          isDashboard={false}
          routeAccessDenied={false}
          identity={{ ...identity, role: 'user' }}
          isObjectDetail={false}
          objectId=""
        />
      </Suspense>
    )
    const view = render(surface(route))
    await screen.findByText('Explore evidence')
    const assistant = screen.getByText('Conversation')
    const instance = assistant.getAttribute('data-instance')
    view.rerender(surface(work))
    const workEvidence = await screen.findByText('Work evidence')
    expect(workEvidence.closest('.grid')).toHaveClass(
      'overflow-auto',
      'grid-rows-[minmax(14rem,1fr)_minmax(16rem,1fr)]',
    )
    expect(screen.getByText('Conversation')).toBe(assistant)
    expect(assistant).toHaveAttribute('data-instance', instance)
    expect(screen.getByRole('navigation', { name: 'Primary workspace contexts' }).closest('header')).toHaveClass(
      'shrink-0',
    )
    view.rerender(surface(ROUTES.find((entry) => entry.id === 'workspace.operate')!))
    await screen.findByText('Operate evidence')
    expect(screen.getByText('Conversation')).toBe(assistant)
    expect(assistant).toHaveAttribute('data-instance', instance)
    expect(screen.getByRole('link', { name: 'operate' })).toHaveAttribute('aria-current', 'page')
    expect(probes.dashboard).not.toHaveBeenCalled()
  })
  it('does not absorb legacy workspace routes before their capability migration', async () => {
    const files = ROUTES.find((entry) => entry.id === 'workspace.files')!
    render(
      <Suspense fallback={<p>Loading</p>}>
        <PrivateAppSurface
          route={files}
          currentView={files.id}
          isChat={false}
          isDashboard={false}
          routeAccessDenied
          identity={identity}
          isObjectDetail={false}
          objectId=""
        />
      </Suspense>,
    )
    expect(await screen.findByText('Legacy sidebar')).toBeInTheDocument()
    expect(screen.getByText('Legacy navigation')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Primary workspace contexts' })).not.toBeInTheDocument()
  })
})

// spec: WEBUI-APPS-R005.6.2
it.each(['chat.console', 'observability.dashboard'])(
  'places %s control in bounded flow rather than over the content',
  async (id) => {
    const selected = ROUTES.find((entry) => entry.id === id)!
    render(
      <Suspense fallback={<p>Loading</p>}>
        <PrivateAppSurface
          route={selected}
          currentView={id}
          isChat={id === 'chat.console'}
          isDashboard={id === 'observability.dashboard'}
          routeAccessDenied={false}
          identity={identity}
          isObjectDetail={false}
          objectId=""
        />
      </Suspense>,
    )
    const control = await screen.findByText('Attended control')
    expect(screen.getAllByText('Attended control')).toHaveLength(1)
    expect(control).toHaveAttribute('data-collapsible', 'true')
    expect(control.parentElement).toHaveClass('shrink-0', 'overflow-auto')
    expect(control.closest('.fixed')).toBeNull()
  },
)
