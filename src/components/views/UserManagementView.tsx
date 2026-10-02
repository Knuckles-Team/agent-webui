/**
 * @file UserManagementView.tsx
 * @description User Management panel -- "There should be a user panel for
 * user management and roles we can grant."
 *
 * Three sections, each backed by a REAL, distinct data source (never a second
 * fabricated one):
 *
 *  1. "You" -- the signed-in principal's own id, tenant, roles/scopes and
 *     admin-ness, read the SAME way every other identity-aware surface in
 *     this app does: `useIdentity()` (`src/lib/auth.ts`) over the server's
 *     `GET /auth/session`.
 *
 *  2. "Principals & role grants" -- an admin-only listing of every principal
 *     and their roles, with grant/revoke controls, backed by
 *     `src/lib/user-management-api.ts`. This section renders `unavailable`
 *     until a REST twin for the engine's RBAC admin methods exists, distinct
 *     from a confirmed-empty roster or a confirmed-forbidden read.
 *
 *  3. "User roster" -- list, search, create, and act on identity-admin users
 *     and service accounts through the typed Graph OS identity operations in
 *     `src/lib/graphos-api/identity.ts`. The server alone decides roles,
 *     scopes, and whether a fresh MFA session is required.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { KeyRound, RefreshCw, ShieldAlert, ShieldCheck, ShieldX, UserCog, Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { UnavailableNotice } from '@/components/ui/unavailable-notice'
import { StatusMessage } from '@/components/ui/status-message'
import { useIdentity } from '@/lib/auth'
import { ROLE_ORDER, type Role } from '@/lib/nav-registry'
import { fetchPrincipalsAndRoles, grantRole, revokeRole, type PrincipalsState } from '@/lib/user-management-api'
import type { AgentIdentity } from '@/lib/admin-api'
import {
  invokeIdentity,
  type IdentityPage,
  type IdentityReply,
  type IdentityUser,
  type IdentityOp,
} from '@/lib/graphos-api/identity'

function IdentityCard() {
  const { identity, loading } = useIdentity()
  const claims = identity.raw
  const isAdmin = identity.role === 'admin'

  if (loading) {
    return (
      <Card data-testid="user-mgmt-self">
        <CardContent className="pt-6">
          <StatusMessage status="loading" label="Loading your identity…" />
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
        {identity.needsSignIn ? (
          <p className="text-amber-600 dark:text-amber-500">
            Your session has expired or was never established.{' '}
            <a href="/" className="underline">
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

type MutationResult = Awaited<ReturnType<typeof grantRole>>

/** Toast a grant/revoke `MutationResult`, one message per outcome `kind`. */
function toastMutationOutcome(
  result: MutationResult,
  copy: { ok: string; unavailable: string; forbidden: string; error: string },
) {
  switch (result.kind) {
    case 'ok':
      toast.success(copy.ok)
      return
    case 'unavailable':
      toast.error(`${copy.unavailable}: ${result.detail}`)
      return
    case 'forbidden':
      toast.error(`Forbidden: ${copy.forbidden} (${result.detail})`)
      return
    case 'error':
      toast.error(`${copy.error}: ${result.detail}`)
  }
}

/** All principals-admin state + mutations, kept out of the section's render body. */
function usePrincipalsAdmin() {
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
    toastMutationOutcome(result, {
      ok: `Granted ${newRole} to ${newIdentityId.trim()}.`,
      unavailable: 'Role grants are not available yet',
      forbidden: 'you are not permitted to grant roles.',
      error: 'Grant failed',
    })
    if (result.kind === 'ok') {
      setNewIdentityId('')
      void refresh()
    }
  }

  const handleRevoke = async (identityId: string, role: string) => {
    setMutating(true)
    const result = await revokeRole(identityId, role)
    setMutating(false)
    toastMutationOutcome(result, {
      ok: `Revoked ${role} from ${identityId}.`,
      unavailable: 'Role revocation is not available yet',
      forbidden: 'you are not permitted to revoke roles.',
      error: 'Revoke failed',
    })
    if (result.kind === 'ok') void refresh()
  }

  return {
    state,
    loading,
    newIdentityId,
    setNewIdentityId,
    newRole,
    setNewRole,
    mutating,
    refresh,
    handleGrant,
    handleRevoke,
  }
}

