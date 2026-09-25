import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { invokeIdentity, type IdentityOp, type IdentityPage, type IdentityReply } from '@/lib/graphos-api/identity'
import UserManagementView from './UserManagementView'
import TenantsPanel from './admin/TenantsPanel'
import ShardsPanel from './admin/ShardsPanel'
import BackupPanel from './admin/BackupPanel'
import IdentityPolicyPanel from './admin/IdentityPolicyPanel'

interface ListedItem {
  id?: string
  handle?: string
  key_id?: string
  name?: string
  username?: string
  status?: string
  description?: string
}

function ListPanel({
  title,
  op,
  description,
  principalId,
  revokeOp,
}: {
  title: string
  op: IdentityOp
  description: string
  principalId?: string
  revokeOp?: IdentityOp
}) {
  const [state, setState] = useState<IdentityReply<IdentityPage<ListedItem>> | null>(null)
  const [revision, setRevision] = useState(0)
  const [mutation, setMutation] = useState<IdentityReply<unknown> | null>(null)
  useEffect(() => {
    let active = true
    if ((op === 'identity.sessions.list' || op === 'identity.api_keys.list') && !principalId)
      return () => {
        active = false
      }
    const params = op === 'identity.audit.list' || op === 'identity.api_keys.list' ? { limit: 50 } : {}
    void invokeIdentity<IdentityPage<ListedItem>>(op, {
      ...params,
      ...(principalId ? { principal_id: principalId } : {}),
    }).then((reply) => {
      if (active) setState(reply)
    })
    return () => {
      active = false
    }
  }, [op, principalId, revision])
  const revoke = async (id: string) => {
    if (!revokeOp) return
    const reply = await invokeIdentity(revokeOp, { id })
    setMutation(reply)
    if (reply.kind === 'ready') setRevision((value) => value + 1)
  }
  const loadMore = async () => {
    if (state?.kind !== 'ready' || !state.result.next_cursor) return
    const params = {
      after: state.result.next_cursor,
      limit: 50,
      ...(principalId ? { principal_id: principalId } : {}),
    }
    const next = await invokeIdentity<IdentityPage<ListedItem>>(op, params)
    if (next.kind === 'ready') {
      setState({
        kind: 'ready',
        result: { items: [...state.result.items, ...next.result.items], next_cursor: next.result.next_cursor },
      })
    } else setMutation(next)
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {principalId && <p className="mb-2 text-xs text-muted-foreground">Principal: {principalId}</p>}
        {state !== null && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mb-3"
            onClick={() => {
              setRevision((value) => value + 1)
            }}
          >
            Refresh
          </Button>
        )}
        {state === null && (
          <p role="status">
            {(op === 'identity.sessions.list' || op === 'identity.api_keys.list') && !principalId
              ? 'Enter a principal id to inspect its records.'
              : 'Loading…'}
          </p>
        )}
        {state !== null && state.kind !== 'ready' && <p role="status">{state.message}</p>}
        {state?.kind === 'ready' && !Array.isArray(state.result.items) && (
          <p role="alert">The identity service returned an invalid list.</p>
        )}
        {state?.kind === 'ready' && Array.isArray(state.result.items) && state.result.items.length === 0 && (
          <p role="status">No records reported.</p>
        )}
        {state?.kind === 'ready' && Array.isArray(state.result.items) && (
          <ul className="space-y-2">
            {state.result.items.map((item, index) => (
              <li key={item.id ?? item.handle ?? item.key_id ?? index} className="rounded border p-2">
                <strong>
                  {item.name ?? item.username ?? item.id ?? item.handle ?? item.key_id ?? `Record ${index + 1}`}
                </strong>
                {item.status && <span className="ml-2 text-muted-foreground">{item.status}</span>}
                {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
                {revokeOp && (item.handle ?? item.id ?? item.key_id) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="ml-2"
                    onClick={() => {
                      void revoke(item.handle ?? item.id ?? item.key_id ?? '')
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {state?.kind === 'ready' && state.result.next_cursor && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void loadMore()
            }}
          >
            Load more
          </Button>
        )}
        {mutation && <p role="status">{mutation.kind === 'ready' ? 'Revocation confirmed.' : mutation.message}</p>}
      </CardContent>
    </Card>
  )
}

function PrincipalRecordsPanel({ kind }: { kind: 'sessions' | 'api-keys' }) {
  const [draft, setDraft] = useState('')
  const [principalId, setPrincipalId] = useState('')
  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setPrincipalId(draft.trim())
        }}
      >
        <Input
          aria-label={`${kind === 'sessions' ? 'Session' : 'API key'} principal id`}
          placeholder="Principal id"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
          }}
        />
        <Button type="submit" disabled={!draft.trim()}>
          Load {kind}
        </Button>
      </form>
      <ListPanel
        title={kind === 'sessions' ? 'Sessions' : 'API keys'}
        op={kind === 'sessions' ? 'identity.sessions.list' : 'identity.api_keys.list'}
        principalId={principalId}
        revokeOp={kind === 'sessions' ? 'identity.sessions.revoke' : 'identity.api_keys.revoke'}
        description={
          kind === 'sessions' ? 'Sessions for the selected principal.' : 'Metadata only; secrets are never displayed.'
        }
      />
    </div>
  )
}

