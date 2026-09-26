import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'

const meta = { registry_digest: 'digest', api_version: 'v1' }
const session = { authenticated: true, csrf_token: 'csrf-secret' }

afterEach(() => vi.unstubAllGlobals())

describe('fleet supervisory cutover', () => {
  it('reads health and topology through governed GraphOS operations', async () => {
    const health = {
      generated_at: 1,
      sessions: { total: 1, by_status: { running: 1 } },
      goals: { active: 1, tracked: 1 },
      domains: { tenant: { total: 1, active: 1, errored: 0, error_rate: 0 } },
    }
    const topology = { domains: [], goals: [], totals: { domains: 0, sessions: 0 } }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, result: health, meta }) })
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, result: topology, meta }) })
    vi.stubGlobal('fetch', fetcher)

    await expect(api.getFleetHealth()).resolves.toEqual(health)
    await expect(api.getFleetTopology()).resolves.toEqual(topology)
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
      '/auth/session',
      '/api/v1/ops/fleet.health',
      '/auth/session',
      '/api/v1/ops/fleet.topology',
    ])
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': 'csrf-secret' },
      body: '{}',
    })
  })

  it('retains tenant control-store health when global goal and worker fields are withheld', async () => {
    const health = {
      generated_at: 100,
      sessions: { total: 1, by_status: { running: 1 } },
      goals: null,
      domains: { tenant: { total: 1, active: 1, errored: 0, error_rate: 0 } },
    }
    const topology = { domains: [], goals: null, totals: { domains: 0, sessions: 1 } }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, result: health, meta }) })
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, result: topology, meta }) })
    vi.stubGlobal('fetch', fetcher)

    await expect(api.getFleetHealth()).resolves.toEqual(health)
    await expect(api.getFleetTopology()).resolves.toEqual(topology)
  })

  it('sends containment through the confirmed operation path', async () => {
    const refusal = {
      ok: false,
      error: {
        code: 'STEP_UP_REQUIRED',
        source: 'graphos',
        message: 'Confirmation required',
        retryable: false,
        details: { plan_ref: `graphos_plan:${'a'.repeat(48)}` },
      },
      meta,
    }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => refusal })
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => refusal })
    vi.stubGlobal('fetch', fetcher)

    await expect(api.pauseFleet({ domain: 'finance' })).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' })
    await expect(api.killFleet({ session_ids: ['s1'] })).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' })
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
      '/auth/session',
      '/api/v1/ops/fleet.pause',
      '/auth/session',
      '/api/v1/ops/fleet.kill',
    ])
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ domain: 'finance' }),
      credentials: 'same-origin',
    })
  })

  it('uses exact approval IDs and revisions for the console decision', async () => {
    const approval = {
      approval_id: 'action_approval:one',
      status: 'active',
      revision: 3,
      kind: 'restart',
      target: 'worker-a',
      expires_at_ms: null,
    }
    const refusal = {
      ok: false,
      error: {
        code: 'STEP_UP_REQUIRED',
        source: 'graphos',
        message: 'Confirmation required',
        retryable: false,
      },
      meta,
    }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { value: { pending: [approval] } }, meta }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => refusal })
    vi.stubGlobal('fetch', fetcher)

    await expect(api.getFleetApprovals()).resolves.toEqual({ pending: [approval] })
    await expect(api.grantFleetApproval(approval.approval_id, approval.revision, 'approved')).rejects.toMatchObject({
      code: 'STEP_UP_REQUIRED',
    })
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
      '/auth/session',
      '/api/v1/ops/approvals.list',
      '/auth/session',
      '/api/v1/ops/approvals.grant',
    ])
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({
      body: JSON.stringify({ approval_id: approval.approval_id, expected_revision: approval.revision }),
    })
  })

  it('uses governed trace, touched, and advisory action preview operations', async () => {
    const event = {
      event_id: 'e1',
      subject: 'worker-a',
      received_at: null,
      correlation_id: 'corr-1',
      actor_id: 'person:one',
      status: null,
      severity: null,
      source_type: null,
    }
    const trace = { correlation_id: 'corr-1', events: [event] }
    const touched = { resource: 'worker-a', events: [event], actors: ['person:one'] }
    const preview = { decision: 'allow', tier: 'auto', reason: 'tier auto', invariant: '', allowed: false }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, result: trace, meta }) })
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, result: touched, meta }) })
      .mockResolvedValueOnce({ ok: true, json: async () => session })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { value: preview }, meta }),
      })
    vi.stubGlobal('fetch', fetcher)

    await expect(api.getFleetTrace('corr-1')).resolves.toEqual(trace)
    await expect(api.getFleetTouched('worker-a')).resolves.toEqual(touched)
    await expect(api.verifyFleetAction({ kind: 'restart_service', target: 'worker-a' })).resolves.toEqual(preview)
    expect(fetcher.mock.calls.filter((_, i) => i % 2 === 1).map((call) => String(call[0]))).toEqual([
      '/api/v1/ops/fleet.trace',
      '/api/v1/ops/fleet.touched',
      '/api/v1/ops/fleet.actions.verify',
    ])
    expect(fetcher.mock.calls[5]?.[1]).toMatchObject({
      body: JSON.stringify({ kind: 'restart_service', target: 'worker-a' }),
      headers: { 'X-CSRF-Token': 'csrf-secret' },
    })
  })
})
