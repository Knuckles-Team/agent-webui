/**
 * @file UserManagementView.tsx
 * @description User Management panel -- "There should be a user panel for
 * user management and roles we can grant."
 *
 * Two sections, each backed by a REAL, distinct data source (never a second
 * fabricated one):
 *
 *  1. "You" -- the signed-in principal's own id, tenant, roles/scopes and
 *     admin-ness, read the SAME way every other identity-aware surface in
 *     this app does: `useIdentity()` (`src/lib/auth.ts`) over the server's
 *     `GET /auth/session`, proven live (HTTP 200) against the deployed
 *     `graph-os` pod on 2026-08-25.
 *
 *  2. "Principals & role grants" -- an admin-only listing of every principal
 *     and their roles, with grant/revoke controls. Empirically, NO REST route
 *     exists for this today (see `src/lib/user-management-api.ts`'s file
 *     docstring for the full probe evidence: `POST /api/graph/configure
 *     {action:"rbac_list"}` -- the closest existing surface -- answers HTTP
 *     200 `{"error":"unknown configuration action"}`; there is no
 *     `/api/registry/identities`, `/api/dashboard/rbac`, or
 *     `/api/enhanced/{identity,users,principals}` route; `openapi.json`'s 191
 *     paths contain none either). This section therefore renders as
 *     `unavailable` against the live backend today, distinct from a
 *     confirmed-empty roster or a confirmed-forbidden read -- the panel is
 *     wired to render `ready` with live data (and enable grant/revoke) the
 *     moment a REST twin for the engine's `RbacAdmin`/`GetIdentity` UDS
 *     methods (EG-092/EG-303) is exposed, with no further frontend change.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { KeyRound, Loader2, RefreshCw, ShieldAlert, ShieldCheck, ShieldX, UserCog, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import { useIdentity } from '@/lib/auth'
import { ROLE_ORDER, type Role } from '@/lib/nav-registry'
import { fetchPrincipalsAndRoles, grantRole, revokeRole, type PrincipalsState } from '@/lib/user-management-api'

function IdentityCard() {
  const { identity, loading } = useIdentity()
  const claims = identity.raw
  const isAdmin = identity.role === 'admin'

  if (loading) {
    return (
      <Card data-testid="user-mgmt-self">
        <CardContent className="pt-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-testid="user-mgmt-self">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <UserCog className="size-4" />
          You
        </CardTitle>
        <CardDescription>Your own signed-in identity, as the server resolved it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!identity.ssoConfigured ? (
          <p className="text-muted-foreground">
            Single sign-on is not configured on this deployment; you are the local operator with full access.
          </p>
        ) : identity.needsSignIn ? (
          <p className="text-amber-600 dark:text-amber-500">
            Your session has expired or was never established.{' '}
            <a href="/auth/login" className="underline">
              Sign in
            </a>{' '}
            to see your live identity.
          </p>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Principal id</dt>
          <dd className="font-mono" data-testid="user-mgmt-self-id">
            {identity.userKey}
          </dd>
          <dt className="text-muted-foreground">Tenant</dt>
          <dd className="font-mono" data-testid="user-mgmt-self-tenant">
            {claims?.tenant ?? '—'}
          </dd>
          <dt className="text-muted-foreground">Admin</dt>
          <dd data-testid="user-mgmt-self-admin">
            {isAdmin ? (
              <Badge variant="default" className="gap-1">
                <ShieldCheck className="size-3" /> Yes
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <ShieldX className="size-3" /> No
              </Badge>
            )}
          </dd>
        </dl>
        <div>
          <p className="text-muted-foreground text-xs mb-1">Roles / scopes</p>
          <div className="flex flex-wrap gap-1" data-testid="user-mgmt-self-roles">
            <Badge variant="secondary">{identity.role}</Badge>
            {(claims?.roles ?? [])
              .filter((r) => r !== identity.role)
              .map((r) => (
                <Badge key={r} variant="outline">
                  {r}
                </Badge>
              ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PrincipalsSection({ isAdmin }: { isAdmin: boolean }) {
  const [state, setState] = useState<PrincipalsState | null>(null)
  const [loading, setLoading] = useState(false)
  const [newIdentityId, setNewIdentityId] = useState('')
  const [newRole, setNewRole] = useState<Role>('reader')
  const [mutating, setMutating] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const next = await fetchPrincipalsAndRoles()
    setState(next)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleGrant = async () => {
    if (!newIdentityId.trim()) {
      toast.error('Enter a principal id to grant a role to.')
      return
    }
    setMutating(true)
    const result = await grantRole(newIdentityId.trim(), newRole)
    setMutating(false)
    if (result.kind === 'ok') {
      toast.success(`Granted ${newRole} to ${newIdentityId.trim()}.`)
      setNewIdentityId('')
      void refresh()
      return
    }
    if (result.kind === 'unavailable') {
      toast.error(`Role grants are not available yet: ${result.detail}`)
      return
    }
    if (result.kind === 'forbidden') {
      toast.error(`Forbidden: you are not permitted to grant roles. (${result.detail})`)
      return
    }
    toast.error(`Grant failed: ${result.detail}`)
  }

  const handleRevoke = async (identityId: string, role: string) => {
    setMutating(true)
    const result = await revokeRole(identityId, role)
    setMutating(false)
    if (result.kind === 'ok') {
      toast.success(`Revoked ${role} from ${identityId}.`)
      void refresh()
      return
    }
    if (result.kind === 'unavailable') {
      toast.error(`Role revocation is not available yet: ${result.detail}`)
      return
    }
    if (result.kind === 'forbidden') {
      toast.error(`Forbidden: you are not permitted to revoke roles. (${result.detail})`)
      return
    }
    toast.error(`Revoke failed: ${result.detail}`)
  }

  return (
    <Card data-testid="user-mgmt-principals">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="size-4" />
            Principals &amp; role grants
          </CardTitle>
          <CardDescription>Every principal known to RBAC and the roles granted to them.</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void refresh()
          }}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          <span className="ml-2">Refresh</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || state === null ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : state.kind === 'unavailable' ? (
          <div className="space-y-2" data-testid="principals-state-unavailable">
            <UnavailableNotice what="Principals and role grants" />
            {state.detail && <p className="text-xs text-muted-foreground font-mono">{state.detail}</p>}
            <p className="text-xs text-muted-foreground">
              No REST route lists RBAC principals or grants roles yet (the engine's <code>RbacAdmin</code>/
              <code>GetIdentity</code> methods are UDS-only today). This panel will populate as soon as one exists.
            </p>
          </div>
        ) : state.kind === 'forbidden' ? (
          <div className="space-y-2" data-testid="principals-state-forbidden">
            <p className="text-sm text-destructive flex items-center gap-2">
              <ShieldAlert className="size-4 shrink-0" /> You do not have permission to view principals and role
              grants.
            </p>
            {state.detail && <p className="text-xs text-muted-foreground font-mono">{state.detail}</p>}
          </div>
        ) : state.kind === 'error' ? (
          <div className="space-y-2" data-testid="principals-state-error">
            <p className="text-sm text-destructive flex items-center gap-2">
              <ShieldAlert className="size-4 shrink-0" /> Could not read principals and role grants.
            </p>
            <p className="text-xs text-muted-foreground font-mono">{state.detail}</p>
          </div>
        ) : state.kind === 'empty' ? (
          <p className="text-sm text-muted-foreground" data-testid="principals-state-empty">
            No principals reported. This is a confirmed empty roster, not a failed read.
          </p>
        ) : (
          <div className="space-y-2" data-testid="principals-state-ready">
            {(state.policy.identities ?? []).map((identity) => (
              <div key={identity.id} className="rounded border p-2 text-sm flex items-center justify-between gap-2">
                <div>
                  <span className="font-mono">{identity.id}</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(identity.roles ?? []).map((role) => (
                      <Badge key={role} variant="outline" className="text-xs gap-1">
                        <KeyRound className="size-3" />
                        {role}
                        {isAdmin && (
                          <button
                            type="button"
                            aria-label={`Revoke ${role} from ${identity.id}`}
                            className="ml-1 opacity-60 hover:opacity-100"
                            disabled={mutating}
                            onClick={() => {
                              void handleRevoke(identity.id, role)
                            }}
                          >
                            ×
                          </button>
                        )}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {isAdmin ? (
          <div className="flex items-end gap-2 pt-2 border-t" data-testid="user-mgmt-grant-form">
            <div className="flex-1">
              <label htmlFor="grant-identity-id" className="text-xs font-semibold text-muted-foreground uppercase">
                Principal id
              </label>
              <Input
                id="grant-identity-id"
                value={newIdentityId}
                onChange={(e) => {
                  setNewIdentityId(e.target.value)
                }}
                placeholder="e.g. 5102c7f9…"
                className="h-9"
              />
            </div>
            <div>
              <label htmlFor="grant-role" className="text-xs font-semibold text-muted-foreground uppercase">
                Role
              </label>
              <select
                id="grant-role"
                value={newRole}
                onChange={(e) => {
                  setNewRole(e.target.value as Role)
                }}
                className="w-full rounded-md border px-2 text-xs bg-muted/20 border-border/40 font-mono h-9"
              >
                {ROLE_ORDER.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
            <Button
              onClick={() => {
                void handleGrant()
              }}
              disabled={mutating}
              size="sm"
            >
              Grant
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground pt-2 border-t">Admin role required to grant or revoke roles.</p>
        )}
      </CardContent>
    </Card>
  )
}

export default function UserManagementView() {
  const { identity } = useIdentity()
  const isAdmin = identity.role === 'admin'

  return (
    <div className="space-y-6" data-testid="user-management-view">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="size-6" />
          User Management
        </h1>
        <p className="text-muted-foreground text-sm">
          Your identity and roles, plus the fleet's principals and the roles granted to them.
        </p>
      </div>

      <IdentityCard />
      <PrincipalsSection isAdmin={isAdmin} />
    </div>
  )
}
