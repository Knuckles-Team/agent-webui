import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Identity } from '@/lib/auth'
import { PageContextProvider } from '@/lib/page-context'
import { WebMcpProvider, WorkspaceWebMcpControl } from '../provider'
import type { AttendedArmClient, AttendedArmScope } from '../attended-arm'

class TestSocket {
  static instances: TestSocket[] = []
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  readonly sent: string[] = []
  readonly url: string
  readonly close = vi.fn(() => {
    this.readyState = 3
  })

  constructor(url: string) {
    this.url = url
    TestSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  open(): void {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }
}

const IDENTITY: Identity = {
  userKey: 'operator-1',
  role: 'admin',
  ssoConfigured: true,
  needsSignIn: false,
  raw: {
    authenticated: true,
    subject: 'operator-1',
    tenant: 'tenant-1',
    roles: ['operator'],
    webui_role: 'admin',
    expires_at: 4_000_000_000,
  },
}

let attendedReady = false
const ATTENDED_ARM_CLIENT: AttendedArmClient = {
  readiness: vi.fn(async () =>
    attendedReady
      ? { status: 'recent-auth' as const, expires_at: Date.now() / 1_000 + 300, route_id: 'graph' }
      : { status: 'none' as const },
  ),
  initiate: vi.fn(async () => ({ authorization_url: 'https://identity.example/authorize', expires_at: 1 })),
  finalize: vi.fn(async (scope: AttendedArmScope) => ({
    status: 'armed' as const,
    expires_at: Date.now() / 1_000 + 300,
    route_id: scope.route_id,
    registration_generation: scope.registration_generation,
    catalog_digest: scope.catalog_digest,
    tool_scope_digest: scope.tool_scope_digest,
  })),
  revoke: vi.fn(async () => undefined),
}

function Surface({ route = '/graph' }: { route?: string }) {
  return (
    <PageContextProvider route={route} view="graph">
      <WebMcpProvider identity={IDENTITY} attendedArmClient={ATTENDED_ARM_CLIENT} isAttendedGesture={() => true}>
        <main>Application</main>
      </WebMcpProvider>
    </PageContextProvider>
  )
}

function installModelContext(
  registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<void>,
): void {
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: { registerTool: vi.fn(registerTool) },
  })
}

async function armAndOpen(): Promise<TestSocket> {
  attendedReady = true
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Arm browser control' }))
  await waitFor(() => {
    expect(TestSocket.instances).toHaveLength(1)
  })
  const socket = TestSocket.instances[0]
  act(() => {
    socket.open()
  })
  return socket
}

beforeEach(() => {
  TestSocket.instances = []
  attendedReady = false
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  Object.defineProperty(document, 'permissionsPolicy', {
    configurable: true,
    value: { allowsFeature: vi.fn(() => true) },
  })
  vi.stubGlobal('WebSocket', TestSocket)
})

afterEach(() => {
  Reflect.deleteProperty(document, 'modelContext')
  vi.unstubAllGlobals()
})

