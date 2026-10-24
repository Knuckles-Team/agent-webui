// spec: WEBUI-APPS-R049.1.3
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PageContextProvider } from '@/lib/page-context'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import { ApiError } from '@/lib/api-validation'
import { workApi } from '@/lib/work-workspace'
import WorkWorkspace from '../WorkWorkspace'
const state = vi.hoisted(() => ({ expires: 1, role: 'user', tools: new Map<string, WebMcpToolDefinition>() }))
vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({
    loading: false,
    identity: {
      userKey: 'owner',
      role: state.role,
      needsSignIn: false,
      raw: { tenant: 'tenant', authenticated: true, roles: [], expires_at: state.expires },
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
  state.tools.clear()
  state.expires = 1
  state.role = 'user'
  window.history.replaceState({}, '', '/workspace/work?task=task-a')
})
describe('Work admission and authoritative task availability', () => {
  it('does not reuse a fresh cached task after observed admission renewal', async () => {
    const view = setup()
    await screen.findByText('Status: working')
    const held = state.tools.get('agent-webui.work.cancel-task.review')!
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
    const held = state.tools.get('agent-webui.work.cancel-task.review')!
    state.role = 'reader'
    view.rerender()
    expect(screen.getByRole('alert')).toHaveTextContent('not available')
    await expect(held.execute({}, { signal: new AbortController().signal })).rejects.toThrow('stale')
    expect(workApi.cancelTask).not.toHaveBeenCalled()
  })
})