function PrincipalRow({
  identity,
  isAdmin,
  mutating,
  onRevoke,
}: {
  identity: AgentIdentity
  isAdmin: boolean
  mutating: boolean
  onRevoke: (identityId: string, role: string) => void
}) {
  return (
    <div className="rounded border p-2 text-sm flex items-center justify-between gap-2">
      <div>
        <span className="font-mono">{identity.id}</span>
        <div className="flex flex-wrap gap-1 mt-1">
          {(identity.roles ?? []).map((role: string) => (
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
                    onRevoke(identity.id, role)
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
  )
}

function PrincipalsListBody({
  loading,
  state,
  isAdmin,
  mutating,
  onRevoke,
}: {
  loading: boolean
  state: PrincipalsState | null
  isAdmin: boolean
  mutating: boolean
  onRevoke: (identityId: string, role: string) => void
}) {
  if (loading || state === null) {
    return <StatusMessage status="loading" label="Loading principals…" />
  }
  if (state.kind === 'unavailable') {
    return (
      <div className="space-y-2" data-testid="principals-state-unavailable">
        <UnavailableNotice what="Principals and role grants" />
        {state.detail && <p className="text-xs text-muted-foreground font-mono">{state.detail}</p>}
        <p className="text-xs text-muted-foreground">
          No REST route lists RBAC principals or grants roles yet (the engine's <code>RbacAdmin</code>/
          <code>GetIdentity</code> methods are UDS-only today). This panel will populate as soon as one exists.
        </p>
      </div>
    )
  }
  if (state.kind === 'forbidden') {
    return (
      <div className="space-y-2" data-testid="principals-state-forbidden">
        <p className="text-sm text-destructive flex items-center gap-2">
          <ShieldAlert className="size-4 shrink-0" /> You do not have permission to view principals and role grants.
        </p>
        {state.detail && <p className="text-xs text-muted-foreground font-mono">{state.detail}</p>}
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="space-y-2" data-testid="principals-state-error">
        <p className="text-sm text-destructive flex items-center gap-2">
          <ShieldAlert className="size-4 shrink-0" /> Could not read principals and role grants.
        </p>
        <p className="text-xs text-muted-foreground font-mono">{state.detail}</p>
      </div>
    )
  }
  if (state.kind === 'empty') {
    return (
      <p className="text-sm text-muted-foreground" data-testid="principals-state-empty">
        No principals reported. This is a confirmed empty roster, not a failed read.
      </p>
    )
  }
  return (
    <div className="space-y-2" data-testid="principals-state-ready">
      {(state.policy.identities ?? []).map((identity) => (
        <PrincipalRow
          key={identity.id}
          identity={identity}
          isAdmin={isAdmin}
          mutating={mutating}
          onRevoke={onRevoke}
        />
      ))}
    </div>
  )
}

function GrantForm({
  newIdentityId,
  setNewIdentityId,
  newRole,
  setNewRole,
  mutating,
  onGrant,
}: {
  newIdentityId: string
  setNewIdentityId: (v: string) => void
  newRole: Role
  setNewRole: (v: Role) => void
  mutating: boolean
  onGrant: () => void
}) {
  return (
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
      <Button onClick={onGrant} disabled={mutating} size="sm">
        Grant
      </Button>
    </div>
  )
}

function PrincipalsSection({ isAdmin }: { isAdmin: boolean }) {
  const admin = usePrincipalsAdmin()

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
            void admin.refresh()
          }}
          disabled={admin.loading}
        >
          <RefreshCw className={admin.loading ? 'size-4 animate-spin' : 'size-4'} />
          <span className="ml-2">Refresh</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <PrincipalsListBody
          loading={admin.loading}
          state={admin.state}
          isAdmin={isAdmin}
          mutating={admin.mutating}
          onRevoke={(identityId, role) => {
            void admin.handleRevoke(identityId, role)
          }}
        />

        {isAdmin ? (
          <GrantForm
            newIdentityId={admin.newIdentityId}
            setNewIdentityId={admin.setNewIdentityId}
            newRole={admin.newRole}
            setNewRole={admin.setNewRole}
            mutating={admin.mutating}
            onGrant={() => {
              void admin.handleGrant()
            }}
          />
        ) : (
          <p className="text-xs text-muted-foreground pt-2 border-t">Admin role required to grant or revoke roles.</p>
        )}
      </CardContent>
    </Card>
  )
}

