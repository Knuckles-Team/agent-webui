/**
 * Per-response CSP nonce for runtime <style> elements.
 *
 * The server replaces the build placeholder in `<meta property="csp-nonce">`
 * with a fresh nonce and adds it to `style-src-elem`. Libraries that insert
 * <style> elements read it from here, so the policy never needs 'unsafe-inline'.
 */
const NONCE_PLACEHOLDER = 'AGENT_WEBUI_CSP_NONCE'

let cached: string | undefined | null = null

export function cspNonce(): string | undefined {
  if (cached !== null) return cached
  const meta =
    typeof document === 'undefined' ? null : document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')
  // Browsers hide the attribute value after parsing; the property keeps it.
  const fromProperty = meta?.nonce ?? ''
  const nonce = fromProperty !== '' ? fromProperty : (meta?.getAttribute('nonce') ?? '')
  cached = nonce && nonce !== NONCE_PLACEHOLDER ? nonce : undefined
  return cached
}

/**
 * Expose the nonce to react-remove-scroll (Radix Dialog, Select and Menu).
 * Its react-style-singleton reads `__webpack_nonce__` through get-nonce.
 */
export function installCspNonce(): void {
  const nonce = cspNonce()
  if (nonce) (globalThis as { __webpack_nonce__?: string }).__webpack_nonce__ = nonce
}
