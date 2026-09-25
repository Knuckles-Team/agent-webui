import { describe, expect, it } from 'vitest'
import { resolveIdentity, titleForMode, type AuthSession } from '@/lib/auth'

const SIGNED_IN: AuthSession = {
  authenticated: true,
  subject: 'usr:0001',
  username: 'alice',
  roles: ['kg:read'],
  webui_role: 'user',
  mode: 'local',
}

describe('resolveIdentity (IDM-07: the frontend never derives a role)', () => {
  it('renders the server-decided role for a signed-in principal', () => {
    const identity = resolveIdentity(SIGNED_IN, true)
    expect(identity).toMatchObject({ userKey: 'usr:0001', role: 'user', needsSignIn: false })
  })

  it('never grants admin when the identity boundary does not answer', () => {
    const identity = resolveIdentity(null, false)
    expect(identity.role).toBe('reader')
    expect(identity.needsSignIn).toBe(true)
  })

  it('treats a signed-out browser as least privilege with a sign-in prompt', () => {
    const identity = resolveIdentity({ authenticated: false, roles: [], mode: 'local' }, true)
    expect(identity).toMatchObject({ role: 'reader', needsSignIn: true })
  })

  it('keeps a session still owing its second factor signed out', () => {
    const pending = { ...SIGNED_IN, authenticated: false, second_factor_required: true }
    expect(resolveIdentity(pending, true).needsSignIn).toBe(true)
  })

  it('falls back to reader for an unknown server role', () => {
    expect(resolveIdentity({ ...SIGNED_IN, webui_role: 'root' }, true).role).toBe('reader')
  })

  it('renders none mode as the server resolved bootstrap administrator', () => {
    const bootstrap = { ...SIGNED_IN, subject: 'usr:bootstrap', webui_role: 'admin', mode: 'none' as const }
    expect(resolveIdentity(bootstrap, true)).toMatchObject({ userKey: 'usr:bootstrap', role: 'admin' })
  })
})

describe('titleForMode', () => {
  it('marks every title in the none demo mode', () => {
    expect(titleForMode('Dashboard', 'none')).toBe('[DEMO] Dashboard')
    expect(titleForMode('Dashboard', 'local')).toBe('Dashboard')
    expect(titleForMode('Dashboard', undefined)).toBe('Dashboard')
  })
})
