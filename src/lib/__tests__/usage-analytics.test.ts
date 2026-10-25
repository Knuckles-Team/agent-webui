// spec: WEBUI-APPS-R049.1.16
import { describe, expect, it } from 'vitest'
import {
  usageActivityCellSchema,
  usageBreakdownSchema,
  usageSummarySchema,
  usageToolStatSchema,
  usageSearchHitSchema,
} from '../usage-analytics'
import { operateHref, parseOperateState } from '../operate-workspace'
const base = {
  session_count: 0,
  totals: {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    reasoning_tokens: 0,
    cost_usd: 0,
  },
  cache_hit_rate: 0,
}
describe('Usage measurements and contextual identity', () => {
  it.each([NaN, Infinity, -Infinity, -1, '0', null, undefined])('refuses invalid measurement %s', (cost) => {
    expect(usageSummarySchema.safeParse({ ...base, totals: { ...base.totals, cost_usd: cost } }).success).toBe(false)
    expect(
      usageBreakdownSchema.safeParse({ key: 'x', session_count: 0, input_tokens: 0, output_tokens: 0, cost_usd: cost })
        .success,
    ).toBe(false)
  })
  it.each(['\u0000', '\ud800', ''])('rejects a non-navigable session identifier %j', (sessionId) => {
    expect(
      usageSearchHitSchema.safeParse({
        session_id: sessionId,
        ordinal: 0,
        role: 'user',
        snippet: 'text',
        project: 'project',
        agent: 'agent',
      }).success,
    ).toBe(false)
  })
  it('keeps measured zero and rejects impossible counters/rates/activity', () => {
    expect(usageSummarySchema.parse(base)).toEqual(base)
    expect(usageSummarySchema.safeParse({ ...base, session_count: 1.2 }).success).toBe(false)
    expect(usageSummarySchema.safeParse({ ...base, cache_hit_rate: 2 }).success).toBe(false)
    expect(
      usageToolStatSchema.safeParse({ name: 'x', category: 'tool', calls: 1, success: 2, success_rate: 1 }).success,
    ).toBe(false)
    expect(usageActivityCellSchema.safeParse({ day_of_week: 7, hour: 24, sessions: 0, cost_usd: 0 }).success).toBe(
      false,
    )
  })
  it('round trips full usage and independent fleet/catalog context', () => {
    const state = {
      server: 'fleet',
      item: 'cap',
      q: 'filter',
      connector: 'cat',
      definition: 'def',
      lens: 'usage' as const,
      usageTenant: 'tenant-a',
      usagePanel: 'sessions' as const,
      usageSession: 'session/a',
      usageDetail: 'timeline' as const,
      usageSearch: 'term',
      usageFrom: '2026-10-01',
      usageTo: '2026-10-25',
      usageProject: 'project',
      usageModel: 'model',
      usageAgent: 'agent',
      usageOrigin: 'runtime',
    }
    expect(parseOperateState(operateHref(state))).toEqual(state)
  })
  it.each([
    'usageSession=',
    'usageTenant=%00',
    'usagePanel=unknown',
    'lens=usage&lens=health',
    'usageDetail=timeline',
    'usageFrom=2026-02-30',
    'usageFrom=2026-10-25&usageTo=2026-10-01',
    'usageSearch=one&usageSearch=two',
  ])('rejects ambiguous usage state %s', (query) => {
    expect(() => parseOperateState(`/workspace/operate?${query}`)).toThrow()
  })
})
