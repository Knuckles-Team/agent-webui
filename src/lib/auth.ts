/**
 * @file auth.ts
 * @description Reads the signed-in operator's identity and role from the
 * SAME OIDC boundary the server already terminates
 * (`agent/agent_webui/oidc_session.py`'s `OIDCBrowserSessionMiddleware`).
 *
 * This is deliberately NOT a second auth path: `/auth/session` is owned by
 * that middleware, and the `webui_role` it reports is computed server-side by
 * `agent/agent_webui/rbac.py` from the actor's verified realm roles — the
 * frontend never re-derives a role from raw claims itself, it only reads what
 * the server already decided. That is what keeps the UI's role filtering and
 * the server's enforcement (`WebUIAuthorizationMiddleware`) from being able to
 * drift into two different answers.
 *
 * `/auth/session` is a zero-configuration endpoint: when the deployment has
 * not set `WEBUI_OIDC_*` (the local/dev default), `OIDCBrowserSessionMiddleware`
 * is never installed and the path falls through to the SPA shell instead of
 * answering JSON. `fetchAuthSession` treats that — and any other failure to
 * parse a `{authenticated: boolean, ...}` body — as "SSO is not configured",
 * not as "signed out", and {@link resolveIdentity} maps that to the same
 * full-access single-operator experience the WebUI had before RBAC existed.
 */
import { useEffect, useState } from 'react'
import { isRole, type Role } from './nav-registry'

/** Shape returned by `GET /auth/session` (see `oidc_session.py::_handle_session`). */
export interface AuthSession {
  authenticated: boolean
  subject?: string | null
  username?: string | null
  email?: string | null
  tenant?: string | null
  roles: string[]
  /** Computed server-side by `agent/agent_webui/rbac.py::resolve_webui_role`. */
  webui_role?: string | null
  expires_at?: number | null
}

/** The one thing the rest of the app needs: who, and what they may do. */
export interface Identity {
  /** Stable per-user key for namespacing per-user local state (chat history,
   *  dashboard layout, preferences). `'local'` is the shared single-operator
   *  key used when SSO is not configured, or as an anonymous fallback. */
  userKey: string
  role: Role
  /** False when `WEBUI_OIDC_*` is not configured on this deployment — the
   *  zero-config dev/local posture. */
  ssoConfigured: boolean
  /** True when SSO is configured but the browser has no valid session — the
   *  UI should offer a sign-in affordance rather than pretend full access. */
  needsSignIn: boolean
  raw: AuthSession | null
}

const DEV_USER_KEY = 'local'

async function fetchAuthSession(): Promise<{ session: AuthSession | null; ssoConfigured: boolean }> {
  try {
    const res = await fetch('/auth/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !contentType.includes('application/json')) {
      // Either the endpoint does not exist (SSO not configured, falls through
      // to the SPA shell) or answered with something unexpected — both read
      // as "not configured" rather than a hard error the operator has to chase.
      return { session: null, ssoConfigured: false }
    }
    const body = (await res.json()) as Partial<AuthSession>
    if (typeof body.authenticated !== 'boolean') {
      return { session: null, ssoConfigured: false }
    }
    return {
      session: { roles: [], ...body, authenticated: body.authenticated },
      ssoConfigured: true,
    }
  } catch {
    return { session: null, ssoConfigured: false }
  }
}

/** Pure mapping from a raw session (or its absence) to what the app renders. */
export function resolveIdentity(session: AuthSession | null, ssoConfigured: boolean): Identity {
  if (!ssoConfigured) {
    return { userKey: DEV_USER_KEY, role: 'admin', ssoConfigured: false, needsSignIn: false, raw: session }
  }
  if (!session?.authenticated) {
    // SSO is configured but this request has no valid session. A top-level
    // browser navigation would already have been redirected to /auth/login by
    // the server before the SPA ever loaded (see oidc_session.py); this path
    // is reached when a session expires mid-use. Fail to the least-privilege
    // role rather than assuming access, and let the caller prompt sign-in.
    return { userKey: DEV_USER_KEY, role: 'reader', ssoConfigured: true, needsSignIn: true, raw: session }
  }
  const role = isRole(session.webui_role) ? session.webui_role : 'reader'
  const userKey = (session.subject ?? session.username ?? session.email ?? DEV_USER_KEY).trim() || DEV_USER_KEY
  return { userKey, role, ssoConfigured: true, needsSignIn: false, raw: session }
}

const UNRESOLVED_IDENTITY: Identity = {
  userKey: DEV_USER_KEY,
  role: 'admin',
  ssoConfigured: false,
  needsSignIn: false,
  raw: null,
}

/**
 * The one hook every role check in the app (nav filtering, the route guard,
 * per-user storage keys) should call. Resolves once on mount; `/auth/session`
 * is a cheap same-origin cookie check, not worth polling for this UI.
 */
export function useIdentity(): { identity: Identity; loading: boolean } {
  const [state, setState] = useState<{ identity: Identity; loading: boolean }>({
    identity: UNRESOLVED_IDENTITY,
    loading: true,
  })

  useEffect(() => {
    let cancelled = false
    void fetchAuthSession().then(({ session, ssoConfigured }) => {
      if (cancelled) return
      setState({ identity: resolveIdentity(session, ssoConfigured), loading: false })
    })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

export const DEV_IDENTITY_USER_KEY = DEV_USER_KEY
