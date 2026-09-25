import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useIdentity } from '@/lib/auth'
import {
  invokeIdentity,
  type IdentityPage,
  type IdentityReply,
  type IdentityUser,
  type IdentityOp,
} from '@/lib/graphos-api/identity'

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

/** The server alone decides roles, scopes, and whether a fresh MFA session is required. */
export default function UserManagementView() {
  const { identity, loading: identityLoading } = useIdentity()
  const [username, setUsername] = useState('')
  const [newKind, setNewKind] = useState<'human' | 'service'>('human')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [users, setUsers] = useState<IdentityReply<IdentityPage<IdentityUser>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [resetToken, setResetToken] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    setActiveQuery('')
    setUsers(await invokeIdentity<IdentityPage<IdentityUser>>('identity.users.list', { limit: 50 }))
    setBusy(false)
  }, [])

  const search = async () => {
    const query = searchQuery.trim()
    if (!query) return refresh()
    setBusy(true)
    setActiveQuery(query)
    setUsers(await invokeIdentity<IdentityPage<IdentityUser>>('identity.users.search', { query, limit: 50 }))
    setBusy(false)
  }

  const loadMore = async () => {
    if (users?.kind !== 'ready' || !users.result.next_cursor) return
    setBusy(true)
    const next = await invokeIdentity<IdentityPage<IdentityUser>>(
      activeQuery ? 'identity.users.search' : 'identity.users.list',
      {
        after: users.result.next_cursor,
        limit: 50,
        ...(activeQuery ? { query: activeQuery } : {}),
      },
    )
    if (next.kind === 'ready') {
      setUsers({
        kind: 'ready',
        result: { items: [...users.result.items, ...next.result.items], next_cursor: next.result.next_cursor },
      })
    } else {
      toast.error(next.message)
    }
    setBusy(false)
  }

  useEffect(() => {
    if (!identityLoading && !identity.needsSignIn) void refresh()
  }, [identityLoading, identity.needsSignIn, refresh])

  const create = async () => {
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
  }

  const act = async (op: IdentityOp, id: string) => {
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
  }

  return (
    <main className="space-y-6" data-testid="user-management-view">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="size-6" />
          Users
        </h1>
        <p className="text-sm text-muted-foreground">Manage local and external identities through Graph OS.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your session</CardTitle>
          <CardDescription>Identity and role as resolved by the server.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>
            Principal: <span className="font-mono">{identity.userKey}</span>
          </p>
          <p>
            Role: <Badge>{identity.role}</Badge>
          </p>
          <p>
            Tenant: <span className="font-mono">{identity.raw?.tenant ?? '—'}</span>
          </p>
        </CardContent>
      </Card>
      {identity.needsSignIn ? (
        <p role="status">Sign in to view the user roster.</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">User roster</CardTitle>
            <CardDescription>
              Changes require identity administrator authority and a fresh MFA session.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void search()
              }}
            >
              <Input
                aria-label="Search users"
                placeholder="Search users"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value)
                }}
              />
              <Button type="submit" disabled={busy || !searchQuery.trim()}>
                Search
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void refresh()
                }}
                aria-label="Refresh users"
              >
                <RefreshCw className="size-4" />
              </Button>
            </form>
            {users === null ? <p role="status">Loading users…</p> : null}
            {users?.kind !== 'ready' && users !== null ? (
              <p role="status" data-testid={`users-${users.kind}`}>
                {users.message}
              </p>
            ) : null}
            {users?.kind === 'ready' && !Array.isArray(users.result.items) ? (
              <p role="alert">The identity service returned an invalid user list.</p>
            ) : null}
            {users?.kind === 'ready' && Array.isArray(users.result.items) && users.result.items.length === 0 ? (
              <p role="status">No users matched this search.</p>
            ) : null}
            {users?.kind === 'ready' && Array.isArray(users.result.items) ? (
              <ul className="space-y-2">
                {users.result.items.map((user) => (
                  <UserRow
                    key={user.principal_id}
                    user={user}
                    busy={busy}
                    onAction={(op, id) => {
                      void act(op, id)
                    }}
                  />
                ))}
              </ul>
            ) : null}
            {users?.kind === 'ready' && users.result.next_cursor ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void loadMore()
                }}
              >
                Load more users
              </Button>
            ) : null}
            {resetToken && (
              <p role="status" className="rounded border p-3">
                One-time reset token: <code>{resetToken}</code>. Copy it now; it will not be shown again.
              </p>
            )}
            <form
              className="flex gap-2 border-t pt-4"
              onSubmit={(event) => {
                event.preventDefault()
                void create()
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
          </CardContent>
        </Card>
      )}
    </main>
  )
}
