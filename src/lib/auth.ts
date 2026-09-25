/**
 * @file auth.ts
 * @description Reads the signed-in principal's identity and role from the one
 * server-side identity boundary: Graph OS's identity broker
 * (`graph_os/identity`, which owns `/auth/*` whenever the WebUI is served by
 * Graph OS) or, for a standalone WebUI, the single-client OIDC boundary
 * (`agent/agent_webui/oidc_session.py`).
 *
 * This is deliberately NOT a second auth path: the `webui_role` that
 * `/auth/session` reports is computed server-side (`agent/agent_webui/rbac.py`)
 * from the principal's verified scopes — the frontend never derives a role
 * itself, it only renders what the server decided. There is no
 * "unconfigured means full access" fallback any more (IDM-07): when
 * `/auth/session` does not answer, the identity is unknown, which renders as
 * the least-privilege role with a sign-in prompt. The `none` auth mode is the
 * demo posture, and it is still a real principal the server resolved (the
 * bootstrap administrator), reported with `mode: "none"` and a banner.
 */
import { useEffect, useState } from 'react'
import { installCsrfToken } from './csrf'
import { isRole, type Role } from './nav-registry'

/** The deployment's auth mode, as the identity broker reports it. */
export type AuthMode = 'none' | 'local' | 'external'

/** Shape returned by `GET /auth/session` (see `oidc_session.py::_handle_session`). */
export interface AuthSession {
  authenticated: boolean
  subject?: string | null
  username?: string | null
  email?: string | null
  /** The IdP's `name` claim (display name). Optional per OIDC -- not every
   *  client scope configuration includes it. */
  name?: string | null
  /** The IdP's `picture` claim (avatar URL). Optional -- Keycloak omits it
   *  unless the account has one set. */
  picture?: string | null
  tenant?: string | null
  roles: string[]
  /** Computed server-side by `agent/agent_webui/rbac.py::resolve_webui_role`. */
  webui_role?: string | null
  expires_at?: number | null
  /** Graph OS identity broker only: the stored auth mode (`null` while the
   *  first administrator has not been created yet). */
  mode?: AuthMode | null
  /** The banner every surface shows (only the `none` demo mode has one). */
  banner?: string | null
  /** A fresh production install: the first administrator must be created. */
  setup_required?: boolean
  /** The session exists but still owes its second factor. */
  second_factor_required?: boolean
  /** Bound to the session cookie; sent back on every state-changing request. */
  csrf_token?: string | null
  is_bootstrap?: boolean
  mfa_enrolled?: boolean
}

/** The one thing the rest of the app needs: who, and what they may do. */
export interface Identity {
  /** Stable per-user key for namespacing per-user local state (chat history,
   *  dashboard layout, preferences). `'local'` is the placeholder key used
   *  while no principal is known. */
  userKey: string
  role: Role
  /** True when the server's identity boundary answered `/auth/session`. */
  ssoConfigured: boolean
  /** True when no principal is signed in (or the boundary could not be
   *  reached): the UI offers sign-in rather than pretending access. */
  needsSignIn: boolean
  raw: AuthSession | null
}

const DEV_USER_KEY = 'local'

async function fetchAuthSession(): Promise<{ session: AuthSession | null; ssoConfigured: boolean }> {
  try {
    const res = await fetch('/auth/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !contentType.includes('application/json')) {
      // The identity boundary did not answer JSON: the principal is unknown,
      // which renders as least privilege with a sign-in prompt.
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

/** The identity rendered while nothing is known: least privilege, sign in. */
function unknownIdentity(session: AuthSession | null, ssoConfigured: boolean): Identity {
  return { userKey: DEV_USER_KEY, role: 'reader', ssoConfigured, needsSignIn: true, raw: session }
}

/** Pure mapping from a raw session (or its absence) to what the app renders.
 *
 * The role only ever comes from the server's `webui_role`; an unreachable
 * boundary, a signed-out browser and a session still owing its second factor
 * all render as the least-privilege role with a sign-in prompt. */
export function resolveIdentity(session: AuthSession | null, ssoConfigured: boolean): Identity {
  if (!ssoConfigured || !session?.authenticated) return unknownIdentity(session, ssoConfigured)
  const role = isRole(session.webui_role) ? session.webui_role : 'reader'
  const userKey = (session.subject ?? session.username ?? session.email ?? DEV_USER_KEY).trim() || DEV_USER_KEY
  return { userKey, role, ssoConfigured: true, needsSignIn: false, raw: session }
}

/** The document title while the install runs in the `none` demo mode. */
export function titleForMode(title: string, mode: AuthMode | null | undefined): string {
  return mode === 'none' ? `[DEMO] ${title}` : title
}

const UNRESOLVED_IDENTITY: Identity = {
  userKey: DEV_USER_KEY,
  role: 'reader',
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
      installCsrfToken(session?.csrf_token ?? null)
      setState({ identity: resolveIdentity(session, ssoConfigured), loading: false })
    })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

export const DEV_IDENTITY_USER_KEY = DEV_USER_KEY
