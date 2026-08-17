import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardView, {
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  nextBackoffDelayMs,
  jitteredReconnectDelayMs,
  ConnectionGeneration,
  DATA_FRESHNESS_BANNER_ID,
} from '@/components/views/DashboardView'

/**
 * BUG-019 (GOC-29) proof.
 *
 * PREMISE, confirmed by reading DashboardView.tsx before this fix: the
 * `/ws/dashboard` reconnect loop retried on a flat, un-jittered 5000ms timer
 * (every simultaneously-disconnected client reconnects in lockstep -- a
 * thundering-herd pattern BD-019 names explicitly), and NOTHING guarded
 * against a message/close/error event from a socket a newer `connect()` had
 * already superseded landing after a forced disconnect -- there was no
 * generation/epoch concept at all. A stale message from an old socket could
 * silently overwrite state a fresher connection had already established.
 *
 * OUT OF SCOPE, stated honestly: the backend `/ws/dashboard` handler
 * (`agent_webui/server.py::_dashboard_ws`, owned by a different lane per this
 * program's file-ownership split) re-sends the ENTIRE dashboard on every
 * push with no per-widget subscription protocol or sequence/cursor field --
 * a true subscription-scoped fetch and a sequence-verified resume both
 * require a backend wire-protocol change this lane does not make. What IS
 * fixed and proven here is the frontend-only half: jittered exponential
 * backoff, and a connection-generation guard that makes a stale/duplicate
 * message from a superseded socket provably inert.
 */

describe('DashboardView reconnect backoff (pure logic, BUG-019)', () => {
  it('doubles the delay each attempt, capped at RECONNECT_MAX_DELAY_MS', () => {
    expect(nextBackoffDelayMs(RECONNECT_BASE_DELAY_MS)).toBe(2000)
    expect(nextBackoffDelayMs(2000)).toBe(4000)
    expect(nextBackoffDelayMs(4000)).toBe(8000)
    expect(nextBackoffDelayMs(20000)).toBe(RECONNECT_MAX_DELAY_MS) // 40000 -> capped
    expect(nextBackoffDelayMs(RECONNECT_MAX_DELAY_MS)).toBe(RECONNECT_MAX_DELAY_MS)
  })

  it('jitters within +/-30% of the input delay and never exceeds the cap or goes negative', () => {
    // Deterministic random() stand-ins covering the extremes and the middle.
    expect(jitteredReconnectDelayMs(1000, () => 0)).toBeCloseTo(700, 5) // random()=0 -> -30%
    expect(jitteredReconnectDelayMs(1000, () => 1)).toBeCloseTo(1300, 5) // random()=1 -> +30%
    expect(jitteredReconnectDelayMs(1000, () => 0.5)).toBeCloseTo(1000, 5) // midpoint -> no jitter

    // A pre-fix flat retry always produced EXACTLY 5000 every single time --
    // this is the behavioural difference this test pins: repeated calls at
    // the same input delay must NOT all collapse to one value once jitter
    // draws from a real (non-constant) source.
    const samples = new Set(Array.from({ length: 20 }, () => jitteredReconnectDelayMs(10000)))
    expect(samples.size).toBeGreaterThan(1)

    // Cap and floor hold even under jitter.
    expect(jitteredReconnectDelayMs(RECONNECT_MAX_DELAY_MS, () => 1)).toBeLessThanOrEqual(RECONNECT_MAX_DELAY_MS)
    expect(jitteredReconnectDelayMs(100, () => 0)).toBeGreaterThanOrEqual(0)
  })
})

describe('ConnectionGeneration (BUG-019 stale/duplicate guard)', () => {
  it('only the most recently started generation is current', () => {
    const gen = new ConnectionGeneration()
    const first = gen.next()
    expect(gen.isCurrent(first)).toBe(true)

    // A forced disconnect triggers a fresh connect() -> a new generation.
    const second = gen.next()
    expect(gen.isCurrent(second)).toBe(true)
    // The superseded generation must now read as stale -- this is exactly
    // what makes a late-arriving message/close/error from the OLD socket a
    // no-op instead of corrupting state a newer connection already set.
    expect(gen.isCurrent(first)).toBe(false)
  })

  it('every generation is unique, even across many reconnects', () => {
    const gen = new ConnectionGeneration()
    const seen = new Set<number>()
    for (let i = 0; i < 50; i += 1) seen.add(gen.next())
    expect(seen.size).toBe(50)
  })
})

