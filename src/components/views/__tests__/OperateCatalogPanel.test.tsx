// spec: WEBUI-APPS-R005.3
import { useState } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import { OperateCatalogPanel } from '@/components/workspace/OperateCatalogPanel'
import { readOperateCatalog } from '@/lib/operate-catalog'

let payload: unknown
let refused = false
const fetcher = vi.fn(async () => Response.json(payload, { status: refused ? 503 : 200 }))
beforeEach(() => {
  refused = false
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
        <OperateCatalogPanel generation={generation} />
      </>
    )
  }
  renderWithProviders(<Harness />)
  await screen.findByRole('article', { name: 'Catalog connector records' })
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>(() => {
        /* Hold the new admission read pending. */
      }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Change admission' }))
  expect(screen.getByRole('status')).toHaveTextContent('Loading connector catalog')
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
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
  fireEvent.click(await screen.findByRole('button', { name: 'Inspect records' }))
  expect(screen.getByText('MCP runtime: up')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'tool: shared-name' }))
  const detail = screen.getByRole('region', { name: 'Selected catalog definition' })
  expect(detail).toHaveTextContent('tool:records')
  expect(detail).toHaveTextContent('sha256:definition')
  expect(detail).not.toHaveTextContent('tool:archive')
  fireEvent.click(screen.getByRole('button', { name: 'skill: shared-name' }))
  expect(detail).toHaveTextContent('skill:records')
  fireEvent.click(screen.getByRole('button', { name: 'Inspect archive' }))
  expect(screen.queryByRole('region', { name: 'Selected catalog definition' })).not.toBeInTheDocument()
  expect(screen.getByText('MCP runtime: not reported')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'workflow: shared-name' })).not.toBeInTheDocument()
})
it('retires selected definitions on a successful catalog refresh', async () => {
  payload = { ...(payload as object), components: [definition('tool:records', 'records')] }
  renderWithProviders(<OperateCatalogPanel generation="first" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Inspect records' }))
  fireEvent.click(screen.getByRole('button', { name: 'tool: shared-name' }))
  payload = { ...(payload as object), components: [] }
  fireEvent.click(screen.getByRole('button', { name: 'Refresh connector catalog' }))
  await screen.findByRole('button', { name: 'Inspect records', expanded: false })
  expect(screen.queryByRole('region', { name: 'Selected catalog definition' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect records' }))
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
