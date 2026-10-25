import type { Identity } from '@/lib/auth'
import { navigateOperate, type OperateState } from '@/lib/operate-workspace'
import { usageFilters } from '@/lib/usage-analytics'
import { UsageAnalytics } from '@/components/usage/UsageAnalytics'

export function OperateUsageLens({
  identity,
  generation,
  state,
}: {
  identity: Identity
  generation: string
  state: OperateState
}) {
  return (
    <UsageAnalytics
      key={`${generation}:${JSON.stringify(usageFilters(state))}:${state.usageSearch ?? ''}`}
      identity={identity}
      generation={generation}
      state={state}
      onNavigate={(next) => {
        navigateOperate(next, identity.role)
      }}
    />
  )
}
