import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api, ApiError } from '@/lib/api'
import { validateShape } from '@/lib/api-validation'
import type { Identity } from '@/lib/auth'
import type { OperateState } from '@/lib/operate-workspace'
import {
  usageActivityCellSchema,
  usageAdmission,
  usageBreakdownSchema,
  usageFilters,
  usageOwnTenant,
  usageSearchHitSchema,
  usageSessionDetailSchema,
  usageSessionRowSchema,
  usageSummarySchema,
  usageToolStatSchema,
  usageTracesSchema,
} from '@/lib/usage-analytics'

function useUsageRead<T>(
  key: readonly unknown[],
  enabled: boolean,
  read: () => Promise<unknown>,
  schema: z.ZodType<T>,
) {
  return useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const result = await read()
      // The existing bindings have no signal parameter. Observe cancellation
      // before accepting their result, never rewire an endpoint to add authority.
      signal.throwIfAborted()
      return validateShape(schema, result, 'usage analytics')
    },
    enabled,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function useUsageController(identity: Identity, generation: string, state: OperateState) {
  const [epoch, setEpoch] = useState(0)
  const allowed = usageAdmission(identity, state)
  const ownTenant = usageOwnTenant(identity, state)
  const filters = usageFilters(state)
  const key = ['usage-analytics', generation, filters, epoch] as const
  const summary = useUsageRead([...key, 'summary'], allowed, () => api.getUsageSummary(filters), usageSummarySchema)
  const models = useUsageRead(
    [...key, 'models'],
    allowed,
    () => api.getUsageByModel(filters),
    z.array(usageBreakdownSchema).max(10000),
  )
  const projects = useUsageRead(
    [...key, 'projects'],
    allowed,
    () => api.getUsageByProject(filters),
    z.array(usageBreakdownSchema).max(10000),
  )
  const agents = useUsageRead(
    [...key, 'agents'],
    allowed,
    () => api.getUsageByAgent(filters),
    z.array(usageBreakdownSchema).max(10000),
  )
  const tools = useUsageRead(
    [...key, 'tools'],
    allowed,
    () => api.getUsageTools(filters),
    z.array(usageToolStatSchema).max(10000),
  )
  const activity = useUsageRead(
    [...key, 'activity'],
    allowed,
    () => api.getUsageActivity(filters),
    z.array(usageActivityCellSchema).max(10000),
  )
  const sessions = useUsageRead(
    [...key, 'sessions'],
    allowed,
    () => api.getUsageTopSessions({ ...filters, limit: 25 }),
    z.array(usageSessionRowSchema).max(10000),
  )
  const traces = useUsageRead([...key, 'traces'], allowed && ownTenant, () => api.getUsageTraces(), usageTracesSchema)
  const search = useUsageRead(
    [...key, 'search', state.usageSearch],
    allowed && ownTenant && Boolean(state.usageSearch),
    () => api.getUsageSearch(state.usageSearch ?? ''),
    z.array(usageSearchHitSchema).max(10000),
  )
  const detail = useUsageRead(
    [...key, 'detail', state.usageSession],
    allowed && ownTenant && Boolean(state.usageSession),
    () => api.getUsageSessionDetail(state.usageSession ?? ''),
    usageSessionDetailSchema.refine(
      (value) => value.session.id === state.usageSession,
      'Session identity does not match request',
    ),
  )
  const reads = [summary, models, projects, agents, tools, activity, sessions, traces, search, detail]
  const denied = reads.some((read) => read.error instanceof ApiError && [401, 403].includes(read.error.status))
  const loading = reads.some((read) => read.isFetching)
  // A denied refresh withdraws the entire protected snapshot. Individual
  // unavailable producers remain independent and do not fabricate zeroes.
  return {
    allowed,
    ownTenant,
    denied,
    loading,
    summary,
    models,
    projects,
    agents,
    tools,
    activity,
    sessions,
    traces,
    search,
    detail,
    refresh: () => {
      setEpoch((value) => value + 1)
    },
  }
}
