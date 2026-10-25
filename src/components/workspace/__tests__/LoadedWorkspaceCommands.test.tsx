import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// spec: WEBUI-APPS-R049.1.9
import { act, fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import { PageContextProvider } from '@/lib/page-context'
import { ApiError } from '@/lib/api-validation'
import { workApi } from '@/lib/work-workspace'
import { conversationOwnerKey } from '@/lib/chat-store'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import type { Role } from '@/lib/nav-registry'
import { WorkspaceCommandsProvider, WorkspaceCommandPalette } from '../WorkspaceCommands'
import WorkWorkspace from '../WorkWorkspace'
import OperateWorkspace from '../OperateWorkspace'
import { loadedCatalogCommands, loadedOperateCommands, loadedWorkCommands } from '../loaded-workspace-commands'
const state = vi.hoisted(() => ({
  role: 'user' as Role,
  tenant: 'a',
  denied: false,
  tools: new Map<string, WebMcpToolDefinition>(),
  conversations: [{ id: 'conversation-a', firstMessage: 'Investigation', timestamp: 1 }],
}))
vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({
    identity: { userKey: 'owner', role: state.role, needsSignIn: state.denied, raw: { tenant: state.tenant } },
    loading: false,
  }),
}))
vi.mock('@/lib/chat-store', async (original) => ({
  ...(await original<object>()),
  useConversations: () => state.conversations,
}))
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: (tools: WebMcpToolDefinition[]) => {
    for (const tool of tools) state.tools.set(tool.name, tool)
  },
}))
vi.mock('@/lib/work-workspace', async (original) => ({
  ...(await original<object>()),
  workApi: {
    listTasks: vi.fn(async () => [{ id: 'task-a' }]),
    getTask: vi.fn(async () => ({ id: 'task-a' })),
    listRuns: vi.fn(async () => ({ ok: true, data: { result: [{ id: 'trace-a', name: 'Recorded trace' }] } })),
    getRun: vi.fn(async () => ({
      ok: true,
      data: { result: { trace: { id: 'trace-a' }, nodes: [{ id: 'node-a', name: 'Recorded span', kind: 'span' }] } },
    })),
  },
}))
vi.mock('@/lib/operate-workspace', async (original) => ({
  ...(await original<object>()),
  operateApi: {
    status: vi.fn(async () => ({ value: { children: { source: { state: 'running' } } } })),
    catalog: vi.fn(async () => ({
      value: {
        items: [
          { id: 'tool-a', server: 'source', kind: 'tool', name: 'Read records' },
          { id: 'hidden', server: 'unconfirmed', kind: 'tool', name: 'Hidden' },
        ],
        next_cursor: null,
      },
    })),
  },
}))
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function Surface({ operate = false }: { operate?: boolean }) {
  return (
    <QueryClientProvider client={client}>
      <WorkspaceCommandsProvider
        owner={conversationOwnerKey({
          userKey: 'owner',
          raw: { tenant: state.tenant, authenticated: !state.denied, roles: [] },
        })}
        role={state.role}
        enabled={!state.denied}
      >
        <WorkspaceCommandPalette />
        <PageContextProvider route={operate ? '/workspace/operate' : '/workspace/work'} view="fixture">
          {operate ? <OperateWorkspace /> : <WorkWorkspace />}
        </PageContextProvider>
      </WorkspaceCommandsProvider>
    </QueryClientProvider>
  )
}
const empty = { conversation: null, task: null, run: null, node: null }
function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Find destination' }))
}
beforeEach(() => {
  client.clear()
  state.role = 'user'
  state.tenant = 'a'
  state.denied = false
  state.tools.clear()
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/workspace/work?conversation=conversation-a&run=trace-a')
})
describe('loaded Work and Operate command adapters', () => {
  it('registers real loaded Work tips with native links and keyboard palette opening', async () => {
    renderWithProviders(<Surface />)
    await screen.findByRole('button', { name: 'Recorded span · span' })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('link', { name: 'Conversation: Investigation' })).toHaveAttribute(
      'href',
      '/workspace/work?conversation=conversation-a&run=trace-a',
    )
    expect(dialog.getByRole('link', { name: 'Task: task-a' })).toHaveAttribute(
      'href',
      '/workspace/work?conversation=conversation-a&task=task-a&run=trace-a',
    )
    const node = dialog.getByRole('link', { name: 'Trace node: Recorded span' })
    const push = vi.spyOn(window.history, 'pushState')
    fireEvent.click(node, { ctrlKey: true })
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(node)
    expect(window.location.search).toBe('?conversation=conversation-a&run=trace-a&node=node-a')
  })
  it('advertises confirmed Operate capabilities and selects through the semantic dispatcher', async () => {
    window.history.replaceState({}, '', '/workspace/operate?q=source')
    state.role = 'reader'
    renderWithProviders(<Surface operate />)
    await screen.findByRole('link', { name: 'source' })
    open()
    const link = await screen.findByRole('link', { name: 'Capability: Read records (source)' })
    expect(link).toHaveAttribute('href', '/workspace/operate?server=source&item=tool-a&q=source&lens=services')
    expect(screen.queryByRole('link', { name: /Capability: Hidden/ })).not.toBeInTheDocument()
    const catalog = state.tools.get('agent-webui.workspace.commands')!
    const result = (await catalog.execute({}, { signal: new AbortController().signal })) as {
      commands: { commandId: string; label: string }[]
    }
    const entry = result.commands.find((command) => command.label.startsWith('Capability: Read'))!
    await act(async () => {
      await state.tools
        .get('agent-webui.workspace.command')!
        .execute({ commandId: entry.commandId }, { signal: new AbortController().signal })
    })
    expect(window.location.search).toBe('?server=source&item=tool-a&q=source&lens=services')
  })
  it('withdraws Work leaves and rejects old palette handles when admission is denied', async () => {
    const view = renderWithProviders(<Surface />)
    await screen.findByRole('button', { name: 'Recorded span · span' })
    const tool = state.tools.get('agent-webui.workspace.command')!
    const ids = (tool.inputSchema as { properties: { commandId: { enum: string[] } } }).properties.commandId.enum
    state.denied = true
    view.rerender(<Surface />)
    await expect(tool.execute({ commandId: ids.at(-1)! }, { signal: new AbortController().signal })).rejects.toThrow(
      'stale',
    )
    open()
    expect(within(screen.getByRole('dialog')).queryAllByRole('link')).toHaveLength(0)
  })
  it.each(['role', 'owner'])('retires loaded Work handles on %s changes', async (change) => {
    const view = renderWithProviders(<Surface />)
    await screen.findByRole('button', { name: 'Recorded span · span' })
    const held = state.tools.get('agent-webui.workspace.command')!
    const ids = (held.inputSchema as { properties: { commandId: { enum: string[] } } }).properties.commandId.enum
    if (change === 'role') state.role = 'reader'
    else state.tenant = 'b'
    view.rerender(<Surface />)
    await expect(held.execute({ commandId: ids.at(-1)! }, { signal: new AbortController().signal })).rejects.toThrow(
      'stale',
    )
    if (change === 'role') {
      open()
      expect(screen.queryByRole('link', { name: 'Task: task-a' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Chat & tasks' })).not.toBeInTheDocument()
    }
  })
  it('removes failed task discoveries and invalidates held command identifiers', async () => {
    renderWithProviders(<Surface />)
    await screen.findByRole('link', { name: 'task-a' })
    open()
    await screen.findByRole('link', { name: 'Task: task-a' })
    const held = state.tools.get('agent-webui.workspace.command')!
    const ids = (held.inputSchema as { properties: { commandId: { enum: string[] } } }).properties.commandId.enum
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    vi.mocked(workApi.listTasks).mockRejectedValueOnce(new ApiError(403, 'access revoked'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh tasks' }))
    await screen.findByText('Task listing failed. Refresh to retry.')
    open()
    expect(screen.queryByRole('link', { name: 'Task: task-a' })).not.toBeInTheDocument()
    await expect(held.execute({ commandId: ids.at(-1)! }, { signal: new AbortController().signal })).rejects.toThrow(
      'stale',
    )
  })
  it('bounds groups, clears node on trace changes, and omits malformed destinations', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `id-${i}` }))
    const commands = loadedWorkCommands(
      { ...empty, run: 'old', node: 'old-node' },
      { conversations: rows, tasks: rows, traces: rows, nodes: rows },
    )
    expect(commands).toHaveLength(100)
    expect(commands.find((entry) => entry.id === 'trace:id-0')?.href).toBe('/workspace/work?run=id-0')
    expect(
      loadedWorkCommands(empty, { conversations: [], tasks: [{ id: '\u0000' }], traces: [], nodes: rows }),
    ).toEqual([])
    expect(
      loadedOperateCommands({ server: null, item: null, q: '' }, [], [{ id: 'x', name: 'x', server: 'missing' }]),
    ).toEqual([])
  })
})

