// spec: OVERSTORY-APPS-R049.1.3, OVERSTORY-APPS-R004.4
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PageContextProvider } from '@/lib/page-context'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import { ApiError } from '@/lib/api-validation'
import { workApi } from '@/lib/work-workspace'
import { readCurrentPlan } from '@/lib/current-plan'
import WorkWorkspace from '../WorkWorkspace'
const state = vi.hoisted(() => ({
  expires: 1,
  role: 'user',
  user: 'owner',
  tenant: 'tenant',
  csrf: 'csrf-a',
  tools: new Map<string, WebMcpToolDefinition>(),
}))
vi.mock('@/lib/current-plan', async (original) => ({
  ...(await original<object>()),
  readCurrentPlan: vi.fn(async () => ({ availability: 'unavailable', snapshot: null })),
}))
vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({
    loading: false,
    identity: {
      userKey: state.user,
      role: state.role,
      needsSignIn: false,
      raw: { tenant: state.tenant, csrf_token: state.csrf, authenticated: true, roles: [], expires_at: state.expires },
    },
  }),
}))
vi.mock('@/lib/chat-store', async (original) => ({ ...(await original<object>()), useConversations: () => [] }))
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: (tools: WebMcpToolDefinition[]) => {
    for (const tool of tools) state.tools.set(tool.name, tool)
  },
}))
vi.mock('@/lib/work-workspace', async (original) => ({
  ...(await original<object>()),
  workApi: {
    listTasks: vi.fn(async () => [{ id: 'task-a' }]),
    getTask: vi.fn(async () => ({ id: 'task-a', status: { state: 'working' } })),
    listRuns: vi.fn(async () => ({ ok: true, data: { result: [] } })),
    getRun: vi.fn(),
    cancelTask: vi.fn(),
  },
}))
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  function tree() {
    return (
      <QueryClientProvider client={client}>
        <PageContextProvider route="/workspace/work" view="workspace.work-proof">
          <WorkWorkspace />
        </PageContextProvider>
      </QueryClientProvider>
    )
  }
  const view = render(tree())
  return {
    client,
    rerender: () => {
      view.rerender(tree())
    },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(workApi.getTask).mockResolvedValue({ id: 'task-a', status: { state: 'working' } })
  state.tools.clear()
  state.expires = 1
  state.role = 'user'
  state.user = 'owner'
  state.tenant = 'tenant'
  state.csrf = 'csrf-a'
  window.history.replaceState({}, '', '/workspace/work?task=task-a')
})
describe('Work admission and authoritative task availability', () => {
  it.each(['principal', 'tenant', 'expiry', 'csrf'] as const)(
    'withdraws a current plan across observed %s admission changes',
    async (change) => {
      vi.mocked(workApi.getTask).mockResolvedValue({ id: 'task-a', metadata: { arbora: { runId: 'run-a' } } })
      vi.mocked(readCurrentPlan).mockResolvedValueOnce({
        availability: 'available',
        snapshot: {
          run_id: 'run-a',
          revision: 1,
          observed_at: new Date(Date.now() - 1000).toISOString(),
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          items: [{ text: 'Private plan', status: 'pending' }],
        },
      })
      const view = setup()
      await screen.findByText('Private plan')
      const pending = new Promise<never>(() => {
        /* Deliberately pending new admission. */
      })
      vi.mocked(workApi.getTask).mockReturnValueOnce(pending)
      if (change === 'principal') state.user = 'other-owner'
      if (change === 'tenant') state.tenant = 'other-tenant'
      if (change === 'expiry') state.expires = 2
      if (change === 'csrf') state.csrf = 'csrf-b'
      view.rerender()
      expect(screen.queryByText('Private plan')).not.toBeInTheDocument()
      expect(workApi.getTask).toHaveBeenCalledTimes(2)
      expect(
        JSON.stringify(
          view.client
            .getQueryCache()
            .getAll()
            .map((query) => query.queryKey),
        ),
      ).not.toContain('csrf-a')
    },
  )
  it('does not reuse a fresh cached task after observed admission renewal', async () => {
    const view = setup()
    await screen.findByText('Status: working')
    const held = state.tools.get('overstory.work.cancel-task.review')!
    vi.mocked(workApi.getTask).mockImplementationOnce(
      () =>
        new Promise(() => {
          /* Keep the renewed read pending to inspect cache withdrawal. */
        }),
    )
    state.expires = 2
    view.rerender()
    expect(screen.queryByText('Status: working')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel task…' })).not.toBeInTheDocument()
    expect(workApi.getTask).toHaveBeenCalledTimes(2)
    await expect(held.execute({}, { signal: new AbortController().signal })).rejects.toThrow('stale')
  })
  it('retires held cancellation review while an authoritative refresh is pending', async () => {
    const { client } = setup()
    await screen.findByRole('button', { name: 'Cancel task…' })
    const held = state.tools.get('overstory.work.cancel-task.review')!
    await act(async () => {
      await held.execute({}, { signal: new AbortController().signal })
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    let resolve!: (value: { id: string; status: { state: string } }) => void
    vi.mocked(workApi.getTask).mockReturnValueOnce(
      new Promise((yes) => {
        resolve = yes
      }),
    )
    let refreshed!: Promise<void>
    await act(async () => {
      refreshed = client.invalidateQueries({ queryKey: ['work-task'] })
    })
    await screen.findByText('Loading task…')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel task…' })).toBeDisabled()
    await expect(held.execute({}, { signal: new AbortController().signal })).rejects.toThrow('stale')
    await act(async () => {
      resolve({ id: 'task-a', status: { state: 'completed' } })
      await refreshed
    })
    await screen.findByText('Status: completed')
    expect(screen.getByRole('button', { name: 'Cancel task…' })).toBeDisabled()
    expect(workApi.cancelTask).not.toHaveBeenCalled()
  })
  it('withdraws cancellation after a failed authoritative task refresh despite cached data', async () => {
    const { client } = setup()
    await screen.findByRole('button', { name: 'Cancel task…' })
    vi.mocked(workApi.getTask).mockRejectedValueOnce(new ApiError(403, 'revoked'))
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['work-task'] })
    })
    await screen.findByText(/Task detail could not be loaded/)
    expect(screen.queryByRole('button', { name: 'Cancel task…' })).not.toBeInTheDocument()
    expect(workApi.cancelTask).not.toHaveBeenCalled()
  })
  it('retires held cancellation review on role downgrade', async () => {
    const view = setup()
    await screen.findByRole('button', { name: 'Cancel task…' })
    const held = state.tools.get('overstory.work.cancel-task.review')!
    state.role = 'reader'
    view.rerender()
    expect(screen.getByRole('alert')).toHaveTextContent('not available')
    await expect(held.execute({}, { signal: new AbortController().signal })).rejects.toThrow('stale')
    expect(workApi.cancelTask).not.toHaveBeenCalled()
  })
})
