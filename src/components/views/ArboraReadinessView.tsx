import { useEffect, useState } from 'react'
import { useIdentity } from '@/lib/auth'
import { roleAtLeast } from '@/lib/nav-registry'
import { replaceWithOperateReadiness, resolveOperateReadinessAlias } from '@/lib/operate-compatibility'

/** Compatibility address; the supported readiness journey lives in Operate. */
export default function ArboraReadinessView() {
  const { identity, loading } = useIdentity()
  const [location] = useState(() => `${window.location.pathname}${window.location.search}${window.location.hash}`)
  const invalid = resolveOperateReadinessAlias(location) === null
  const allowed = !identity.needsSignIn && roleAtLeast(identity.role, 'reader')
  useEffect(
    function enterOperateWhenAllowed() {
      if (loading || !allowed) return
      replaceWithOperateReadiness(location)
    },
    [loading, allowed, location],
  )
  if (loading) return <p role="status">Checking readiness access…</p>
  if (!allowed) return <p role="alert">Readiness is not available for this identity.</p>
  if (invalid) return <p role="alert">Invalid readiness destination.</p>
  return <p role="status">Opening readiness in Operate…</p>
}
