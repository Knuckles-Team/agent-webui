// spec: OVERSTORY-APPS-R005.3
import { useState, type ComponentProps } from 'react'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import { OperateCatalogPanel as CatalogPanel } from '@/components/workspace/OperateCatalogPanel'
import { readOperateCatalog } from '@/lib/operate-catalog'
import { parseOperateState } from '@/lib/operate-workspace'
import { useWorkspaceLocation } from '@/lib/workspace-navigation'
import { WorkspaceCommandsProvider, WorkspaceCommandPalette } from '@/components/workspace/WorkspaceCommands'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import { loadedCatalogCommands } from '@/components/workspace/loaded-workspace-commands'
import { workspaceCommandBranches } from '@/components/workspace/workspace-command-branches'
const tools = vi.hoisted(() => new Map<string, WebMcpToolDefinition>())
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: (values: WebMcpToolDefinition[]) => {
    for (const tool of values) tools.set(tool.name, tool)
  },
}))
function OperateCatalogPanel(props: Pick<ComponentProps<typeof CatalogPanel>, 'generation' | 'runtime'>) {
  const location = useWorkspaceLocation()
  return <CatalogPanel {...props} state={parseOperateState(location)} role="reader" owner={props.generation} />
}

let payload: unknown
let refused = false
const fetcher = vi.fn(async () => Response.json(payload, { status: refused ? 503 : 200 }))
beforeEach(() => {
  refused = false
  tools.clear()
  window.history.replaceState({}, '', '/workspace/operate')
  payload = {
    source: 'epistemic_graph',
    servers: [
      {
        server_id: 'srv:records',
        name: 'records',
        status: 'available',
        tool_count: 0,
        url: 'https://private.invalid',
        error: 'private-fixture',
      },
      { server_id: 'srv:archive', name: 'archive', status: 'unavailable', tool_count: 2 },
    ],
    components: [],
    counts: { servers: 2, tools: 2, skills: 0, workflows: 0 },
  }
  fetcher.mockReset()
  fetcher.mockImplementation(async () => Response.json(payload, { status: refused ? 503 : 200 }))
  vi.stubGlobal('fetch', fetcher)
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

it('renders the complete returned catalog without requiring a fleet process or tool', async () => {
  renderWithProviders(<OperateCatalogPanel generation="first" />)
  const records = within(await screen.findByRole('article', { name: 'Catalog connector records' }))
  expect(records.getByText('Registration: available')).toBeVisible()
  expect(records.getByText('Catalog tools: 0')).toBeVisible()
  expect(records.getByText('Provider connection: not reported by this catalog.')).toBeVisible()
  expect(screen.getByRole('article', { name: 'Catalog connector archive' })).toHaveTextContent(
    'Registration: unavailable',
  )
  expect(document.body).not.toHaveTextContent('private-fixture')
  expect(document.body).not.toHaveTextContent('private.invalid')
  expect(localStorage.length + sessionStorage.length).toBe(0)
  expect(fetcher).toHaveBeenCalledWith(
    '/api/enhanced/tools',
    expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
  )
  const result = await readOperateCatalog()
  expect(result.servers[0]).not.toHaveProperty('url')
  expect(result.servers[0]).not.toHaveProperty('error')
})

it('distinguishes filtering and empty catalog, then withdraws stale data on refusal', async () => {
  renderWithProviders(<OperateCatalogPanel generation="first" />)
  await screen.findByRole('article', { name: 'Catalog connector records' })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } })
  expect(screen.getByText('No matching catalog connectors.')).toBeVisible()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
  refused = true
  fireEvent.click(screen.getByRole('button', { name: 'Refresh connector catalog' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('not available')
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  refused = false
  tools.clear()
  window.history.replaceState({}, '', '/workspace/operate')
  payload = { source: 'epistemic_graph', servers: [], components: [] }
  fireEvent.click(screen.getByRole('button', { name: 'Refresh connector catalog' }))
  expect(await screen.findByText('No connectors in the returned catalog.')).toBeVisible()
  refused = true
  fireEvent.click(screen.getByRole('button', { name: 'Refresh connector catalog' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('not available')
  expect(screen.queryByText('No connectors in the returned catalog.')).not.toBeInTheDocument()
})

it('retires earlier admission data while the new identity read is pending', async () => {
  function Harness() {
    const [generation, setGeneration] = useState('first')
    return (
      <>
        <button
          onClick={() => {
            setGeneration('second')
          }}
        >
          Change admission
        </button>
        <WorkspaceCommandsProvider owner={generation} role="reader">
          <WorkspaceCommandPalette />
          <OperateCatalogPanel generation={generation} />
        </WorkspaceCommandsProvider>
      </>
    )
  }
  renderWithProviders(<Harness />)
  await screen.findByRole('article', { name: 'Catalog connector records' })
  const held = tools.get('agent-webui.workspace.commands')!
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>(() => {
        /* Hold the new admission read pending. */
      }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Change admission' }))
  expect(screen.getByRole('status')).toHaveTextContent('Loading connector catalog')
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  await expect(held.execute({ offset: 0 }, { signal: new AbortController().signal })).rejects.toThrow('stale')
})

it.each([
  { source: 'legacy', servers: [] },
  { source: 'epistemic_graph', servers: [{ server_id: 'a', name: 'a', status: 'connected', tool_count: 0 }] },
  { source: 'epistemic_graph', servers: [{ server_id: 'a', name: 'a', status: 'available', tool_count: -1 }] },
  {
    source: 'epistemic_graph',
    servers: Array(2).fill({ server_id: 'a', name: 'a', status: 'available', tool_count: 0 }),
  },
])('rejects malformed or incompatible catalog contracts', async (invalid) => {
  payload = { components: [], ...invalid }
  await expect(readOperateCatalog()).rejects.toThrow()
})

const definition = (id: string, serverName: string | null, kind = 'tool') => ({
  id,
  name: 'shared-name',
  server_name: serverName,
  kind,
  description: `Description ${id}`,
  status: 'active',
  authority: kind === 'workflow' ? 'workflow_catalog' : 'agent_component',
  revision: 3,
  definition_digest: 'sha256:definition',
  content_digest: 'sha256:content',
})
it('inspects definitions by returned identity and explicit connector association', async () => {
  payload = {
    ...(payload as object),
    components: [
      definition('tool:records', 'records'),
      definition('skill:records', 'records', 'skill'),
      definition('tool:archive', 'archive'),
      definition('workflow:unbound', null, 'workflow'),
    ],
  }
  renderWithProviders(<OperateCatalogPanel generation="first" runtime={{ records: { state: 'up' } }} />)
  fireEvent.click(await screen.findByRole('link', { name: 'Inspect records' }))
  expect(screen.getByText('MCP runtime: up')).toBeVisible()
  fireEvent.click(screen.getByRole('link', { name: 'tool: shared-name' }))
  const detail = screen.getByRole('region', { name: 'Selected catalog definition' })
  expect(detail).toHaveTextContent('tool:records')
  expect(detail).toHaveTextContent('sha256:definition')
  expect(detail).not.toHaveTextContent('tool:archive')
  fireEvent.click(screen.getByRole('link', { name: 'skill: shared-name' }))
  expect(detail).toHaveTextContent('skill:records')
  fireEvent.click(screen.getByRole('link', { name: 'Inspect archive' }))
  expect(screen.queryByRole('region', { name: 'Selected catalog definition' })).not.toBeInTheDocument()
  expect(screen.getByText('MCP runtime: not reported')).toBeVisible()
  expect(screen.queryByRole('link', { name: 'workflow: shared-name' })).not.toBeInTheDocument()
})
it('retains the destination but withdraws a removed definition on catalog refresh', async () => {
  payload = { ...(payload as object), components: [definition('tool:records', 'records')] }
  renderWithProviders(<OperateCatalogPanel generation="first" />)
  fireEvent.click(await screen.findByRole('link', { name: 'Inspect records' }))
  fireEvent.click(screen.getByRole('link', { name: 'tool: shared-name' }))
  payload = { ...(payload as object), components: [] }
  fireEvent.click(screen.getByRole('button', { name: 'Refresh connector catalog' }))
  await screen.findByRole('link', { name: 'Inspect records', expanded: true })
  expect(screen.queryByRole('region', { name: 'Selected catalog definition' })).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('definition is not in the current connector catalog')
  expect(screen.getByText('No tool or skill definitions returned for this connector.')).toBeVisible()
})
it('rejects duplicate component identities and mismatched authority', async () => {
  payload = {
    ...(payload as object),
    components: [definition('duplicate', 'records'), definition('duplicate', 'archive')],
  }
  await expect(readOperateCatalog()).rejects.toThrow()
  payload = {
    ...(payload as object),
    components: [{ ...definition('tool', 'records'), authority: 'workflow_catalog' }],
  }
  await expect(readOperateCatalog()).rejects.toThrow()
})

// spec: OVERSTORY-APPS-R046.2.2
it('restores exact URL identities and refuses wrong-connector and missing definition links', async () => {
  payload = {
    ...(payload as object),
    components: [definition('tool:records', 'records'), definition('tool:archive', 'archive')],
  }
  window.history.replaceState({}, '', '/workspace/operate?connector=srv%3Arecords&definition=tool%3Arecords')
  renderWithProviders(<OperateCatalogPanel generation="first" />)
  expect(await screen.findByRole('region', { name: 'Selected catalog definition' })).toHaveTextContent('tool:records')
  const search = screen.getByRole('textbox')
  fireEvent.change(search, { target: { value: 'archive' } })
  expect(screen.getByRole('region', { name: 'Selected catalog definition' })).toBeVisible()
  expect(search).toHaveValue('archive')
  const link = screen.getByRole('link', { name: 'tool: shared-name' })
  const push = vi.spyOn(window.history, 'pushState')
  fireEvent.click(link, { ctrlKey: true })
  expect(push).not.toHaveBeenCalled()
  act(() => {
    window.history.replaceState({}, '', '/workspace/operate?connector=srv%3Arecords&definition=tool%3Aarchive')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(screen.queryByRole('region', { name: 'Selected catalog definition' })).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('definition is not in the current connector catalog')
  act(() => {
    window.history.replaceState({}, '', '/workspace/operate?connector=missing')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(screen.getByRole('alert')).toHaveTextContent('connector is not in the current caller-visible catalog')
  push.mockRestore()
})

// spec: OVERSTORY-APPS-R047
it('uses loaded catalog commands for semantic selection and retires handles on refresh', async () => {
  payload = { ...(payload as object), components: [definition('tool:records', 'records')] }
  renderWithProviders(
    <WorkspaceCommandsProvider owner="first" role="reader">
      <WorkspaceCommandPalette />
      <OperateCatalogPanel generation="first" />
    </WorkspaceCommandsProvider>,
  )
  await screen.findByRole('link', { name: 'Inspect records' })
  const list = tools.get('agent-webui.workspace.commands')!
  const context = { signal: new AbortController().signal }
  const catalog = (await list.execute({ offset: 0 }, context)) as { commands: { commandId: string; label: string }[] }
  const entry = catalog.commands.find((entry) => entry.label.startsWith('tool:'))!
  const selected = tools.get('agent-webui.workspace.command')!
  await act(async () => {
    await selected.execute({ commandId: entry.commandId }, context)
  })
  expect(screen.getByRole('region', { name: 'Selected catalog definition' })).toHaveTextContent('tool:records')
  expect(window.location.search).toBe('?connector=srv%3Arecords&definition=tool%3Arecords&lens=services')
  await expect(selected.execute({ commandId: entry.commandId }, context)).rejects.toThrow('stale')
  const held = tools.get('agent-webui.workspace.commands')!
  refused = true
  fireEvent.click(screen.getByRole('button', { name: 'Refresh connector catalog' }))
  await screen.findByRole('alert')
  await expect(held.execute({ offset: 0 }, context)).rejects.toThrow('stale')
  expect(screen.queryByRole('region', { name: 'Selected catalog definition' })).not.toBeInTheDocument()
})

// spec: OVERSTORY-APPS-R046.2.2
it('bounds catalog commands and nests only explicit connector-definition associations', () => {
  const commands = loadedCatalogCommands(
    { server: null, item: null, q: '' },
    [{ server_id: 'records', name: 'records' }],
    Array.from({ length: 60 }, (_, i) => ({ id: `tool:${i}`, name: 'Lookup', kind: 'tool', server_name: 'records' })),
  )
  expect(commands).toHaveLength(26)
  const roots = workspaceCommandBranches([
    { id: 'operate', label: 'Operate', href: '/workspace/operate' },
    ...commands,
  ])
  expect(roots[0].children[0].command.id).toBe('connector:records')
  expect(roots[0].children[0].children).toHaveLength(25)
  expect(
    loadedCatalogCommands(
      { server: null, item: null, q: '' },
      [],
      [{ id: 'a', name: 'Lookup', kind: 'tool', server_name: 'missing' }],
    ),
  ).toEqual([])
})

// spec: OVERSTORY-APPS-R046.2.2
it('refreshes equivalent definitions without stealing focus from the retained filter', async () => {
  payload = { ...(payload as object), components: [definition('tool:records', 'records')] }
  window.history.replaceState({}, '', '/workspace/operate?connector=srv%3Arecords&definition=tool%3Arecords')
  renderWithProviders(<OperateCatalogPanel generation="first" />)
  await screen.findByRole('region', { name: 'Selected catalog definition' })
  const filter = screen.getByRole('textbox')
  filter.focus()
  payload = JSON.parse(JSON.stringify(payload))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh connector catalog' }))
  await screen.findByRole('region', { name: 'Selected catalog definition' })
  expect(filter).toHaveFocus()
})

// spec: OVERSTORY-APPS-R046.2.2
it.each(['x'.repeat(257), 'unsafe\u0000identity', '\ud800'])(
  'keeps non-navigable catalog identities readable without crashing',
  async (id) => {
    payload = {
      ...(payload as object),
      servers: [
        { server_id: id, name: 'invalid', status: 'available', tool_count: 1 },
        { server_id: 'srv:records', name: 'records', status: 'available', tool_count: 1 },
      ],
      components: [definition(id, 'records')],
    }
    renderWithProviders(<OperateCatalogPanel generation="first" />)
    expect(
      await screen.findByText('Inspect invalid: workspace navigation is unavailable for this catalog identity.'),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('link', { name: 'Inspect records' }))
    expect(
      screen.getByText('tool: shared-name: workspace navigation is unavailable for this catalog identity.'),
    ).toBeVisible()
    expect(screen.queryByRole('link', { name: 'tool: shared-name' })).not.toBeInTheDocument()
  },
)
