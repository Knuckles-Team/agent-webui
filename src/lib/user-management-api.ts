/**
 * @file user-management-api.ts
 * @description Typed API layer for the User Management panel (principals +
 * role grants).
 *
 * WIRING (honest, empirically verified 2026-08-25 against the live `graph-os`
 * pod, `KG_DAEMON_ROLE=client` probe over `http://127.0.0.1:8080`):
 *
 *   - `GET /auth/session` is REAL and working (HTTP 200,
 *     `{"authenticated":false}` for an unauthenticated caller) -- this is
 *     `src/lib/auth.ts`'s `useIdentity()` boundary and is the one place the
 *     signed-in principal's own id/tenant/roles/admin-ness is read from. This
 *     module does not re-implement that; the view imports `useIdentity`
 *     directly.
 *   - There is NO REST route to list all principals or grant/revoke a role.
 *     `POST /api/graph/configure {action:"rbac_list"}` -- the closest
 *     existing surface, already probed by `admin-api.ts`'s `fetchRbacPolicy`
 *     for the read-only Admin console RBAC tab -- answers HTTP 200 with
 *     `{"status":"success","result":{"error":"unknown configuration
 *     action"}}`. Probed the same way for `action:"rbac_grant"` /
 *     `"rbac_revoke"` / `"identity_list"`: identical "unknown configuration
 *     action" reply. `GET /api/registry/identities`, `/api/dashboard/rbac`,
 *     `/api/dashboard/identities`, `/api/enhanced/{identity,users,principals}`
 *     all 404. `docs/reference/openapi.json` (191 routes) has no
 *     identity/role/rbac/principal path at all beyond `/api/oauth/*` and
 *     `/api/enhanced/sessions/*` (chat sessions, unrelated). The engine's
 *     `RbacAdmin`/`GetIdentity` methods (EG-092/EG-303) are reachable only
 *     over the epistemic-graph UDS/MessagePack client, not from the browser.
 *
 * Given that, this module: (a) keeps probing the closest surface, exactly
 * like `admin-api.ts`'s existing RBAC probe convention, so the panel lights
 * up for free the moment a REST twin is wired; (b) treats the dispatcher's
 * "unknown configuration action" reply as `unavailable` -- NOT as a valid
 * empty policy -- which `admin-api.ts::fetchRbacPolicy` does not do today
 * (it has no schema, so that reply currently parses as `RbacPolicy{}` and
 * renders "0 roles / 0 grants / 0 identities", indistinguishable from a
 * genuinely empty policy; see this module's `isUnrecognizedConfigureAction`);
 * (c) NEVER reports a grant/revoke mutation as succeeded unless the server
 * answered with the specific confirmation field -- an unrecognized action, a
 * network error, or a 403 all resolve to a distinct, visible non-`ok` state.
 */

import { z } from 'zod'
import { gatewayPost } from './gateway'
import { looseArray } from './api-validation'
import type { RbacPolicy, RbacRole, RbacGrant, AgentIdentity } from './admin-api'

const rbacRoleSchema: z.ZodType<RbacRole> = z.object({
  name: z.string(),
  description: z.string().optional(),
})
const rbacGrantSchema: z.ZodType<RbacGrant> = z.object({
  role: z.string(),
  resource: z.string().optional(),
  action: z.string().optional(),
  effect: z.string().optional(),
})
const agentIdentitySchema: z.ZodType<AgentIdentity> = z.object({
  id: z.string(),
  roles: looseArray(z.string()).optional(),
})
const rbacPolicySchema: z.ZodType<RbacPolicy> = z.object({
  roles: looseArray(rbacRoleSchema),
  grants: looseArray(rbacGrantSchema),
  identities: looseArray(agentIdentitySchema).optional(),
})

/**
 * True when `raw` is exactly the `/graph/configure` dispatcher's "I don't
 * recognize this action" reply -- an object whose ONLY key is a string
 * `error` -- rather than a real payload that happens to also carry an
 * `error` field alongside real data. `gatewayPost`'s HTTP-level `unavailable`
 * detection (404/501) can't see this: the dispatcher answers HTTP 200.
 */
function isUnrecognizedConfigureAction(raw: unknown): raw is { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const keys = Object.keys(raw)
  return keys.length === 1 && keys[0] === 'error' && typeof (raw as Record<string, unknown>).error === 'string'
}