/* ── End-to-end forced-disconnect proof (real render + mock WebSocket) ── */

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly url: string

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(): void {
    /* DashboardView's socket never sends anything meaningful; no-op. */
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  // ── test-only helpers, simulating server-driven events ──
  serverOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  serverMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  /** Simulate the connection dropping out from under the client. */
  serverForceClose(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
}

const DASHBOARD_FULL_BODY = {
  layout: {
    groups: [],
    columns: 4,
    theme: 'system',
    card_size: 'medium',
    show_search: true,
    show_status_indicators: true,
    auto_refresh: true,
    refresh_interval: 30,
  },
  data: {
    widgetA: { fields: { count: 1 }, status: 'ok', error: null, timestamp: '2026-01-01T00:00:00Z' },
  },
}

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <DashboardView />
    </QueryClientProvider>,
  )
  return { queryClient, ...utils }
}

describe('DashboardView WebSocket end-to-end (BUG-019 forced-disconnect gap/duplicate proof)', () => {
  let originalWebSocket: typeof WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    originalWebSocket = global.WebSocket
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(DASHBOARD_FULL_BODY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    global.WebSocket = originalWebSocket
    vi.useRealTimers()
  })

  it('a stale message from a superseded socket after a forced disconnect never overwrites fresher data (no duplicate/corruption)', async () => {
    const { queryClient, unmount } = renderDashboard()
    await act(async () => {
      await Promise.resolve()
    })

    expect(MockWebSocket.instances.length).toBe(1)
    const first = MockWebSocket.instances[0]
    act(() => {
      first.serverOpen()
      first.serverMessage({
        type: 'snapshot',
        data: { widgetA: { ...DASHBOARD_FULL_BODY.data.widgetA, fields: { count: 1 } } },
      })
    })
    expect(
      (queryClient.getQueryData(['dashboard-full']) as typeof DASHBOARD_FULL_BODY).data.widgetA.fields.count,
    ).toBe(1)

    // Forced disconnect -- the socket drops out from under the client.
    act(() => {
      first.serverForceClose()
    })

    // Reconnect is scheduled on a jittered exponential timer, not
    // immediately -- advance past the maximum possible first-attempt delay
    // (base 1000ms * 1.3 jitter headroom) to let it fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONNECT_BASE_DELAY_MS * 1.5)
    })
    expect(MockWebSocket.instances.length).toBe(2)
    const second = MockWebSocket.instances[1]

    // A STALE message arrives late on the OLD (superseded) socket -- e.g. a
    // buffered frame that was in flight before the disconnect was noticed.
    // Pre-fix, DashboardView had no generation guard at all, so this would
    // have been applied unconditionally. It must be a no-op now.
    act(() => {
      first.serverMessage({
        type: 'update',
        data: { widgetA: { ...DASHBOARD_FULL_BODY.data.widgetA, fields: { count: 999 } } },
      })
    })
    expect(
      (queryClient.getQueryData(['dashboard-full']) as typeof DASHBOARD_FULL_BODY).data.widgetA.fields.count,
    ).toBe(1)

    // The NEW connection's own fresh update is applied normally.
    act(() => {
      second.serverOpen()
      second.serverMessage({
        type: 'update',
        data: { widgetA: { ...DASHBOARD_FULL_BODY.data.widgetA, fields: { count: 2 } } },
      })
    })
    expect(
      (queryClient.getQueryData(['dashboard-full']) as typeof DASHBOARD_FULL_BODY).data.widgetA.fields.count,
    ).toBe(2)

    unmount()
  })

  it('reconnect delay grows across repeated failures instead of retrying at a constant interval', async () => {
    renderDashboard()
    await act(async () => {
      await Promise.resolve()
    })
    expect(MockWebSocket.instances.length).toBe(1)

    // Deterministic min/max bounds for each attempt's jittered delay, from
    // the same exponential sequence the component tracks internally
    // (1000 -> 2000 -> 4000, doubling on every failed attempt since `onopen`
    // never fires in this test to reset it) with the documented +/-30%
    // jitter envelope.
    const expectedBaseDelaysMs = [1000, 2000, 4000]

    for (const baseDelayMs of expectedBaseDelaysMs) {
      const before = MockWebSocket.instances.length
      const socket = MockWebSocket.instances[before - 1]
      act(() => {
        socket.serverForceClose()
      })

      const minBoundMs = baseDelayMs * 0.7
      const maxBoundMs = baseDelayMs * 1.3

      // Advancing to just under the guaranteed minimum must NOT reconnect
      // yet -- this is what proves the delay actually grew past the
      // previous attempt's range instead of the pre-fix flat 5000ms firing
      // on the same short interval every time.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(minBoundMs - 10)
      })
      expect(MockWebSocket.instances.length).toBe(before)

      // Advancing the rest of the way to the guaranteed maximum must
      // reconnect.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(maxBoundMs - (minBoundMs - 10) + 10)
      })
      expect(MockWebSocket.instances.length).toBe(before + 1)
    }
  })
})