function RoleGroupEditor({ kind }: { kind: 'role' | 'group' }) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [entries, setEntries] = useState('')
  const [principalId, setPrincipalId] = useState('')
  const [change, setChange] = useState<'add' | 'remove'>('add')
  const [outcome, setOutcome] = useState<IdentityReply<unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  const group = kind === 'group'
  const title = group ? 'Group' : 'Role'
  const upsert = async () => {
    setBusy(true)
    const values = entries
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const params = group ? { group_id: id, name, roles: values } : { role_id: id, name, scopes: values }
    setOutcome(await invokeIdentity(group ? 'identity.groups.upsert' : 'identity.roles.upsert', params))
    setBusy(false)
  }
  const membership = async () => {
    setBusy(true)
    const params = group
      ? { principal_id: principalId, group_id: id, change }
      : { principal_id: principalId, role_id: id, change }
    setOutcome(
      await invokeIdentity(group ? 'identity.groups.change_membership' : 'identity.roles.change_user_role', params),
    )
    setBusy(false)
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title} administration</CardTitle>
        <CardDescription>Writes require administrator authority and fresh MFA.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <Input
            aria-label={`${title} id`}
            placeholder={`${title} id`}
            value={id}
            onChange={(event) => {
              setId(event.target.value)
            }}
          />
          <Input
            aria-label={`${title} name`}
            placeholder="Display name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
          <Input
            aria-label={group ? 'Group roles' : 'Role scopes'}
            placeholder={group ? 'Roles, comma separated' : 'Scopes, comma separated'}
            value={entries}
            onChange={(event) => {
              setEntries(event.target.value)
            }}
          />
        </div>
        <Button
          type="button"
          disabled={busy || !id.trim() || !name.trim()}
          onClick={() => {
            void upsert()
          }}
        >
          Save {title.toLowerCase()}
        </Button>
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Input
            aria-label="Member principal id"
            className="max-w-xs"
            placeholder="Principal id"
            value={principalId}
            onChange={(event) => {
              setPrincipalId(event.target.value)
            }}
          />
          <select
            aria-label="Membership action"
            className="rounded border bg-background p-2"
            value={change}
            onChange={(event) => {
              setChange(event.target.value as 'add' | 'remove')
            }}
          >
            <option value="add">Add</option>
            <option value="remove">Remove</option>
          </select>
          <Button
            type="button"
            disabled={busy || !id.trim() || !principalId.trim()}
            onClick={() => {
              void membership()
            }}
          >
            Apply membership
          </Button>
        </div>
        {outcome && (
          <p role="status">
            {outcome.kind === 'ready' ? `${title} change confirmed. Refresh the list.` : outcome.message}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function MappingDryRun() {
  const [idpId, setIdpId] = useState('')
  const [claimsText, setClaimsText] = useState('{"groups":[]}')
  const [result, setResult] = useState<IdentityReply<{ roles: string[]; groups: string[]; scopes: string[] }> | null>(
    null,
  )
  const run = async () => {
    try {
      const claims = JSON.parse(claimsText) as unknown
      if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error('Claims must be an object')
      if (
        !Object.values(claims).every(
          (value) => Array.isArray(value) && value.every((item) => typeof item === 'string'),
        )
      ) {
        throw new Error('Every claim must be a string array')
      }
      setResult(await invokeIdentity('identity.idps.mapping_dry_run', { idp_id: idpId, claims }))
    } catch {
      setResult({ kind: 'error', message: 'Enter a JSON object whose values are string arrays.' })
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mapping rule dry run</CardTitle>
        <CardDescription>
          Preview the roles, groups and scopes a sample claim set would receive. This does not change an identity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          aria-label="Identity provider id"
          placeholder="Identity provider id"
          value={idpId}
          onChange={(e) => {
            setIdpId(e.target.value)
          }}
        />
        <textarea
          aria-label="Sample claims JSON"
          className="w-full rounded border bg-background p-2 font-mono text-sm"
          rows={4}
          value={claimsText}
          onChange={(e) => {
            setClaimsText(e.target.value)
          }}
        />
        <Button
          type="button"
          disabled={!idpId.trim()}
          onClick={() => {
            void run()
          }}
        >
          Evaluate mapping
        </Button>
        {result?.kind !== 'ready' && result !== null && <p role="status">{result.message}</p>}
        {result?.kind === 'ready' && (
          <dl className="text-sm space-y-1">
            <dt>Roles</dt>
            <dd>{result.result.roles.join(', ') || 'None'}</dd>
            <dt>Groups</dt>
            <dd>{result.result.groups.join(', ') || 'None'}</dd>
            <dt>Scopes</dt>
            <dd>{result.result.scopes.join(', ') || 'None'}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

function IdentityProviderEditor() {
  const [idpId, setIdpId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [kind, setKind] = useState<'oidc' | 'saml' | 'ldap' | 'scim'>('oidc')
  const [configJson, setConfigJson] = useState('{}')
  const [secretRef, setSecretRef] = useState('')
  const [outcome, setOutcome] = useState<IdentityReply<unknown> | null>(null)
  const save = async () => {
    try {
      const config = JSON.parse(configJson) as unknown
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid configuration')
      setOutcome(
        await invokeIdentity('identity.idps.upsert', {
          idp_id: idpId.trim(),
          kind,
          display_name: displayName.trim(),
          enabled: false,
          config_json: configJson,
          jit_policy: 'deny',
          ...(secretRef.trim() ? { secret_ref: secretRef.trim() } : {}),
        }),
      )
    } catch {
      setOutcome({ kind: 'error', message: 'Configuration must be a JSON object.' })
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configure identity provider</CardTitle>
        <CardDescription>
          Use a secret reference; do not paste credentials. New providers start disabled with just-in-time provisioning
          denied until mapping rules are reviewed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            aria-label="Provider id"
            placeholder="Provider id"
            value={idpId}
            onChange={(event) => {
              setIdpId(event.target.value)
            }}
          />
          <Input
            aria-label="Provider display name"
            placeholder="Display name"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value)
            }}
          />
        </div>
        <select
          aria-label="Provider kind"
          className="rounded border bg-background p-2"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as 'oidc' | 'saml' | 'ldap' | 'scim')
          }}
        >
          <option value="oidc">OIDC</option>
          <option value="saml">SAML</option>
          <option value="ldap">LDAP</option>
          <option value="scim">SCIM</option>
        </select>
        <Input
          aria-label="Provider secret reference"
          placeholder="Secret reference (optional)"
          value={secretRef}
          onChange={(event) => {
            setSecretRef(event.target.value)
          }}
        />
        <textarea
          aria-label="Provider configuration JSON"
          className="w-full rounded border bg-background p-2 font-mono text-sm"
          rows={5}
          value={configJson}
          onChange={(event) => {
            setConfigJson(event.target.value)
          }}
        />
        <Button
          type="button"
          disabled={!idpId.trim() || !displayName.trim()}
          onClick={() => {
            void save()
          }}
        >
          Save provider
        </Button>
        {outcome && (
          <p role="status">{outcome.kind === 'ready' ? 'Provider saved. Refresh the list.' : outcome.message}</p>
        )}
      </CardContent>
    </Card>
  )
}

function ModePanel() {
  const [state, setState] = useState<IdentityReply<{ mode: string; epoch?: number }> | null>(null)
  const [target, setTarget] = useState('')
  const [fallback, setFallback] = useState<'off' | 'break_glass' | 'full'>('break_glass')
  const [acknowledged, setAcknowledged] = useState(false)
  const [transition, setTransition] = useState<IdentityReply<unknown> | null>(null)
  useEffect(() => {
    let active = true
    void invokeIdentity<{ mode: string; epoch?: number }>('identity.mode.status').then((reply) => {
      if (active) setState(reply)
    })
    return () => {
      active = false
    }
  }, [])
  const submit = async () => {
    const params = target === 'external' ? { to: target, local_fallback: fallback } : { to: target }
    const reply = await invokeIdentity('identity.mode.transition', params)
    setTransition(reply)
    if (reply.kind === 'ready')
      setState(await invokeIdentity<{ mode: string; epoch?: number }>('identity.mode.status'))
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Security mode</CardTitle>
        <CardDescription>
          Mode transitions require a fresh MFA administrator session. A successful transition revokes existing
          sessions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === null && <p role="status">Loading mode…</p>}
        {state !== null && state.kind !== 'ready' && <p role="status">{state.message}</p>}
        {state?.kind === 'ready' && (
          <p>
            Current mode: <strong>{state.result.mode}</strong>
          </p>
        )}
        <label className="block text-sm" htmlFor="target-mode">
          Target mode
        </label>
        <select
          id="target-mode"
          className="rounded border bg-background p-2"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value)
          }}
        >
          <option value="">Select a mode</option>
          <option value="local">Local</option>
          <option value="external">External</option>
        </select>
        {target === 'external' && (
          <select
            aria-label="Local fallback"
            className="rounded border bg-background p-2"
            value={fallback}
            onChange={(event) => {
              setFallback(event.target.value as 'off' | 'break_glass' | 'full')
            }}
          >
            <option value="off">No local fallback</option>
            <option value="break_glass">Break glass only</option>
            <option value="full">Full local fallback</option>
          </select>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => {
              setAcknowledged(event.target.checked)
            }}
          />
          I understand this transition revokes current sessions.
        </label>
        <Button
          type="button"
          disabled={!acknowledged || !target || state?.kind !== 'ready' || target === state.result.mode}
          onClick={() => {
            void submit()
          }}
        >
          Request transition
        </Button>
        {transition && (
          <p role="status">
            {transition.kind === 'ready' ? 'Transition completed. Sign in again.' : transition.message}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function AuditPanel() {
  const [verified, setVerified] = useState<IdentityReply<{ valid: boolean; first_broken_seq?: number }> | null>(null)
  const [exported, setExported] = useState<IdentityReply<IdentityPage<unknown>> | null>(null)
  const verify = async () => {
    setVerified(await invokeIdentity<{ valid: boolean; first_broken_seq?: number }>('identity.audit.verify'))
  }
  const exportPage = async () => {
    const result = await invokeIdentity<IdentityPage<unknown>>('identity.audit.export', { limit: 500 })
    setExported(result)
    if (result.kind !== 'ready') return
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.result, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'identity-audit-page.json'
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="space-y-4">
      <ListPanel title="Identity audit" op="identity.audit.list" description="Identity administration events." />
      <Card>
        <CardHeader>
          <CardTitle>Audit integrity and export</CardTitle>
          <CardDescription>Verify the chain or export a bounded page with its continuation cursor.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void verify()
              }}
            >
              Verify audit chain
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void exportPage()
              }}
            >
              Export first audit page
            </Button>
          </div>
          {verified && (
            <p role="status">
              {verified.kind === 'ready'
                ? verified.result.valid
                  ? 'Audit chain verified.'
                  : `Audit chain broken at sequence ${verified.result.first_broken_seq ?? 'unknown'}.`
                : verified.message}
            </p>
          )}
          {exported && exported.kind !== 'ready' && <p role="status">{exported.message}</p>}
        </CardContent>
      </Card>
    </div>
  )
}

