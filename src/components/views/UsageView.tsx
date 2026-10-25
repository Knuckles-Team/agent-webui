import { useState } from 'react'
import { useIdentity, type Identity } from '@/lib/auth'
import { useWorkspaceAdmission } from '@/components/workspace/useWorkspaceAdmission'
import { UsageAnalytics } from '@/components/usage/UsageAnalytics'
import { usageFilters } from '@/lib/usage-analytics'
import type { OperateState } from '@/lib/operate-workspace'

/** Compatibility page uses the same controller and panels, not a second dashboard. */
export default function UsageView() {
  const { identity, loading } = useIdentity()
  const generation = useWorkspaceAdmission(identity)
  if (loading) return <p role="status">Checking usage access…</p>
  return <AuthorizedUsage key={generation} identity={identity} generation={generation} />
}
function AuthorizedUsage({ identity, generation }: { identity: Identity; generation: string }) {
  const [state, setState] = useState<OperateState>({ server: null, item: null, q: '', lens: 'usage' })
  return (
    <div className="min-w-0 space-y-4 p-4">
      <h1 className="text-xl font-semibold">Usage &amp; Cost</h1>
      <UsageAnalytics
        key={JSON.stringify(usageFilters(state))}
        identity={identity}
        generation={generation}
        state={state}
        onNavigate={setState}
      />
    </div>
  )
}
