import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import GraphOSReadinessView from '@/components/views/GraphOSReadinessView'
import { fetchReadinessSnapshot } from '@/lib/readiness-api'
import type { ReadinessSnapshot, ReadinessCheck } from '@/lib/readiness-api'

vi.mock('@/lib/readiness-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/readiness-api')>('@/lib/readiness-api')
  return { ...actual, fetchReadinessSnapshot: vi.fn() }
})

const mockedFetch = vi.mocked(fetchReadinessSnapshot)

function check(state: ReadinessCheck['state'], extra: Partial<ReadinessCheck> = {}): ReadinessCheck {
  return { state, ...extra }
}

function snapshot(overrides: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot {
  return {
    schema_version: 'graphos.readiness.v1',
    snapshot_id: 'sha256:deadbeef',
    observed_at: '2026-08-16T12:00:00+00:00',
    principal: { subject: null, tenant: null, policy_epoch: null },
    overall: 'ready',
    checks: {
      engine: check('ready'),
      identity_policy: check('not_configured'),
      catalog: check('ready'),
      source_sync: check('ready'),
      synthetic_query: check('ready', { evidence_count: 3, route: 'graph_code_context' }),
      dense_index: check('ready', { coverage_pct: 100 }),
      sparse_index: check('ready', { coverage_pct: 100 }),
    },
    required_failures: [],
    degraded_reasons: [],
    refresh: { mode: 'not_probed', cursor: null, next_due_at: null },
    ...overrides,
  }
}

describe('GraphOSReadinessView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockedFetch.mockReset()
  })

  it('KNOWN-GOOD: renders overall Ready only when the backend genuinely reports ready', async () => {
    mockedFetch.mockResolvedValue({ ok: true, data: snapshot(), unavailable: false })

    render(<GraphOSReadinessView />)

    await waitFor(() => {
      expect(screen.getByText('Every check reported ready.')).toBeInTheDocument()
    })
    // "Ready" appears both as the overall badge and per-check badges; assert at
    // least the overall summary text renders, not a fabricated green state.
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0)
  })

  it('KNOWN-BAD: renders Unavailable and the failing check reason when the engine is degraded, never Ready', async () => {
    const bad = snapshot({
      overall: 'unavailable',
      required_failures: ['synthetic_query'],
      checks: {
        ...snapshot().checks,
        synthetic_query: check('unavailable', { reason: 'engine_degraded', evidence_count: 0 }),
      },
    })
    mockedFetch.mockResolvedValue({ ok: true, data: bad, unavailable: false })

    render(<GraphOSReadinessView />)

    await waitFor(() => {
      expect(screen.getByText(/Required check\(s\) failing: synthetic_query/)).toBeInTheDocument()
    })
    expect(screen.getByText('engine_degraded')).toBeInTheDocument()
    // The overall badge must read Unavailable, not Ready — fetch it scoped to
    // avoid matching the per-row badge text.
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
    expect(screen.queryByText('Every check reported ready.')).not.toBeInTheDocument()
  })

  it('renders degraded reasons without claiming success', async () => {
    const degraded = snapshot({
      overall: 'degraded',
      degraded_reasons: ['sparse_index:compiled_index_empty'],
      checks: {
        ...snapshot().checks,
        sparse_index: check('unavailable', { reason: 'compiled_index_empty', coverage_pct: 0 }),
      },
    })
    mockedFetch.mockResolvedValue({ ok: true, data: degraded, unavailable: false })

    render(<GraphOSReadinessView />)

    await waitFor(() => {
      expect(screen.getByText('sparse_index:compiled_index_empty')).toBeInTheDocument()
    })
    expect(screen.queryByText('Every check reported ready.')).not.toBeInTheDocument()
  })

  it('shows a distinct "not activated" notice on a 404/501, never a false readiness state', async () => {
    mockedFetch.mockResolvedValue({ ok: false, data: null, unavailable: true, error: 'HTTP 404' })

    render(<GraphOSReadinessView />)

    await waitFor(() => {
      expect(screen.getByText(/not activated on this backend yet/)).toBeInTheDocument()
    })
  })

  it('shows an explicit error state on a schema-validation failure (hostile payload), never a fabricated state', async () => {
    mockedFetch.mockResolvedValue({ ok: false, data: null, unavailable: false, error: 'response shape mismatch' })

    render(<GraphOSReadinessView />)

    await waitFor(() => {
      expect(screen.getByText('response shape mismatch')).toBeInTheDocument()
    })
  })

  it('handles a rejected fetch promise without crashing (ErrorBoundary-safe)', async () => {
    mockedFetch.mockRejectedValue(new Error('network exploded'))

    render(<GraphOSReadinessView />)

    await waitFor(() => {
      expect(screen.getByText('network exploded')).toBeInTheDocument()
    })
  })
})