export default function AdminView() {
  return (
    <div className="space-y-6" data-testid="admin-view">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="size-6" />
          Admin Console
        </h1>
        <p className="text-sm text-muted-foreground">Graph OS identity, security and engine administration.</p>
      </div>
      <Tabs defaultValue="users">
        <TabsList className="flex h-auto flex-wrap justify-start">
          {[
            'users',
            'groups',
            'roles',
            'idps',
            'sessions',
            'api-keys',
            'audit',
            'security-mode',
            'policy',
            'tenants',
            'shards',
            'backup',
          ].map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {tab.replaceAll('-', ' ')}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="users">
          <UserManagementView />
        </TabsContent>
        <TabsContent value="groups" className="space-y-4">
          <ListPanel
            title="Groups"
            op="identity.groups.list"
            description="Groups and memberships from Graph OS identity."
          />
          <RoleGroupEditor kind="group" />
        </TabsContent>
        <TabsContent value="roles" className="space-y-4">
          <ListPanel
            title="Roles and scopes"
            op="identity.roles.list"
            description="Roles and effective scope grants from Graph OS identity."
          />
          <RoleGroupEditor kind="role" />
        </TabsContent>
        <TabsContent value="idps" className="space-y-4">
          <ListPanel
            title="Identity providers"
            op="identity.idps.list"
            description="Configured external authorities."
          />
          <IdentityProviderEditor />
          <MappingDryRun />
        </TabsContent>
        <TabsContent value="sessions">
          <PrincipalRecordsPanel kind="sessions" />
        </TabsContent>
        <TabsContent value="api-keys">
          <PrincipalRecordsPanel kind="api-keys" />
        </TabsContent>
        <TabsContent value="audit">
          <AuditPanel />
        </TabsContent>
        <TabsContent value="security-mode">
          <ModePanel />
        </TabsContent>
        <TabsContent value="policy">
          <IdentityPolicyPanel />
        </TabsContent>
        <TabsContent value="tenants">
          <TenantsPanel />
        </TabsContent>
        <TabsContent value="shards">
          <ShardsPanel />
        </TabsContent>
        <TabsContent value="backup">
          <BackupPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
