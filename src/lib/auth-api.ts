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

async function postJson(path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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
  return outcomeOf(await postJson('/auth/mfa/verify', { method, code }))
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
  await postJson('/auth/logout', {})
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