const USER_ACTIONS: readonly { label: string; op: IdentityOp }[] = [
  { label: 'Disable', op: 'identity.users.disable' },
  { label: 'Enable', op: 'identity.users.enable' },
  { label: 'Unlock', op: 'identity.users.unlock' },
  { label: 'Force logout', op: 'identity.users.force_logout' },
  { label: 'Reset password', op: 'identity.users.admin_reset' },
  { label: 'Deprovision', op: 'identity.users.deprovision' },
]

function UserRow({
  user,
  onAction,
  busy,
}: {
  user: IdentityUser
  onAction: (op: IdentityOp, id: string) => void
  busy: boolean
}) {
  return (
    <li className="rounded-md border p-3 space-y-2" data-testid="identity-user-row">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{user.username ?? user.principal_id}</strong>
        <span className="font-mono text-xs text-muted-foreground">{user.principal_id}</span>
        {user.status && <Badge variant="outline">{user.status}</Badge>}
        {user.kind && <Badge variant="secondary">{user.kind}</Badge>}
      </div>
      <div className="flex flex-wrap gap-1" aria-label={`Roles for ${user.username ?? user.principal_id}`}>
        {(user.roles ?? []).map((role) => (
          <Badge key={role} variant="outline">
            {role}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {USER_ACTIONS.filter(({ op }) => user.kind !== 'service' || op !== 'identity.users.admin_reset').map(
          ({ label, op }) => (
            <Button
              key={op}
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                onAction(
                  user.kind === 'service' && op === 'identity.users.deprovision'
                    ? 'identity.service_accounts.deprovision'
                    : op,
                  user.principal_id,
                )
              }}
            >
              {label}
            </Button>
          ),
        )}
      </div>
    </li>
  )
}

type UserRosterReply = IdentityReply<IdentityPage<IdentityUser>> | null

/** All user-roster state + mutations, kept out of the section's render body. */
function useUserRoster() {
  const { identity, loading: identityLoading } = useIdentity()
  const [username, setUsername] = useState('')
  const [newKind, setNewKind] = useState<'human' | 'service'>('human')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [users, setUsers] = useState<UserRosterReply>(null)
  const [busy, setBusy] = useState(false)
  const [resetToken, setResetToken] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    setActiveQuery('')
    setUsers(await invokeIdentity<IdentityPage<IdentityUser>>('identity.users.list', { limit: 50 }))
    setBusy(false)
  }, [])

  const search = useCallback(async () => {
    const query = searchQuery.trim()
    if (!query) return refresh()
    setBusy(true)
    setActiveQuery(query)
    setUsers(await invokeIdentity<IdentityPage<IdentityUser>>('identity.users.search', { query, limit: 50 }))
    setBusy(false)
  }, [searchQuery, refresh])

  const appendPage = (current: Extract<UserRosterReply, { kind: 'ready' }>, next: IdentityPage<IdentityUser>) => ({
    kind: 'ready' as const,
    result: { items: [...current.result.items, ...next.items], next_cursor: next.next_cursor },
  })

  const loadMore = useCallback(async () => {
    if (users?.kind !== 'ready' || !users.result.next_cursor) return
    setBusy(true)
    const next = await invokeIdentity<IdentityPage<IdentityUser>>(
      activeQuery ? 'identity.users.search' : 'identity.users.list',
      { after: users.result.next_cursor, limit: 50, ...(activeQuery ? { query: activeQuery } : {}) },
    )
    if (next.kind === 'ready') setUsers(appendPage(users, next.result))
    else toast.error(next.message)
    setBusy(false)
  }, [users, activeQuery])

  useEffect(() => {
    if (!identityLoading && !identity.needsSignIn) void refresh()
  }, [identityLoading, identity.needsSignIn, refresh])

  const create = useCallback(async () => {
    if (!username.trim()) return
    setBusy(true)
    const result = await invokeIdentity(
      newKind === 'service' ? 'identity.service_accounts.create' : 'identity.users.create',
      {
        username: username.trim(),
        ...(newKind === 'human' ? { kind: 'human' } : {}),
      },
    )
    if (result.kind === 'ready') {
      toast.success('User created.')
      setUsername('')
      void refresh()
    } else {
      toast.error(result.message)
      setBusy(false)
    }
  }, [username, newKind, refresh])

  const act = useCallback(
    async (op: IdentityOp, id: string) => {
      setBusy(true)
      setResetToken(null)
      const result = await invokeIdentity<{ reset_token?: string }>(op, { principal_id: id })
      if (result.kind === 'ready') {
        if (op === 'identity.users.admin_reset') setResetToken(result.result.reset_token ?? null)
        toast.success('Identity action completed.')
        void refresh()
      } else {
        toast.error(result.message)
        setBusy(false)
      }
    },
    [refresh],
  )

  return {
    needsSignIn: identity.needsSignIn,
    username,
    setUsername,
    newKind,
    setNewKind,
    searchQuery,
    setSearchQuery,
    users,
    busy,
    resetToken,
    refresh,
    search,
    loadMore,
    create,
    act,
  }
}

