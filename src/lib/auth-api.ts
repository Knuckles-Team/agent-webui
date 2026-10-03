/**
 * @file auth-api.ts
 * @description The browser side of the Graph OS identity broker's own routes:
 * sign-in, the second factor, first-run setup, sign-out and the list of
 * enabled identity providers. Every call is a same-origin JSON request, so
 * the browser attaches `Origin`; the CSRF chokepoint (`csrf.ts`) adds the
 * session's token where one exists. Answers are the server's fixed outcome
 * codes — nothing here interprets a role or a principal.
 */

/** A sign-in or second-factor outcome, as the engine decided it. */
export type SignInOutcome =
  'ok' | 'bad' | 'throttled' | 'mfa_required' | 'mfa_enrollment_required' | 'password_change_required' | 'error'

/** One enabled browser identity provider (`GET /auth/idps`). */
export interface IdentityProviderOption {
  idp_id: string
  display_name: string
  kind: string
}

async function sessionCsrfToken(): Promise<string> {
  const response = await fetch('/auth/session', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error('Identity session unavailable')
  const session = (await response.json()) as { csrf_token?: unknown }
  if (typeof session.csrf_token !== 'string' || !session.csrf_token)
    throw new Error('Identity session has no CSRF token')
  return session.csrf_token
}

async function postJson(path: string, body: Record<string, unknown>, sessionRequired = false): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (sessionRequired) headers['X-CSRF-Token'] = await sessionCsrfToken()
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify(body),
  })
}

async function outcomeOf(response: Response): Promise<SignInOutcome> {
  try {
    const body = (await response.json()) as { outcome?: unknown; error?: unknown }
    return typeof body.outcome === 'string' ? (body.outcome as SignInOutcome) : 'error'
  } catch {
    return 'error'
  }
}

export async function signIn(username: string, password: string): Promise<SignInOutcome> {
  return outcomeOf(await postJson('/auth/login', { username, password }))
}

export async function verifySecondFactor(method: 'totp' | 'recovery', code: string): Promise<SignInOutcome> {
  return outcomeOf(await postJson('/auth/mfa/verify', { method, code }, true))
}

/** First-run: create the first administrator with the operator's setup code. */
export async function createFirstAdministrator(
  setupCode: string,
  username: string,
  password: string,
): Promise<SignInOutcome> {
  const response = await postJson('/auth/setup', { setup_code: setupCode, username, password })
  if (response.status === 403) return 'bad'
  return outcomeOf(response)
}

/** Sign out: the broker revokes the session server-side. */
export async function signOut(): Promise<void> {
  const response = await postJson('/auth/logout', {}, true)
  if (!response.ok) throw new Error('Identity sign-out was refused')
}

/** Offline reset choices are uniform for every account; no e-mail claim is made. */
export async function forgotPassword(): Promise<{ emailReset: boolean; alternatives: string[] }> {
  const response = await postJson('/auth/password/forgot', {})
  if (!response.ok) throw new Error('Password recovery is unavailable')
  const body = (await response.json()) as { email_reset?: unknown; alternatives?: unknown }
  return {
    emailReset: body.email_reset === true,
    alternatives: Array.isArray(body.alternatives)
      ? body.alternatives.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  const response = await postJson('/auth/password/reset', { purpose: 'admin_reset', token, new_password: newPassword })
  if (!response.ok) return false
  const body = (await response.json()) as { reset?: unknown }
  return body.reset === true
}

export async function changePassword(current: string, next: string): Promise<boolean> {
  const response = await postJson('/auth/password/change', { current, new: next }, true)
  if (!response.ok) return false
  const body = (await response.json()) as { changed?: unknown }
  return body.changed === true
}

/** TOTP material and recovery codes are one-time responses; callers keep them in component memory only. */
export async function beginTotpEnrollment(): Promise<{ secret: string; provisioningUri: string }> {
  const response = await postJson('/auth/mfa/totp/enroll', {}, true)
  if (!response.ok) throw new Error('TOTP enrollment was refused')
  const body = (await response.json()) as { secret?: unknown; provisioning_uri?: unknown }
  if (typeof body.secret !== 'string' || typeof body.provisioning_uri !== 'string')
    throw new Error('TOTP enrollment answer was incomplete')
  return { secret: body.secret, provisioningUri: body.provisioning_uri }
}

export async function confirmTotpEnrollment(code: string): Promise<boolean> {
  const response = await postJson('/auth/mfa/totp/confirm', { code }, true)
  if (!response.ok) return false
  const body = (await response.json()) as { confirmed?: unknown }
  return body.confirmed === true
}

export async function regenerateRecoveryCodes(): Promise<string[]> {
  const response = await postJson('/auth/mfa/recovery-codes', {}, true)
  if (!response.ok) throw new Error('Recovery-code rotation was refused')
  const body = (await response.json()) as { codes?: unknown }
  if (!Array.isArray(body.codes) || !body.codes.every((code) => typeof code === 'string'))
    throw new Error('Recovery-code response was invalid')
  return body.codes
}

/** Enabled browser identity providers; an empty list when none (or on error). */
export async function listIdentityProviders(): Promise<IdentityProviderOption[]> {
  try {
    const response = await fetch('/auth/idps', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    if (!response.ok) return []
    const body = (await response.json()) as { idps?: unknown }
    return Array.isArray(body.idps) ? (body.idps as IdentityProviderOption[]) : []
  } catch {
    return []
  }
}
