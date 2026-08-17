import { describe, expect, it, vi } from 'vitest'

import {
  READINESS_CHECK_ORDER,
  fetchReadinessSnapshot,
  isReadinessReady,
  type ReadinessCheck,
  type ReadinessChecks,
  type ReadinessSnapshot,
  type ReadinessState,
} from '../readiness-api'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function validCheck(state: ReadinessState, extra: Record<string, unknown> = {}): ReadinessCheck {
  return { state, ...extra }
}

function validSnapshot(overall: ReadinessState = 'ready'): ReadinessSnapshot {
  const checks = Object.fromEntries(
    READINESS_CHECK_ORDER.map((name) => [name, validCheck('ready')]),
  ) as unknown as ReadinessChecks
  return {
    schema_version: 'graphos.readiness.v1',
    snapshot_id: 'sha256:abc123',
    observed_at: '2026-08-16T00:00:00+00:00',
    principal: { subject: null, tenant: null, policy_epoch: null },
    overall,
    checks,
    required_failures: [],
    degraded_reasons: [],
    refresh: { mode: 'not_probed', cursor: null, next_due_at: null },
  }
}

describe('readiness-api', () => {
  it('POSTs action=readiness to the canonical /graph/analyze route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'success', result: validSnapshot() }))
    globalThis.fetch = fetchMock

    await fetchReadinessSnapshot({ query: 'foo', nodeId: 'code:1' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/graph/analyze',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'readiness', query: 'foo', node_id: 'code:1' }),
      }),
    )
  })

  it('resolves a well-formed unavailable snapshot as ok:true, never coerced to ready', async () => {
    const snapshot = validSnapshot('unavailable')
    snapshot.checks.synthetic_query = validCheck('unavailable', {
      reason: 'engine_degraded',
      evidence_count: 0,
      route: 'graph_code_context',
    })
    snapshot.required_failures = ['synthetic_query']
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'success', result: snapshot }))
    globalThis.fetch = fetchMock

    const res = await fetchReadinessSnapshot()

    expect(res.ok).toBe(true)
    expect(res.data?.overall).toBe('unavailable')
    expect(isReadinessReady(res.data!)).toBe(false)
  })

  it('resolves ready only when the backend genuinely reports ready', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'success', result: validSnapshot('ready') }))
    globalThis.fetch = fetchMock

    const res = await fetchReadinessSnapshot()

    expect(res.ok).toBe(true)
    expect(isReadinessReady(res.data!)).toBe(true)
  })

  it('KNOWN-BAD: rejects a hostile payload claiming overall=ready with an invalid check shape', async () => {
    // A malformed/hostile response that CLAIMS ready but violates the schema
    // (state is not one of the five valid states) must resolve ok:false, never
    // be handed to a caller as a trustworthy ReadinessSnapshot.
    const hostile = {
      ...validSnapshot('ready'),
      checks: {
        ...validSnapshot('ready').checks,
        engine: { state: 'green' }, // not a valid ReadinessState
      },
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'success', result: hostile }))
    globalThis.fetch = fetchMock

    const res = await fetchReadinessSnapshot()

    expect(res.ok).toBe(false)
    expect(res.data).toBeNull()
    expect(res.error).toBeTruthy()
  })

  it('rejects a snapshot missing required top-level fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'success', result: { overall: 'ready' } }))
    globalThis.fetch = fetchMock

    const res = await fetchReadinessSnapshot()

    expect(res.ok).toBe(false)
    expect(res.data).toBeNull()
  })

  it('reports unavailable (not an error) when the route itself is not yet activated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }))
    globalThis.fetch = fetchMock

    const res = await fetchReadinessSnapshot()

    expect(res.ok).toBe(false)
    expect(res.unavailable).toBe(true)
  })

  it('treats an oversized/huge checks payload as valid so long as it matches the schema', async () => {
    const snapshot = validSnapshot('degraded')
    snapshot.checks.source_sync = validCheck('degraded', {
      reason: 'partial_connector_coverage',
      missing: Array.from({ length: 500 }, (_, i) => `connector-${String(i)}`),
    })
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'success', result: snapshot }))
    globalThis.fetch = fetchMock

    const res = await fetchReadinessSnapshot()

    expect(res.ok).toBe(true)
    expect(res.data?.checks.source_sync.missing).toHaveLength(500)
  })
})
