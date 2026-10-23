import { useMemo } from 'react'
import type { Identity } from '@/lib/auth'

/** Opaque generation; credential material never enters a query key. */
export function useWorkspaceAdmission(identity: Identity): string {
  const roles = [...(identity.raw?.roles ?? [])].sort().join('\u0000')
  return useMemo(
    () => crypto.randomUUID(),
    [
      identity.userKey,
      identity.role,
      identity.needsSignIn,
      identity.raw?.authenticated,
      identity.raw?.tenant,
      identity.raw?.expires_at,
      identity.raw?.csrf_token,
      identity.raw?.mode,
      roles,
    ],
  )
}
