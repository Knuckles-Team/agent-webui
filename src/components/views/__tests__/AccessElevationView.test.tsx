import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import AccessElevationView from '@/components/views/AccessElevationView'
import { renderWithProviders } from '@/__tests__/fixtures'
import { formatRemaining, type Elevation } from '@/lib/elevation'

const HOUR_MS = 3_600_000

function elevation(overrides: Partial<Elevation>): Elevation {
  return {
    elevation_id: 'elevation-1',
    grantee: 'alice',
    status: 'requested',
    scopes: [{ graph: 'tenant-a', action: 'write' }],
    span_ms: HOUR_MS,
    justification: 'repair incident 42',
    request_digest: 'digest-1',
    requested_at_ms: 1,
    revision: 1,
    remaining_ms: 0,
    own: false,
    ...overrides,
  }
}

interface Call {
  url: string
  body: Record<string, unknown>
}

function mockGateway(rows: Elevation[]) {
  const calls: Call[] = []
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    calls.push({ url, body })
    const request = body.request as { action?: string } | undefined
    const payload = url.endsWith('/api/elevations/approve')
      ? { status: 'success', elevation: { ...rows[0], status: 'active', remaining_ms: HOUR_MS } }
      : request?.action === 'list'
        ? { status: 'success', result: rows }
        : { status: 'success', result: rows[0] }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
      text: () => Promise.resolve(''),
    }) as unknown as Promise<Response>
  })
  return { calls, fetchMock }
}

describe('AccessElevationView', () => {
  let original: typeof fetch

  beforeEach(() => {
    original = global.fetch
  })

  afterEach(() => {
    global.fetch = original
  })

  it('approves someone else’s request by id and digest only, never naming an approver', async () => {
    const { calls, fetchMock } = mockGateway([elevation({})])
    global.fetch = fetchMock as unknown as typeof fetch
    renderWithProviders(<AccessElevationView />)
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }))
    await waitFor(() => {
      expect(calls.some((c) => c.url.endsWith('/api/elevations/approve'))).toBe(true)
    })
    const approval = calls.find((c) => c.url.endsWith('/api/elevations/approve'))
    expect(approval?.body).toEqual({ elevation_id: 'elevation-1', request_digest: 'digest-1' })
  })

  it('never offers to approve the signed-in user’s own request', async () => {
    const { fetchMock } = mockGateway([elevation({ own: true })])
    global.fetch = fetchMock as unknown as typeof fetch
    renderWithProviders(<AccessElevationView />)
    expect(await screen.findByText('yours')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument()
  })

  it('shows a countdown for an active elevation and offers only revoke', async () => {
    const { fetchMock } = mockGateway([elevation({ status: 'active', remaining_ms: HOUR_MS })])
    global.fetch = fetchMock as unknown as typeof fetch
    renderWithProviders(<AccessElevationView />)
    expect(await screen.findByLabelText('Time remaining')).toHaveTextContent(/0:59:5\d|1:00:00/)
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })

  it('files a request through the shared action route with no identity field', async () => {
    const { calls, fetchMock } = mockGateway([elevation({ own: true })])
    global.fetch = fetchMock as unknown as typeof fetch
    renderWithProviders(<AccessElevationView />)
    fireEvent.change(screen.getByLabelText('Graph'), { target: { value: 'tenant-a' } })
    fireEvent.change(screen.getByLabelText('Access'), { target: { value: 'write' } })
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Justification'), { target: { value: 'incident' } })
    fireEvent.click(screen.getByRole('button', { name: /^request$/i }))
    await waitFor(() => {
      expect(calls.some((c) => (c.body.request as { action?: string })?.action === 'request')).toBe(true)
    })
    const filed = calls.find((c) => (c.body.request as { action?: string })?.action === 'request')
    expect(filed?.url).toContain('/api/graph/elevation')
    expect(filed?.body).toEqual({
      request: {
        action: 'request',
        scopes: [{ graph: 'tenant-a', action: 'write' }],
        span_ms: 30 * 60_000,
        justification: 'incident',
      },
    })
  })

  it('formats the countdown', () => {
    expect(formatRemaining(HOUR_MS + 61_000)).toBe('1:01:01')
    expect(formatRemaining(-5)).toBe('0:00:00')
  })
})