function UserRosterListBody({
  users,
  busy,
  onAction,
}: {
  users: UserRosterReply
  busy: boolean
  onAction: (op: IdentityOp, id: string) => void
}) {
  if (users === null) return <p role="status">Loading users…</p>
  if (users.kind !== 'ready') {
    return (
      <p role="status" data-testid={`users-${users.kind}`}>
        {users.message}
      </p>
    )
  }
  if (!Array.isArray(users.result.items)) {
    return <p role="alert">The identity service returned an invalid user list.</p>
  }
  if (users.result.items.length === 0) {
    return <p role="status">No users matched this search.</p>
  }
  return (
    <ul className="space-y-2">
      {users.result.items.map((user) => (
        <UserRow key={user.principal_id} user={user} busy={busy} onAction={onAction} />
      ))}
    </ul>
  )
}

function UserCreateForm({
  username,
  setUsername,
  newKind,
  setNewKind,
  busy,
  onCreate,
}: {
  username: string
  setUsername: (v: string) => void
  newKind: 'human' | 'service'
  setNewKind: (v: 'human' | 'service') => void
  busy: boolean
  onCreate: () => void
}) {
  return (
    <form
      className="flex gap-2 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault()
        onCreate()
      }}
    >
      <Input
        aria-label="New username"
        placeholder="New username"
        value={username}
        onChange={(e) => {
          setUsername(e.target.value)
        }}
      />
      <select
        aria-label="New identity kind"
        className="rounded border bg-background p-2"
        value={newKind}
        onChange={(event) => {
          setNewKind(event.target.value as 'human' | 'service')
        }}
      >
        <option value="human">Human</option>
        <option value="service">Service account</option>
      </select>
      <Button type="submit" disabled={busy || !username.trim()}>
        Create {newKind === 'service' ? 'service account' : 'user'}
      </Button>
    </form>
  )
}

/** The server alone decides roles, scopes, and whether a fresh MFA session is required. */
function UserRosterSection() {
  const roster = useUserRoster()

  if (roster.needsSignIn) {
    return (
      <Card data-testid="user-mgmt-roster">
        <CardHeader>
          <CardTitle className="text-base">User roster</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="status">Sign in to view the user roster.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-testid="user-mgmt-roster">
      <CardHeader>
        <CardTitle className="text-base">User roster</CardTitle>
        <CardDescription>Changes require identity administrator authority and a fresh MFA session.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void roster.search()
          }}
        >
          <Input
            aria-label="Search users"
            placeholder="Search users"
            value={roster.searchQuery}
            onChange={(event) => {
              roster.setSearchQuery(event.target.value)
            }}
          />
          <Button type="submit" disabled={roster.busy || !roster.searchQuery.trim()}>
            Search
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={roster.busy}
            onClick={() => {
              void roster.refresh()
            }}
            aria-label="Refresh users"
          >
            <RefreshCw className="size-4" />
          </Button>
        </form>
        <UserRosterListBody
          users={roster.users}
          busy={roster.busy}
          onAction={(op, id) => {
            void roster.act(op, id)
          }}
        />
        {roster.users?.kind === 'ready' && roster.users.result.next_cursor ? (
          <Button
            type="button"
            variant="outline"
            disabled={roster.busy}
            onClick={() => {
              void roster.loadMore()
            }}
          >
            Load more users
          </Button>
        ) : null}
        {roster.resetToken && (
          <p role="status" className="rounded border p-3">
            One-time reset token: <code>{roster.resetToken}</code>. Copy it now; it will not be shown again.
          </p>
        )}
        <UserCreateForm
          username={roster.username}
          setUsername={roster.setUsername}
          newKind={roster.newKind}
          setNewKind={roster.setNewKind}
          busy={roster.busy}
          onCreate={() => {
            void roster.create()
          }}
        />
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
          Your identity and roles, the fleet's principals and role grants, and the identity-admin user roster.
        </p>
      </div>

      <IdentityCard />
      <PrincipalsSection isAdmin={isAdmin} />
      <UserRosterSection />
    </div>
  )
}
