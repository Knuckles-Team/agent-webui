import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PromqlPanel } from '../PromqlPanel'
import { LogsPanel } from '../LogsPanel'
import { TracesPanel } from '../TracesPanel'
import { TIME_RANGES } from '../queries'

const RANGE = TIME_RANGES.find((r) => r.id === '1h')!

/** Route-aware fetch mock: pattern → { status, body } (body is the raw gateway envelope). */
function mockFetch(map: Record<string, { status?: number; body?: unknown }>) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    for (const [pattern, spec] of Object.entries(map)) {
      if (url.includes(pattern)) {
        const status = spec.status ?? 200
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          json: () => Promise.resolve(spec.body ?? {}),
          text: () => Promise.resolve(''),
        }) as unknown as Promise<Response>
      }
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
      text: () => Promise.resolve(''),
    }) as unknown as Promise<Response>
  })
}

describe('PromqlPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    global.fetch = mockFetch({
      '/api/graph/promql': {
        body: {
          status: 'success',
          result: {
            data: {
              result: [
                {
                  metric: { __name__: 'up' },
                  values: [
                    [1000, '1'],
                    [1060, '2'],
                  ],
                },
              ],
            },
          },
        },
      },
    }) as unknown as typeof fetch
  })

  it('renders the series returned by the promql API', async () => {
    render(<PromqlPanel title="Request rate" initialQuery="up" range={RANGE} refreshSignal={0} />)
    expect(screen.getByText('Request rate')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('up')).toBeInTheDocument()
    })
    // POSTed to the real gateway promql route.
    const spy = global.fetch as unknown as ReturnType<typeof vi.fn>
    expect(spy.mock.calls.some((c) => String(c[0]).includes('/api/graph/promql'))).toBe(true)
  })
})

describe('LogsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a read-only placeholder when /graph/logs is unavailable (404)', async () => {
    global.fetch = mockFetch({ '/api/graph/logs': { status: 404 } }) as unknown as typeof fetch
    render(<LogsPanel title="Logs" range={RANGE} refreshSignal={0} />)
    await waitFor(() => {
      expect(screen.getByText(/not activated/i)).toBeInTheDocument()
    })
    expect(screen.getByText('read-only')).toBeInTheDocument()
  })

  it('renders log rows when the API returns lines', async () => {
    global.fetch = mockFetch({
      '/api/graph/logs': {
        body: {
          status: 'success',
          result: { logs: [{ timestamp: 1000, message: 'hello world', level: 'INFO', stream: 'graph-os' }] },
        },
      },
    }) as unknown as typeof fetch
    render(<LogsPanel title="Logs" range={RANGE} refreshSignal={0} />)
    await waitFor(() => {
      expect(screen.getByText('hello world')).toBeInTheDocument()
    })
    expect(screen.getByText('graph-os')).toBeInTheDocument()
  })
})

describe('TracesPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    global.fetch = mockFetch({
      '/api/graph/traces': {
        body: {
          status: 'success',
          result: {
            traces: [{ trace_id: 't1', name: 'checkout', spans: [{ name: 'db.query', start: 0, duration: 5 }] }],
          },
        },
      },
    }) as unknown as typeof fetch
  })

  it('lists traces and renders the span timeline', async () => {
    render(<TracesPanel title="Recent traces" refreshSignal={0} />)
    await waitFor(() => {
      expect(screen.getByText('checkout')).toBeInTheDocument()
    })
    expect(screen.getByText('db.query')).toBeInTheDocument()
  })
})
