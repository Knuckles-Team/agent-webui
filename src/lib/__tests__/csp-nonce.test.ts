import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadWithMeta(nonce: string | null) {
  document.head.querySelectorAll('meta[property="csp-nonce"]').forEach((node) => {
    node.remove()
  })
  if (nonce !== null) {
    const meta = document.createElement('meta')
    meta.setAttribute('property', 'csp-nonce')
    meta.setAttribute('nonce', nonce)
    document.head.append(meta)
  }
  vi.resetModules()
  return import('../csp-nonce')
}

describe('csp nonce', () => {
  afterEach(() => {
    delete (globalThis as { __webpack_nonce__?: string }).__webpack_nonce__
  })

  it('reads the server nonce and exposes it to get-nonce', async () => {
    const { cspNonce, installCspNonce } = await loadWithMeta('server-nonce-1')
    expect(cspNonce()).toBe('server-nonce-1')
    installCspNonce()
    expect((globalThis as { __webpack_nonce__?: string }).__webpack_nonce__).toBe('server-nonce-1')
  })

  it('ignores the unreplaced build placeholder', async () => {
    const { cspNonce, installCspNonce } = await loadWithMeta('AGENT_WEBUI_CSP_NONCE')
    expect(cspNonce()).toBeUndefined()
    installCspNonce()
    expect((globalThis as { __webpack_nonce__?: string }).__webpack_nonce__).toBeUndefined()
  })

  it('returns undefined without a nonce meta tag', async () => {
    const { cspNonce } = await loadWithMeta(null)
    expect(cspNonce()).toBeUndefined()
  })
})