// spec: WEBUI-APPS-R049.1.16
it('selects services for fleet and catalog commands without losing retained usage context', () => {
  const retained = {
    server: 'source',
    item: null,
    q: 'read',
    lens: 'usage' as const,
    usageTenant: 'tenant-a',
    usagePanel: 'sessions' as const,
    usageSession: 'session-a',
    usageDetail: 'timeline' as const,
    usageFrom: '2026-01-01',
    usageTo: '2026-01-31',
    usageModel: 'model-a',
    usageProject: 'project-a',
    usageAgent: 'agent-a',
    usageOrigin: 'origin-a',
  }
  const commands = [
    ...loadedOperateCommands(retained, ['source'], [{ id: 'tool-a', name: 'Read', server: 'source' }]),
    ...loadedCatalogCommands(
      retained,
      [{ server_id: 'connector-a', name: 'Source connector' }],
      [{ id: 'definition-a', name: 'Read', kind: 'tool', server_name: 'Source connector' }],
    ),
  ]
  expect(commands).toHaveLength(4)
  for (const command of commands) {
    const query = new URL(command.href, 'https://workspace.invalid').searchParams
    expect(query.get('lens')).toBe('services')
    for (const [key, value] of Object.entries(retained)) {
      if (key.startsWith('usage')) expect(query.get(key)).toBe(value)
    }
  }
  expect(new URL(commands[3].href, 'https://workspace.invalid').searchParams.get('definition')).toBe('definition-a')
})
