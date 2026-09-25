/** Browser adapter for the Graph OS identity operation registry. */
export type IdentityOp =
  | 'identity.users.list'
  | 'identity.users.search'
  | 'identity.users.create'
  | 'identity.users.disable'
  | 'identity.users.enable'
  | 'identity.users.deprovision'
  | 'identity.users.unlock'
  | 'identity.users.force_logout'
  | 'identity.users.admin_reset'
  | 'identity.service_accounts.create'
  | 'identity.service_accounts.deprovision'
  | 'identity.groups.list'
  | 'identity.groups.upsert'
  | 'identity.groups.change_membership'
  | 'identity.roles.list'
  | 'identity.roles.upsert'
  | 'identity.roles.change_user_role'
  | 'identity.idps.list'
  | 'identity.idps.upsert'
  | 'identity.idps.mapping_dry_run'
  | 'identity.sessions.list'
  | 'identity.sessions.revoke'
  | 'identity.api_keys.list'
  | 'identity.api_keys.revoke'
  | 'identity.audit.list'
  | 'identity.audit.export'
  | 'identity.audit.verify'
  | 'identity.policy.get'
  | 'identity.policy.set'
  | 'identity.mode.status'
  | 'identity.mode.transition'

export type IdentityReply<T> =
  | { kind: 'ready'; result: T }
  | { kind: 'unavailable' | 'forbidden' | 'step_up' | 'confirmation' | 'error'; message: string }

interface Envelope<T> {
  ok?: unknown
  result?: T
  error?: { code?: string; message?: string }
}

/** No URL, token, or principal detail is reflected in a failed request. */
export async function invokeIdentity<T>(
  op: IdentityOp,
  params: Record<string, unknown> = {},
): Promise<IdentityReply<T>> {
  try {
    const response = await fetch(`/api/v1/ops/${op}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (response.status === 404 || response.status === 501 || response.status === 503) {
      return { kind: 'unavailable', message: 'This identity operation is not available on this server.' }
    }
    if (response.status === 401 || response.status === 403) {
      return { kind: 'forbidden', message: 'Your session cannot perform this identity operation.' }
    }
    const body = (await response.json()) as Envelope<T>
    if (response.status === 428) {
      return body.error?.code === 'STEP_UP_REQUIRED'
        ? { kind: 'step_up', message: 'A fresh administrator MFA confirmation is required.' }
        : { kind: 'confirmation', message: 'Review and confirm the operation plan in the administrator console.' }
    }
    if (response.ok && body.ok === true && 'result' in body) return { kind: 'ready', result: body.result as T }
    if (body.error?.code === 'STEP_UP_REQUIRED' || body.error?.code === 'CONFIRMATION_REQUIRED') {
      return { kind: 'step_up', message: 'Confirm this action in the administrator console.' }
    }
    if (body.error?.code === 'SURFACE_NOT_ALLOWED' || body.error?.code === 'SCOPE_REQUIRED') {
      return { kind: 'forbidden', message: 'This operation requires an authorized administrator session.' }
    }
    return { kind: 'error', message: 'The identity service did not confirm the operation.' }
  } catch {
    return { kind: 'unavailable', message: 'The identity service could not be reached.' }
  }
}

export interface IdentityUser {
  principal_id: string
  username?: string
  kind?: string
  status?: string
  roles?: string[]
}

export interface IdentityPage<T> {
  items: T[]
  next_cursor?: string | null
}
