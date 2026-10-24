// spec: WEBUI-APPS-R005.3
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import OperateWorkspace from '@/components/workspace/OperateWorkspace'

vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({
    identity: { userKey: 'reader', role: 'reader', needsSignIn: false, raw: { tenant: 'test' } },
    loading: false,
  }),
}))
vi.mock('@/lib/webmcp/provider', () => ({ useWebMcpToolSet: vi.fn() }))

const meta = { registry_digest: 'fixture', api_version: 'v1' }
let status: unknown
let refused: boolean
let pending: boolean
const fetcher = vi.fn(async (url: string, _options?: RequestInit) => {
  if (url === '/api/enhanced/tools')
    return Response.json({
      source: 'epistemic_graph',
      servers: [{ server_id: 'srv:catalog-only', name: 'catalog-only', status: 'unavailable', tool_count: 0 }],
    })
  if (url === '/auth/session') return Response.json({ authenticated: true, csrf_token: 'session-fixture' })
  if (url === '/api/v1/ops/fleet.status') return fleetResponse()
  if (url === '/api/v1/ops/fleet.catalog.list')
    return Response.json({
      ok: true,
      result: { value: { items: [], next_cursor: null } },
      meta,
    })
  throw new Error(`Unexpected request: ${url}`)
})

function fleetResponse() {
  if (pending)
    return new Promise<Response>(() => {
      /* Keep discovery pending to prove the loading state. */
    })
  if (refused) return Response.json({ message: 'unavailable' }, { status: 503 })
  return Response.json({ ok: true, result: status, meta })
}

beforeEach(() => {
  refused = false
  pending = false
  status = {
    value: {
      children: {
        records: {
          state: 'running',
          mounted_tools: 0,
          in_flight: 2,
          queued: 3,
          restart_count: 1,
          token: 'private-fixture',
        },
        archive: { state: 'stopped' },
      },
    },
  }
  fetcher.mockClear()
  vi.stubGlobal('fetch', fetcher)
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/workspace/operate')
})
afterEach(() => vi.unstubAllGlobals())

describe('Operate connector inventory through the real browser adapter', () => {
  it('renders each returned connector even with no capabilities, preserving zero and missing counters', async () => {
    renderWithProviders(<OperateWorkspace />)
    const records = within(await screen.findByRole('article', { name: 'Connector records' }))
    expect(records.getByText('Reported state: running')).toBeVisible()
    expect(records.getByText('Mounted tools').nextElementSibling).toHaveTextContent('0')
    expect(records.getByText('In flight').nextElementSibling).toHaveTextContent('2')
    expect(records.getByText('Queued').nextElementSibling).toHaveTextContent('3')
    expect(records.getByText('Restarts').nextElementSibling).toHaveTextContent('1')
    const archive = within(screen.getByRole('article', { name: 'Connector archive' }))
    expect(archive.getAllByText('Not available')).toHaveLength(4)
    expect(within(screen.getByRole('region', { name: 'Fleet children' })).getAllByRole('article')).toHaveLength(2)
    expect(await screen.findByRole('article', { name: 'Catalog connector catalog-only' })).toHaveTextContent(
      'Registration: unavailable',
    )
    expect(document.body).not.toHaveTextContent('private-fixture')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    const request = fetcher.mock.calls.find(([url]) => url.endsWith('/fleet.status'))!
    expect(JSON.parse(request[1]!.body as string)).toEqual({ servers: [] })
  })

  it('filters tiles and opens the existing inspector with native context links', async () => {
    renderWithProviders(<OperateWorkspace />)
    await screen.findByRole('article', { name: 'Connector records' })
    const input = screen.getByRole('textbox', { name: 'Filter fleet children' })
    input.focus()
    fireEvent.change(input, { target: { value: 'REC' } })
    expect(input).toHaveFocus()
    expect(screen.queryByRole('article', { name: 'Connector archive' })).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'records' })
    expect(link).toHaveAttribute('href', '/workspace/operate?server=records&q=REC')
    fireEvent.click(link)
    expect(link).toHaveAttribute('aria-current', 'location')
    expect(screen.getByText('Selected connector')).toBeVisible()
    expect(
      within(screen.getByRole('region', { name: 'Connector detail' })).getByRole('heading', { name: 'records' }),
    ).toBeVisible()
    expect(await screen.findByText('No capabilities for this child in the loaded catalog pages.')).toBeVisible()
    fireEvent.change(input, { target: { value: 'missing' } })
    expect(screen.getByText('No matching fleet children.')).toBeVisible()
    expect(screen.queryByText('No connectors were reported by Arbora.')).not.toBeInTheDocument()
  })

  it('distinguishes loading, empty inventory and failed refresh without retaining stale tiles', async () => {
    pending = true
    const mounted = renderWithProviders(<OperateWorkspace />)
    expect(screen.getByText('Loading fleet…')).toBeVisible()
    mounted.unmount()
    pending = false
    renderWithProviders(<OperateWorkspace />)
    await screen.findByRole('article', { name: 'Connector records' })
    refused = true
    fireEvent.click(screen.getByRole('button', { name: 'Refresh fleet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Fleet status could not be confirmed')
    expect(screen.queryByRole('article', { name: 'Connector records' })).not.toBeInTheDocument()
    expect(screen.queryByText('No connectors were reported by Arbora.')).not.toBeInTheDocument()
    refused = false
    status = { value: { children: {} } }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh fleet' }))
    expect(await screen.findByText('No connectors were reported by Arbora.')).toBeVisible()
  })
})