describe('WebMCP provider remote projection', () => {
  it('defers hidden registrations and retires them across hide/show without removing manual content', async function hiddenRegistrationLifecycle() {
    const signals: AbortSignal[] = []
    installModelContext((_tool, options) => {
      if (options?.signal) signals.push(options.signal)
      return Promise.resolve()
    })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    render(<Surface />)
    expect(screen.getByRole('main')).toHaveTextContent('Application')
    expect(signals).toHaveLength(0)

    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => {
      expect(signals).toHaveLength(2)
    })
    expect(signals.every((signal) => !signal.aborted)).toBe(true)

    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => {
      expect(signals.every((signal) => signal.aborted)).toBe(true)
    })
    expect(screen.getByRole('main')).toHaveTextContent('Application')
    expect(screen.queryByRole('button', { name: 'Arm browser control' })).not.toBeInTheDocument()

    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => {
      expect(signals).toHaveLength(4)
    })
    expect(signals.slice(0, 2).every((signal) => signal.aborted)).toBe(true)
    expect(signals.slice(2).every((signal) => !signal.aborted)).toBe(true)
    expect(TestSocket.instances).toHaveLength(0)
  })

  it('does not revive pending registrations acknowledged after the document hides', async function hiddenPendingAcknowledgement() {
    const pending: { signal?: AbortSignal; acknowledge: () => void }[] = []
    installModelContext(
      (_tool, options) =>
        new Promise<void>((resolve) => {
          pending.push({ signal: options?.signal, acknowledge: resolve })
        }),
    )
    render(<Surface />)
    await waitFor(() => {
      expect(pending).toHaveLength(2)
    })
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {
      pending.forEach(({ acknowledge }) => {
        acknowledge()
      })
      await Promise.resolve()
    })
    expect(pending.every(({ signal }) => signal?.aborted)).toBe(true)
    expect(TestSocket.instances).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Arm browser control' })).not.toBeInTheDocument()
  })

  it('arms only after browser registration acknowledgement and reuses those exact definitions', async () => {
    const registered: { tool: Record<string, unknown>; signal?: AbortSignal }[] = []
    installModelContext((tool, options) => {
      registered.push({ tool, signal: options?.signal })
      return Promise.resolve()
    })
    render(<Surface />)

    await waitFor(() => {
      expect(registered).toHaveLength(2)
    })
    expect(registered.map(({ tool }) => String(tool.name).split('__')[0])).toEqual([
      'agent-webui.get-page-context',
      'agent-webui.navigate',
    ])
    expect(registered.every(({ tool }) => !('capability' in tool))).toBe(true)
    expect(TestSocket.instances).toHaveLength(0)

    const socket = await armAndOpen()
    const frames = socket.sent.map((frame) => JSON.parse(frame) as Record<string, unknown>)
    expect(frames.map((frame) => frame.type)).toEqual(['channel.open', 'catalog.register'])
    expect(frames[1]).toMatchObject({
      route_id: 'graph',
      tools: [
        { tool_id: 'agent-webui.get-page-context' },
        { tool_id: 'agent-webui.navigate', confirmation_policy: 'exact-request' },
      ],
    })
  })

  it('retires native registrations and the attended channel on route change', async () => {
    const signals: AbortSignal[] = []
    installModelContext((_tool, options) => {
      if (options?.signal) signals.push(options.signal)
      return Promise.resolve()
    })
    const rendered = render(<Surface />)
    await waitFor(() => {
      expect(signals).toHaveLength(2)
    })
    const socket = await armAndOpen()

    rendered.rerender(<Surface route="/explore" />)

    await waitFor(() => {
      expect(socket.close).toHaveBeenCalled()
      expect(signals.slice(0, 2).every((signal) => signal.aborted)).toBe(true)
    })
  })

  it('does not offer remote control without a verified SSO session', () => {
    installModelContext(() => Promise.resolve())
    render(
      <PageContextProvider route="/graph" view="graph">
        <WebMcpProvider identity={{ ...IDENTITY, ssoConfigured: false, raw: null }}>
          <main>Application</main>
        </WebMcpProvider>
      </PageContextProvider>,
    )

    expect(screen.queryByRole('button', { name: 'Arm browser control' })).not.toBeInTheDocument()
  })

  it('keeps the current registry available across React StrictMode effect replay', async () => {
    installModelContext(() => Promise.resolve())
    render(
      <StrictMode>
        <Surface />
      </StrictMode>,
    )

    const socket = await armAndOpen()

    expect(socket.sent.map((frame) => (JSON.parse(frame) as { type: unknown }).type)).toEqual([
      'channel.open',
      'catalog.register',
    ])
  })

  it('resumes an exact server-owned attended receipt after the callback reload', async () => {
    attendedReady = true
    installModelContext(() => Promise.resolve())
    render(<Surface />)

    await waitFor(() => {
      expect(TestSocket.instances).toHaveLength(1)
    })
    act(() => {
      TestSocket.instances[0].open()
    })

    expect(screen.getByRole('status')).toHaveTextContent('Arbora validation is pending')
  })
})

// spec: WEBUI-APPS-R049.1.1
it('places one attended control in workspace flow without implicitly arming it', async () => {
  installModelContext(async () => undefined)
  render(
    <PageContextProvider route="/workspace/explore" view="workspace.explore-proof">
      <WebMcpProvider identity={IDENTITY} controlPlacement="workspace" attendedArmClient={ATTENDED_ARM_CLIENT}>
        <main>
          <WorkspaceWebMcpControl />
        </main>
      </WebMcpProvider>
    </PageContextProvider>,
  )
  const control = await screen.findByRole('complementary', { name: 'Remote browser control' })
  expect(screen.getAllByRole('complementary', { name: 'Remote browser control' })).toHaveLength(1)
  expect(control).not.toHaveClass('fixed')
  expect(control.closest('main')).not.toBeNull()
  expect(TestSocket.instances).toHaveLength(0)
})