/**
 * GOC-29: closing BUG-019's deferred backend half.
 *
 * `/ws/dashboard` (`agent_webui/server.py::_dashboard_ws`) now carries
 * `stream_id` (minted fresh per accepted connection) and `sequence`
 * (monotonic within a connection) on every message. These tests pin the two
 * known-bad proofs the wire-protocol addition exists to satisfy:
 *
 * 1. A dropped connection must render as degraded/unknown, never as
 *    frozen-but-plausible data with no visible change. KNOWN-BAD: before
 *    this change, `onclose` only flipped the small header Live/Polling
 *    badge -- the widget data itself, and the rest of the page, gave no
 *    signal that it might be stale.
 * 2. A message gap after reconnect must be DETECTED, not silently skipped.
 *    KNOWN-BAD: before this change, the client had no `stream_id` to compare
 *    -- a fresh snapshot after a forced disconnect was applied exactly like
 *    an ordinary periodic update, so a caller had no way to know anything
 *    had been missed.
 */
describe('DashboardView data-freshness (GOC-29 backend wire-protocol proofs)', () => {
  let originalWebSocket: typeof WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    originalWebSocket = global.WebSocket
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(DASHBOARD_FULL_BODY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    global.WebSocket = originalWebSocket
    vi.useRealTimers()
  })

  it('KNOWN-BAD PROOF 1: a dropped connection announces degraded data instead of staying silent', async () => {
    const { getByText, queryByText } = renderDashboard()
    await act(async () => {
      await Promise.resolve()
    })

    const socket = MockWebSocket.instances[0]
    act(() => {
      socket.serverOpen()
      socket.serverMessage({
        type: 'snapshot',
        stream_id: 'stream-a',
        sequence: 1,
        data: { widgetA: { ...DASHBOARD_FULL_BODY.data.widgetA, fields: { count: 1 } } },
      })
    })
    // Live, in-sequence data -> no degraded-data banner.
    expect(queryByText(/reconnecting|reconnected/i)).toBeNull()

    // The connection drops out from under the client (the exact scenario
    // BUG-019's forced-disconnect campaign exercises).
    act(() => {
      socket.serverForceClose()
    })

    // Must be announced immediately -- not merely a header icon color swap.
    const banner = getByText(/connection lost.*may be out of date/i)
    expect(banner.id).toBe(DATA_FRESHNESS_BANNER_ID)
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.getAttribute('aria-live')).toBe('polite')
  })

  it('KNOWN-BAD PROOF 2: a reconnect with a new stream_id is detected and announced as a gap, then clears on the next live update', async () => {
    const { getByText, queryByText } = renderDashboard()
    await act(async () => {
      await Promise.resolve()
    })

    const first = MockWebSocket.instances[0]
    act(() => {
      first.serverOpen()
      first.serverMessage({
        type: 'snapshot',
        stream_id: 'stream-a',
        sequence: 1,
        data: { widgetA: { ...DASHBOARD_FULL_BODY.data.widgetA, fields: { count: 1 } } },
      })
    })
    expect(queryByText(/reconnected.*missed/i)).toBeNull()

    act(() => {
      first.serverForceClose()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONNECT_BASE_DELAY_MS * 1.5)
    })
    expect(MockWebSocket.instances.length).toBe(2)
    const second = MockWebSocket.instances[1]

    // The reconnect's server-minted stream_id differs from the one this
    // client last saw -- exactly what `_dashboard_ws` guarantees (a fresh
    // UUID per accepted connection) since the endpoint cannot replay a
    // cursor. This must be surfaced as a detected gap, not silently applied.
    act(() => {
      second.serverOpen()
      second.serverMessage({
        type: 'snapshot',
        stream_id: 'stream-b',
        sequence: 1,
        data: { widgetA: { ...DASHBOARD_FULL_BODY.data.widgetA, fields: { count: 2 } } },
      })
    })
    const gapBanner = getByText(/reconnected after a dropped connection.*missed/i)
    expect(gapBanner.id).toBe(DATA_FRESHNESS_BANNER_ID)
    expect(gapBanner.getAttribute('aria-live')).toBe('assertive')

    // The following update on the SAME (new) stream_id is an ordinary
    // in-sequence continuation -- the gap notice must clear, not persist
    // forever and desensitize the operator to real future gaps.
    act(() => {
      second.serverMessage({
        type: 'update',
        stream_id: 'stream-b',
        sequence: 2,
        data: { widgetA: { ...DASHBOARD_FULL_BODY.data.widgetA, fields: { count: 3 } } },
      })
    })
    expect(queryByText(/reconnected.*missed/i)).toBeNull()
  })
})
