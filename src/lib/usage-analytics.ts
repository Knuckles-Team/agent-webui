import { z } from 'zod'
import { canonicalJson } from './webmcp/canonical'
import type { UsageFilters } from './api'
import type { Identity } from './auth'
import { roleAtLeast } from './nav-registry'
import { OperateStateSchema, type OperateState } from './operate-workspace'

// The existing analytics API is distinct from usage.read's tenant totals.
// Missing, negative, nonfinite or malformed measurements are not measured zero.
const count = z.number().int().nonnegative()
const amount = z.number().nonnegative()
const shortText = z.string().max(4096)
const identifier = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => {
    if (Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
      return false
    try {
      canonicalJson(value)
      return true
    } catch {
      return false
    }
  })
export const usageSummarySchema = z.object({
  session_count: count,
  totals: z.object({
    input_tokens: count,
    output_tokens: count,
    cache_creation_tokens: count,
    cache_read_tokens: count,
    reasoning_tokens: count,
    cost_usd: amount,
  }),
  cache_hit_rate: amount.max(1),
})
export const usageBreakdownSchema = z.object({
  key: shortText,
  session_count: count,
  input_tokens: count,
  output_tokens: count,
  cost_usd: amount,
})
export const usageToolStatSchema = z
  .object({ name: shortText, category: shortText, calls: count, success: count, success_rate: amount.max(1) })
  .refine((v) => v.success <= v.calls)
export const usageActivityCellSchema = z.object({
  day_of_week: count.max(6),
  hour: count.max(23),
  sessions: count,
  cost_usd: amount,
})
export const usageSessionRowSchema = z.object({
  id: identifier,
  project: shortText,
  agent: shortText,
  started_at: shortText.optional(),
  ended_at: shortText.optional(),
  message_count: count,
  total_output_tokens: count,
  cost_usd: amount,
  health_grade: shortText.optional(),
  outcome: shortText,
  origin: shortText,
})
export const usageTracesSchema = z.object({
  enabled: z.boolean(),
  host: shortText,
  traces: z.array(z.object({ session_id: identifier, project: shortText, url: shortText })).max(10000),
})
export const usageSearchHitSchema = z.object({
  session_id: identifier,
  ordinal: count,
  role: shortText,
  snippet: z.string().max(100000),
  project: shortText,
  agent: shortText,
})
export const usageSessionDetailSchema = z.object({
  session: usageSessionRowSchema,
  messages: z
    .array(
      z.object({
        ordinal: count,
        role: shortText,
        content: z.string().max(1000000),
        model: shortText,
        context_tokens: count,
        output_tokens: count,
        has_tool_use: z.boolean(),
      }),
    )
    .max(10000),
  tool_calls: z
    .array(
      z.object({
        message_ordinal: count.optional(),
        tool_name: shortText,
        category: shortText,
        skill_name: shortText.optional(),
        status: shortText,
      }),
    )
    .max(10000),
  usage_events: z
    .array(z.object({ model: shortText, input_tokens: count, output_tokens: count, cost_usd: amount.optional() }))
    .max(10000),
})
export function usageFilters(state: OperateState): UsageFilters {
  const s = OperateStateSchema.parse(state)
  return {
    tenant_id: s.usageTenant,
    from: s.usageFrom,
    to: s.usageTo,
    model: s.usageModel,
    project: s.usageProject,
    agent: s.usageAgent,
    origin: s.usageOrigin,
  }
}
export function usageAdmission(identity: Identity, state: OperateState): boolean {
  if (identity.needsSignIn || !roleAtLeast(identity.role, 'user')) return false
  return !state.usageTenant || state.usageTenant === identity.raw?.tenant || roleAtLeast(identity.role, 'admin')
}
/** The existing search/detail/traces methods do not accept a tenant override. */
export function usageOwnTenant(identity: Identity, state: OperateState): boolean {
  return !state.usageTenant || state.usageTenant === identity.raw?.tenant
}
