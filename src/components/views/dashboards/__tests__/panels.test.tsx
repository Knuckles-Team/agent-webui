import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { PromqlPanel } from '../PromqlPanel'
import { LogsPanel } from '../LogsPanel'
import { TracesPanel } from '../TracesPanel'
import { VizPanel } from '../VizPanel'
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

  it('shows a read-only placeholder when the route answers 200 but the engine surface degrades (D-W6-ISO-2)', async () => {
    // The registered /graph/logs route now always answers 200 -- a missing
    // engine capability comes back as {degraded: true}, not a 404/501. This
    // must be treated identically to the 404 case above, not as "0 logs".
    global.fetch = mockFetch({
      '/api/graph/logs': {
        body: {
          status: 'success',
          result: {
            surface: 'logs',
            action: 'query',
            degraded: true,
            error: "engine surface 'logs' is not available in this engine build",
            tried: ['observability.query_logs'],
          },
        },
      },
    }) as unknown as typeof fetch
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

// A real (tiny, valid) 1x1 PNG, base64-encoded -- proves the panel decodes an
// actual image, not just any string.
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('VizPanel (GOC-88, D-VZ-1 V5)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a real chart image + LOD metadata for an exact render', async () => {
    global.fetch = mockFetch({
      '/api/graph/viz': {
        body: {
          status: 'success',
          result: {
            surface: 'viz',
            action: 'plot_from_query',
            rows_returned: 3,
            rows_rendered: 3,
            result: {
              view_result: { row_count: 3, lod_tier: 'Direct', exact: true, reduction: 'None', wall_time_ms: 2 },
              format: 'png',
              content_type: 'image/png',
              bytes: { __bytes_b64__: TINY_PNG_B64 },
            },
          },
        },
      },
    }) as unknown as typeof fetch
    render(
      <VizPanel
        title="Chart"
        initialQuery="SELECT a, b FROM nodes"
        initialMark="scatter"
        initialXField="a"
        initialYField="b"
        refreshSignal={0}
      />,
    )
    const img = await waitFor(() => screen.getByTestId('viz-panel-image'))
    expect(img).toHaveAttribute('src', expect.stringContaining('data:image/png;base64,'))
    expect(screen.getByText('exact')).toBeInTheDocument()
    expect(screen.getByText(/tier: Direct/)).toBeInTheDocument()
    const spy = global.fetch as unknown as ReturnType<typeof vi.fn>
    expect(spy.mock.calls.some((c) => String(c[0]).includes('/api/graph/viz'))).toBe(true)
  })

  it('never fabricates a chart when the query returns no usable rows -- shows the real reason instead', async () => {
    global.fetch = mockFetch({
      '/api/graph/viz': {
        body: {
          status: 'success',
          result: {
            surface: 'viz',
            action: 'plot_from_query',
            unavailable: true,
            reason: "query returned 2 row(s); 0 had every one of ['a', 'b'] present",
          },
        },
      },
    }) as unknown as typeof fetch
    render(
      <VizPanel
        title="Chart"
        initialQuery="SELECT a, b FROM nodes"
        initialMark="scatter"
        initialXField="a"
        initialYField="b"
        refreshSignal={0}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(/0 had every one of/)).toBeInTheDocument()
    })
    expect(screen.getByText(/not a fabricated empty chart/)).toBeInTheDocument()
    expect(screen.queryByTestId('viz-panel-image')).not.toBeInTheDocument()
  })

  it('shows the capability-not-activated notice when the route is unavailable (404)', async () => {
    global.fetch = mockFetch({ '/api/graph/viz': { status: 404 } }) as unknown as typeof fetch
    render(
      <VizPanel
        title="Chart"
        initialQuery="SELECT a, b FROM nodes"
        initialMark="scatter"
        initialXField="a"
        initialYField="b"
        refreshSignal={0}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(/not activated/i)).toBeInTheDocument()
    })
    expect(screen.queryByTestId('viz-panel-image')).not.toBeInTheDocument()
  })

  it('shows the capability-not-activated notice when the engine build lacks the viz surface (degraded)', async () => {
    global.fetch = mockFetch({
      '/api/graph/viz': {
        body: {
          status: 'success',
          result: {
            surface: 'viz',
            action: 'plot_from_query',
            degraded: true,
            error: "engine surface 'viz' is not available in this engine build",
            tried: ['client.viz'],
          },
        },
      },
    }) as unknown as typeof fetch
    render(
      <VizPanel
        title="Chart"
        initialQuery="SELECT a, b FROM nodes"
        initialMark="scatter"
        initialXField="a"
        initialYField="b"
        refreshSignal={0}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(/not activated/i)).toBeInTheDocument()
    })
    expect(screen.queryByTestId('viz-panel-image')).not.toBeInTheDocument()
  })

  it('does not query until a query/x/y field is provided, and runs on refresh once they are', async () => {
    global.fetch = mockFetch({
      '/api/graph/viz': {
        body: {
          status: 'success',
          result: {
            surface: 'viz',
            action: 'plot_from_query',
            rows_returned: 1,
            rows_rendered: 1,
            result: {
              view_result: { row_count: 1, lod_tier: 'Direct', exact: true, reduction: 'None', wall_time_ms: 1 },
              format: 'png',
              content_type: 'image/png',
              bytes: { __bytes_b64__: TINY_PNG_B64 },
            },
          },
        },
      },
    }) as unknown as typeof fetch
    render(
      <VizPanel
        title="Chart"
        initialQuery=""
        initialMark="scatter"
        initialXField=""
        initialYField=""
        refreshSignal={0}
      />,
    )
    expect(screen.getByText(/Enter a query/)).toBeInTheDocument()
    const spy = global.fetch as unknown as ReturnType<typeof vi.fn>
    expect(spy.mock.calls.length).toBe(0)
    fireEvent.change(screen.getByLabelText('SQL query'), { target: { value: 'SELECT a, b FROM nodes' } })
    fireEvent.change(screen.getByLabelText('x field'), { target: { value: 'a' } })
    fireEvent.change(screen.getByLabelText('y field'), { target: { value: 'b' } })
    fireEvent.click(screen.getByRole('button', { name: /Refresh panel/i }))
    await waitFor(() => {
      expect(screen.getByTestId('viz-panel-image')).toBeInTheDocument()
    })
  })
})