/** True when a gateway error string is the shared helpers' `HTTP 403: ...` shape. */
function isForbiddenError(error: string | undefined): boolean {
  return !!error && /^HTTP 403\b/.test(error)
}

/** The three-plus-ready render states the Users panel distinguishes. Never
 *  collapse `unavailable` (route not wired) into `empty` (route answered,
 *  zero principals) or `forbidden` (caller lacks admin) -- that collapse is
 *  the exact defect class this program has repeatedly hit ("0 MCP servers"
 *  indistinguishable from "catalog unreadable"). */
export type PrincipalsState =
  | { kind: 'unavailable'; detail?: string }
  | { kind: 'forbidden'; detail?: string }
  | { kind: 'error'; detail: string }
  | { kind: 'empty' }
  | { kind: 'ready'; policy: RbacPolicy }

export async function fetchPrincipalsAndRoles(): Promise<PrincipalsState> {
  const r = await gatewayPost<unknown>('/configure', { action: 'rbac_list' })
  if (r.unavailable) return { kind: 'unavailable', detail: r.error }
  if (!r.ok) {
    if (isForbiddenError(r.error)) return { kind: 'forbidden', detail: r.error }
    return { kind: 'error', detail: r.error ?? 'Request failed' }
  }
  if (isUnrecognizedConfigureAction(r.data)) {
    return { kind: 'unavailable', detail: r.data.error }
  }
  const parsed = rbacPolicySchema.safeParse(r.data)
  if (!parsed.success) {
    const [issue] = parsed.error.issues
    return {
      kind: 'error',
      detail: `Unexpected response shape from /api/graph/configure (rbac_list): ${issue.path.join('.')} ${issue.message}`,
    }
  }
  const { roles, grants, identities } = parsed.data
  if (roles.length === 0 && grants.length === 0 && (identities ?? []).length === 0) {
    return { kind: 'empty' }
  }
  return { kind: 'ready', policy: parsed.data }
}

/** Result of a grant/revoke attempt. `kind: 'ok'` is the ONLY success case --
 *  every other branch (including an unrecognized action) is a visible
 *  failure the caller must render, never a silent no-op that looks like
 *  success. */
export type RoleMutationResult =
  | { kind: 'unavailable'; detail: string }
  | { kind: 'forbidden'; detail: string }
  | { kind: 'error'; detail: string }
  | { kind: 'ok' }

async function probeRoleMutation(
  action: 'rbac_grant' | 'rbac_revoke',
  identityId: string,
  role: string,
): Promise<RoleMutationResult> {
  const r = await gatewayPost<unknown>('/configure', { action, identity_id: identityId, role })
  if (r.unavailable) {
    return { kind: 'unavailable', detail: r.error ?? 'Route not found' }
  }
  if (!r.ok) {
    if (isForbiddenError(r.error)) return { kind: 'forbidden', detail: r.error ?? 'Forbidden' }
    return { kind: 'error', detail: r.error ?? 'Request failed' }
  }
  if (isUnrecognizedConfigureAction(r.data)) {
    return { kind: 'unavailable', detail: r.data.error }
  }
  const successKey = action === 'rbac_grant' ? 'granted' : 'revoked'
  if (
    r.data &&
    typeof r.data === 'object' &&
    !Array.isArray(r.data) &&
    (r.data as Record<string, unknown>)[successKey] === true
  ) {
    return { kind: 'ok' }
  }
  return { kind: 'error', detail: 'Server did not confirm the role change.' }
}

/**
 * Attempt to grant `role` to `identityId`. There is no REST twin for this
 * today (see file docstring) -- this always resolves `unavailable` against
 * the live deployment, by design, rather than fabricating success. Wired
 * against the closest probe surface so it starts working the moment the
 * backend adds the route, with no further frontend change.
 */
export function grantRole(identityId: string, role: string): Promise<RoleMutationResult> {
  return probeRoleMutation('rbac_grant', identityId, role)
}

/** Attempt to revoke `role` from `identityId`. See {@link grantRole}. */
export function revokeRole(identityId: string, role: string): Promise<RoleMutationResult> {
  return probeRoleMutation('rbac_revoke', identityId, role)
}
