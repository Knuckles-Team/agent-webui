/**
 * @file RbacPanel.tsx
 * @description Roles / grants / agent identities for the Admin console.
 *
 * WIRING (honest): the engine RBAC admin — durable roles + role hierarchy +
 * resource/action grants over per-agent RLS/ACL with a hash-chained audit
 * (CONCEPT:EG-092), persisted to redb and reloaded at boot (CONCEPT:EG-303) —
 * is a `Method::RbacAdmin` engine op reachable ONLY over the epistemic_graph
 * UDS/MessagePack client (`client.rbac.*`). There is no browser-facing REST twin
 * yet, so this panel PROBES the closest existing surface
 * (`POST /api/graph/configure` action=rbac_list) and, when it resolves
 * `unavailable` (the common case today), renders a clearly-labeled read-only
 * state describing the model — it never fabricates roles/grants. If/when the
 * REST twin lands, the same probe renders the live policy with no further wiring.
 */

import { useEffect, useState } from 'react'
import { KeyRound, Loader2, RefreshCw, ShieldAlert, UserCog } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { fetchRbacPolicy, type AgentIdentity, type RbacGrant, type RbacPolicy, type RbacRole } from '@/lib/admin-api'

/** RBAC policy probe state, kept out of the panel's own render body. */
function useRbacPolicy() {
  const [policy, setPolicy] = useState<RbacPolicy | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    const r = await fetchRbacPolicy()
    setUnavailable(!r.ok)
    setPolicy(r.ok ? r.data : null)
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  return { policy, unavailable, loading, refresh }
}

function UnwiredNotice() {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Badge variant="outline">read-only · not wired</Badge>
          RBAC admin not exposed over REST yet
        </CardTitle>
        <CardDescription>
          The engine RBAC admin surface (EG-092 roles/grants + EG-303 durable persistence) is reachable today only over
          the epistemic-graph UDS client (<code>client.rbac.*</code> — AddRole / RemoveRole / AddGrant / RemoveGrant /
          List). This panel will render the live policy — and enable editing where the API allows — as soon as the REST
          twin is wired; until then it is read-only by design and shows no fabricated data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">The engine RBAC model:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="font-medium text-foreground">Roles</span> — durable named roles with a role hierarchy
            (EG-092), persisted to redb and reloaded at boot (EG-303).
          </li>
          <li>
            <span className="font-medium text-foreground">Grants</span> — resource/action grants bound to a role,
            enforced over per-agent row-level security + ACLs with a hash-chained audit log.
          </li>
          <li>
            <span className="font-medium text-foreground">Agent identities</span> — the agent principals the grants are
            evaluated against.
          </li>
        </ul>
      </CardContent>
    </Card>
  )
}

function RolesCard({ roles }: { roles: RbacRole[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <UserCog className="size-4" />
          Roles
          <Badge variant="secondary">{roles.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {roles.length === 0 ? (
          <p className="text-muted-foreground text-sm">No roles.</p>
        ) : (
          roles.map((r) => (
            <div key={r.name} className="rounded border p-2 text-sm">
              <span className="font-medium font-mono">{r.name}</span>
              {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function GrantsCard({ grants }: { grants: RbacGrant[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="size-4" />
          Grants
          <Badge variant="secondary">{grants.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {grants.length === 0 ? (
          <p className="text-muted-foreground text-sm">No grants.</p>
        ) : (
          grants.map((g, i) => (
            <div key={`${g.role}-${String(i)}`} className="rounded border p-2 text-xs font-mono">
              <span className="font-medium">{g.role}</span>
              {' → '}
              {g.action ?? '*'} on {g.resource ?? '*'}
              {g.effect && (
                <Badge variant="outline" className="ml-2">
                  {g.effect}
                </Badge>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function IdentitiesCard({ identities }: { identities: AgentIdentity[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <UserCog className="size-4" />
          Agent identities
          <Badge variant="secondary">{identities.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {identities.length === 0 ? (
          <p className="text-muted-foreground text-sm">No identities.</p>
        ) : (
          identities.map((a) => (
            <div key={a.id} className="rounded border p-2 text-sm">
              <span className="font-mono">{a.id}</span>
              {a.roles && a.roles.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {a.roles.map((role) => (
                    <Badge key={role} variant="outline" className="text-xs">
                      {role}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function RbacBody({
  loading,
  unavailable,
  policy,
}: {
  loading: boolean
  unavailable: boolean
  policy: RbacPolicy | null
}) {
  if (loading) return <Loader2 className="size-5 animate-spin text-muted-foreground" />
  if (unavailable) return <UnwiredNotice />
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <RolesCard roles={policy?.roles ?? []} />
      <GrantsCard grants={policy?.grants ?? []} />
      <IdentitiesCard identities={policy?.identities ?? []} />
    </div>
  )
}

export default function RbacPanel() {
  const rbac = useRbacPolicy()

  return (
    <div className="space-y-6" data-testid="admin-rbac-panel">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ShieldAlert className="size-5" />
            RBAC
          </h2>
          <p className="text-muted-foreground text-sm">
            Roles, resource/action grants and agent identities (EG-092 / EG-303).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void rbac.refresh()
          }}
          disabled={rbac.loading}
        >
          <RefreshCw className={rbac.loading ? 'size-4 animate-spin' : 'size-4'} />
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      <RbacBody loading={rbac.loading} unavailable={rbac.unavailable} policy={rbac.policy} />
    </div>
  )
}
